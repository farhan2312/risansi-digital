import { query } from "@/lib/db";
import { assemblyDueSql, boiReceivedSql, onlyBillingSql, orderOpenSql, orderStatusSql, releasedSql, spareEcSql } from "@/lib/dept-view";
import { ecDrawingSentSql } from "@/lib/drawing-filter";

/**
 * Which SOs can raise an escalation (`a.id` is the SO): open (not cancelled
 * or diverted), released to the departments (an SO No., not held by Order
 * Making), not Only Billing (no department's), not a test SO, and not held by
 * Central (a payment hold excepted). A fully dispatched SO has nothing left
 * for any department to be late on.
 */
const OPEN_ONLY = `EXISTS (SELECT 1 FROM orders oo WHERE oo.id = a.id AND ${orderOpenSql("oo")} AND NOT ${onlyBillingSql("oo")}
  AND ${releasedSql("oo")}
  AND COALESCE(oo.so_no, '') !~* 'test'
  AND lower(${orderStatusSql("oo")}) <> 'fully dispatch'
  AND (a.type = 'hold' OR COALESCE(oo.clearance_status, '') <> 'Hold'))`;

/** Which escalation a row is, for who has opened it: kind, department, SO, EC and due date. */
const ALERT_KEY = `concat_ws('|', a.type, a.department, a.id::text, COALESCE(a.item_id::text, ''), COALESCE(a.due_date, ''))`;
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
  /** The SO's type: which Orders list (Pump or Spare) it is on. */
  order_type?: string | null;
  /** A payment hold's reason (Accounts'). */
  reason?: string | null;
  /** Which escalation it is (escalation_seen), and whether the reader has opened it. */
  key: string;
  seen: boolean;
};

// Every branch surfaces one kind of delay/escalation. A department is "overdue"
// when its target date has passed but the completing step hasn't happened.
// Targets are SO-level but the steps are done per EC, so each department arm
// yields one row per unfinished EC — "Open" then lands on that EC's summary,
// and an SO with three late ECs shows three escalations. Payment holds stay
// SO-level (item_id null).
const ALERTS_SQL = `
  -- Drawing not handed off by its own readiness date.
  SELECT o.id, it.id AS item_id, o.sl_no::int AS sl_no, o.so_no, it.ec_no, o.client_name,
         'Drawing'::text AS department, 'overdue'::text AS type,
         to_char(o.drg_readiness_date, 'YYYY-MM-DD') AS due_date,
         (${TODAY_IST} - o.drg_readiness_date)::int AS days_overdue
    FROM orders o JOIN order_items it ON it.order_id = o.id
   WHERE o.drg_readiness_date < ${TODAY_IST}
     -- A Spare EC needs no drawing, so it is never late for one.
     AND NOT (${spareEcSql("it", "o")})
     -- Late until Drawing has sent what it owes: the GAD (and the curve where
     -- asked) sent to the client, parts all drawn where asked (lib/drawing-filter).
     AND NOT ${ecDrawingSentSql("it", "o")}

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
                   WHERE b.item_id = it.id AND NOT ${boiReceivedSql("b")})
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
     AND o.qc_required = 'Yes'
     AND qc.qc_doc_actual_date IS NULL

  UNION ALL
  -- Assembly & Packing: a readiness lot not packed by its packing date, or an
  -- EC without lots not packed by Planning's readiness date.
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
  -- Payment on hold: Accounts' Hold on the SO (its Clear / Hold), SO-level.
  SELECT o.id, NULL::uuid, o.sl_no::int, o.so_no, NULL::text, o.client_name,
         'Accounts'::text, 'hold'::text,
         NULL::text, NULL::int
    FROM orders o
   WHERE o.accounts_hold_status = 'Hold'
`;

/** Escalations show this many per page. */
export const ALERTS_PAGE_SIZE = 25;

/**
 * One page of active alerts — escalations (holds) first, then most overdue.
 * The tail of the ORDER BY keeps the order stable, so a row never shows on
 * two pages or none.
 */
export async function listAlertsPage(page: number, userId: string, withOpened = false): Promise<PageResult<AlertRow>> {
  try {
    return await pageWithTotal(
      page,
      (p) =>
        query<AlertRow & { total_count: string }>(
          `SELECT x.*, count(*) OVER ()::text AS total_count
             FROM (SELECT a.id, a.item_id::text AS item_id, a.sl_no, a.so_no, a.ec_no,
                          a.client_name, a.department, a.type, a.due_date, a.days_overdue,
                          oo.order_type,
                          CASE WHEN a.type = 'hold'
                               THEN NULLIF(concat_ws(' · ', NULLIF(btrim(oo.accounts_hold_reason), ''), NULLIF(btrim(oo.accounts_hold_remarks), '')), '')
                          END AS reason,
                          ${ALERT_KEY} AS key,
                          EXISTS (SELECT 1 FROM escalation_seen es WHERE es.user_id = $3 AND es.alert_key = ${ALERT_KEY}) AS seen
                     FROM (${ALERTS_SQL}) a
                     JOIN orders oo ON oo.id = a.id
                    WHERE ${OPEN_ONLY}) x
            -- The ones opened fold away unless asked for; shown, they come last.
            WHERE $4::boolean OR NOT x.seen
            ORDER BY x.seen ASC, x.days_overdue DESC NULLS FIRST, x.sl_no ASC, x.department ASC,
                     x.ec_no ASC NULLS FIRST, x.item_id ASC
            LIMIT $1 OFFSET $2`,
          [ALERTS_PAGE_SIZE, offsetFor(p, ALERTS_PAGE_SIZE), userId, withOpened]
        ),
      async () => {
        const c = await alertCounts(userId);
        return withOpened ? c.total : c.unseen;
      },
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

/** Every active escalation, and those the reader has not opened yet. */
export async function alertCounts(userId: string): Promise<{ total: number; unseen: number }> {
  try {
    const result = await query<{ total: number; unseen: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM escalation_seen es
                                                  WHERE es.user_id = $1 AND es.alert_key = ${ALERT_KEY}))::int AS unseen
         FROM (${ALERTS_SQL}) a WHERE ${OPEN_ONLY}`,
      [userId]
    );
    return { total: Number(result.rows[0]?.total ?? 0), unseen: Number(result.rows[0]?.unseen ?? 0) };
  } catch (error) {
    console.error("alertCounts failed:", error);
    return { total: 0, unseen: 0 };
  }
}

/** The sidebar badge: the escalations the reader has not opened yet. */
export async function countAlerts(userId: string): Promise<number> {
  return (await alertCounts(userId)).unseen;
}

/**
 * The reader has opened these escalations (by key), or with no keys every one
 * active now. Opened ones fold away; a new due date makes a new one.
 */
export async function markAlertsSeen(userId: string, keys: string[] | null): Promise<void> {
  if (keys) {
    if (keys.length === 0) return;
    await query(
      `INSERT INTO escalation_seen (user_id, alert_key) SELECT $1, k FROM unnest($2::text[]) k
       ON CONFLICT DO NOTHING`,
      [userId, keys]
    );
    return;
  }
  await query(
    `INSERT INTO escalation_seen (user_id, alert_key)
     SELECT $1, ${ALERT_KEY} FROM (${ALERTS_SQL}) a WHERE ${OPEN_ONLY}
     ON CONFLICT DO NOTHING`,
    [userId]
  );
}

/** Opened by mistake: not opened again. */
export async function unmarkAlertSeen(userId: string, key: string): Promise<void> {
  await query(`DELETE FROM escalation_seen WHERE user_id = $1 AND alert_key = $2`, [userId, key]);
}
