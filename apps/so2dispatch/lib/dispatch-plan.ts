import "server-only";
import { query } from "@/lib/db";
import { PUMP_LIKE } from "@/lib/order-schema";
import { soStageStatusSql } from "@/lib/assembly";
import { boiReceivedSql, clearedSql, onlyBillingSql, orderOpenSql, orderStatusSql, releasedSql } from "@/lib/dept-view";

// The Dispatch Plan: the pump SOs that can go out within the next two weeks,
// found from what the departments have already recorded — nothing is kept of
// its own. An SO is on it while all three hold:
//
//   Ready     every pump EC Fully ready, or a lot In plan for a date up to
//             two weeks out (overdue plans too: they are still to go out)
//   BOI       every bought-out item in hand, or expected by the vendor
//             within two weeks (an SO with no BOI items has nothing to wait for)
//   Accounts  not held by Accounts (its Clear / Hold)
//
// It also leaves out what nobody should dispatch: an SO held by Order Making
// or Central, cancelled, diverted, Only Billing, or already fully dispatched.

/** How far ahead the plan looks, in days. */
export const DISPATCH_PLAN_DAYS = 14;

export type DispatchPlanEc = { id: string; ec_no: string | null; quantity: number; status: string | null };

/** A bought-out item as order_boi_items keeps it: lib/dept-view boiStatus reads it. */
export type DispatchPlanBoi = Record<string, unknown> & {
  id: string;
  ec_no: string | null;
  name: string | null;
  boi_qty: number | null;
  expected_receipt_date: string | null;
  receipt_date: string | null;
};

/** Assembly's or Packing's word on the SO, with its next planned and last done dates. */
export type DispatchPlanStage = { status: string; next: string | null; last: string | null };

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
  boi_items: DispatchPlanBoi[];
  /** Accounts' Clear (a held SO is not on the plan), or null while it has not decided. */
  accounts_status: string | null;
  accounts_remarks: string | null;
  assembly: DispatchPlanStage;
  packing: DispatchPlanStage;
  dispatch_target: string | null;
  status: string;
};

const PUMP_EC = `it.item_type = ANY($1::text[])`;
const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const HORIZON = `(${TODAY} + $2::int)`;
/** The SO's pump lots that carry a share: what Packing packs. */
const LOTS = `FROM order_ready_lots rl JOIN order_items ri ON ri.id = rl.item_id
               WHERE ri.order_id = so.id AND ri.item_type = ANY($1::text[]) AND COALESCE(rl.qty, 0) > 0`;

export async function listDispatchPlan(): Promise<DispatchPlanRow[]> {
  const result = await query<DispatchPlanRow>(
    `WITH so AS (
       SELECT o.*
         FROM orders o
        WHERE ${releasedSql("o")} AND ${clearedSql("o")} AND ${orderOpenSql("o")} AND NOT ${onlyBillingSql("o")}
          -- A test SO (its SO No. says TEST) is not to be dispatched.
          AND COALESCE(o.so_no, '') !~* 'test'
          AND COALESCE(o.status_override, '') <> 'Hold'
          AND ${orderStatusSql("o")} <> 'Fully dispatch'
          AND COALESCE(o.accounts_hold_status, '') <> 'Hold'
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
              bool_and(${boiReceivedSql("b")} OR b.expected_receipt_date <= ${HORIZON}) AS boi_ok,
              jsonb_agg(jsonb_build_object(
                'id', b.id, 'ec_no', it.ec_no,
                'name', CASE WHEN b.boi_item = 'Others' THEN COALESCE(NULLIF(btrim(b.boi_item_other), ''), 'Others') ELSE b.boi_item END,
                'boi_qty', b.boi_qty, 'stock_allocated_qty', b.stock_allocated_qty, 'received_qty', b.received_qty,
                'vendor_order', b.vendor_order, 'vendor_status', b.vendor_status, 'vendor_name', b.vendor_name,
                'expected_receipt_date', to_char(b.expected_receipt_date, 'YYYY-MM-DD'),
                'receipt_date', to_char(b.receipt_date, 'YYYY-MM-DD')
              ) ORDER BY it.seq, b.created_at) AS boi_items
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
            COALESCE(b.boi_items, '[]'::jsonb) AS boi_items,
            NULLIF(so.accounts_hold_status, '') AS accounts_status,
            CASE WHEN so.accounts_hold_status = 'Clear' THEN NULLIF(btrim(so.accounts_hold_remarks), '') END AS accounts_remarks,
            jsonb_build_object(
              'status', ${soStageStatusSql("assembly", "so")},
              'next', (SELECT to_char(min(la.plan_date), 'YYYY-MM-DD') FROM order_lot_assembly la JOIN order_items s ON s.id = la.item_id
                        WHERE s.order_id = so.id AND la.assembled_date IS NULL),
              'last', (SELECT to_char(max(la.assembled_date), 'YYYY-MM-DD') FROM order_lot_assembly la JOIN order_items s ON s.id = la.item_id
                        WHERE s.order_id = so.id)) AS assembly,
            jsonb_build_object(
              'status', ${soStageStatusSql("packing", "so")},
              'next', (SELECT to_char(min(rl.packing_plan_date), 'YYYY-MM-DD') ${LOTS} AND rl.packed_date IS NULL),
              'last', (SELECT to_char(max(rl.packed_date), 'YYYY-MM-DD') ${LOTS})) AS packing,
            to_char(COALESCE(so.dispatch_target_revised_date, so.dispatch_target_date), 'YYYY-MM-DD') AS dispatch_target,
            ${orderStatusSql("so")} AS status
       FROM so
       JOIN ready r ON r.order_id = so.id
       LEFT JOIN boi b ON b.order_id = so.id
      WHERE (r.fully_ready OR r.plan_date IS NOT NULL)
        AND COALESCE(b.boi_ok, TRUE)
      ORDER BY r.fully_ready DESC, r.plan_date NULLS FIRST, so.sl_no`,
    [PUMP_LIKE, DISPATCH_PLAN_DAYS]
  );
  return result.rows;
}
