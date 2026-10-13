// Marking a department's work on an SO (or one EC of it) finished.
//
// The derived statuses elsewhere — the Departments popup, the order-list filter
// — infer progress from whatever the department happened to fill in. That
// answers "has anything been recorded?", not "are you done?". A department
// signing off explicitly is what closes the loop, and it is what makes the time
// taken measurable: completion date minus the target date the department was
// originally given.
//
// Plain module (no server imports) so the checkbox and the SQL behind it agree.

import {
  DEPT_FILTER_LABELS,
  isPerEcDept,
  type DeptFilterKey,
} from "@/lib/dept-status";
import type { OrderTable } from "@/lib/order-schema";
import type { TargetKey } from "@/lib/target-dates";


/**
 * Whether departments sign their work off by hand ("Complete"). Off for now:
 * how long each department takes (TAT) will be worked out another way. The
 * sign-offs already recorded are kept.
 */
export const SIGN_OFF_ENABLED = false;

export type DeptKey = DeptFilterKey;
export { isPerEcDept, DEPT_FILTER_LABELS as DEPT_LABELS };

/** The department a section table belongs to. */
const DEPT_BY_TABLE: Partial<Record<OrderTable, DeptKey>> = {
  order_drawing: "drawing",
  order_purchase: "purchase",
  order_qc: "quality",
  order_planning: "planning",
  order_assembly_dispatch: "assembly",
  order_billing: "billing",
  order_accounts: "accounts",
  order_dispatch: "dispatch",
};

export function deptForTable(table: OrderTable): DeptKey | null {
  return DEPT_BY_TABLE[table] ?? null;
}

/**
 * The target date each department is measured against. Planning schedules to
 * the dispatch date and Assembly to the packing team's; Billing and Accounts
 * have no date of their own, so their completion records no day count.
 */
const TARGET_BY_DEPT: Partial<Record<DeptKey, TargetKey>> = {
  drawing: "drawing",
  purchase: "purchase",
  quality: "quality",
  planning: "dispatch",
  assembly: "packing",
  dispatch: "dispatch",
};

export function targetKeyForDept(dept: DeptKey): TargetKey | null {
  return TARGET_BY_DEPT[dept] ?? null;
}

/** One department's sign-off on an SO or an EC. */
export type DeptCompletion = {
  id: string;
  order_id: string;
  item_id: string | null;
  dept: DeptKey;
  completed_on: string;
  /** The target the department was *originally* given, not the latest one. */
  target_date: string | null;
  /** completed_on − target_date. Positive is late, negative is early. */
  days_taken: number | null;
  completed_by_email: string | null;
  completed_by_role: string | null;
};

/** "3 days late" / "2 days early" / "on target", or null without a target. */
export function describeDays(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "on target";
  const n = Math.abs(days);
  const unit = n === 1 ? "day" : "days";
  return days > 0 ? `${n} ${unit} late` : `${n} ${unit} early`;
}
