import "server-only";
// The SOs' pendency reasons (lib/pendency): read for a page, and matched by
// a department's Pendency reason filter.

import { query } from "@/lib/db";
import { BILLING_STATE } from "@/lib/orders";
import { drawingFilterSql } from "@/lib/drawing-filter";
import { soPurchaseStateSql } from "@/lib/purchase-filter";
import type { Pendency, PendencyDept } from "@/lib/pendency";

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The department still has the SO (alias o; Billing's state reads o itself) pending: a PI to raise, or the SO Open. */
export function stillPendingSql(dept: PendencyDept, o = "o"): string {
  if (dept === "billing") return `${BILLING_STATE} IN ('Pending', 'Partially raised')`;
  if (dept === "drawing") return drawingFilterSql({ so: ["Open"], gad: [], curve: [], part: [] }, o);
  return `${soPurchaseStateSql(o)} = 'Open'`;
}

/**
 * The Pendency reason filter as a condition on an SO (alias o): one of the
 * reasons asked for, on an SO the department still has pending — a reason
 * left from before it moved on does not count.
 */
export function pendencyFilterSql(dept: PendencyDept, reasons: string[], o = "o"): string {
  if (!reasons.length) return "TRUE";
  return `(EXISTS (SELECT 1 FROM order_pendency pn
                    WHERE pn.order_id = ${o}.id AND pn.dept = ${lit(dept)} AND pn.cleared_at IS NULL
                      AND pn.reason IN (${reasons.map(lit).join(", ")}))
           AND ${stillPendingSql(dept, o)})`;
}

/** Each SO's pendency with the department, by SO id. */
export async function listPendency(orderIds: string[], dept: PendencyDept): Promise<Record<string, Pendency>> {
  if (!orderIds.length) return {};
  const r = await query<{
    order_id: string;
    reason: string;
    remarks: string | null;
    set_by: string | null;
    at: string;
    cleared_at: string | null;
    cleared_by: string | null;
  }>(
    `SELECT order_id, reason, remarks, set_by, to_char(updated_at, 'YYYY-MM-DD') AS at,
            to_char(cleared_at, 'YYYY-MM-DD') AS cleared_at, cleared_by
       FROM order_pendency WHERE dept = $2 AND order_id = ANY($1::uuid[])`,
    [orderIds, dept]
  );
  return Object.fromEntries(
    r.rows.map((x) => [
      x.order_id,
      {
        reason: x.reason,
        remarks: x.remarks ?? "",
        by: x.set_by ?? "",
        at: x.at,
        clearedAt: x.cleared_at ?? "",
        clearedBy: x.cleared_by ?? "",
      },
    ])
  );
}
