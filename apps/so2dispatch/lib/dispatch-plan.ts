import "server-only";
import { query } from "@/lib/db";
import { PAYMENT_HOLD_VALUE, PUMP_LIKE } from "@/lib/order-schema";
import { boiReceivedSql, clearedSql, onlyBillingSql, orderOpenSql, orderStatusSql, releasedSql } from "@/lib/dept-view";

// The Dispatch Plan: the pump SOs that can go out within the next two weeks,
// found from what the departments have already recorded — nothing is kept of
// its own. An SO is on it while all three hold:
//
//   Ready     every pump EC Fully ready, or a lot In plan for a date up to
//             two weeks out (overdue plans too: they are still to go out)
//   BOI       every bought-out item in hand, or expected by the vendor
//             within two weeks (an SO with no BOI items has nothing to wait for)
//   Accounts  not held by Accounts, nor on an outstanding hold
//
// It also leaves out what nobody should dispatch: an SO held by Order Making
// or Central, cancelled, diverted, Only Billing, or already fully dispatched.

/** How far ahead the plan looks, in days. */
export const DISPATCH_PLAN_DAYS = 14;

export type DispatchPlanEc = { id: string; ec_no: string | null; quantity: number; status: string | null };

export type DispatchPlanRow = {
  id: string;
  sl_no: number;
  so_no: string | null;
  so_date: string | null;
  client_name: string | null;
  reps: string | null;
  zone: string | null;
  ecs: DispatchPlanEc[];
  pumps: number;
  /** Every pump EC Fully ready. */
  fully_ready: boolean;
  /** When the readiness date is, for a Fully ready SO. */
  ready_date: string | null;
  /** The earliest In plan lot within the window, when not Fully ready. */
  plan_date: string | null;
  boi_total: number;
  boi_in_hand: number;
  /** The latest date a pending item is expected, when any is pending. */
  boi_expected: string | null;
  payment_status: string | null;
  dispatch_target: string | null;
  status: string;
};

const PUMP_EC = `it.item_type = ANY($1::text[])`;
const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const HORIZON = `(${TODAY} + $2::int)`;

export async function listDispatchPlan(): Promise<DispatchPlanRow[]> {
  const result = await query<DispatchPlanRow>(
    `WITH so AS (
       SELECT o.*
         FROM orders o
        WHERE ${releasedSql("o")} AND ${clearedSql("o")} AND ${orderOpenSql("o")} AND NOT ${onlyBillingSql("o")}
          AND COALESCE(o.status_override, '') <> 'Hold'
          AND ${orderStatusSql("o")} <> 'Fully dispatch'
          AND COALESCE(o.accounts_hold_status, '') <> 'Hold'
          AND NOT EXISTS (SELECT 1 FROM order_accounts a WHERE a.order_id = o.id AND a.payment_status = $3)
          AND EXISTS (SELECT 1 FROM order_items it WHERE it.order_id = o.id AND ${PUMP_EC})
     ),
     ready AS (
       SELECT it.order_id,
              jsonb_agg(jsonb_build_object('id', it.id, 'ec_no', it.ec_no, 'quantity', COALESCE(it.quantity, 0),
                                           'status', pl.actual_spare_status) ORDER BY it.seq) AS ecs,
              COALESCE(sum(it.quantity), 0)::int AS pumps,
              bool_and(pl.actual_spare_status IS NOT DISTINCT FROM 'Fully ready') AS fully_ready,
              max(pl.planning_readiness_date) AS ready_date,
              -- A lot In plan in the window; an EC with no lots, its own In plan date.
              least(
                min(rl.plan_date),
                min(pl.planning_readiness_date) FILTER (
                  WHERE pl.actual_spare_status = 'In plan' AND pl.planning_readiness_date <= ${HORIZON}
                    AND NOT EXISTS (SELECT 1 FROM order_ready_lots x WHERE x.item_id = it.id))
              ) AS plan_date
         FROM order_items it
         JOIN so ON so.id = it.order_id
         LEFT JOIN order_planning pl ON pl.item_id = it.id
         LEFT JOIN LATERAL (
           SELECT min(l.ready_date) AS plan_date FROM order_ready_lots l
            WHERE l.item_id = it.id AND l.status = 'In plan' AND l.ready_date <= ${HORIZON}
         ) rl ON TRUE
        WHERE ${PUMP_EC}
        GROUP BY it.order_id
     ),
     boi AS (
       SELECT it.order_id,
              count(*)::int AS boi_total,
              count(*) FILTER (WHERE ${boiReceivedSql("b")})::int AS boi_in_hand,
              max(b.expected_receipt_date) FILTER (WHERE NOT ${boiReceivedSql("b")}) AS boi_expected,
              bool_and(${boiReceivedSql("b")} OR b.expected_receipt_date <= ${HORIZON}) AS boi_ok
         FROM order_boi_items b
         JOIN order_items it ON it.id = b.item_id
         JOIN so ON so.id = it.order_id
        GROUP BY it.order_id
     )
     SELECT so.id, so.sl_no::int AS sl_no, so.so_no, to_char(so.so_date, 'YYYY-MM-DD') AS so_date,
            so.client_name, so.reps, so.zone,
            r.ecs, r.pumps, r.fully_ready,
            to_char(r.ready_date, 'YYYY-MM-DD') AS ready_date,
            CASE WHEN r.fully_ready THEN NULL ELSE to_char(r.plan_date, 'YYYY-MM-DD') END AS plan_date,
            COALESCE(b.boi_total, 0) AS boi_total, COALESCE(b.boi_in_hand, 0) AS boi_in_hand,
            to_char(b.boi_expected, 'YYYY-MM-DD') AS boi_expected,
            a.payment_status,
            to_char(COALESCE(so.dispatch_target_revised_date, so.dispatch_target_date), 'YYYY-MM-DD') AS dispatch_target,
            ${orderStatusSql("so")} AS status
       FROM so
       JOIN ready r ON r.order_id = so.id
       LEFT JOIN boi b ON b.order_id = so.id
       LEFT JOIN order_accounts a ON a.order_id = so.id
      WHERE (r.fully_ready OR r.plan_date IS NOT NULL)
        AND COALESCE(b.boi_ok, TRUE)
      ORDER BY r.fully_ready DESC, r.plan_date NULLS FIRST, so.sl_no`,
    [PUMP_LIKE, DISPATCH_PLAN_DAYS, PAYMENT_HOLD_VALUE]
  );
  return result.rows;
}
