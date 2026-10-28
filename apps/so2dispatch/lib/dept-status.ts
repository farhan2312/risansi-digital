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
  billing: "Proforma Invoice",
  accounts: "Accounts",
  dispatch: "Dispatch",
};

/** Nothing recorded yet. Every department offers it. */
export const PENDING = "Pending";
/**
 * Central Visibility has put the SO on hold: every department reads Hold
 * until it is cleared (Dispatch's own Hold, too).
 */
export const HOLD = "Hold";

/** The departments whose SO hold counts Dispatch's own hold too. */
const DISPATCH_HOLD_DEPTS: readonly string[] = ["dispatch", "billing", "accounts"];

/**
 * The SO is on hold (alias o) — by Central Visibility or Order Making, and by
 * Dispatch (its dispatch status Hold) on the Orders list and in Dispatch,
 * Proforma Invoice and Accounts. Accounts' own hold is not an SO hold. The SO
 * hold card and filter; a held SO counts as no department's Open or Pending.
 */
export function soHoldSql(o = "o", dept?: string | null): string {
  const dispatch = !dept || DISPATCH_HOLD_DEPTS.includes(dept) ? ` OR COALESCE(${o}.status_override, '') = 'Hold'` : "";
  return `(COALESCE(${o}.clearance_status, '') = 'Hold' OR COALESCE(${o}.om_status, '') = 'Hold'${dispatch})`;
}

/** `expr IN values`, a held SO (alias o) left out of the open words. */
export function inListNotHeld(expr: string, values: string[], open: string[], o: string, dept: string): string {
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const list = `${expr} IN (${values.map(lit).join(", ")})`;
  return values.some((v) => open.includes(v))
    ? `(${list} AND (${expr} NOT IN (${open.map(lit).join(", ")}) OR NOT ${soHoldSql(o, dept)}))`
    : list;
}
/**
 * Planning's Status filter also reads Assembly & Packing on the same EC, so
 * "Fully ready" splits into packed and not packed yet.
 */
export const PLANNING_PACKING_OPTIONS = ["Partially packed", "Fully packed", "Not packed"];
/**
 * …and on a Pump SO, Assembly & Packing's own SO statuses, as its page reads
 * them (lib/assembly): assembly, then packing.
 */
export const PLANNING_PUMP_ASSEMBLY_OPTIONS = ["Not assembled", "Partial assembled", "Fully assembled"];
export const PLANNING_PUMP_PACKING_OPTIONS = ["Not packed", "Partially packed", "Fully packed"];
/** Planning says "Not assembled" / "Not packed" for Assembly & Packing's "… pending". */
export const PLANNING_PUMP_STAGE_STATUS: Record<string, string> = {
  "Not assembled": "Assembly pending",
  "Not packed": "Packing pending",
};
/** The Assembly & Packing choices Planning's Status filter offers for these order types. */
export function planningPackingOptions(types: string[]): string[] {
  const pump = types.length > 0 && types.every((t) => /^(pump|rolb)$/i.test(t));
  return pump ? [...PLANNING_PUMP_ASSEMBLY_OPTIONS, ...PLANNING_PUMP_PACKING_OPTIONS] : PLANNING_PACKING_OPTIONS;
}
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
  // The SO's own Planning status (an SO is planned as one).
  planning: [...PUMP_PLANNING_STATUSES],
  // A Spare stands where its latest readiness lot does: ready, then packed.
  // A Pump is Fully packed once its packing date is in.
  // No Pending: what reaches Assembly & Packing is ready or packed already.
  // A Spare lot ready but not packed yet is In Progress.
  assembly: ["In Progress", "Partially packed", "Fully packed"],
  // Which one depends on the SO's Bill Type — a Challan order never gets a PI.
  // N/A is the paid-after-receipt case: no PI is due at all.
  // PIs raised against the SO's payment terms — After Receipt lines are not
  // counted (no PI is raised for them); N/A when every line is After Receipt.
  billing: ["Fully raised", "Partially raised", PENDING, NOT_APPLICABLE],
  accounts: [...values(PAYMENT_STATUS_OPTIONS), PENDING, NOT_APPLICABLE],
  // "Pending" is itself a stored dispatch status, so it covers both a blank
  // column and an explicit Pending rather than appearing twice.
  // Dispatch's own words only: a cancelled or diverted SO is out of its queue.
  dispatch: ["Fully dispatch", "LOT dispatch", HOLD, PENDING],
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
    if (t === "spare") return [...SPARE_PLANNING_STATUSES, HOLD];
    if (t === "pump" || t === "rolb") return [...PUMP_PLANNING_STATUSES, HOLD];
  }
  const list = DEPT_STATUSES[dept];
  return list.includes(HOLD) ? list : [...list, HOLD];
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
