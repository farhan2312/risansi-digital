// The Orders list's Pump view: where each department stands on a pump SO,
// read with the same rules as the department pages (lib/drawing-filter,
// purchase-filter, qc-filter, assembly), one SO-level summary per row.

import { query } from "@/lib/db";
import { spareEcSql, boiReceivedSql, boiStatus, orderStatusSql } from "@/lib/dept-view";
import { linksFromRows, qcDocsStatus, requiredQcDocs } from "@/lib/qc-docs";
import { basePlateStepsSql, pumpLotsFromEcs, type PumpLot } from "@/lib/assembly";
import { curveStatusSql, ecDrawingDoneSql, ecGadStatusSql, partStatusSql } from "@/lib/drawing-filter";
import { soPurchaseStateSql } from "@/lib/purchase-filter";
import { ecQcStatusSql, soQcStateSql } from "@/lib/qc-filter";
import { basePlateSql, soStageStatusSql, woodenBoxReceivedSql, woodenBoxSql, woodenBoxStatusSql } from "@/lib/assembly";
import { SO_PLANNING_STATUS } from "@/lib/orders";

/** One department's standing on the SO: the status holding it back, and how many of its ECs are through. */
export type PumpStage = { label: string; done: number; total: number };

/** A bought-out item, as Purchase has it: what, for which EC, how many, where it stands and its dates. */
export type PumpBoiItem = {
  ec: string;
  item: string;
  qty: number | null;
  status: string;
  tone: "done" | "part" | "pending";
  expected: string | null;
  received: string | null;
};

export type PumpSummary = {
  drawing: {
    gad: PumpStage;
    /** Null when the SO asks for no Performance Curve. */
    curve: PumpStage | null;
    /** Null when none of its ECs' GADs is Non Standard. */
    part: PumpStage | null;
    readiness: string | null;
    closed: boolean;
    /** Each pump EC's own GAD, curve and part drawing status ("Not required" where it needs none). */
    ecs: { ec: string; gad: string; curve: string; part: string }[];
  };
  purchase: { required: boolean; state: string; items: number; received: number; list: PumpBoiItem[] };
  quality: {
    required: boolean;
    state: string;
    docs: string | null;
    submitted: number;
    total: number;
    /** Each EC's documents: how many of those needed are in, and the last day one went in. */
    ecs: { ec: string; label: string; done: number; total: number; last: string | null; missing: string[] }[];
  };
  planning: { status: string; readiness: string | null };
  assembly: { status: string; next: string | null; last: string | null };
  packing: { status: string; next: string | null; last: string | null };
  alignment: {
    base_plate: string | null;
    base_plate_status: string | null;
    base_plate_date: string | null;
    /** Each step it reached, with its day. */
    base_plate_steps?: { status: string; date: string | null }[];
    wooden_box: string | null;
    wooden_box_status: string | null;
    wooden_box_received_date: string | null;
    /** A row per way (in house, bought out), keyed as on Assembly & Packing's rows. */
    wooden_boxes: Record<string, unknown>[];
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
  /** Its packing slips (Planning's tentative and Packing's actual), oldest first, with the lots each carries. */
  slips: { no: string | null; date: string | null; qty: number | null; kind: string | null; lot_nos?: unknown }[];
  /** Its pump lots as Assembly & Packing works them: each lot's assembly and packing. */
  lots: PumpLot[];
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
  ec_nos: string[];
  boi_list: Record<string, unknown>[] | null;
  qc_ecs: { ec: string | null; links: unknown }[] | null;
  lot_ecs: Record<string, unknown>[] | null;
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
  base_plate_steps: { status: string; date: string | null }[] | null;
  wooden_box: string | null;
  wooden_box_status: string | null;
  wooden_box_received_date: string | null;
  wooden_boxes: Record<string, unknown>[] | null;
  dispatch: string | null;
  sent_asm: boolean;
  sent_dsp: boolean;
  held: boolean;
  has_ecs: boolean;
  slips: { no: string | null; date: string | null; qty: number | null; kind: string | null; lot_nos?: unknown }[];
};

/** "EC/26/1/1563/40266" as "40266": the EC's own number, enough beside its SO. */
const ecShort = (ec: string | null | undefined) => String(ec ?? "").split("/").pop() || "—";

/** Every department's standing on each of these pump SOs, by SO id — one read for the page. */
export async function listPumpSummaries(orderIds: string[]): Promise<Record<string, PumpSummary>> {
  if (orderIds.length === 0) return {};
  const pumps = (cond: string) =>
    `FROM order_items s WHERE s.order_id = o.id AND NOT (${spareEcSql("s", "o")})${cond ? ` AND ${cond}` : ""}`;
  const lots = `FROM order_ready_lots rl JOIN order_items ri ON ri.id = rl.item_id
                 WHERE ri.order_id = o.id AND ri.item_type IN ('Pump', 'ROLB') AND COALESCE(rl.qty, 0) > 0`;
  const r = await query<Raw>(
    `SELECT o.id,
            COALESCE((SELECT array_agg(COALESCE(s.ec_no, '') ORDER BY s.seq) ${pumps("")}), '{}') AS ec_nos,
            -- Purchase's items on the pump ECs, EC by EC.
            (SELECT jsonb_agg(to_jsonb(b) || jsonb_build_object('ec_no', s.ec_no) ORDER BY s.seq, b.created_at)
               FROM order_boi_items b JOIN order_items s ON s.id = b.item_id
              WHERE s.order_id = o.id AND NOT (${spareEcSql("s", "o")})) AS boi_list,
            -- Quality's documents, EC by EC.
            (SELECT jsonb_agg(jsonb_build_object('ec', s.ec_no, 'links',
                      COALESCE((SELECT jsonb_agg(jsonb_build_object('doc_type', ql.doc_type, 'link', ql.link,
                                  'submitted_date', to_char(ql.submitted_date, 'YYYY-MM-DD')))
                                  FROM order_qc_doc_links ql WHERE ql.item_id = s.id), '[]'::jsonb)) ORDER BY s.seq)
               FROM order_items s WHERE s.order_id = o.id) AS qc_ecs,
            -- The pump ECs' lot rows with their assembly entries: the SO's lots (lib/assembly pumpLotsFromEcs).
            (SELECT jsonb_agg(jsonb_build_object('id', s.id, 'ready_lots', COALESCE((
                      SELECT jsonb_agg(to_jsonb(rl) || jsonb_build_object('asm', COALESCE((
                               SELECT jsonb_agg(jsonb_build_object('id', la.id, 'qty', la.qty, 'plan_date', la.plan_date,
                                        'shift', la.shift, 'assembled_date', la.assembled_date) ORDER BY la.seq)
                                 FROM order_lot_assembly la WHERE la.lot_row_id = rl.id), '[]'::jsonb)) ORDER BY rl.seq)
                        FROM order_ready_lots rl WHERE rl.item_id = s.id), '[]'::jsonb)) ORDER BY s.seq)
               FROM order_items s WHERE s.order_id = o.id AND s.item_type IN ('Pump', 'ROLB')) AS lot_ecs,
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
            ${basePlateSql("o")} AS base_plate, o.base_plate_status, to_char(o.base_plate_date, 'YYYY-MM-DD') AS base_plate_date,
            ${basePlateStepsSql("o")} AS base_plate_steps,
            ${woodenBoxSql("o")} AS wooden_box, ${woodenBoxStatusSql("o")} AS wooden_box_status,
            ${woodenBoxReceivedSql("o")} AS wooden_box_received_date,
            (SELECT jsonb_agg(jsonb_build_object('source', wb.source, 'required_qty', wb.required_qty,
                      'stock_qty', wb.stock_qty, 'status', wb.status,
                      'received_date', to_char(wb.received_date, 'YYYY-MM-DD'),
                      'received_qty', wb.received_qty, 'remarks', wb.remarks) ORDER BY wb.source DESC)
               FROM order_wooden_boxes wb WHERE wb.order_id = o.id) AS wooden_boxes,
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
                                       'qty', ps.quantity, 'kind', ps.kind, 'lot_nos', ps.lot_nos)
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
    const qcNeeded = String(x.qc_required ?? "") === "Yes";
    const needed = requiredQcDocs({ qc_documents: x.qc_documents });
    out[x.id] = {
      drawing: {
        gad: stage(x.gad, GAD_ORDER, "Issued to planning"),
        curve: curves.length ? stage(curves, CURVE_ORDER, "Approved by client") : null,
        part: parts.length ? stage(parts, PART_ORDER, "Fully complete") : null,
        readiness: x.drg_readiness,
        closed: x.drg_closed,
        ecs: x.ec_nos.map((ec, i) => ({ ec: ecShort(ec), gad: x.gad[i] ?? "—", curve: x.curve[i] ?? "—", part: x.part[i] ?? "—" })),
      },
      purchase: {
        required: x.boi === "Yes",
        state: x.purchase_state,
        items: x.boi_items,
        received: x.boi_received,
        list: (x.boi_list ?? []).map((b) => {
          const st = boiStatus(b);
          const qty = Number(b.boi_qty ?? 0) || null;
          return {
            ec: ecShort(b.ec_no as string),
            item: String(b.boi_item ?? "") === "Others" ? String(b.boi_item_other ?? "") || "Others" : String(b.boi_item ?? "") || "Item",
            qty,
            status: st.label,
            tone: st.tone,
            expected: b.expected_receipt_date ? String(b.expected_receipt_date).slice(0, 10) : null,
            received: b.receipt_date ? String(b.receipt_date).slice(0, 10) : null,
          };
        }),
      },
      quality: {
        required: qcNeeded,
        state: x.qc_state,
        docs: x.qc_documents,
        submitted: x.qc.filter((s) => s === "Submitted").length,
        total: x.qc.length,
        ecs: (x.qc_ecs ?? []).map((e) => {
          const links = linksFromRows(e.links);
          const st = qcDocsStatus(needed, links);
          const days = links.map((l) => l.submitted_date).filter(Boolean).sort();
          return {
            ec: ecShort(e.ec),
            label: st.label,
            done: st.done,
            total: st.total,
            last: days[days.length - 1] ?? null,
            missing: needed.filter((d) => !links.some((l) => l.doc_type === d && (l.link.trim() || l.submitted_date))),
          };
        }),
      },
      planning: { status: x.planning_status, readiness: x.planning_readiness },
      assembly: { status: x.assembly_status, next: x.assembly_next, last: x.assembly_last },
      packing: { status: x.packing_status, next: x.packing_next, last: x.packing_last },
      alignment: {
        base_plate: x.base_plate,
        base_plate_status: x.base_plate_status,
        base_plate_date: x.base_plate_date,
        base_plate_steps: x.base_plate_steps ?? [],
        wooden_box: x.wooden_box,
        wooden_box_status: x.wooden_box_status,
        wooden_box_received_date: x.wooden_box_received_date,
        wooden_boxes: x.wooden_boxes ?? [],
      },
      dispatch: x.dispatch || "Pending",
      sentToAssembly: !!x.sent_asm,
      sentToDispatch: !!x.sent_dsp,
      held: !!x.held,
      hasEcs: !!x.has_ecs,
      slips: Array.isArray(x.slips) ? x.slips : [],
      lots: pumpLotsFromEcs(x.lot_ecs ?? []),
    };
  }
  return out;
}
