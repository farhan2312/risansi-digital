import "server-only";
// The Orders page's department board: for every SO the Orders filter
// selects, each department's own summary cards, counted exactly as its page
// counts them (the same card definitions, over the same queue), and each
// department's own status per SO for its page's table. Read only.

import { query } from "@/lib/db";
import {
  countKpiCardsOver,
  deptKpiCards,
  dispatchQueueSql,
  listOrderDeptStatuses,
  listOrderIdsMatching,
  sectionItemsSql,
  TEST_SO_SQL,
  type DeptCell,
  type EcDeptStatus,
} from "@/lib/orders";
import { DEPT_VIEWS, deptQueueSql, orderStatusSql, CLOSED_ORDER_STATUSES } from "@/lib/dept-view";
import { pumpViewRestrict } from "@/lib/assembly";
import { assemblyPumpCards, drawingCards, purchaseCards, qcCards } from "@/lib/dept-cards";
import { orderTypeText } from "@/lib/order-schema";
import { ordersKind, parseOrderListFilter, scopeToRep, withOrdersKind, type OrderListFilter } from "@/lib/order-list-filter";
import { seesOrderRefs } from "@/lib/roles";
import type { KpiCard, KpiCardDef } from "@/lib/kpis";
import { BOARD_DEPTS, cardRole, type BoardData, type BoardDeptKey, type DeptSoRow } from "@/lib/dept-board-keys";

/** The Orders filter from its query string, as the Orders page reads it (a Rep's own SOs). */
export function boardFilterOf(
  user: { role: string; rep_names?: string[] },
  get: (key: string) => string | undefined
): OrderListFilter {
  const filter = scopeToRep(withOrdersKind(parseOrderListFilter(get, { noDispatchTarget: true }), get("type")), user);
  if (!seesOrderRefs(user.role)) filter.refSearch = "";
  return filter;
}

/** An SO's order value in rupees, as the Dashboard counts it. */
const ORDER_VALUE_INR = `COALESCE(o.order_value_inr, CASE WHEN upper(COALESCE(o.order_currency, 'INR')) = 'INR' THEN o.order_value END, 0)`;

const kindOf = (filter: OrderListFilter): "spare" | "pump" => ordersKind(filter.types.join(","));

/** A department's cards and the SOs its page lists (its queue), as its page has them. */
function deptSpec(dept: BoardDeptKey, kind: "spare" | "pump"): { cards: KpiCardDef[]; restrict: string } {
  const pump = kind === "pump";
  switch (dept) {
    case "drawing":
      return { cards: drawingCards(), restrict: `${deptQueueSql("drawing")} AND ${sectionItemsSql("drawing")}` };
    case "purchase":
      return { cards: purchaseCards(), restrict: `${deptQueueSql("purchase")} AND ${sectionItemsSql("purchase")}` };
    case "billing":
      return { cards: deptKpiCards("billing", [], DEPT_VIEWS.billing.hasTarget), restrict: deptQueueSql("billing") };
    case "accounts":
      return { cards: deptKpiCards("accounts", [], DEPT_VIEWS.accounts.hasTarget), restrict: deptQueueSql("accounts") };
    case "planning":
      return { cards: deptKpiCards("planning", pump ? ["Pump"] : ["Spare"]), restrict: `${deptQueueSql("planning")} AND ${sectionItemsSql("planning")}` };
    case "quality":
      return { cards: qcCards(), restrict: `${deptQueueSql("quality")} AND ${sectionItemsSql("quality")}` };
    case "assembly":
      return pump
        ? { cards: assemblyPumpCards(), restrict: `${deptQueueSql("assembly")} AND ${pumpViewRestrict([], [])} AND ${sectionItemsSql("assembly")}` }
        : { cards: deptKpiCards("assembly", ["Spare"]), restrict: `${deptQueueSql("assembly")} AND ${sectionItemsSql("assembly")}` };
    case "dispatch":
      return { cards: deptKpiCards("dispatch", [], false), restrict: dispatchQueueSql() };
  }
}

/** Every department's cards over the SOs the Orders filter selects. */
export async function loadDeptBoard(filter: OrderListFilter): Promise<BoardData> {
  const kind = kindOf(filter);
  const ids = await listOrderIdsMatching(filter);
  const columns = await Promise.all(
    BOARD_DEPTS.map(async (d) => {
      const spec = deptSpec(d.key, kind);
      if (!ids.length) return { key: d.key, cards: [], values: {} };
      // Each SO card's order value: summed over the SOs it counts, in rupees.
      const valueCards: KpiCardDef[] = spec.cards
        .filter((c) => !c.measure)
        .map((c) => ({ key: c.key, label: c.label, sql: null, params: {}, money: true, measure: c.sql ? `CASE WHEN (${c.sql}) THEN ${ORDER_VALUE_INR} ELSE 0 END` : ORDER_VALUE_INR }));
      const [cards, values] = await Promise.all([
        countKpiCardsOver(ids, spec.restrict, spec.cards),
        countKpiCardsOver(ids, spec.restrict, valueCards),
      ]);
      return { key: d.key, cards, values: Object.fromEntries(values.map((v) => [v.key, v.count])) };
    })
  );
  return { columns, kind };
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

type Head = {
  id: string;
  so_no: string;
  client_name: string | null;
  order_type: string | null;
  spare_type: string | null;
  so_date: string | null;
  cv_hold: boolean;
  zone: string | null;
  reps: string | null;
  value: number;
  /** The keys of the cards it counts in. */
  keys: string[];
};

/**
 * One department's cards and its SOs: for each, the cards it counts in (its
 * status in each group, Overdue, the holds — the department page's own
 * rules), per EC how many of its ECs are at each status, its target and how
 * late.
 */
export async function loadDeptPage(
  filter: OrderListFilter,
  dept: BoardDeptKey
): Promise<{ cards: KpiCard[]; rows: DeptSoRow[]; kind: "spare" | "pump"; today: string }> {
  const kind = kindOf(filter);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const spec = deptSpec(dept, kind);
  const matched = await listOrderIdsMatching(filter);
  if (!matched.length) return { cards: [], rows: [], kind, today };
  // The cards an SO can be in: those that pick SOs (not a total or a sum).
  const picking = spec.cards.filter((c) => c.sql && !c.measure);
  const keysSql = picking.length
    ? `array_remove(ARRAY[${picking.map((c, i) => `CASE WHEN (${c.sql}) THEN ${i} END`).join(", ")}]::int[], NULL)`
    : "ARRAY[]::int[]";
  const [cards, heads] = await Promise.all([
    countKpiCardsOver(matched, spec.restrict, spec.cards),
    query<Omit<Head, "keys"> & { keys: number[] }>(
      `SELECT o.id::text, o.so_no, o.client_name, o.order_type, o.spare_type,
              to_char(o.so_date, 'YYYY-MM-DD') AS so_date,
              COALESCE(o.clearance_status, '') = 'Hold' AS cv_hold, o.zone, o.reps,
              COALESCE(o.order_value_inr, CASE WHEN upper(COALESCE(o.order_currency, 'INR')) = 'INR' THEN o.order_value END, 0)::float8 AS value,
              ${keysSql} AS keys
         FROM orders o
        WHERE o.id = ANY($1::uuid[]) AND (${spec.restrict}) AND NOT ${TEST_SO_SQL("o")}
        ORDER BY o.so_date ASC NULLS LAST, o.sl_no ASC`,
      [matched]
    ),
  ]);
  const statuses = await listOrderDeptStatuses(heads.rows.map((h) => h.id));
  const rows: DeptSoRow[] = [];
  for (const h of heads.rows) {
    const st = statuses.get(h.id);
    const inCards = h.keys.map((i) => picking[i]);
    const row: DeptSoRow = {
      id: h.id,
      soNo: h.so_no || "—",
      client: h.client_name ?? "",
      orderType: orderTypeText(h),
      soDate: h.so_date,
      cvHold: h.cv_hold,
      zone: h.zone ?? "",
      reps: h.reps ?? "",
      value: Number(h.value) || 0,
      statuses: inCards
        .filter((c) => cardRole(c) === "status")
        .map((c) => ({ key: c.key, label: c.label, group: c.group ?? "Status", tone: c.tone ?? "neutral" })),
      flags: inCards.filter((c) => cardRole(c) !== "status").map((c) => ({ key: c.key, label: c.label })),
      target: null,
      late: 0,
    };
    if (st) {
      const t = st.targets;
      // Per EC: how many of its ECs are at each status; the target and how late, while it is open.
      const perEc = (pick: (e: EcDeptStatus) => DeptCell, target: string | null) => {
        const cells = st.ecs.map(pick).filter((c) => c.state !== "na" && c.label !== "—");
        const tally = new Map<string, number>();
        for (const c of cells) tally.set(c.label, (tally.get(c.label) ?? 0) + 1);
        row.ecStatuses = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
        setTarget(target, cells.some((c) => c.state === "pending"));
      };
      const setTarget = (target: string | null, open: boolean) => {
        row.target = target;
        row.late = open && target && target < today ? daysBetween(target, today) : 0;
      };
      if (dept === "drawing") perEc((e) => e.drawing, t.drawingReadiness ?? t.drawing);
      else if (dept === "purchase") perEc((e) => e.purchase, t.purchase);
      else if (dept === "planning") perEc((e) => e.planning, null);
      else if (dept === "quality") perEc((e) => e.quality, t.quality);
      else if (dept === "assembly") perEc((e) => e.assembly, t.assembly);
      else if (dept === "dispatch" && st.dispatch.label !== "Hold") setTarget(t.dispatchRevised ?? t.dispatch, st.dispatch.state === "pending");
    }
    // Late only as the department's own Overdue card has it.
    if (!row.flags.some((f) => f.key === "overdue")) row.late = 0;
    rows.push(row);
  }
  return { cards, rows, kind, today };
}

/** One row of the Dashboard's SO pipeline: a department's status, its SOs and their value. */
export type PipelineRow = { dept: string; key: string; label: string; tone: string; count: number; value: number };

/**
 * The Dashboard's SO pipeline in the department board's own statuses: each SO
 * once, at the furthest of Planning → Assembly & Packing → Dispatch whose
 * queue it is in and whose status card it matches (the same cards, the same
 * rules as the board). Those in none: cancelled or diverted, or not with
 * Planning yet.
 */
export async function pipelineByStatus(orderIds: string[], kind: "spare" | "pump"): Promise<PipelineRow[]> {
  const ids = orderIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return [];
  const order: [BoardDeptKey, string][] = [
    ["dispatch", "Dispatch"],
    ["assembly", "Assembly & Packing"],
    ["planning", "Planning"],
  ];
  const picks = order.flatMap(([key, dept]) => {
    const spec = deptSpec(key, kind);
    // Furthest first within a department too: packing before assembly. A
    // starting status (nothing begun there yet) leaves the SO to the
    // department before, so Assembly & Packing holds only SOs it has begun.
    const starting = ["Assembly pending", "Packing pending"];
    const rank = (l: string) => (/packed|packing/i.test(l) ? 0 : 1);
    return spec.cards
      .filter((c) => c.sql && !c.measure && !c.group && cardRole(c) === "status" && !(key === "assembly" && starting.includes(c.label)))
      .sort((x, y) => (key === "assembly" ? rank(x.label) - rank(y.label) : 0))
      .map((c) => ({ dept, key: `${key}::${c.key}`, label: c.label, tone: c.tone ?? "neutral", pos: spec.cards.indexOf(c), when: `(${spec.restrict}) AND (${c.sql})` }));
  });
  const CLOSED = "closed::closed";
  const NOT_YET = "none::none";
  const r = await query<{ stage: string; n: number; value: number }>(
    `SELECT stage, count(*)::int AS n, COALESCE(sum(v), 0)::float8 AS value FROM (
       SELECT CASE WHEN ${orderStatusSql("o")} = ANY($2::text[]) THEN '${CLOSED}'
                   ${picks.map((p, i) => `WHEN ${p.when} THEN $${i + 3}::text`).join("\n                   ")}
                   ELSE '${NOT_YET}' END AS stage,
              ${ORDER_VALUE_INR} AS v
         FROM orders o WHERE o.id = ANY($1::uuid[]) AND NOT ${TEST_SO_SQL("o")}) s
     GROUP BY stage`,
    [ids, [...CLOSED_ORDER_STATUSES], ...picks.map((p) => p.key)]
  );
  const got = new Map(r.rows.map((x) => [x.stage, x]));
  // Earliest first, as an SO moves: Planning, then Assembly & Packing, then Dispatch.
  const rows: PipelineRow[] = [];
  const notYet = got.get(NOT_YET);
  if (notYet) rows.push({ dept: "Not with Planning yet", key: NOT_YET, label: "Not with Planning yet", tone: "neutral", count: notYet.n, value: notYet.value });
  for (const [, dept] of [...order].reverse()) {
    // Shown in the department's own card order (as its page and the board list them).
    for (const p of picks.filter((x) => x.dept === dept).sort((x, y) => x.pos - y.pos)) {
      const g = got.get(p.key);
      rows.push({ dept, key: p.key, label: p.label, tone: p.tone, count: g?.n ?? 0, value: g?.value ?? 0 });
    }
  }
  const closed = got.get(CLOSED);
  if (closed) rows.push({ dept: "Closed", key: CLOSED, label: "Cancelled by client / Diverted", tone: "neutral", count: closed.n, value: closed.value });
  return rows;
}
