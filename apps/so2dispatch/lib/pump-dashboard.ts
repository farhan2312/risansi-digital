import "server-only";
// The Pump dashboard: every pump SO the Orders list's filter selects, read
// once and summed up like the Spare one — where the SOs stand, how dispatch
// is going, each Rep's book — and, since a pump passes through every
// department, how each department stands on the open SOs and what is
// overdue there. The departments' standings are the Orders list's Pump view's
// own (listPumpSummaries), so the two pages agree.

import { query } from "@/lib/db";
import {
  deptOverduePredicate,
  isTestSo,
  listOrdersPage,
  orderListKpiCards,
  pumpCardSql,
  type OrderListOptions,
} from "@/lib/orders";
import { deptQueueSql, type DeptKey } from "@/lib/dept-view";
import { listPumpSummaries, type PumpSummary } from "@/lib/pump-summary";
import type { KpiCard } from "@/lib/kpis";
import type { OrderListFilter } from "@/lib/order-list-filter";
import { CLOSED } from "@/lib/order-row-view";
import type { Bucket, RepRow } from "@/lib/spare-dashboard";

/** Where a pump SO stands, earliest first: Planning, then Assembly, Packing and Dispatch. */
export const PUMP_STAGES = [
  "Date awaited",
  "In plan",
  "Partial ready",
  "Ready, not assembled",
  "Assembly on",
  "Assembled, not packed",
  "Packing on",
  "Packed, to dispatch",
  "Dispatch hold",
  "Lot dispatched",
  "Fully dispatched",
  "Cancelled / Diverted",
] as const;
export type PumpStage = (typeof PUMP_STAGES)[number];

export type PumpSo = {
  id: string;
  sl_no: number;
  so_no: string;
  so_date: string | null;
  client: string;
  reps: string[];
  zone: string;
  value_inr: number;
  stage: PumpStage;
  dispatch: string;
  delivery_date: string | null;
  first_dispatch: string | null;
  no_slip: boolean;
  holds: { by: "Clearance" | "Accounts" | "Dispatch"; reason: string }[];
};

/** A department's standing across the open SOs. */
export type DeptRow = {
  key: string;
  label: string;
  /** Its page, the Overdue card picked. */
  href: string | null;
  done: number;
  progress: number;
  pending: number;
  /** SOs it has no work on (no BOI, no Quality). */
  na: number;
  overdue: number | null;
};

export type PumpDashboard = {
  total: number;
  options: OrderListOptions;
  kpis: KpiCard[];
  asOf: string;
  stages: Bucket[];
  dispatchMix: Bucket[];
  intake: Bucket[];
  zones: Bucket[];
  clients: Bucket[];
  reps: RepRow<PumpStage>[];
  depts: DeptRow[];
  /** Open SOs by the GAD stage holding them back. */
  gad: Bucket[];
  /** Bought-out items on the open SOs, received or not. */
  boi: { received: number; pending: number };
  /** Pump ECs on the open SOs whose Quality documents are in, or not (Quality needed). */
  qc: { submitted: number; pending: number };
  metrics: {
    sos: number;
    value: number;
    closed: number;
    open: number;
    /** Pump ECs, and pumps (their quantity), on the SOs in view. */
    ecs: number;
    pumps: number;
    onTimeRate: number | null;
    onTimeMeasured: number;
    late: number;
    dueThisWeek: number;
    holds: number;
  };
  holds: PumpSo[];
  watch: (PumpSo & { daysLate: number })[];
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const DAY = 86400000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** Where a pump SO stands: dispatch first (it overrides), then packing, assembly and planning. */
function stageOf(dispatchStatus: string, s: PumpSummary | undefined): PumpStage {
  const dispatch = dispatchStatus || "Pending";
  if (CLOSED.includes(dispatch)) return "Cancelled / Diverted";
  if (dispatch === "Fully dispatch") return "Fully dispatched";
  if (dispatch === "Hold") return "Dispatch hold";
  if (dispatch === "LOT dispatch") return "Lot dispatched";
  if (!s) return "Date awaited";
  if (s.packing.status === "Fully packed") return "Packed, to dispatch";
  if (s.packing.status === "Partially packed") return "Packing on";
  if (s.assembly.status === "Fully assembled") return "Assembled, not packed";
  if (s.assembly.status === "Partial assembled") return "Assembly on";
  if (s.planning.status === "Fully ready") return "Ready, not assembled";
  if (s.planning.status === "Partial ready") return "Partial ready";
  if (s.planning.status === "In plan") return "In plan";
  return "Date awaited";
}

type Standing = "done" | "progress" | "pending" | "na";

/** Each department's standing on one SO, as the Orders list's Pump view reads it. */
function standings(s: PumpSummary, dispatch: string): Record<string, Standing> {
  const gadStarted = s.drawing.gad.label !== "Pending" || s.drawing.gad.done > 0;
  return {
    drawing: s.drawing.closed ? "done" : gadStarted ? "progress" : "pending",
    purchase: !s.purchase.required ? "na" : s.purchase.state === "Closed" ? "done" : s.purchase.received > 0 ? "progress" : "pending",
    quality: !s.quality.required ? "na" : s.quality.state === "Closed" ? "done" : s.quality.submitted > 0 ? "progress" : "pending",
    planning: s.planning.status === "Fully ready" ? "done" : ["Partial ready", "In plan"].includes(s.planning.status) ? "progress" : "pending",
    assembly: s.assembly.status === "Fully assembled" ? "done" : s.assembly.status === "Partial assembled" ? "progress" : "pending",
    packing: s.packing.status === "Fully packed" ? "done" : s.packing.status === "Partially packed" ? "progress" : "pending",
    dispatch: dispatch === "Fully dispatch" ? "done" : dispatch === "LOT dispatch" ? "progress" : "pending",
  };
}

/** The departments, in the order a pump passes them; overdue from each one's own rule. */
const DEPTS: { key: string; label: string; overdue: DeptKey | null; href: string }[] = [
  { key: "drawing", label: "Drawing", overdue: "drawing", href: "/risansi/departments/drawing?overdue=1" },
  { key: "purchase", label: "Purchase (BOI)", overdue: "purchase", href: "/risansi/departments/purchase?overdue=1" },
  { key: "quality", label: "Quality", overdue: "quality", href: "/risansi/departments/qc?overdue=1" },
  { key: "planning", label: "Planning", overdue: "planning", href: "/risansi/departments/planning?type=pump&overdue=1" },
  { key: "assembly", label: "Assembly", overdue: "assembly", href: "/risansi/departments/assembly-dispatch?type=pump&overdue=1" },
  { key: "packing", label: "Packing", overdue: null, href: "/risansi/departments/assembly-dispatch?type=pump" },
  { key: "dispatch", label: "Dispatch", overdue: "dispatch", href: "/risansi/departments/dispatch?overdue=1" },
];

/** The Pump dashboard for the Orders list's filter (types pinned to Pump / ROLB by the caller). */
export async function getPumpDashboard(filter: OrderListFilter, card: string | null = null): Promise<PumpDashboard> {
  const result = await listOrdersPage({
    page: 1,
    filter,
    all: true,
    kpis: orderListKpiCards("pump"),
    // The pump card picked narrows the SOs, as on the Orders list.
    extraRestrict: pumpCardSql(card),
  });
  // A test SO counts in nothing here.
  const rows = result.rows.filter((r) => !isTestSo(r.so_no));
  const ids = rows.map((r) => r.id);
  const summaries = await listPumpSummaries(ids);

  // What neither carries: the delivery date, the first dispatch, the dispatch
  // hold's reason, a packed lot on no slip, the pump ECs and their quantity,
  // and each department's overdue.
  type Facts = {
    id: string;
    delivery: string | null;
    first: string | null;
    hold_reason: string | null;
    no_slip: boolean;
    ecs: number;
    pumps: number;
  } & Record<string, unknown>;
  const facts = new Map<string, Facts>();
  if (ids.length) {
    const overdue = DEPTS.filter((d) => d.overdue).map(
      (d) => `(${deptQueueSql(d.overdue!)} AND ${deptOverduePredicate(d.overdue!)}) AS overdue_${d.key}`
    );
    const r = await query<Facts>(
      `SELECT o.id,
              to_char(o.delivery_date_as_per_so, 'YYYY-MM-DD') AS delivery,
              (SELECT to_char(min(COALESCE(i.invoice_date, i.challan_date)), 'YYYY-MM-DD')
                 FROM order_invoices i
                WHERE i.order_id = o.id AND NULLIF(btrim(i.delivery_mode), '') IS NOT NULL
                  AND COALESCE(i.invoice_date, i.challan_date) IS NOT NULL) AS first,
              CASE WHEN o.status_override = 'Hold' THEN o.status_reason END AS hold_reason,
              EXISTS (SELECT 1 FROM order_ready_lots nl JOIN order_items ni ON ni.id = nl.item_id
                       WHERE ni.order_id = o.id AND ni.item_type IN ('Pump', 'ROLB') AND nl.packed_date IS NOT NULL
                         AND NOT EXISTS (SELECT 1 FROM order_packing_slips ns
                                          WHERE ns.order_id = o.id AND ns.kind = 'actual'
                                            AND NULLIF(btrim(ns.packing_slip_no), '') IS NOT NULL
                                            AND (SELECT count(*) FROM order_ready_lots n2
                                                  WHERE n2.item_id = nl.item_id AND n2.seq <= nl.seq) = ANY(ns.lot_nos))) AS no_slip,
              (SELECT count(*)::int FROM order_items s WHERE s.order_id = o.id AND s.item_type IN ('Pump', 'ROLB')) AS ecs,
              (SELECT COALESCE(sum(s.quantity), 0)::int FROM order_items s WHERE s.order_id = o.id AND s.item_type IN ('Pump', 'ROLB')) AS pumps,
              ${overdue.join(",\n              ")}
         FROM orders o WHERE o.id = ANY($1::uuid[])`,
      [ids]
    );
    for (const x of r.rows) facts.set(x.id, x);
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const sos: PumpSo[] = rows.map((o) => {
    const f = facts.get(o.id);
    const holds: PumpSo["holds"] = [];
    if (o.clearance_status === "Hold") holds.push({ by: "Clearance", reason: str(o.clearance_hold_reason) });
    if (o.accounts_hold_status === "Hold") holds.push({ by: "Accounts", reason: str(o.accounts_hold_reason) });
    if (str(o.dispatch_status) === "Hold") holds.push({ by: "Dispatch", reason: str(f?.hold_reason) });
    const inr = Number(o.order_value_inr ?? ((o.order_currency ?? "INR").toUpperCase() === "INR" ? o.order_value : 0)) || 0;
    return {
      id: o.id,
      sl_no: o.sl_no,
      so_no: str(o.so_no),
      so_date: o.so_date ? str(o.so_date).slice(0, 10) : null,
      client: str(o.client_name),
      reps: str(o.reps).split(",").map((r) => r.trim()).filter(Boolean),
      zone: str(o.zone) || "No zone",
      value_inr: inr,
      stage: stageOf(str(o.dispatch_status), summaries[o.id]),
      dispatch: str(o.dispatch_status) || "Pending",
      delivery_date: f?.delivery ?? null,
      first_dispatch: f?.first ?? null,
      no_slip: !!f?.no_slip,
      holds,
    };
  });

  const live = sos.filter((s) => s.stage !== "Cancelled / Diverted");
  const open = live.filter((s) => s.stage !== "Fully dispatched");
  const count = (list: PumpSo[], stage: PumpStage) => list.filter((s) => s.stage === stage).length;

  const mix = (label: string, test: (s: PumpSo) => boolean) => ({ label, count: sos.filter(test).length });
  const dispatchMix = [
    mix("Fully dispatched", (s) => s.dispatch === "Fully dispatch"),
    mix("Lot dispatched", (s) => s.dispatch === "LOT dispatch"),
    mix("Dispatch hold", (s) => s.dispatch === "Hold"),
    mix("Pending", (s) => s.dispatch === "Pending"),
    mix("Cancelled / Diverted", (s) => s.stage === "Cancelled / Diverted"),
  ];

  // The last twelve months of intake, by SO date.
  const months: Bucket[] = [];
  const now = new Date(`${today}T00:00:00Z`);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    const inMonth = sos.filter((s) => (s.so_date ?? "").startsWith(key));
    months.push({
      label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
      count: inMonth.length,
      value: inMonth.reduce((a, s) => a + s.value_inr, 0),
    });
  }

  const measured = live.filter((s) => s.first_dispatch && s.delivery_date);
  const onTime = measured.filter((s) => s.first_dispatch! <= s.delivery_date!);
  const isLate = (s: PumpSo) =>
    !!s.delivery_date && (s.first_dispatch ? s.first_dispatch > s.delivery_date : s.stage !== "Fully dispatched" && s.delivery_date < today);
  const lateList = open
    .filter((s) => s.delivery_date && s.delivery_date < today)
    .map((s) => ({ ...s, daysLate: days(s.delivery_date!, today) }))
    .sort((a, b) => b.daysLate - a.daysLate);
  const weekAhead = new Date(now.getTime() + 7 * DAY).toISOString().slice(0, 10);
  const dueSoon = open
    .filter((s) => s.delivery_date && s.delivery_date >= today && s.delivery_date <= weekAhead)
    .map((s) => ({ ...s, daysLate: -days(today, s.delivery_date!) }))
    .sort((a, b) => b.daysLate - a.daysLate);

  const group = (key: (s: PumpSo) => string, list: PumpSo[]) => {
    const m = new Map<string, Bucket>();
    for (const s of list) {
      const k = key(s);
      const b = m.get(k) ?? { label: k, count: 0, value: 0 };
      b.count++;
      b.value = (b.value ?? 0) + s.value_inr;
      m.set(k, b);
    }
    return [...m.values()];
  };

  // Each Rep's book: their SOs by stage, and how their dispatches went.
  const repMap = new Map<string, RepRow<PumpStage>>();
  for (const s of sos) {
    for (const rep of s.reps.length ? s.reps : ["No Rep"]) {
      const r =
        repMap.get(rep) ??
        ({
          rep,
          sos: 0,
          value: 0,
          stages: Object.fromEntries(PUMP_STAGES.map((st) => [st, 0])) as Record<PumpStage, number>,
          stageValues: Object.fromEntries(PUMP_STAGES.map((st) => [st, 0])) as Record<PumpStage, number>,
          noSlip: 0,
          noSlipValue: 0,
          dispatchedOnTime: 0,
          dispatchedMeasured: 0,
          late: 0,
          lateValue: 0,
        } satisfies RepRow<PumpStage>);
      r.stages[s.stage]++;
      r.stageValues[s.stage] += s.value_inr;
      r.sos++;
      r.value += s.value_inr;
      if (isLate(s)) {
        r.late++;
        r.lateValue += s.value_inr;
      }
      if (s.no_slip) {
        r.noSlip++;
        r.noSlipValue += s.value_inr;
      }
      if (s.first_dispatch && s.delivery_date) {
        r.dispatchedMeasured++;
        if (s.first_dispatch <= s.delivery_date) r.dispatchedOnTime++;
      }
      repMap.set(rep, r);
    }
  }

  // The departments on the open SOs: done, under way, not started, or no work for them.
  const depts: DeptRow[] = DEPTS.map((d) => ({
    key: d.key,
    label: d.label,
    href: d.href,
    done: 0,
    progress: 0,
    pending: 0,
    na: 0,
    overdue: d.overdue ? 0 : null,
  }));
  const gad = new Map<string, number>();
  const boi = { received: 0, pending: 0 };
  const qc = { submitted: 0, pending: 0 };
  for (const s of open) {
    const sum = summaries[s.id];
    if (!sum) continue;
    const st = standings(sum, s.dispatch);
    const f = facts.get(s.id);
    for (const d of depts) {
      d[st[d.key]]++;
      if (d.overdue !== null && f?.[`overdue_${d.key}`]) d.overdue++;
    }
    // An SO with no pump EC yet has no GAD to stand at.
    if (!sum.drawing.closed && sum.drawing.gad.total > 0) gad.set(sum.drawing.gad.label, (gad.get(sum.drawing.gad.label) ?? 0) + 1);
    if (sum.purchase.required) {
      boi.received += sum.purchase.received;
      boi.pending += sum.purchase.items - sum.purchase.received;
    }
    if (sum.quality.required) {
      qc.submitted += sum.quality.submitted;
      qc.pending += sum.quality.total - sum.quality.submitted;
    }
  }
  const GAD_ORDER = ["Pending", "Resubmit", "Sent to client – approval pending", "Approved by client", "Issued to planning"];

  return {
    total: result.total,
    options: result.options,
    kpis: result.kpis ?? [],
    asOf: new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }),
    stages: PUMP_STAGES.map((st) => ({ label: st, count: count(sos, st) })),
    dispatchMix,
    intake: months,
    zones: group((s) => s.zone, sos).sort((a, b) => b.count - a.count),
    clients: group((s) => s.client || "—", sos).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 8),
    reps: [...repMap.values()].sort((a, b) => b.sos - a.sos || a.rep.localeCompare(b.rep)),
    depts,
    gad: [...gad.entries()]
      .map(([label, n]) => ({ label, count: n }))
      .sort((a, b) => GAD_ORDER.indexOf(a.label) - GAD_ORDER.indexOf(b.label)),
    boi,
    qc,
    metrics: {
      sos: sos.length,
      value: sos.reduce((a, s) => a + s.value_inr, 0),
      closed: sos.length - live.length,
      open: open.length,
      ecs: [...facts.values()].reduce((a, f) => a + (Number(f.ecs) || 0), 0),
      pumps: [...facts.values()].reduce((a, f) => a + (Number(f.pumps) || 0), 0),
      onTimeRate: measured.length ? onTime.length / measured.length : null,
      onTimeMeasured: measured.length,
      late: live.filter(isLate).length,
      dueThisWeek: dueSoon.length,
      holds: live.filter((s) => s.holds.length).length,
    },
    holds: live.filter((s) => s.holds.length).sort((a, b) => b.sl_no - a.sl_no),
    watch: [...lateList.slice(0, 12), ...dueSoon.slice(0, 6)],
  };
}
