import "server-only";
// The Spare dashboard: every Spare SO the Orders list's filter selects, read
// once and summed up — where the open SOs stand, how dispatch is going, how
// long things take, and each Rep's book. The KPI cards are the Orders list's
// own (orderListKpiCards), so a card means the same thing on both pages.

import { query } from "@/lib/db";
import { listOrdersPage, orderListKpiCards, type OrderListOptions, type OrderListRow } from "@/lib/orders";
import type { KpiCard } from "@/lib/kpis";
import type { OrderListFilter } from "@/lib/order-list-filter";
import { CLOSED } from "@/lib/order-row-view";

/** Where an SO stands, earliest first: the pipeline's stages. */
export const STAGES = [
  "Date awaited",
  "In plan",
  "Partial ready",
  "Ready, not packed",
  "Packed, to dispatch",
  "Dispatch hold",
  "Lot dispatched",
  "Fully dispatched",
  "Cancelled / Diverted",
] as const;
export type Stage = (typeof STAGES)[number];

export type DashboardSo = {
  id: string;
  sl_no: number;
  so_no: string;
  so_date: string | null;
  client: string;
  reps: string[];
  zone: string;
  value_inr: number;
  stage: Stage;
  dispatch: string;
  delivery_date: string | null;
  first_dispatch: string | null;
  /** Packed but on no packing slip yet. */
  no_slip: boolean;
  holds: { by: "Clearance" | "Accounts" | "Dispatch"; reason: string }[];
};

export type Bucket = { label: string; count: number; value?: number };

export type RepRow = {
  rep: string;
  /** All the Rep's SOs (cancelled and diverted included), and their value. */
  sos: number;
  value: number;
  stages: Record<Stage, number>;
  noSlip: number;
  dispatchedOnTime: number;
  dispatchedMeasured: number;
  late: number;
};

export type SpareDashboard = {
  total: number;
  options: OrderListOptions;
  kpis: KpiCard[];
  asOf: string;
  stages: Bucket[];
  dispatchMix: Bucket[];
  intake: Bucket[];
  zones: Bucket[];
  clients: Bucket[];
  reps: RepRow[];
  metrics: {
    /** All SOs in view (cancelled and diverted included), and their value. */
    sos: number;
    value: number;
    closed: number;
    /** Of them, not fully dispatched yet. */
    open: number;
    onTimeRate: number | null;
    onTimeMeasured: number;
    /** Dispatched after the delivery date, or not dispatched and past it. */
    late: number;
    dueThisWeek: number;
    holds: number;
  };
  holds: DashboardSo[];
  watch: (DashboardSo & { daysLate: number })[];
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const DAY = 86400000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** Where a Spare SO stands: dispatch first (it overrides), then its packing, then its planning. */
function stageOf(o: OrderListRow, packedLatest: boolean, packedAny: boolean): Stage {
  const dispatch = str(o.dispatch_status) || "Pending";
  if (CLOSED.includes(dispatch)) return "Cancelled / Diverted";
  if (dispatch === "Fully dispatch") return "Fully dispatched";
  if (dispatch === "Hold") return "Dispatch hold";
  if (dispatch === "LOT dispatch") return "Lot dispatched";
  const lots = o.lots ?? [];
  const plan = (lots.length ? lots[lots.length - 1].status : null) || str(o.readiness_status) || "Date awaited";
  // Every EC's latest lot packed: it waits on Dispatch. (A migrated SO with no
  // lots, Fully ready and packed somewhere, reads the same.)
  if (packedLatest || (plan === "Fully ready" && packedAny && !lots.length)) return "Packed, to dispatch";
  if (plan === "Fully ready") return "Ready, not packed";
  if (plan === "Partial ready") return "Partial ready";
  if (plan === "In plan") return "In plan";
  return "Date awaited";
}

/** The Spare dashboard for the Orders list's filter (types pinned to Spare by the caller). */
export async function getSpareDashboard(filter: OrderListFilter): Promise<SpareDashboard> {
  const result = await listOrdersPage({ page: 1, filter, all: true, kpis: orderListKpiCards("spare") });
  const rows = result.rows;
  const ids = rows.map((r) => r.id);

  // What the list rows do not carry: the delivery date, the first dispatch
  // (invoice and its Dispatch step filled), the dispatch hold's reason, and
  // whether a packed lot is on no slip.
  const facts = new Map<
    string,
    { delivery: string | null; first: string | null; hold_reason: string | null; no_slip: boolean; packed_latest: boolean; packed_any: boolean }
  >();
  if (ids.length) {
    const r = await query<{
      id: string;
      delivery: string | null;
      first: string | null;
      hold_reason: string | null;
      no_slip: boolean;
      packed_latest: boolean;
      packed_any: boolean;
    }>(
      `SELECT o.id,
              to_char(o.delivery_date_as_per_so, 'YYYY-MM-DD') AS delivery,
              (SELECT to_char(min(COALESCE(i.invoice_date, i.challan_date)), 'YYYY-MM-DD')
                 FROM order_invoices i
                WHERE i.order_id = o.id AND NULLIF(btrim(i.delivery_mode), '') IS NOT NULL
                  AND COALESCE(i.invoice_date, i.challan_date) IS NOT NULL) AS first,
              CASE WHEN o.status_override = 'Hold' THEN o.status_reason END AS hold_reason,
              EXISTS (SELECT 1 FROM order_ready_lots nl JOIN order_items ni ON ni.id = nl.item_id
                       WHERE ni.order_id = o.id AND nl.packed_date IS NOT NULL
                         AND NOT EXISTS (SELECT 1 FROM order_packing_slips ns
                                          WHERE ns.order_id = o.id AND ns.kind = 'actual'
                                            AND NULLIF(btrim(ns.packing_slip_no), '') IS NOT NULL
                                            AND (SELECT count(*) FROM order_ready_lots n2
                                                  WHERE n2.item_id = nl.item_id AND n2.seq <= nl.seq) = ANY(ns.lot_nos))) AS no_slip,
              -- The latest lot of every EC packed.
              (EXISTS (SELECT 1 FROM order_ready_lots l JOIN order_items li ON li.id = l.item_id WHERE li.order_id = o.id)
               AND NOT EXISTS (SELECT 1 FROM order_items li
                                JOIN LATERAL (SELECT l.packed_date FROM order_ready_lots l
                                               WHERE l.item_id = li.id ORDER BY l.seq DESC LIMIT 1) last ON true
                               WHERE li.order_id = o.id AND last.packed_date IS NULL)) AS packed_latest,
              EXISTS (SELECT 1 FROM order_ready_lots l JOIN order_items li ON li.id = l.item_id
                       WHERE li.order_id = o.id AND l.packed_date IS NOT NULL) AS packed_any
         FROM orders o WHERE o.id = ANY($1::uuid[])`,
      [ids]
    );
    for (const x of r.rows) facts.set(x.id, x);
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const sos: DashboardSo[] = rows.map((o) => {
    const f = facts.get(o.id);
    const holds: DashboardSo["holds"] = [];
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
      stage: stageOf(o, !!f?.packed_latest, !!f?.packed_any),
      dispatch: str(o.dispatch_status) || "Pending",
      delivery_date: f?.delivery ?? null,
      first_dispatch: f?.first ?? null,
      no_slip: !!f?.no_slip,
      holds,
    };
  });

  // All SOs count, cancelled and diverted included; "live" (not cancelled or
  // diverted) is what can be late, held, or still to go.
  const live = sos.filter((s) => s.stage !== "Cancelled / Diverted");
  const open = live.filter((s) => s.stage !== "Fully dispatched");
  const count = (list: DashboardSo[], stage: Stage) => list.filter((s) => s.stage === stage).length;

  // Dispatch: the SO's own status, closed ones included.
  const mix = (label: string, test: (s: DashboardSo) => boolean) => ({ label, count: sos.filter(test).length });
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
  // Late: went out after its delivery date, or has not gone and is past it.
  const isLate = (s: DashboardSo) =>
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

  // By zone and by client: open SOs, by count and value.
  const group = (key: (s: DashboardSo) => string, list: DashboardSo[]) => {
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

  // Each Rep's book: their open SOs by stage, and how their dispatches went.
  const repMap = new Map<string, RepRow>();
  for (const s of sos) {
    for (const rep of s.reps.length ? s.reps : ["No Rep"]) {
      const r =
        repMap.get(rep) ??
        ({
          rep,
          sos: 0,
          value: 0,
          stages: Object.fromEntries(STAGES.map((st) => [st, 0])) as Record<Stage, number>,
          noSlip: 0,
          dispatchedOnTime: 0,
          dispatchedMeasured: 0,
          late: 0,
        } satisfies RepRow);
      r.stages[s.stage]++;
      r.sos++;
      r.value += s.value_inr;
      if (isLate(s)) r.late++;
      if (s.no_slip) r.noSlip++;
      if (s.first_dispatch && s.delivery_date) {
        r.dispatchedMeasured++;
        if (s.first_dispatch <= s.delivery_date) r.dispatchedOnTime++;
      }
      repMap.set(rep, r);
    }
  }

  return {
    total: result.total,
    options: result.options,
    kpis: result.kpis ?? [],
    asOf: new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }),
    stages: STAGES.map((st) => ({ label: st, count: count(sos, st) })),
    dispatchMix,
    intake: months,
    zones: group((s) => s.zone, sos).sort((a, b) => b.count - a.count),
    clients: group((s) => s.client || "—", sos).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 8),
    reps: [...repMap.values()].sort((a, b) => b.sos - a.sos || a.rep.localeCompare(b.rep)),
    metrics: {
      sos: sos.length,
      value: sos.reduce((a, s) => a + s.value_inr, 0),
      closed: sos.length - live.length,
      open: open.length,
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
