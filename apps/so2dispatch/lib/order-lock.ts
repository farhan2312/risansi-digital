// Sections and lists an order carries no work for, and so accepts no entries
// into. Distinct from a department's status reading N/A: that is a statement
// about progress, this refuses the data.
//
// Plain module (no server imports): the forms hide what the actions refuse,
// and both read this so they cannot disagree.

import type { ChildTable, OrderTable } from "@/lib/order-schema";
import { isCentral } from "@/lib/roles";

/** The order columns the rules below look at. */
export type LockFacts = {
  /** Every payment term counted from receipt — see isAfterReceiptOnly. */
  after_receipt_only?: unknown;
  bill_type?: unknown;
  /** Set by Central Visibility; cancelled or diverted closes the order. */
  status_override?: unknown;
};

/**
 * Why this section or list takes no entries on this order, or null when it
 * does. Paid after receipt means no proforma to raise and no receipt to
 * confirm, so the PI list and the Accounts section are closed — while the
 * dispatch invoice, which is a different record, carries on as normal.
 */
export function lockReason(
  table: OrderTable | ChildTable,
  order: LockFacts | null | undefined,
  /**
   * Who is asking. A cancelled or diverted order is closed to the departments;
   * Central Visibility and Admin can still correct it. Left out, the order is
   * treated as closed to the caller too.
   */
  role?: string
): string | null {
  if (!order) return null;
  const status = String(order.status_override ?? "").trim();
  if ((status === "Cancelled by client" || status === "Diverted") && !(role && isCentral(role))) {
    return status === "Diverted"
      ? "This order has been diverted, so it takes no further entries."
      : "This order was cancelled by the client, so it takes no further entries.";
  }
  // Paid after receipt no longer closes anything: a PI can be raised, and a
  // payment recorded, against every payment term.
  return null;
}

/** Shorthand for the places that only need the yes/no. */
export function isLocked(
  table: OrderTable | ChildTable,
  order: LockFacts | null | undefined,
  role?: string
): boolean {
  return lockReason(table, order, role) !== null;
}
