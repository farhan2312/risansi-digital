import "server-only";
// The Orders page's department board: every SO the filter selects, and where
// it stands in each department. Read only: it reads the same department
// statuses the Orders list's row tags do (listOrderDeptStatuses), and the
// SO's own holds and targets.

import { query } from "@/lib/db";
import { listOrderDeptStatuses, listOrderIdsMatching, TEST_SO_SQL, type DeptCell, type EcDeptStatus, type SoDeptStatus } from "@/lib/orders";
import { orderStatusSql, CLOSED_ORDER_STATUSES } from "@/lib/dept-view";
import { ONLY_BILLING, orderTypeText } from "@/lib/order-schema";
import { parseOrderListFilter, scopeToRep, withOrdersKind, type OrderListFilter } from "@/lib/order-list-filter";
import { seesOrderRefs } from "@/lib/roles";

/** The Orders filter from its query string, as the Orders page reads it (a Rep's own SOs). */
export function boardFilterOf(
  user: { role: string; rep_names?: string[] },
  get: (key: string) => string | undefined
): OrderListFilter {
  const filter = scopeToRep(withOrdersKind(parseOrderListFilter(get, { noDispatchTarget: true }), get("type")), user);
  if (!seesOrderRefs(user.role)) filter.refSearch = "";
  return filter;
}
import type { BoardCell, BoardData, BoardDeptKey, BoardGroup, BoardSo } from "@/lib/dept-board-keys";

/** A status that says the department has not begun on it. */
const NOT_STARTED = /^(pending|date awaited|assembly pending|packing pending|readiness date awaited|not started|—)$/i;

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** A department's cell: its group from the status, the hold and the target. */
function cellOf(c: DeptCell, target: string | null, today: string, held = false, ec?: { done: number; total: number }): BoardCell {
  const late = c.state === "pending" && target && target < today ? daysBetween(target, today) : 0;
  const group: BoardGroup =
    c.state === "na" ? "na"
    : c.state === "done" ? "done"
    : held ? "hold"
    : late > 0 ? "overdue"
    : NOT_STARTED.test(c.label.trim()) && !(ec && ec.done > 0) ? "waiting"
    : "progress";
  return {
    group,
    label: held && c.state === "pending" ? "On hold" : c.label,
    target: c.state === "na" ? null : target,
    late,
    ...(ec ? { ecDone: ec.done, ecTotal: ec.total } : {}),
  };
}

/** A per-EC department as one cell for the SO: done once every EC it has is. */
function rollUp(ecs: EcDeptStatus[], pick: (e: EcDeptStatus) => DeptCell): { cell: DeptCell; ec?: { done: number; total: number } } {
  const cells = ecs.map(pick).filter((c) => c.state !== "na" && c.label !== "—");
  if (!cells.length) return { cell: { state: "na", label: "N/A" } };
  const done = cells.filter((c) => c.state === "done");
  const ec = { done: done.length, total: cells.length };
  if (done.length === cells.length) {
    const labels = new Set(done.map((c) => c.label));
    return { cell: { state: "done", label: labels.size === 1 ? done[0].label : "Done" }, ec };
  }
  // The status most of its open ECs are at.
  const tally = new Map<string, number>();
  for (const c of cells) if (c.state === "pending") tally.set(c.label, (tally.get(c.label) ?? 0) + 1);
  const label = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { cell: { state: "pending", label }, ec };
}

type Head = {
  id: string;
  so_no: string;
  client_name: string | null;
  order_type: string | null;
  spare_type: string | null;
  so_date: string | null;
  bill_mode: string | null;
  om_status: string | null;
  sent_ops: string | null;
  accounts_hold: string | null;
  cv_hold: boolean;
};

/**
 * The board for the Orders filter: every SO it selects with an SO No. (no
 * test SO, none cancelled or diverted), oldest SO first.
 */
export async function loadDeptBoard(filter: OrderListFilter): Promise<BoardData> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const matched = await listOrderIdsMatching(filter);
  if (!matched.length) return { sos: [], today };
  const heads = await query<Head>(
    `SELECT o.id::text, o.so_no, o.client_name, o.order_type, o.spare_type,
            to_char(o.so_date, 'YYYY-MM-DD') AS so_date, o.bill_mode, o.om_status,
            to_char(o.ec_sent_operation_date, 'YYYY-MM-DD') AS sent_ops,
            o.accounts_hold_status AS accounts_hold,
            COALESCE(o.clearance_status, '') = 'Hold' AS cv_hold
       FROM orders o
      WHERE o.id = ANY($1::uuid[])
        AND NULLIF(btrim(o.so_no), '') IS NOT NULL
        AND NOT ${TEST_SO_SQL("o")}
        AND ${orderStatusSql("o")} <> ALL($2::text[])
      ORDER BY o.so_date ASC NULLS LAST, o.sl_no ASC`,
    [matched, [...CLOSED_ORDER_STATUSES]]
  );
  const statuses = await listOrderDeptStatuses(heads.rows.map((h) => h.id));
  const sos: BoardSo[] = [];
  for (const h of heads.rows) {
    const st = statuses.get(h.id);
    if (!st) continue;
    sos.push({
      id: h.id,
      soNo: h.so_no,
      client: h.client_name ?? "",
      orderType: orderTypeText(h),
      soDate: h.so_date,
      ecs: st.ecs.length,
      cvHold: h.cv_hold,
      cells: cellsOf(h, st, today),
    });
  }
  return { sos, today };
}

function cellsOf(h: Head, st: SoDeptStatus, today: string): Record<BoardDeptKey, BoardCell> {
  const t = st.targets;
  const per = (pick: (e: EcDeptStatus) => DeptCell, target: string | null) => {
    const { cell, ec } = rollUp(st.ecs, pick);
    return cellOf(cell, target, today, false, ec);
  };
  const rest = {
    drawing: per((e) => e.drawing, t.drawingReadiness ?? t.drawing),
    purchase: per((e) => e.purchase, t.purchase),
    billing: cellOf(st.billing, null, today),
    accounts: cellOf(st.accounts, null, today, h.accounts_hold === "Hold"),
    planning: per((e) => e.planning, null),
    quality: per((e) => e.quality, t.quality),
    assembly: per((e) => e.assembly, t.assembly),
    dispatch:
      st.dispatch.label === "Hold"
        ? cellOf(st.dispatch, null, today, true)
        : cellOf(st.dispatch, t.dispatchRevised ?? t.dispatch, today),
  };
  // Order Making: done once sent to Operation (an Only Billing SO never goes);
  // an SO the departments after it have taken up is past it too (the older
  // SOs carry no Sent to Operation date).
  const downstream = Object.values(rest).some((c) => c.group === "done" || c.group === "progress" || c.group === "overdue");
  const om: DeptCell =
    h.bill_mode === ONLY_BILLING
      ? { state: "done", label: "Only Billing" }
      : h.sent_ops
        ? { state: "done", label: "Sent to Operation" }
        : downstream && h.om_status !== "Hold"
          ? { state: "done", label: "In Operation" }
          : { state: "pending", label: "Pending" };
  return { "order-making": cellOf(om, null, today, h.om_status === "Hold"), ...rest };
}
