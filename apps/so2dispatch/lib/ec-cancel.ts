// An EC the client no longer wants: cancelled, not deleted.
//
//   Not packed                    → cancelled at once; every department drops it
//   Packed, on no packing slip    → cancelled, with what happens to the packed goods
//   On a packing slip / invoiced  → refused (Dispatch takes it off the slip first;
//                                   an invoiced EC is a return, not a cancellation)
//
// The EC and every department's rows on it are kept as they stood (a JSON
// snapshot in order_item_cancellations), then the EC is removed — so every
// queue, lot, count and status leaves it out without each of them having to.

import "server-only";
import { query, withTransaction } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DISPOSITIONS = ["Keep as stock", "Dismantle / reuse", "Divert to another SO"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export type CancelCheck = {
  /** Why it cannot be cancelled, or null. */
  blocked: string | null;
  /** Something of it is packed: what happens to the packed goods is asked. */
  packed: boolean;
  ecNo: string | null;
};

/** Whether this EC can be cancelled, and whether it is packed. */
export async function checkEcCancel(itemId: string): Promise<CancelCheck | null> {
  if (!UUID_RE.test(itemId)) return null;
  const r = await query<{
    ec_no: string | null;
    invoiced: boolean;
    own_slip: string | null;
    lot_slip: string | null;
    packed: boolean;
  }>(
    `SELECT it.ec_no,
            EXISTS (SELECT 1 FROM order_invoices iv WHERE iv.item_id = it.id) AS invoiced,
            -- A packing slip raised on this EC itself: one Packing made (numbered
            -- or not), or any on a dispatch — removing the EC would remove it.
            (SELECT COALESCE(NULLIF(btrim(ps.packing_slip_no), ''), '(no number)') FROM order_packing_slips ps
              WHERE ps.item_id = it.id
                AND (ps.kind = 'actual'
                     OR EXISTS (SELECT 1 FROM order_invoice_slips x WHERE x.packing_slip_id = ps.id)
                     OR EXISTS (SELECT 1 FROM order_invoices iv WHERE iv.packing_slip_id = ps.id))
              ORDER BY ps.seq LIMIT 1) AS own_slip,
            -- A packed lot of this EC that one of the SO's slips carries.
            (SELECT btrim(ps.packing_slip_no)
               FROM (SELECT rl.packed_date, (row_number() OVER (ORDER BY rl.seq))::int AS n
                       FROM order_ready_lots rl WHERE rl.item_id = it.id) l
               JOIN order_packing_slips ps ON ps.order_id = it.order_id AND ps.kind = 'actual'
                AND NULLIF(btrim(ps.packing_slip_no), '') IS NOT NULL AND l.n = ANY(ps.lot_nos)
              WHERE l.packed_date IS NOT NULL
              ORDER BY ps.seq LIMIT 1) AS lot_slip,
            (EXISTS (SELECT 1 FROM order_ready_lots rl WHERE rl.item_id = it.id AND rl.packed_date IS NOT NULL)
             OR EXISTS (SELECT 1 FROM order_assembly_dispatch ad WHERE ad.item_id = it.id AND ad.actual_packing_date IS NOT NULL)) AS packed
       FROM order_items it WHERE it.id = $1`,
    [itemId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const ec = row.ec_no ?? "This EC";
  const slip = row.own_slip || row.lot_slip;
  const blocked = row.invoiced
    ? `${ec} is on a dispatch (invoice or challan). It can't be cancelled; that is a return.`
    : slip
      ? `${ec} is on packing slip ${slip}. Dispatch takes it off the slip first.`
      : null;
  return { blocked, packed: row.packed, ecNo: row.ec_no };
}

/** The EC and every table's rows on it, without file contents, as one JSON. */
async function snapshot(c: Parameters<Parameters<typeof withTransaction>[0]>[0], itemId: string) {
  // Every table that points at order_items, found rather than listed, so a
  // department table added later is kept too.
  const refs = await c.query<{ tbl: string; col: string }>(
    `SELECT cl.relname AS tbl, a.attname AS col
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
      WHERE con.confrelid = 'order_items'::regclass AND con.contype = 'f'
      ORDER BY cl.relname`
  );
  const bytea = async (tbl: string) =>
    (
      await c.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND data_type = 'bytea'`,
        [tbl]
      )
    ).rows.map((x) => x.column_name);
  const item = await c.query<{ j: Record<string, unknown> }>(
    `SELECT to_jsonb(t) - $2::text[] AS j FROM order_items t WHERE t.id = $1`,
    [itemId, await bytea("order_items")]
  );
  const children: Record<string, unknown[]> = {};
  for (const { tbl, col } of refs.rows) {
    // Names from the catalogue, quoted.
    const rows = await c.query<{ j: unknown[] }>(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t) - $2::text[]), '[]'::jsonb) AS j FROM "${tbl.replace(/"/g, '""')}" t WHERE t."${col.replace(/"/g, '""')}" = $1`,
      [itemId, await bytea(tbl)]
    );
    if (rows.rows[0]?.j?.length) children[tbl] = rows.rows[0].j;
  }
  return { item: item.rows[0]?.j ?? null, children };
}

/**
 * Cancel the EC: kept, then removed. Refused while it is on a slip or a
 * dispatch; a packed EC needs what happens to its goods. Returns the SO's id.
 */
export async function cancelEc(input: {
  itemId: string;
  reason: string;
  disposition: string | null;
  dispositionNote: string | null;
  userId: string;
  userName: string;
}): Promise<{ ok: true; orderId: string; ecNo: string | null; packed: boolean } | { ok: false; error: string }> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Give the reason the client cancelled it." };
  const check = await checkEcCancel(input.itemId);
  if (!check) return { ok: false, error: "EC not found." };
  if (check.blocked) return { ok: false, error: check.blocked };
  const disposition = (input.disposition ?? "").trim();
  if (check.packed && !DISPOSITIONS.includes(disposition as Disposition)) {
    return { ok: false, error: "It is packed: say what happens to the packed goods." };
  }
  return withTransaction(async (c) => {
    const it = await c.query<{ order_id: string; ec_no: string | null; item_type: string | null; model_no: string | null; quantity: number | null; version_no: number | null }>(
      `SELECT it.order_id, it.ec_no, it.item_type, it.model_no, it.quantity, o.version_no
         FROM order_items it JOIN orders o ON o.id = it.order_id
        WHERE it.id = $1 FOR UPDATE OF it`,
      [input.itemId]
    );
    const row = it.rows[0];
    if (!row) return { ok: false as const, error: "EC not found." };
    const snap = await snapshot(c, input.itemId);
    await c.query(
      `INSERT INTO order_item_cancellations
         (order_id, item_id, ec_no, item_type, model_no, quantity, version_no, reason,
          was_packed, disposition, disposition_note, snapshot, cancelled_by, cancelled_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, ''), NULLIF($11, ''), $12::jsonb, $13, $14)`,
      [
        row.order_id,
        input.itemId,
        row.ec_no,
        row.item_type,
        row.model_no,
        row.quantity,
        row.version_no ?? 0,
        reason,
        check.packed,
        check.packed ? disposition : "",
        check.packed ? (input.dispositionNote ?? "").trim() : "",
        JSON.stringify(snap),
        UUID_RE.test(input.userId) ? input.userId : null,
        input.userName,
      ]
    );
    await c.query(`DELETE FROM order_items WHERE id = $1`, [input.itemId]);
    return { ok: true as const, orderId: row.order_id, ecNo: row.ec_no, packed: check.packed };
  });
}

export type EcCancellation = {
  id: string;
  ec_no: string | null;
  item_type: string | null;
  model_no: string | null;
  quantity: number | null;
  version_no: number | null;
  reason: string;
  was_packed: boolean;
  disposition: string | null;
  disposition_note: string | null;
  cancelled_by_name: string | null;
  cancelled_at: string;
};

/** The SO's cancelled ECs, newest first. */
export async function listEcCancellations(orderId: string): Promise<EcCancellation[]> {
  if (!UUID_RE.test(orderId)) return [];
  const r = await query<EcCancellation>(
    `SELECT id, ec_no, item_type, model_no, quantity, version_no, reason, was_packed,
            disposition, disposition_note, cancelled_by_name, cancelled_at::text AS cancelled_at
       FROM order_item_cancellations WHERE order_id = $1 ORDER BY cancelled_at DESC`,
    [orderId]
  );
  return r.rows;
}
