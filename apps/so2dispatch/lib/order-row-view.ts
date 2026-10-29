import type { DeptCell, OrderListRow, SoDeptStatus } from "@/lib/orders";

// How one SO reads on the Orders list — its departments, planning, packing,
// readiness — shared by the list on screen and its PDF, so both say the same.

/** Planning is done once the ECs are ready, not as soon as they have a status. */
export const READY = ["fully ready", "assembled", "packed"];
/** The order statuses that close an SO. */
export const CLOSED = ["Cancelled by client", "Diverted"];

/**
 * The order's own status, always worked out — never set by hand: Canceled or
 * Diverted as it was closed; Closed once fully dispatched; Active-Hold while
 * any hold is on it (Central Visibility's, Order Making's, Dispatch's or
 * Accounts'); else Active.
 */
export type OrderStatus = "Active" | "Active-Hold" | "Canceled" | "Diverted" | "Closed";
export function orderStatusOf(o: {
  dispatch_status?: string | null;
  clearance_status?: string | null;
  om_status?: string | null;
  accounts_hold_status?: string | null;
}): OrderStatus {
  const dispatch = String(o.dispatch_status ?? "");
  if (dispatch === "Cancelled by client") return "Canceled";
  if (dispatch === "Diverted") return "Diverted";
  if (dispatch === "Fully dispatch") return "Closed";
  const held = [o.clearance_status, o.om_status, o.accounts_hold_status].some((v) => v === "Hold") || dispatch === "Hold";
  return held ? "Active-Hold" : "Active";
}
const READY_OR_BEYOND = ["partial ready", "fully ready", "assembled", "packed"];

export type EcDeptKey = "drawing" | "purchase" | "quality" | "planning" | "assembly";

/** An EC department across the SO's ECs: their shared state, or how many are done. */
export function acrossEcs(status: SoDeptStatus | undefined, key: EcDeptKey): DeptCell | null {
  if (!status) return null;
  const cells = status.ecs
    .map((e) => e[key])
    .filter((c) => c.state !== "na")
    .map((c) => (key === "planning" && !READY.includes(c.label.toLowerCase()) ? { ...c, state: "pending" as const } : c));
  if (cells.length === 0) return null;
  if (new Set(cells.map((c) => `${c.state}|${c.label}`)).size === 1) return cells[0];
  const done = cells.filter((c) => c.state === "done").length;
  return { state: done === cells.length ? "done" : "pending", label: `${done}/${cells.length} ECs done` };
}

/** A department the SO has reached. */
export type ReachedDept = {
  key: EcDeptKey | "billing" | "accounts" | "dispatch";
  name: string;
  cell: DeptCell;
};

const EC_TAG_NAMES = { drawing: "Drawing", purchase: "Purchase", quality: "Quality", planning: "Planning", assembly: "Packing" } as const;

/**
 * The departments an SO has reached — the ones whose queue it sits in now.
 * Packing appears once something is ready (not while Planning is still
 * planning), Dispatch once a numbered packing slip exists, Billing once there
 * are terms or PIs, Accounts once there is a PI or a payment.
 */
/** Planning has sent the SO on to Assembly & Packing: an EC ready (or beyond), or one under way there. */
export function reachedAssembly(status: SoDeptStatus | undefined): boolean {
  return !!status?.ecs.some(
    (e) =>
      !["pending", "assembly pending", "—"].includes(e.assembly.label.toLowerCase()) ||
      READY_OR_BEYOND.includes(e.planning.label.toLowerCase())
  );
}

/** The SO has reached Dispatch: a numbered packing slip filed — what puts it on Dispatch's queue. */
export function reachedDispatch(order: OrderListRow): boolean {
  return !!order.in_dispatch;
}

export function reachedDepts(order: OrderListRow, status: SoDeptStatus | undefined): ReachedDept[] {
  const tags: ReachedDept[] = [];
  if (!status) return tags;
  // Accounts is not involved only on a Challan order — nor is Billing's PI list.
  const challan = status.accounts.state === "na";
  for (const key of ["drawing", "purchase", "quality", "planning"] as const) {
    const anyInvolved = status.ecs.some((e) => e[key].state !== "na");
    if (!anyInvolved) continue;
    tags.push({ key, name: EC_TAG_NAMES[key], cell: acrossEcs(status, key)! });
  }
  if (reachedAssembly(status)) {
    const cell = acrossEcs(status, "assembly");
    const pump = (order.order_type ?? "").toLowerCase() !== "spare";
    if (cell) tags.push({ key: "assembly", name: pump ? "Assembly" : "Packing", cell });
  }
  const hasTerms = (order.term_lines ?? []).length > 0;
  const hasPi = (order.pi_docs ?? []).length > 0;
  if (!challan && status.billing.state !== "na" && (hasTerms || hasPi)) {
    tags.push({ key: "billing", name: "PI", cell: status.billing });
  }
  if (status.accounts.state !== "na" && (hasPi || status.accounts.state === "done")) {
    tags.push({ key: "accounts", name: "Accounts", cell: status.accounts });
  }
  if (order.in_dispatch || status.dispatch.state === "done") {
    tags.push({ key: "dispatch", name: "Dispatch", cell: status.dispatch });
  }
  return tags;
}

/** Planning's word on the SO. A Spare starts at Date awaited — once it has an EC; with none it reaches no department. */
export function planningText(order: OrderListRow, status: SoDeptStatus | undefined): string | null {
  if (Number(order.ec_count ?? 0) === 0) return null;
  return (
    order.readiness_status ??
    acrossEcs(status, "planning")?.label ??
    ((order.order_type ?? "").toLowerCase() === "spare" ? "Date awaited" : null)
  );
}

/** Assembly & Packing: its status, and when it was ready or packed. */
export function assemblyView(
  order: OrderListRow,
  status: SoDeptStatus | undefined,
  formatDate: (v: string | null) => string
): { cell: DeptCell | null; text: string | null; line?: string } {
  const cell = acrossEcs(status, "assembly");
  const text = cell?.label ?? null;
  const plan = order.packing_plan;
  const line =
    text && /packed/i.test(text) && order.packed_on
      ? `Packed ${formatDate(order.packed_on)}`
      : plan?.date && text && !/^fully packed$/i.test(text)
        ? [`Packing ${formatDate(plan.date)}`, plan.shift, plan.pdi === "Yes" ? "PDI" : null].filter(Boolean).join(" · ")
        : text && /ready|in progress/i.test(text) && order.ready_on
          ? `Ready ${formatDate(order.ready_on)}`
          : undefined;
  return { cell, text, line };
}
