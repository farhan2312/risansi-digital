import { query } from "@/lib/db";
import { assemblyDueSql, orderOpenSql, orderStatusSql, spareEcSql } from "@/lib/dept-view";

/** A cancelled or diverted order raises no escalation. `a.id` is the SO. */
const OPEN_ONLY = `EXISTS (SELECT 1 FROM orders oo WHERE oo.id = a.id AND ${orderOpenSql("oo")})`;
import {
  offsetFor,
  pageResult,
  pageWithTotal,
  type PageResult,
} from "@/lib/pagination";

// The DB session runs in UTC, but the business operates on IST days. Deadlines
// are calendar dates, so "today" must be the IST calendar date, not the UTC
// one — otherwise the day boundary is off by up to 5.5 hours.
const TODAY_IST = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

export type AlertRow = {
  id: string; // the SO
  item_id: string | null; // the EC, for per-EC escalations; null for SO-level ones
  sl_no: number;
  so_no: string | null;
  ec_no: string | null;
  client_name: string | null;
  department: string;
  type: "overdue" | "ld_risk" | "hold";
  due_date: string | null;
  days_overdue: number | null;
};

// Every branch surfaces one kind of delay/escalation. A department is "overdue"
// when its target date has passed but the completing step hasn't happened.
// Targets are SO-level but the steps are done per EC, so each department arm
// yields one row per unfinished EC — "Open" then lands on that EC's summary,
// and an SO with three late ECs shows three escalations. Payment holds stay
// SO-level (item_id null).
const ALERTS_SQL = `
  -- Drawing not handed off by its target date.
  SELECT o.id, it.id AS item_id, o.sl_no::int AS sl_no, o.so_no, it.ec_no, o.client_name,
         'Drawing'::text AS department, 'overdue'::text AS type,
         to_char(o.drg_target_date, 'YYYY-MM-DD') AS due_date,
         (${TODAY_IST} - o.drg_target_date)::int AS days_overdue
    FROM orders o JOIN order_items it ON it.order_id = o.id
   WHERE o.drg_target_date < ${TODAY_IST}
     -- A Spare EC needs no drawing, so it is never late for one.
     AND NOT (${spareEcSql("it", "o")})
     AND NOT EXISTS (
       SELECT 1 FROM order_drawing_revisions rv
        WHERE rv.item_id = it.id
          -- Drawing's part ends at its hand-off to Operations (or, on
          -- revisions from before that step, straight to the client).
          AND (lower(coalesce(rv.issued_to_operations, '')) = 'yes'
               OR lower(coalesce(rv.issued_to_client, '')) = 'yes')
     )

  UNION ALL
  -- Purchase: an EC's BOI items not all received by the target date.
  SELECT o.id, it.id, o.sl_no::int, o.so_no, it.ec_no, o.client_name,
         'Purchase'::text, 'overdue'::text,
         to_char(o.purchase_target_date, 'YYYY-MM-DD'),
         (${TODAY_IST} - o.purchase_target_date)::int
    FROM orders o JOIN order_items it ON it.order_id = o.id
   WHERE o.boi = 'Yes'
     AND o.purchase_target_date < ${TODAY_IST}
     AND (
       NOT EXISTS (SELECT 1 FROM order_boi_items b WHERE b.item_id = it.id)
       OR EXISTS (SELECT 1 FROM order_boi_items b
                   WHERE b.item_id = it.id AND b.receipt_date IS NULL)
     )

  UNION ALL
  -- QC docs not submitted by the target date (LD risk).
  SELECT o.id, it.id, o.sl_no::int, o.so_no, it.ec_no, o.client_name,
         'Quality'::text, 'ld_risk'::text,
         to_char(o.qc_doc_target_date, 'YYYY-MM-DD'),
         (${TODAY_IST} - o.qc_doc_target_date)::int
    FROM orders o JOIN order_items it ON it.order_id = o.id
    LEFT JOIN order_qc qc ON qc.item_id = it.id
   WHERE o.qc_doc_target_date < ${TODAY_IST}
     AND (o.qc_required IS NULL OR o.qc_required <> 'No')
     AND qc.qc_doc_actual_date IS NULL

  UNION ALL
  -- Assembly & Packing: the EC (or a readiness lot of it) is not packed by
  -- Planning's readiness date.
  -- Judged on the packing date alone — whether the order has since been
  -- dispatched is Dispatch's arm, below.
  SELECT o.id, it.id, o.sl_no::int, o.so_no, it.ec_no, o.client_name,
         'Assembly & Packing'::text, 'overdue'::text,
         to_char(a.due, 'YYYY-MM-DD'),
         (${TODAY_IST} - a.due)::int
    FROM orders o JOIN order_items it ON it.order_id = o.id
    CROSS JOIN LATERAL (SELECT ${assemblyDueSql("it")} AS due) a
   WHERE a.due < ${TODAY_IST}

  UNION ALL
  -- Dispatch: the order has not gone out by its dispatch date (a revision
  -- supersedes the original). SO-level, like the status it reads.
  SELECT o.id, NULL::uuid, o.sl_no::int, o.so_no, NULL::text, o.client_name,
         'Dispatch'::text, 'overdue'::text,
         to_char(COALESCE(o.dispatch_target_revised_date, o.dispatch_target_date),
                 'YYYY-MM-DD'),
         (${TODAY_IST}
            - COALESCE(o.dispatch_target_revised_date, o.dispatch_target_date))::int
    FROM orders o
   WHERE COALESCE(o.dispatch_target_revised_date, o.dispatch_target_date) < ${TODAY_IST}
     AND lower(${orderStatusSql("o")}) <> 'fully dispatch'

  UNION ALL
  -- Payment on hold (escalated to Central Visibility, SO-level)
  SELECT o.id, NULL::uuid, o.sl_no::int, o.so_no, NULL::text, o.client_name,
         'Accounts'::text, 'hold'::text,
         NULL::text, NULL::int
    FROM orders o JOIN order_accounts a ON a.order_id = o.id
   WHERE lower(a.payment_status) = 'outstanding hold'
`;

/** Escalations show this many per page. */
export const ALERTS_PAGE_SIZE = 25;

/**
 * One page of active alerts — escalations (holds) first, then most overdue.
 * The tail of the ORDER BY keeps the order stable, so a row never shows on
 * two pages or none.
 */
export async function listAlertsPage(page: number): Promise<PageResult<AlertRow>> {
  try {
    return await pageWithTotal(
      page,
      (p) =>
        query<AlertRow & { total_count: string }>(
          `SELECT a.id, a.item_id::text AS item_id, a.sl_no, a.so_no, a.ec_no,
                  a.client_name, a.department, a.type, a.due_date, a.days_overdue,
                  count(*) OVER ()::text AS total_count
             FROM (${ALERTS_SQL}) a
            WHERE ${OPEN_ONLY}
            ORDER BY a.days_overdue DESC NULLS FIRST, a.sl_no ASC, a.department ASC,
                     a.ec_no ASC NULLS FIRST, a.item_id ASC
            LIMIT $1 OFFSET $2`,
          [ALERTS_PAGE_SIZE, offsetFor(p, ALERTS_PAGE_SIZE)]
        ),
      countAlerts,
      ALERTS_PAGE_SIZE
    );
  } catch (error) {
    // The orders table is mid-restructure and some columns this query relies
    // on (target dates) are temporarily gone — degrade to "no alerts" rather
    // than taking down the page. Remove this guard once those columns are back.
    console.error("listAlertsPage failed (orders columns may be missing):", error);
    return pageResult([], 0, 1, ALERTS_PAGE_SIZE);
  }
}

/** Count of active alerts (for the sidebar badge). */
export async function countAlerts(): Promise<number> {
  try {
    const result = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM (${ALERTS_SQL}) a WHERE ${OPEN_ONLY}`
    );
    return Number(result.rows[0]?.count ?? 0);
  } catch (error) {
    console.error("countAlerts failed (orders columns may be missing):", error);
    return 0;
  }
}
