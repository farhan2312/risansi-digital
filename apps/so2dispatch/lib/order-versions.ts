import "server-only";

import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { PUMP_LIKE } from "@/lib/order-schema";
import { canOpenVersions } from "@/lib/roles";

type Row = Record<string, unknown>;

/**
 * An SO as it stood at one version: the SO, its ECs, and every table holding
 * its data — payment terms and each department's work. Files stored in the
 * database (bytea) are left out; the rows still say a file was there.
 */
export type VersionSnapshot = {
  order: Row;
  items: Row[];
  tables: Record<string, Row[]>;
};

/** A frozen version, as the history lists it. */
export type OrderVersion = {
  id: string;
  version_no: number;
  reason: string;
  created_by_name: string | null;
  created_at: string;
};

/** The tables read straight off the SO (order_id), and the columns left out of each. */
const SO_TABLES: Record<string, string[]> = {
  order_payment_terms: [],
  order_billing: [],
  order_billing_docs: [],
  order_accounts: [],
  order_dispatch: [],
  order_invoices: ["lr_file_data"],
  order_packing_slips: [],
  order_wooden_boxes: [],
  order_target_revisions: [],
  order_assembly_plans: [],
  order_dept_completions: [],
  order_drawing_readiness_history: [],
  order_followups: [],
  order_om_status_history: [],
  order_pendency: [],
};

/** The tables read off its ECs (item_id). */
const EC_TABLES: Record<string, string[]> = {
  order_drawing: [],
  order_drawing_revisions: [],
  order_drawing_documents: [],
  order_part_drawings: [],
  order_purchase: [],
  order_boi_items: [],
  order_qc: [],
  order_qc_doc_links: [],
  order_qc_documents: ["file_data"],
  order_qc_requirement_documents: ["file_data"],
  order_planning: [],
  order_part_shortages: [],
  order_ready_lots: [],
  order_ready_lot_history: [],
  order_lots: [],
  order_assembly_dispatch: [],
  order_lot_assembly: [],
  order_packing_plan_history: [],
};

const strip = (cols: string[]) => cols.map((c) => ` - '${c}'`).join("");
const agg = (t: string, cols: string[], where: string) =>
  `'${t}', (SELECT COALESCE(jsonb_agg(to_jsonb(x)${strip(cols)}), '[]'::jsonb) FROM ${t} x WHERE ${where})`;

const ITEMS = `(SELECT id FROM order_items WHERE order_id = o.id)`;

/** One query reading the whole SO as it stands. */
const SNAPSHOT_SQL = `
  SELECT jsonb_build_object(
           'order', to_jsonb(o),
           'items', (SELECT COALESCE(jsonb_agg((to_jsonb(it) - 'order_copy_file_data') ORDER BY it.seq), '[]'::jsonb)
                       FROM order_items it WHERE it.order_id = o.id),
           'tables', jsonb_build_object(${[
             ...Object.entries(SO_TABLES).map(([t, c]) => agg(t, c, "x.order_id = o.id")),
             ...Object.entries(EC_TABLES).map(([t, c]) => agg(t, c, `x.item_id IN ${ITEMS}`)),
             agg("order_invoice_slips", [], "x.invoice_id IN (SELECT id FROM order_invoices WHERE order_id = o.id)"),
             agg(
               "order_picture_links",
               [],
               `x.invoice_id IN (SELECT id FROM order_invoices WHERE order_id = o.id)
                OR x.packing_slip_id IN (SELECT id FROM order_packing_slips WHERE order_id = o.id)`
             ),
             agg("order_boi_expected_history", [], `x.boi_item_id IN (SELECT id FROM order_boi_items WHERE item_id IN ${ITEMS})`),
           ].join(",\n")}),
           -- Who the rows name, by id: read now, so the version keeps naming them.
           'users', (SELECT COALESCE(jsonb_object_agg(u.id, COALESCE(NULLIF(btrim(u.full_name), ''), u.email)), '{}'::jsonb) FROM users u)
         ) AS snap
    FROM orders o
   WHERE o.id = $1`;

type Runner = { query: PoolClient["query"] } | null;

/** The SO as it stands now. */
export async function readSnapshot(orderId: string, client: Runner = null): Promise<VersionSnapshot | null> {
  const r = client
    ? await client.query<{ snap: VersionSnapshot }>(SNAPSHOT_SQL, [orderId])
    : await query<{ snap: VersionSnapshot }>(SNAPSHOT_SQL, [orderId]);
  return r.rows[0]?.snap ?? null;
}

/** Only a Pump SO is versioned. */
export const isVersionedType = (orderType: unknown) => PUMP_LIKE.includes(String(orderType ?? "").trim());

/** The SO's frozen versions, oldest first. */
export async function listOrderVersions(orderId: string): Promise<OrderVersion[]> {
  const r = await query<OrderVersion>(
    `SELECT id, version_no, reason, created_by_name, created_at::text AS created_at
       FROM order_versions WHERE order_id = $1 ORDER BY version_no`,
    [orderId]
  );
  return r.rows;
}

/** One frozen version, whole. */
export async function getOrderVersion(orderId: string, versionNo: number): Promise<(OrderVersion & { snapshot: VersionSnapshot }) | null> {
  const r = await query<OrderVersion & { snapshot: VersionSnapshot }>(
    `SELECT id, version_no, reason, created_by_name, created_at::text AS created_at, snapshot
       FROM order_versions WHERE order_id = $1 AND version_no = $2`,
    [orderId, versionNo]
  );
  return r.rows[0] ?? null;
}

/**
 * Freeze the SO as it stands as its current version, and move it on to the
 * next. One transaction: the SO is locked while it is read and its number
 * raised, so two clicks cannot freeze the same version twice.
 */
export async function freezeVersion(
  client: PoolClient,
  input: { orderId: string; reason: string; userId: string; userName: string }
): Promise<{ frozen: number; current: number }> {
  const lock = await client.query<{ version_no: number }>(`SELECT version_no FROM orders WHERE id = $1 FOR UPDATE`, [input.orderId]);
  if (lock.rows.length === 0) throw new Error("Order not found.");
  // An SO starts at v0.
  const frozen = Number(lock.rows[0].version_no) || 0;
  const snap = await readSnapshot(input.orderId, client);
  if (!snap) throw new Error("Order not found.");
  await client.query(
    `INSERT INTO order_versions (order_id, version_no, reason, snapshot, created_by, created_by_name)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [input.orderId, frozen, input.reason, JSON.stringify(snap), input.userId, input.userName]
  );
  await client.query(`UPDATE orders SET version_no = version_no + 1, updated_at = now() WHERE id = $1`, [input.orderId]);
  return { frozen, current: frozen + 1 };
}

/** What a versions view shows: the version picked, the one before it, and the list. */
export type VersionsData = {
  orderId: string;
  soLabel: string;
  client: string;
  orderType: string;
  currentNo: number;
  picked: number;
  versions: OrderVersion[];
  snap: VersionSnapshot;
  /** The version before the one picked, to say what changed in it. */
  before: VersionSnapshot | null;
  /** The version picked, when it is a frozen one. */
  frozen: OrderVersion | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An SO's versions, for Order Making, Central Visibility and Admin (the
 * departments see only its number), at the version asked (the current one
 * when not asked). Null when there is no such SO or it is not theirs to open.
 */
export async function getVersionsData(
  orderId: string,
  asked: number | null,
  viewer: { role: string; rep_names?: readonly string[] | null }
): Promise<VersionsData | null> {
  if (!UUID_RE.test(orderId) || !canOpenVersions(viewer.role)) return null;
  const [current, versions] = await Promise.all([readSnapshot(orderId), listOrderVersions(orderId)]);
  if (!current) return null;
  // An SO starts at v0.
  const currentNo = Number(current.order.version_no ?? 0) || 0;
  const picked = Math.min(Math.max(asked ?? currentNo, 0), currentNo);
  const [frozenRow, beforeRow] = await Promise.all([
    picked < currentNo ? getOrderVersion(orderId, picked) : null,
    picked > 0 ? getOrderVersion(orderId, picked - 1) : null,
  ]);
  const { snapshot: frozenSnap, ...frozen } = frozenRow ?? { snapshot: null };
  return {
    orderId,
    soLabel: String(current.order.so_no ?? `#${current.order.sl_no}`),
    client: String(current.order.client_name ?? ""),
    orderType: String(current.order.order_type ?? ""),
    currentNo,
    picked,
    versions,
    snap: frozenSnap ?? current,
    before: beforeRow?.snapshot ?? null,
    frozen: frozenRow ? (frozen as OrderVersion) : null,
  };
}

/** The departments a version change is told to, by the role that reads it. */
export const VERSION_DEPT_ROLES: Record<string, string> = {
  drawing: "drawing",
  purchase: "purchase",
  quality: "qc",
  planning: "planning",
  assembly: "assembly",
  dispatch: "dispatch",
  billing: "operations",
  accounts: "accounts",
};
