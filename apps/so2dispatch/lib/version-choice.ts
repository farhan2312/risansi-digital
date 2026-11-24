// A department's choice on a new SO version, made once per version:
//
//   Not needed   no work for it: its data stays as in the version before
//   Copy         acknowledged; its work carries over from the version before
//   Flush        acknowledged; its work on the ECs added or changed in this
//                version is cleared, to start again from zero
//
// The new version is a copy of the one before, so Not needed and Copy leave
// the data as it is; only Flush clears. The version before keeps every
// department's work either way (order_versions). Choosing also acknowledges
// the EC changes as they stand.

import "server-only";
import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
import { ackEcVersionChanges, listEcVersionChanges } from "@/lib/ec-version-changes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

import { CHOICE_DEPTS, VERSION_CHOICES, type DeptChoice, type VersionChoice } from "@/lib/version-dept-choice";
export { CHOICE_DEPTS, CHOICE_LABEL, VERSION_CHOICES, type DeptChoice, type VersionChoice } from "@/lib/version-dept-choice";

/** What the departments chose on the SO's version `versionNo` (every department, or one). */
export async function listVersionChoices(orderId: string, versionNo: number, dept: string | null = null): Promise<DeptChoice[]> {
  if (!UUID_RE.test(orderId)) return [];
  const r = await query<DeptChoice>(
    `SELECT dept, choice, flushed_ecs, chosen_by_name, chosen_at::text AS chosen_at
       FROM order_version_dept_choices
      WHERE order_id = $1 AND version_no = $2 AND ($3::text IS NULL OR dept = $3)
      ORDER BY chosen_at`,
    [orderId, versionNo, dept]
  );
  return r.rows;
}

/** Purchase's own columns on an EC's BOI items (the items themselves are Order Making's). */
const BOI_PURCHASE_COLS = [
  "stock_allocated_qty",
  "vendor_order",
  "vendor_code",
  "vendor_name",
  "ril_po_no",
  "ril_po_date",
  "vendor_so_no",
  "vendor_so_date",
  "order_qty",
  "expected_receipt_date",
  "rate_per_unit",
  "received_qty",
  "receipt_date",
  "remarks",
];

/** Planning's own columns on an EC (part_drawing, Standard or Non Standard, is Drawing's). */
const PLANNING_COLS = [
  "planning_documents_required",
  "pump_readiness_remarks",
  "planning_readiness_date",
  "planning_status",
  "actual_pump_status",
  "assembled_packed_qty",
  "assembly_date",
  "spare_readiness_remarks",
  "actual_spare_status",
  "assembly_remarks",
  "packing_date",
  "packing_remarks",
  "readiness_date_status",
  "ready_qty",
];

/** Assembly & Packing's columns on a readiness lot (the lot itself is Planning's). */
const LOT_ASSEMBLY_COLS = [
  "packing_status",
  "packed_date",
  "packing_plan_date",
  "packing_shift",
  "pdi",
  "assembly_plan_date",
  "assembly_shift",
  "assembled_date",
  "pump_packing_status",
  "packing_remarks",
  "assembly_remarks",
  "final_alignment",
  "recheck_at",
  "recheck_note",
];

const nulls = (cols: string[]) => cols.map((c) => `${c} = NULL`).join(", ");

/** Why the department cannot flush these ECs, or null. */
async function flushBlocked(db: Pick<PoolClient, "query">, dept: string, itemIds: string[]): Promise<string | null> {
  if (itemIds.length === 0) return null;
  if (dept === "planning") {
    // Its readiness lots carry Assembly & Packing's work: not while any is planned, assembled or packed.
    const r = await db.query<{ ec_no: string | null }>(
      `SELECT it.ec_no FROM order_items it
        WHERE it.id = ANY($1::uuid[])
          AND (EXISTS (SELECT 1 FROM order_lot_assembly la WHERE la.item_id = it.id)
               OR EXISTS (SELECT 1 FROM order_ready_lots rl WHERE rl.item_id = it.id AND rl.packed_date IS NOT NULL))
        ORDER BY it.seq LIMIT 1`,
      [itemIds]
    );
    if (r.rows[0]) {
      return `EC ${r.rows[0].ec_no ?? ""} already has assembly planned, assembled or packed on its lots. Ask Assembly & Packing to clear theirs first, then flush.`;
    }
  }
  if (dept === "assembly") {
    // Not what has gone out, or is on a numbered packing slip.
    const r = await db.query<{ ec_no: string | null; why: string }>(
      `SELECT it.ec_no,
              CASE WHEN EXISTS (SELECT 1 FROM order_invoices iv WHERE iv.item_id = it.id) THEN 'is on a dispatch'
                   ELSE 'is on a packing slip' END AS why
         FROM order_items it
        WHERE it.id = ANY($1::uuid[])
          AND (EXISTS (SELECT 1 FROM order_invoices iv WHERE iv.item_id = it.id)
               OR EXISTS (SELECT 1
                            FROM (SELECT rl.packed_date, (row_number() OVER (ORDER BY rl.seq))::int AS n
                                    FROM order_ready_lots rl WHERE rl.item_id = it.id) l
                            JOIN order_packing_slips ps ON ps.order_id = it.order_id AND ps.kind = 'actual'
                             AND NULLIF(btrim(ps.packing_slip_no), '') IS NOT NULL AND l.n = ANY(ps.lot_nos)
                           WHERE l.packed_date IS NOT NULL))
        ORDER BY it.seq LIMIT 1`,
      [itemIds]
    );
    if (r.rows[0]) return `EC ${r.rows[0].ec_no ?? ""} ${r.rows[0].why}: its packing cannot be cleared. Ask Dispatch first.`;
  }
  return null;
}

/** Clear the department's own work on these ECs. */
async function flushDept(c: PoolClient, dept: string, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const ids = [itemIds];
  if (dept === "drawing") {
    await c.query(`DELETE FROM order_drawing WHERE item_id = ANY($1::uuid[])`, ids);
    // Its GAD and Performance Curve versions (their documents go with them), and the part drawings.
    await c.query(`DELETE FROM order_drawing_revisions WHERE item_id = ANY($1::uuid[])`, ids);
    await c.query(`DELETE FROM order_drawing_documents WHERE item_id = ANY($1::uuid[])`, ids);
    await c.query(`DELETE FROM order_part_drawings WHERE item_id = ANY($1::uuid[])`, ids);
    await c.query(`UPDATE order_planning SET part_drawing = NULL WHERE item_id = ANY($1::uuid[])`, ids);
    await c.query(`UPDATE order_items SET gad_required = NULL, gad_remarks = NULL WHERE id = ANY($1::uuid[])`, ids);
  } else if (dept === "purchase") {
    await c.query(`DELETE FROM order_purchase WHERE item_id = ANY($1::uuid[])`, ids);
    // The BOI items stay (Order Making's); what Purchase recorded on them goes.
    await c.query(
      `DELETE FROM order_boi_expected_history WHERE boi_item_id IN (SELECT id FROM order_boi_items WHERE item_id = ANY($1::uuid[]))`,
      ids
    );
    await c.query(`UPDATE order_boi_items SET ${nulls(BOI_PURCHASE_COLS)} WHERE item_id = ANY($1::uuid[])`, ids);
  } else if (dept === "qc") {
    for (const t of ["order_qc", "order_qc_doc_links", "order_qc_documents", "order_qc_requirement_documents"]) {
      await c.query(`DELETE FROM ${t} WHERE item_id = ANY($1::uuid[])`, ids);
    }
  } else if (dept === "planning") {
    // Its readiness lots (and their history), the old lot rows, part shortages, and its fields.
    for (const t of ["order_ready_lots", "order_lots", "order_part_shortages"]) {
      await c.query(`DELETE FROM ${t} WHERE item_id = ANY($1::uuid[])`, ids);
    }
    await c.query(`UPDATE order_planning SET ${nulls(PLANNING_COLS)} WHERE item_id = ANY($1::uuid[])`, ids);
  } else if (dept === "assembly") {
    // Its assembly entries, what it recorded on Planning's lots, and its packed date.
    await c.query(`DELETE FROM order_lot_assembly WHERE item_id = ANY($1::uuid[])`, ids);
    await c.query(`UPDATE order_ready_lots SET ${nulls(LOT_ASSEMBLY_COLS)} WHERE item_id = ANY($1::uuid[])`, ids);
    await c.query(`DELETE FROM order_assembly_dispatch WHERE item_id = ANY($1::uuid[])`, ids);
  }
}

/**
 * The department's choice on the SO's current version. Refused once it has
 * chosen on this version, before any version is made, and for a Flush the
 * ECs' state forbids. Acknowledges the EC changes as they stand.
 */
export async function chooseOnVersion(
  orderId: string,
  dept: string,
  choice: string,
  user: { id: string; name: string }
): Promise<{ ok: true; version: number; flushedEcs: string[] } | { ok: false; error: string }> {
  if (!UUID_RE.test(orderId)) return { ok: false, error: "SO not found." };
  if (!CHOICE_DEPTS[dept]) return { ok: false, error: "Only Drawing, Purchase, Quality, Planning and Assembly & Packing choose on a version." };
  if (!VERSION_CHOICES.includes(choice as VersionChoice)) return { ok: false, error: "Choose Not needed, Copy or Flush." };
  const changes = (await listEcVersionChanges([orderId], dept))[orderId];
  // Flush: the ECs added or changed in this version (a removed one is gone already).
  const targets = (changes?.changes ?? []).filter((c) => c.kind !== "removed").map((c) => ({ id: c.itemId, ec: c.ecNo ?? "" }));
  const result = await withTransaction(async (c) => {
    const so = await c.query<{ version_no: number }>(`SELECT version_no FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const version = Number(so.rows[0]?.version_no ?? 0) || 0;
    if (!so.rows[0]) return { ok: false as const, error: "SO not found." };
    if (version < 1) return { ok: false as const, error: "The SO has no new version to choose on." };
    const had = await c.query(`SELECT 1 FROM order_version_dept_choices WHERE order_id = $1 AND version_no = $2 AND dept = $3`, [orderId, version, dept]);
    if (had.rows.length) return { ok: false as const, error: "Your department has already chosen on this version." };
    const flush = choice === "flush" ? targets : [];
    if (flush.length) {
      const blocked = await flushBlocked(c, dept, flush.map((t) => t.id));
      if (blocked) return { ok: false as const, error: blocked };
      await flushDept(c, dept, flush.map((t) => t.id));
    }
    await c.query(
      `INSERT INTO order_version_dept_choices (order_id, version_no, dept, choice, flushed_items, flushed_ecs, chosen_by, chosen_by_name)
       VALUES ($1, $2, $3, $4, $5::uuid[], $6::text[], $7, $8)`,
      [orderId, version, dept, choice, flush.map((t) => t.id), flush.map((t) => t.ec), UUID_RE.test(user.id) ? user.id : null, user.name]
    );
    return { ok: true as const, version, flushedEcs: flush.map((t) => t.ec) };
  });
  if (result.ok) await ackEcVersionChanges(orderId, dept, user);
  return result;
}
