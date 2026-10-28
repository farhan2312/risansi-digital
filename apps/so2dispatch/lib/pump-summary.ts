// The Orders list's Pump view: where each department stands on a pump SO,
// read with the same rules as the department pages (lib/drawing-filter,
// purchase-filter, qc-filter, assembly), one SO-level summary per row.

import { query } from "@/lib/db";
import { spareEcSql, boiReceivedSql, orderStatusSql } from "@/lib/dept-view";
import { curveStatusSql, ecDrawingDoneSql, ecGadStatusSql, partStatusSql } from "@/lib/drawing-filter";
import { soPurchaseStateSql } from "@/lib/purchase-filter";
import { ecQcStatusSql, soQcStateSql } from "@/lib/qc-filter";
import { soStageStatusSql } from "@/lib/assembly";
import { SO_PLANNING_STATUS } from "@/lib/orders";

/** One department's standing on the SO: the status holding it back, and how many of its ECs are through. */
export type PumpStage = { label: string; done: number; total: number };

export type PumpSummary = {
  drawing: {
    gad: PumpStage;
    /** Null when the SO asks for no Performance Curve. */
    curve: PumpStage | null;
    /** Null when Planning asked for part drawings on none of its ECs. */
    part: PumpStage | null;
    readiness: string | null;
    closed: boolean;
  };
  purchase: { required: boolean; state: string; items: number; received: number };
  quality: { required: boolean; state: string; docs: string | null; submitted: number; total: number };
  planning: { status: string; readiness: string | null };
  assembly: { status: string; next: string | null; last: string | null };
  packing: { status: string; next: string | null; last: string | null };
  alignment: {
    base_plate: string | null;
    base_plate_status: string | null;
    base_plate_date: string | null;
    wooden_box: string | null;
    wooden_box_status: string | null;
  };
  /** The SO's dispatch status, as on the Orders list. */
  dispatch: string;
  /** Planning has sent it on to Assembly & Packing: a pump EC Partial or Fully ready (or some ready). */
  sentToAssembly: boolean;
  /** It has reached Dispatch: a numbered packing slip filed (what puts it on Dispatch's queue). */
  sentToDispatch: boolean;
  /** Central Visibility holds the SO: every department reads Hold until it is cleared. */
  held: boolean;
  /** Any EC yet: with none it reaches Drawing, Purchase, Quality and Planning not at all. */
  hasEcs: boolean;
  /** Its packing slips (Planning's tentative and Packing's actual), oldest first. */
  slips: { no: string | null; date: string | null; qty: number | null; kind: string | null }[];
};

/** The earliest stage any EC is at (what holds the SO back), and how many reached the last. */
function stage(statuses: string[], order: string[], doneAt: string): PumpStage {
  const total = statuses.length;
  const done = statuses.filter((s) => s === doneAt).length;
  const label =
    total === 0
      ? "—"
      : [...statuses].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? "—";
  return { label, done, total };
}

const GAD_ORDER = ["Pending", "Resubmit", "Sent to client – approval pending", "Approved by client", "Issued to planning"];
const CURVE_ORDER = ["Pending", "Resubmit", "Sent to client for approval", "Approved by client"];
const PART_ORDER = ["Pending", "Partial complete", "Fully complete"];

type Raw = {
  id: string;
  gad: string[];
  curve: string[];
  part: string[];
  drg_readiness: string | null;
  drg_closed: boolean;
  boi: string | null;
  purchase_state: string;
  boi_items: number;
  boi_received: number;
  qc_required: string | null;
  qc_documents: string | null;
  qc_state: string;
  qc: string[];
  planning_status: string;
  planning_readiness: string | null;
  assembly_status: string;
  assembly_next: string | null;
  assembly_last: string | null;
  packing_status: string;
  packing_next: string | null;
  packing_last: string | null;
  base_plate: string | null;
  base_plate_status: string | null;
  base_plate_date: string | null;
  wooden_box: string | null;
  wooden_box_status: string | null;
  dispatch: string | null;
  sent_asm: boolean;
  sent_dsp: boolean;
  held: boolean;
  has_ecs: boolean;
  slips: { no: string | null; date: string | null; qty: number | null; kind: string | null }[];
};

/** Every department's standing on each of these pump SOs, by SO id — one read for the page. */
export async function listPumpSummaries(orderIds: string[]): Promise<Record<string, PumpSummary>> {
  if (orderIds.length === 0) return {};
  const pumps = (cond: string) =>
    `FROM order_items s WHERE s.order_id = o.id AND NOT (${spareEcSql("s", "o")})${cond ? ` AND ${cond}` : ""}`;
  const lots = `FROM order_ready_lots rl JOIN order_items ri ON ri.id = rl.item_id
                 WHERE ri.order_id = o.id AND ri.item_type IN ('Pump', 'ROLB') AND COALESCE(rl.qty, 0) > 0`;
  const r = await query<Raw>(
    `SELECT o.id,
            COALESCE((SELECT array_agg(${ecGadStatusSql("s")} ORDER BY s.seq) ${pumps("")}), '{}') AS gad,
            COALESCE((SELECT array_agg(${curveStatusSql("s", "o")} ORDER BY s.seq) ${pumps("")}), '{}') AS curve,
            COALESCE((SELECT array_agg(${partStatusSql("s")} ORDER BY s.seq) ${pumps("")}), '{}') AS part,
            to_char(o.drg_readiness_date, 'YYYY-MM-DD') AS drg_readiness,
            (EXISTS (SELECT 1 ${pumps("")}) AND NOT EXISTS (SELECT 1 ${pumps(`NOT ${ecDrawingDoneSql("s", "o")}`)})) AS drg_closed,
            o.boi,
            ${soPurchaseStateSql("o")} AS purchase_state,
            (SELECT count(*)::int FROM order_boi_items b JOIN order_items s ON s.id = b.item_id
              WHERE s.order_id = o.id AND NOT (${spareEcSql("s", "o")})) AS boi_items,
            (SELECT count(*)::int FROM order_boi_items b JOIN order_items s ON s.id = b.item_id
              WHERE s.order_id = o.id AND NOT (${spareEcSql("s", "o")}) AND ${boiReceivedSql("b")}) AS boi_received,
            o.qc_required, o.qc_documents,
            ${soQcStateSql("o")} AS qc_state,
            COALESCE((SELECT array_agg(${ecQcStatusSql("s", "o")} ORDER BY s.seq)
                        FROM order_items s WHERE s.order_id = o.id), '{}') AS qc,
            ${SO_PLANNING_STATUS} AS planning_status,
            (SELECT to_char(max(pl.planning_readiness_date), 'YYYY-MM-DD')
               FROM order_items s JOIN order_planning pl ON pl.item_id = s.id WHERE s.order_id = o.id) AS planning_readiness,
            ${soStageStatusSql("assembly", "o")} AS assembly_status,
            -- Assembly goes by its entries, EC by EC.
            (SELECT to_char(min(la.plan_date), 'YYYY-MM-DD') FROM order_lot_assembly la JOIN order_items s ON s.id = la.item_id
              WHERE s.order_id = o.id AND la.assembled_date IS NULL) AS assembly_next,
            (SELECT to_char(max(la.assembled_date), 'YYYY-MM-DD') FROM order_lot_assembly la JOIN order_items s ON s.id = la.item_id
              WHERE s.order_id = o.id) AS assembly_last,
            ${soStageStatusSql("packing", "o")} AS packing_status,
            (SELECT to_char(min(rl.packing_plan_date), 'YYYY-MM-DD') ${lots} AND rl.packed_date IS NULL) AS packing_next,
            (SELECT to_char(max(rl.packed_date), 'YYYY-MM-DD') ${lots}) AS packing_last,
            o.base_plate, o.base_plate_status, to_char(o.base_plate_date, 'YYYY-MM-DD') AS base_plate_date,
            o.wooden_box, o.wooden_box_status,
            ${orderStatusSql("o")} AS dispatch,
            EXISTS (SELECT 1 FROM order_items s JOIN order_planning pl ON pl.item_id = s.id
                     WHERE s.order_id = o.id AND NOT (${spareEcSql("s", "o")})
                       AND (pl.actual_spare_status IN ('Partial ready', 'Fully ready') OR COALESCE(pl.ready_qty, 0) > 0))
              OR ${SO_PLANNING_STATUS} IN ('Partial ready', 'Fully ready') AS sent_asm,
            EXISTS (SELECT 1 FROM order_packing_slips sps
                     WHERE sps.order_id = o.id AND sps.kind = 'actual'
                       AND NULLIF(btrim(sps.packing_slip_no), '') IS NOT NULL) AS sent_dsp,
            COALESCE(o.clearance_status, '') = 'Hold' AS held,
            EXISTS (SELECT 1 FROM order_items s WHERE s.order_id = o.id) AS has_ecs,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('no', ps.packing_slip_no,
                                       'date', to_char(ps.packing_slip_date, 'YYYY-MM-DD'),
                                       'qty', ps.quantity, 'kind', ps.kind)
                                       ORDER BY ps.packing_slip_date NULLS LAST, ps.created_at)
                        FROM order_packing_slips ps
                       WHERE ps.order_id = o.id AND NULLIF(btrim(ps.packing_slip_no), '') IS NOT NULL), '[]'::jsonb) AS slips
       FROM orders o
      WHERE o.id = ANY($1::uuid[])`,
    [orderIds]
  );

  const out: Record<string, PumpSummary> = {};
  for (const x of r.rows) {
    const curves = x.curve.filter((s) => s !== "Not required");
    const parts = x.part.filter((s) => s !== "Not required");
    const qcNeeded = String(x.qc_required ?? "") !== "No";
    out[x.id] = {
      drawing: {
        gad: stage(x.gad, GAD_ORDER, "Issued to planning"),
        curve: curves.length ? stage(curves, CURVE_ORDER, "Approved by client") : null,
        part: parts.length ? stage(parts, PART_ORDER, "Fully complete") : null,
        readiness: x.drg_readiness,
        closed: x.drg_closed,
      },
      purchase: { required: x.boi === "Yes", state: x.purchase_state, items: x.boi_items, received: x.boi_received },
      quality: {
        required: qcNeeded,
        state: x.qc_state,
        docs: x.qc_documents,
        submitted: x.qc.filter((s) => s === "Submitted").length,
        total: x.qc.length,
      },
      planning: { status: x.planning_status, readiness: x.planning_readiness },
      assembly: { status: x.assembly_status, next: x.assembly_next, last: x.assembly_last },
      packing: { status: x.packing_status, next: x.packing_next, last: x.packing_last },
      alignment: {
        base_plate: x.base_plate,
        base_plate_status: x.base_plate_status,
        base_plate_date: x.base_plate_date,
        wooden_box: x.wooden_box,
        wooden_box_status: x.wooden_box_status,
      },
      dispatch: x.dispatch || "Pending",
      sentToAssembly: !!x.sent_asm,
      sentToDispatch: !!x.sent_dsp,
      held: !!x.held,
      hasEcs: !!x.has_ecs,
      slips: Array.isArray(x.slips) ? x.slips : [],
    };
  }
  return out;
}
