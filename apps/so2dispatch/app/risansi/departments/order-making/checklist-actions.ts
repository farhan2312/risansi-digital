"use server";

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { canAccessOrderMaking, canViewOrderMaking, isCentral, isOrderMaking } from "@/lib/roles";
import { checklistFor, type ChecklistTeam } from "@/lib/so-checklist";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChecklistAnswer = {
  point_key: string;
  answer: string | null;
  remarks: string | null;
  filled_by_name: string | null;
  filled_at: string;
};

export type ChecklistData = {
  orderId: string;
  soNo: string | null;
  slNo: number;
  soDate: string | null;
  orderType: string | null;
  versionNo: number;
  /** The SO's own values for the auto points, by the point's column. */
  auto: Record<string, string | null>;
  /** The answers, by version (the current one and any before it). */
  versions: Record<number, ChecklistAnswer[]>;
  /** Which points this user fills: the SO team's (the SO's assignee), the PO team's. */
  can: Record<ChecklistTeam, boolean>;
};

type OrderHead = {
  so_no: string | null;
  sl_no: number;
  so_date: string | null;
  order_type: string | null;
  version_no: number;
  so_assignee_id: string | null;
} & Record<string, string | number | null>;

async function loadHead(orderId: string): Promise<OrderHead | null> {
  const r = await query<OrderHead>(
    `SELECT o.so_no, o.sl_no::int AS sl_no, to_char(o.so_date, 'YYYY-MM-DD') AS so_date, o.order_type,
            COALESCE(o.version_no, 0)::int AS version_no, o.so_assignee_id,
            o.industry_type, o.market_type, o.reps, o.payment_terms,
            to_char(o.delivery_date_as_per_so, 'YYYY-MM-DD') AS delivery_date_as_per_so,
            o.ld, to_char(o.ld_date, 'YYYY-MM-DD') AS ld_date, o.freight_terms, o.packing_requirement, o.boi,
            -- Base plate: Yes when any EC asks for one.
            CASE WHEN EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.base_plate = 'Yes') THEN 'Yes'
                 WHEN EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id) THEN 'No' END AS base_plate
       FROM orders o WHERE o.id = $1`,
    [orderId]
  );
  return r.rows[0] ?? null;
}

/** Who fills which points: the SO team's, the member it is assigned to; the rest, Order Making PO. Central and Admin, both. */
function teamsFor(user: { id: string; role: string }, assigneeId: string | null): Record<ChecklistTeam, boolean> {
  const central = isCentral(user.role);
  const may = canAccessOrderMaking(user.role);
  return {
    SO: may && (central || (!!assigneeId && assigneeId === user.id)),
    PO: central || isOrderMaking(user.role),
  };
}

/** The SO's checklist: its points' answers by version, the SO's own values, and what this user fills. */
export async function getChecklistAction(orderId: string): Promise<{ ok: true; data: ChecklistData } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canViewOrderMaking(user.role)) return { ok: false, error: "No access." };
  if (!UUID_RE.test(orderId)) return { ok: false, error: "Order not found." };
  const head = await loadHead(orderId);
  if (!head) return { ok: false, error: "Order not found." };
  const r = await query<ChecklistAnswer & { version_no: number }>(
    `SELECT version_no, point_key, answer, remarks, filled_by_name, filled_at::text AS filled_at
       FROM order_so_checklist WHERE order_id = $1 ORDER BY version_no, point_key`,
    [orderId]
  );
  const versions: Record<number, ChecklistAnswer[]> = { [head.version_no]: [] };
  for (const { version_no, ...a } of r.rows) (versions[version_no] ??= []).push(a);
  const auto: Record<string, string | null> = {};
  for (const p of checklistFor(head.order_type)) {
    if (p.auto) auto[p.auto] = head[p.auto] == null || head[p.auto] === "" ? null : String(head[p.auto]);
  }
  return {
    ok: true,
    data: {
      orderId,
      soNo: head.so_no,
      slNo: head.sl_no,
      soDate: head.so_date,
      orderType: head.order_type,
      versionNo: head.version_no,
      auto,
      versions,
      can: teamsFor(user, head.so_assignee_id),
    },
  };
}

/**
 * Save the checklist points changed, on the SO's current version. Each point
 * only by its team (see teamsFor); an answer and remark both blank clear it.
 */
export async function saveChecklistAction(
  orderId: string,
  versionNo: number,
  entries: { key: string; answer: string; remarks: string }[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!canAccessOrderMaking(user.role)) return { ok: false, error: "No access." };
  if (!UUID_RE.test(orderId)) return { ok: false, error: "Order not found." };
  if (!Array.isArray(entries) || entries.length === 0) return { ok: true };
  const head = await loadHead(orderId);
  if (!head) return { ok: false, error: "Order not found." };
  if (head.version_no !== versionNo) {
    return { ok: false, error: "A new version of this SO was made: close and open its checklist again." };
  }
  const can = teamsFor(user, head.so_assignee_id);
  const points = new Map(checklistFor(head.order_type).map((p) => [p.key, p]));
  const rows: { key: string; answer: string | null; remarks: string | null }[] = [];
  for (const e of entries) {
    const p = points.get(String(e?.key ?? ""));
    if (!p) return { ok: false, error: "Unknown checklist point." };
    if (!can[p.team]) {
      return {
        ok: false,
        error: p.team === "SO" ? "The green points are for the member this SO is assigned to." : "These points are for Order Making PO.",
      };
    }
    const answer = p.auto ? "" : String(e.answer ?? "").trim();
    if (answer && !(p.options ?? []).includes(answer)) return { ok: false, error: `Pick an answer for "${p.label}".` };
    rows.push({ key: p.key, answer: answer || null, remarks: String(e.remarks ?? "").trim().slice(0, 1000) || null });
  }
  for (const row of rows) {
    if (!row.answer && !row.remarks) {
      await query(`DELETE FROM order_so_checklist WHERE order_id = $1 AND version_no = $2 AND point_key = $3`, [
        orderId,
        versionNo,
        row.key,
      ]);
    } else {
      await query(
        `INSERT INTO order_so_checklist (order_id, version_no, point_key, answer, remarks, filled_by, filled_by_name, filled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (order_id, version_no, point_key)
         DO UPDATE SET answer = EXCLUDED.answer, remarks = EXCLUDED.remarks,
                       filled_by = EXCLUDED.filled_by, filled_by_name = EXCLUDED.filled_by_name, filled_at = now()`,
        [orderId, versionNo, row.key, row.answer, row.remarks, user.id, user.full_name ?? user.email]
      );
    }
  }
  const label = head.so_no || `Sl. ${head.sl_no}`;
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "order.update",
    category: "activity",
    target: label,
    details: `Checklist (v${versionNo}): ${rows
      .map((r) => `${points.get(r.key)!.label} — ${r.answer ?? (r.remarks ? "remark" : "cleared")}`)
      .join("; ")
      .slice(0, 900)}`,
    subject: { orderId, soNo: head.so_no },
  });
  revalidatePath("/risansi/departments/order-making");
  return { ok: true };
}
