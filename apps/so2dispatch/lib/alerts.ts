import { query } from "@/lib/db";
import { onlyBillingSql, orderOpenSql, orderStatusSql, releasedSql } from "@/lib/dept-view";

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
  /** Where its dispatch stands (Pending, LOT dispatch…). */
  status?: string | null;
  /** A payment hold's reason (Accounts'). */
  reason?: string | null;
  /** Which escalation it is (escalation_seen), and whether the reader has opened it. */
  key: string;
  seen: boolean;
};

// One escalation only: an SO not fully dispatched whose To Be Dispatch Date
// (Central Visibility's, on the Dispatch Plan) has passed. SO-level. (Until
// 2026-11-18 there were per-department arms too — Drawing, Purchase, Quality,
// Assembly & Packing, the Dispatch target and Accounts holds; see git history.)
const ALERTS_SQL = `
  SELECT o.id, NULL::uuid AS item_id, o.sl_no::int AS sl_no, o.so_no, NULL::text AS ec_no, o.client_name,
         'Dispatch'::text AS department, 'overdue'::text AS type,
         to_char(o.final_dispatch_target_date, 'YYYY-MM-DD') AS due_date,
         (${TODAY_IST} - o.final_dispatch_target_date)::int AS days_overdue
    FROM orders o
   WHERE o.final_dispatch_target_date < ${TODAY_IST}
     AND lower(${orderStatusSql("o")}) <> 'fully dispatch'
`;

/** Escalations show this many per page. */
export const ALERTS_PAGE_SIZE = 25;

/**
 * One page of active escalations, the most overdue first.
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
                          ${orderStatusSql("oo")} AS status,
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
