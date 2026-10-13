// The department-status filter on the orders list. Plain module (no server
// imports) so the client filter controls and the SQL that backs them agree on
// one list of departments and states.
//
// The states are the department's real vocabulary — Drawing is "Approved" or
// "Issued to Client", Accounts carries the actual payment status — not a
// flattened done/pending. They mirror getOrderDeptStatus, the same rules the
// "Departments" popup shows, so filtering to "Drawing / Approved" lists exactly
// the SOs whose popup says Approved.

import {
  PAYMENT_STATUS_OPTIONS,
  PLANNING_STATUS_VALUES,
  PUMP_PLANNING_STATUSES,
  SPARE_PLANNING_STATUSES,
} from "@/lib/order-schema";

export const DEPT_FILTER_KEYS = [
  "drawing",
  "purchase",
  "quality",
  "planning",
  "assembly",
  "billing",
  "accounts",
  "dispatch",
] as const;

export type DeptFilterKey = (typeof DEPT_FILTER_KEYS)[number];

export const DEPT_FILTER_LABELS: Record<DeptFilterKey, string> = {
  drawing: "Drawing",
  purchase: "Purchase",
  quality: "Quality",
  planning: "Planning",
  assembly: "Assembly & Packing",
  billing: "Billing & Operations",
  accounts: "Accounts",
  dispatch: "Dispatch",
};

/** Nothing recorded yet. Every department offers it. */
export const PENDING = "Pending";
/**
 * Planning's Status filter also reads Assembly & Packing on the same EC, so
 * "Fully ready" splits into packed and not packed yet.
 */
export const PLANNING_PACKING_OPTIONS = ["Partially packed", "Fully packed", "Not packed"];
/** The department has nothing to do on this order at all. */
export const NOT_APPLICABLE = "N/A";

const values = (list: { value: string }[]) => list.map((o) => o.value);

const DEPT_STATUSES: Record<DeptFilterKey, string[]> = {
  // The furthest hand-off wins: a drawing that came back approved reads as
  // Approved even though it was issued to Operations and the client first.
  drawing: ["Approved", "Issued to Client", "Issued to Operations", PENDING, NOT_APPLICABLE],
  // Bought out and every line receipted.
  purchase: ["Received", PENDING, NOT_APPLICABLE],
  quality: ["Submitted", PENDING, NOT_APPLICABLE],
  // Whichever of pump/spare/free-text status the EC carries.
  // No Pending: a Spare starts at Date awaited, a Pump at its first status.
  planning: [...PLANNING_STATUS_VALUES],
  // A Spare stands where its latest readiness lot does: ready, then packed.
  // A Pump is Fully packed once its packing date is in.
  // No Pending: what reaches Assembly & Packing is ready or packed already.
  assembly: ["Partial ready", "Fully ready", "Partially packed", "Fully packed"],
  // Which one depends on the SO's Bill Type — a Challan order never gets a PI.
  // N/A is the paid-after-receipt case: no PI is due at all.
  billing: ["PI raised", PENDING],
  accounts: [...values(PAYMENT_STATUS_OPTIONS), PENDING, NOT_APPLICABLE],
  // "Pending" is itself a stored dispatch status, so it covers both a blank
  // column and an explicit Pending rather than appearing twice.
  // Dispatch's own words only: a cancelled or diverted SO is out of its queue.
  dispatch: ["Fully dispatch", "LOT dispatch", PENDING],
};

/**
 * Departments whose work does not vary by customer: they make, check, plan and
 * pack to dates and statuses, so zone, rep, market and order type are noise on
 * their queues. The commercial departments keep them.
 */
export const DEPTS_WITHOUT_PARTY: ReadonlySet<DeptFilterKey> = new Set<DeptFilterKey>([
  "planning",
  "purchase",
  "quality",
  "assembly",
]);

/**
 * A department's statuses. Planning's words differ for a Pump and a Spare, so
 * with exactly one of those types chosen it offers only that type's.
 */
export function statusesFor(dept: DeptFilterKey, types: string[] = []): string[] {
  if (dept === "planning" && types.length === 1) {
    const t = types[0].trim().toLowerCase();
    if (t === "spare") return [...SPARE_PLANNING_STATUSES];
    if (t === "pump" || t === "rolb") return [...PUMP_PLANNING_STATUSES];
  }
  return DEPT_STATUSES[dept];
}

/** Drawing…Assembly are tracked per EC; the rest sit on the SO. */
export function isPerEcDept(dept: DeptFilterKey): boolean {
  return dept !== "billing" && dept !== "accounts" && dept !== "dispatch";
}

/**
 * Nothing is outstanding on a row: every department is either done or not
 * involved. One rule, so the green "Complete" row on the pipeline and the one
 * on the order overview mean the same thing — and so a department that has
 * nothing to do (Purchase on a no-BOI order) never holds a row back.
 *
 * Callers pass what each department says about the row: the pipeline reads it
 * from DEPT_VIEWS, the overview from the status cells.
 */
export function allDeptsSettled(depts: { done: boolean; na: boolean }[]): boolean {
  return depts.length > 0 && depts.every((d) => d.done || d.na);
}
