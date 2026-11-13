// What changed in a Pump SO's ECs since its last frozen version, as each
// department sees it:
//
//   SO26/1/1913  v2  · 3 EC changes
//     EC/26/1/1913/1  Added
//     EC/26/1/1913/2  Changed: Quantity 4 → 6, Model PX → PY
//     EC/26/1/1913/3  Cancelled by client: no longer needed
//
// Worked out by comparing the ECs as they stand with those in the version
// frozen when this one began (order_versions, version_no - 1), so nothing has
// to be recorded at the moment of each edit. A department acknowledges what it
// has seen; a change made after that shows again.

import "server-only";
import { query } from "@/lib/db";
import { addOnFieldsFor, PUMP_LIKE } from "@/lib/order-schema";

type Row = Record<string, unknown>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The departments that work on ECs, by the role that is theirs. */
const DEPT_OF_ROLE: Record<string, string> = {
  drawing: "drawing",
  purchase: "purchase",
  qc: "qc",
  planning: "planning",
  assembly: "assembly",
};
export const ecChangeDept = (role: string): string | null => DEPT_OF_ROLE[role] ?? null;

export type EcChange = {
  itemId: string;
  ecNo: string | null;
  kind: "added" | "changed" | "removed";
  /** What changed on a changed EC; the reason on a cancelled one. */
  lines: string[];
  /** Acknowledged by the viewer's department (as it stands now). */
  acked: boolean;
  fingerprint: string;
};

export type SoEcChanges = { version: number; changes: EcChange[] };

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const val = (v: unknown, type: string) => {
  const s = str(v);
  return type === "date" ? s.slice(0, 10) : s;
};

/** Each SO's EC changes in its current version, keyed by SO id. Only versioned SOs past v0. */
export async function listEcVersionChanges(orderIds: string[], dept: string | null): Promise<Record<string, SoEcChanges>> {
  const ids = [...new Set(orderIds.filter((id) => UUID_RE.test(id)))];
  if (ids.length === 0) return {};
  const r = await query<{
    order_id: string;
    order_type: string | null;
    version_no: number;
    was: Row[] | null;
    now: Row[];
    cancelled: { item_id: string; reason: string }[];
    acks: { item_id: string; fingerprint: string }[];
  }>(
    `SELECT o.id AS order_id, o.order_type, o.version_no,
            v.snapshot->'items' AS was,
            COALESCE((SELECT jsonb_agg(to_jsonb(it) - 'order_copy_file_data' ORDER BY it.seq)
                        FROM order_items it WHERE it.order_id = o.id), '[]'::jsonb) AS now,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('item_id', c.item_id, 'reason', c.reason))
                        FROM order_item_cancellations c WHERE c.order_id = o.id), '[]'::jsonb) AS cancelled,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('item_id', a.item_id, 'fingerprint', a.fingerprint))
                        FROM order_ec_version_acks a
                       WHERE a.order_id = o.id AND a.version_no = o.version_no AND a.dept = $2), '[]'::jsonb) AS acks
       FROM orders o
       JOIN order_versions v ON v.order_id = o.id AND v.version_no = o.version_no - 1
      WHERE o.id = ANY($1::uuid[]) AND o.version_no > 0 AND o.order_type = ANY($3::text[])`,
    [ids, dept ?? "", PUMP_LIKE]
  );
  const out: Record<string, SoEcChanges> = {};
  for (const row of r.rows) {
    const fields = addOnFieldsFor(row.order_type).filter((f) => f.column !== "ec_link");
    const was = new Map((row.was ?? []).map((it) => [str(it.id), it]));
    const now = new Map(row.now.map((it) => [str(it.id), it]));
    const acked = new Map(row.acks.map((a) => [a.item_id, a.fingerprint]));
    const why = new Map(row.cancelled.map((c) => [c.item_id, c.reason]));
    const changes: EcChange[] = [];
    const push = (itemId: string, ecNo: unknown, kind: EcChange["kind"], lines: string[]) => {
      const fingerprint = JSON.stringify([kind, lines]);
      changes.push({ itemId, ecNo: str(ecNo) || null, kind, lines, fingerprint, acked: acked.get(itemId) === fingerprint });
    };
    for (const [id, it] of now) {
      const before = was.get(id);
      if (!before) {
        push(id, it.ec_no, "added", []);
        continue;
      }
      const lines = fields
        .filter((f) => val(before[f.column], f.type) !== val(it[f.column], f.type))
        .map((f) => `${f.label}: ${val(before[f.column], f.type) || "—"} → ${val(it[f.column], f.type) || "—"}`);
      if (lines.length) push(id, it.ec_no, "changed", lines);
    }
    for (const [id, it] of was) {
      if (now.has(id)) continue;
      const reason = why.get(id);
      push(id, it.ec_no, "removed", [reason ? `Cancelled by client: ${reason}` : "Deleted"]);
    }
    if (changes.length) out[row.order_id] = { version: row.version_no, changes };
  }
  return out;
}

/** The viewer's department has seen the SO's EC changes as they stand now. */
export async function ackEcVersionChanges(orderId: string, dept: string, user: { id: string; name: string }): Promise<void> {
  const all = (await listEcVersionChanges([orderId], dept))[orderId];
  if (!all) return;
  for (const ch of all.changes) {
    await query(
      `INSERT INTO order_ec_version_acks (order_id, item_id, version_no, dept, fingerprint, acked_by, acked_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (item_id, version_no, dept) DO UPDATE
          SET fingerprint = EXCLUDED.fingerprint, acked_by = EXCLUDED.acked_by,
              acked_by_name = EXCLUDED.acked_by_name, acked_at = now()`,
      [orderId, ch.itemId, all.version, dept, ch.fingerprint, UUID_RE.test(user.id) ? user.id : null, user.name]
    );
  }
}
