// How to read one pipeline row from a department's point of view: the status
// it is in, whether that counts as finished, whether the department is
// involved at all, and the date it is working to.
//
// Every dashboard reads these rather than restating them — the central
// pipeline, the department dashboards, and anything counting "how many are
// pending" — so a rule changes in one place.
//
// Plain module (no server imports): the dashboards are client components.

import type { OrderOverviewRow } from "@/lib/orders";
import { isRep } from "@/lib/roles";
import {
  DEPT_FILTER_LABELS,
  NOT_APPLICABLE,
  PENDING,
  isPerEcDept,
  type DeptFilterKey,
} from "@/lib/dept-status";

export type DeptKey = DeptFilterKey;

export type DeptView = {
  key: DeptKey;
  label: string;
  /** Whether the row is an EC's work or the whole SO's. */
  perEc: boolean;
  /** The department's own word for where this row stands. */
  status: (row: OrderOverviewRow) => string;
  /** Finished, in the sense the department would recognise. */
  done: (row: OrderOverviewRow) => boolean;
  /**
   * The department has nothing to record on this order, so its status reads
   * N/A and it is not counted as outstanding.
   */
  na: (row: OrderOverviewRow) => boolean;
  /**
   * The order is none of this department's business at all: off its queue,
   * its dashboard, and its URLs. Stronger than `na` — an order can be N/A
   * and still belong to the department, the way a paid-after-receipt order
   * still gets its dispatch recorded by Dispatch.
   */
  hidden: (row: OrderOverviewRow) => boolean;
  /** The date it is judged against, if it has one. */
  target: (row: OrderOverviewRow) => string | null;
  /**
   * Whether the department works to a deadline at all. Distinct from target()
   * returning null on a given row: Billing and Accounts have no target date in
   * the schema, so a dashboard should drop the whole notion rather than show a
   * column of dashes.
   */
  hasTarget: boolean;
};

const text = (v: string | null | undefined) => (v ?? "").trim();
const same = (a: string | null | undefined, b: string) =>
  text(a).toLowerCase() === b;

/** A revised dispatch date supersedes the original wherever it is quoted. */
export function dispatchTarget(row: OrderOverviewRow): string | null {
  return row.dispatch_target_revised_date ?? row.dispatch_target_date;
}

const never = () => false;

/**
 * An order Central Visibility has closed: cancelled by the client, or diverted.
 * Nothing is deleted, but it is no longer anyone's work.
 */
export const CLOSED_ORDER_STATUSES = ["Cancelled by client", "Diverted"] as const;

/** Whether a status set by Central Visibility closes the order. */
export function isClosedStatus(status: unknown): boolean {
  return (CLOSED_ORDER_STATUSES as readonly string[]).includes(String(status ?? "").trim());
}

/**
 * The order status, in SQL over an orders alias: what Central Visibility set,
 * else what the invoices say (Pending / LOT dispatch / Fully dispatch).
 */
export function orderStatusSql(order = "o"): string {
  return `COALESCE(NULLIF(${order}.status_override, ''), NULLIF(${order}.dispatch_status, ''), 'Pending')`;
}

/** The order is still open — not cancelled, not diverted. */
export function orderOpenSql(order = "o"): string {
  return `COALESCE(${order}.status_override, '') NOT IN ('Cancelled by client', 'Diverted')`;
}

/**
 * A Spare EC needs no drawing: it is a part supplied as it is, not something
 * drawn for the client. Read off the EC's own type, else the SO's — an Add-On
 * Spare under a Pump order is still a spare.
 */
export function isSpareEc(r: {
  item_type?: string | null;
  order_type?: string | null;
}): boolean {
  const own = text(r.item_type);
  return (own || text(r.order_type)).toLowerCase() === "spare";
}

/**
 * The SQL twin of isSpareEc, over an EC alias and its order's alias. An order
 * with no EC row (a LEFT JOIN miss) reads the SO's type.
 */
export function spareEcSql(item = "it", order = "o"): string {
  return `lower(btrim(COALESCE(NULLIF(btrim(${item}.item_type), ''), ${order}.order_type, ''))) = 'spare'`;
}

/**
 * When Assembly & Packing owes an EC, as SQL over an EC alias: NULL when it
 * owes nothing. An EC with readiness lots is owed lot by lot — the earliest
 * packing date Assembly & Packing set among its lots not packed yet (a lot
 * with no packing date owes nothing yet), so a lot packed on time keeps it
 * on time even while the rest is still with Planning. Otherwise Planning's
 * readiness date, until the EC is packed. Past it, the EC is overdue.
 */
export function assemblyDueSql(item = "it"): string {
  return `(CASE WHEN EXISTS (SELECT 1 FROM order_ready_lots rl WHERE rl.item_id = ${item}.id)
            THEN (SELECT min(rl.packing_plan_date) FROM order_ready_lots rl
                   WHERE rl.item_id = ${item}.id AND rl.packed_date IS NULL)
            ELSE (SELECT apl.planning_readiness_date FROM order_planning apl
                   WHERE apl.item_id = ${item}.id
                     AND NOT EXISTS (SELECT 1 FROM order_assembly_dispatch aad
                                      WHERE aad.item_id = ${item}.id
                                        AND aad.actual_packing_date IS NOT NULL))
       END)`;
}

/**
 * The order has drawing work: an EC that is not a Spare, or — before any EC
 * exists — an SO that is not of type Spare.
 */
function drawingInvolvedSql(order: string): string {
  return `(EXISTS (SELECT 1 FROM order_items s
                   WHERE s.order_id = ${order}.id AND NOT (${spareEcSql("s", order)}))
          OR (NOT EXISTS (SELECT 1 FROM order_items s WHERE s.order_id = ${order}.id)
              AND lower(btrim(COALESCE(${order}.order_type, ''))) <> 'spare'))`;
}

/**
 * Paid after receipt used to make Billing and Accounts N/A. PIs and payments
 * are now recorded on every order, whatever its terms, so nothing is N/A for
 * that reason — this stays the one switch, should that change again.
 */
const paidAfterReceipt: (r: OrderOverviewRow) => boolean = () => false;

export const DEPT_VIEWS: Record<DeptKey, DeptView> = {
  drawing: {
    key: "drawing",
    label: DEPT_FILTER_LABELS.drawing,
    perEc: true,
    // The column carries the raw wording ("Drg approved"); the filter and
    // the popup say "Approved". One vocabulary, so say theirs.
    status: (r) =>
      isSpareEc(r)
        ? NOT_APPLICABLE
        : same(r.drg_status, "drg approved")
        ? "Approved"
        : same(r.drg_status, "drg. issued to client")
          ? "Issued to Client"
          : same(r.drg_status, "drg. issued to operations")
            ? "Issued to Operations"
            : PENDING,
    done: (r) => !isSpareEc(r) && same(r.drg_status, "drg approved"),
    // A Spare is supplied as it is: nothing for Drawing to draw.
    na: isSpareEc,
    hidden: isSpareEc,
    target: (r) => r.drg_target_date,
    hasTarget: true,
  },
  purchase: {
    key: "purchase",
    label: DEPT_FILTER_LABELS.purchase,
    perEc: true,
    // purchase_done is true when the SO has no BOI at all, so the applies
    // check has to come first or every non-BOI order reads as finished.
    status: (r) =>
      !same(r.boi, "yes")
        ? NOT_APPLICABLE
        : r.purchase_done
          ? "Received"
          : PENDING,
    done: (r) => same(r.boi, "yes") && r.purchase_done,
    // Nothing bought out on this order, so Purchase never acts on it.
    na: (r) => !same(r.boi, "yes"),
    hidden: (r) => !same(r.boi, "yes"),
    target: (r) => r.purchase_target_date,
    hasTarget: true,
  },
  quality: {
    key: "quality",
    label: DEPT_FILTER_LABELS.quality,
    perEc: true,
    status: (r) =>
      same(r.qc_required, "no")
        ? NOT_APPLICABLE
        : r.qc_submitted
          ? "Submitted"
          : PENDING,
    done: (r) => !same(r.qc_required, "no") && r.qc_submitted,
    na: (r) => same(r.qc_required, "no"),
    hidden: (r) => same(r.qc_required, "no"),
    target: (r) => r.qc_doc_target_date,
    hasTarget: true,
  },
  planning: {
    key: "planning",
    label: DEPT_FILTER_LABELS.planning,
    perEc: true,
    // A Spare starts at Date awaited, not "Pending".
    status: (r) => text(r.planning_status) || (isSpareEc(r) ? "Date awaited" : PENDING),
    // Done once the EC is ready — a Spare Fully ready, a Pump Assembled or
    // Packed — so a date still open is late once it passes (the rule
    // Planning's reminders and Overdue filter use).
    done: (r) => ["fully ready", "assembled", "packed"].includes(text(r.planning_status).toLowerCase()),
    na: never,
    hidden: never,
    // Planning works to its own readiness date.
    target: (r) => r.planning_readiness_date,
    hasTarget: true,
  },
  assembly: {
    key: "assembly",
    label: DEPT_FILTER_LABELS.assembly,
    perEc: true,
    // A Spare with no readiness lot is not with Assembly & Packing yet.
    status: (r) =>
      isSpareEc(r) && !r.assembly_done && (!r.assembly_state || r.assembly_state === PENDING)
        ? "Not ready yet"
        : r.assembly_state || (r.assembly_done ? "Fully packed" : PENDING),
    done: (r) => r.assembly_done,
    na: never,
    hidden: never,
    target: (r) => r.dispatch_team_target_date,
    hasTarget: true,
  },
  billing: {
    key: "billing",
    label: DEPT_FILTER_LABELS.billing,
    perEc: false,
    // PIs raised against the payment terms, After Receipt lines not counted.
    status: (r) => r.billing_state ?? (r.has_pi ? "Fully raised" : PENDING),
    done: (r) => r.billing_state === "Fully raised" || r.billing_state === "Challan filed",
    // Every term After Receipt: no PI is due.
    na: (r) => r.billing_state === "N/A" || paidAfterReceipt(r),
    // A Challan order is not Billing's: no PI, and the challan is Dispatch's.
    hidden: (r) => same(r.bill_type, "challan"),
    target: () => null,
    hasTarget: false,
  },
  accounts: {
    key: "accounts",
    label: DEPT_FILTER_LABELS.accounts,
    perEc: false,
    // A Challan order carries no receivable, so Accounts never acts on it.
    status: (r) =>
      same(r.bill_type, "challan")
        ? NOT_APPLICABLE
        : text(r.payment_status) || PENDING,
    done: (r) =>
      !same(r.bill_type, "challan") &&
      (same(r.payment_status, "payment rcvd") ||
        same(r.payment_status, "after receipt")),
    // A Challan order carries no receivable; a paid-after-receipt one has
    // nothing to confirm until the money simply arrives.
    na: (r) => same(r.bill_type, "challan") || paidAfterReceipt(r),
    hidden: (r) => same(r.bill_type, "challan"),
    target: () => null,
    hasTarget: false,
  },
  dispatch: {
    key: "dispatch",
    label: DEPT_FILTER_LABELS.dispatch,
    perEc: false,
    status: (r) => text(r.dispatch_status) || PENDING,
    done: (r) => same(r.dispatch_status, "fully dispatch"),
    na: never,
    hidden: never,
    target: dispatchTarget,
    hasTarget: true,
  },
};

/** The department a role works in, if it works in one. */
const VIEW_BY_ROLE: Record<string, DeptKey> = {
  drawing: "drawing",
  purchase: "purchase",
  qc: "quality",
  planning: "planning",
  assembly: "assembly",
  dispatch: "dispatch",
  operations: "billing",
  accounts: "accounts",
};

export function deptViewForRole(role: string): DeptView | null {
  const key = VIEW_BY_ROLE[role];
  return key ? DEPT_VIEWS[key] : null;
}

export { isPerEcDept };

/**
 * The same rule as each view's `hidden`, written as SQL over an `orders`
 * alias — so the queues and dashboards drop in the database exactly the orders
 * the department has no business seeing.
 *
 * A department that has nothing to do with an order does not see the order:
 * Drawing only orders with an EC that is not a Spare, Purchase only orders
 * with BOI, Quality only those needing QC docs, Accounts only those carrying a
 * receivable. The rest work every order.
 */
/**
 * A bought-out item is in hand. With an order placed to a vendor, when that
 * order is Fully received (received qty = order qty); without one, when RIL
 * stock allocated covers its qty. (A receipt dated before quantities were
 * kept still counts.) Over an order_boi_items alias; boiInHand is the same
 * rule in the browser.
 */
export function boiReceivedSql(b: string): string {
  return `(CASE WHEN ${b}.vendor_order = 'Yes' THEN ${b}.vendor_status = 'Fully received'
               ELSE (COALESCE(${b}.boi_qty, 0) > 0 AND COALESCE(${b}.stock_allocated_qty, 0) >= ${b}.boi_qty)
                    OR (${b}.receipt_date IS NOT NULL AND ${b}.boi_qty IS NULL)
          END)`;
}

/** The same rule as boiReceivedSql, for a row already in the browser. */
export function boiInHand(b: Record<string, unknown>): boolean {
  if (b.vendor_order === "Yes") return b.vendor_status === "Fully received";
  const qty = Number(b.boi_qty ?? 0) || 0;
  if (qty > 0) return (Number(b.stock_allocated_qty ?? 0) || 0) >= qty;
  return !!String(b.receipt_date ?? "").trim();
}

/**
 * Where a bought-out item stands, in words: its vendor order's status when one
 * is placed (Pending, Partially received, Fully received), else its RIL stock
 * (Available in RIL stock, Partially in RIL stock, Pending).
 */
export function boiStatus(b: Record<string, unknown>): { label: string; tone: "done" | "part" | "pending" } {
  if (b.vendor_order === "Yes") {
    const s = String(b.vendor_status ?? "Pending");
    return { label: s, tone: s === "Fully received" ? "done" : s === "Partially received" ? "part" : "pending" };
  }
  const qty = Number(b.boi_qty ?? 0) || 0;
  const stock = Number(b.stock_allocated_qty ?? 0) || 0;
  if (boiInHand(b)) return { label: qty > 0 ? "Available in RIL stock" : "Received", tone: "done" };
  if (stock > 0) return { label: "Partially in RIL stock", tone: "part" };
  return { label: "Pending", tone: "pending" };
}

/** One document's versions on an EC, oldest first (a row's doc_type, GAD when blank). */
export function drawingVersions(rows: Record<string, unknown>[], docType: string): Record<string, unknown>[] {
  return rows
    .filter((r) => String(r.doc_type ?? "GAD") === docType)
    .sort((x, y) => Number(x.seq ?? 0) - Number(y.seq ?? 0));
}

export type DrawingStatusTone = "done" | "part" | "pending" | "rework";

/**
 * Where a drawing document stands, from its latest version: pending until a
 * version goes to the client; then awaiting approval; sent back to resubmit;
 * approved; and a GAD, finally, issued to Planning.
 */
export function drawingDocStatus(
  rows: Record<string, unknown>[],
  docType: string
): { label: string; tone: DrawingStatusTone; version: number } {
  const versions = drawingVersions(rows, docType);
  const last = versions[versions.length - 1];
  const gad = docType === "GAD";
  const yes = (v: unknown) => String(v ?? "").trim().toLowerCase() === "yes";
  const no = (v: unknown) => String(v ?? "").trim().toLowerCase() === "no";
  const version = versions.length;
  if (!last || !yes(last.issued_to_client)) {
    return { label: gad ? "Drawing pending" : "Pending", tone: "pending", version };
  }
  if (gad && yes(last.approved) && yes(last.issued_to_production)) {
    return { label: "Issued to planning", tone: "done", version };
  }
  if (yes(last.approved)) return { label: "Approved by client", tone: gad ? "part" : "done", version };
  if (no(last.approved)) return { label: "Resubmit", tone: "rework", version };
  return { label: gad ? "Sent to client, approval pending" : "Sent to client for approval", tone: "part", version };
}

/** Order Making has not held the SO. Held there, it goes to no department at all. */
export function omClearSql(order = "o"): string {
  return `COALESCE(NULLIF(${order}.om_status, ''), 'Clear') <> 'Hold'`;
}

/** Central Visibility has cleared the SO (and Order Making has not held it): departments work on it. */
export function clearedSql(order = "o"): string {
  return `COALESCE(NULLIF(${order}.clearance_status, ''), 'Clear') = 'Clear' AND ${omClearSql(order)}`;
}

/**
 * The SO has been released to the departments: cleared by Order Making (the
 * first step) and by Central Visibility (the second). A hold at either step
 * keeps it from every department until that step clears it.
 */
export function releasedSql(order = "o"): string {
  return clearedSql(order);
}

/**
 * What a department sees in its queue and dashboard: an order it has work on
 * that Central Visibility has cleared or put on hold. (Involvement alone still
 * decides who an order's targets are for, whatever its clearance.)
 */
export function deptQueueSql(dept: DeptKey, alias = "o"): string {
  return `${deptInvolvementSql(dept, alias)} AND ${releasedSql(alias)}`;
}

export function deptInvolvementSql(dept: DeptKey, alias = "o"): string {
  // A cancelled or diverted order is nobody's work.
  return `(${deptOwnInvolvementSql(dept, alias)}) AND ${orderOpenSql(alias)}`;
}

function deptOwnInvolvementSql(dept: DeptKey, alias: string): string {
  switch (dept) {
    case "drawing":
      return drawingInvolvedSql(alias);
    case "purchase":
      return `lower(coalesce(${alias}.boi, '')) = 'yes'`;
    case "quality":
      return `lower(coalesce(${alias}.qc_required, '')) <> 'no'`;
    // A Challan order has no PI and no A/R: its challan is filed by Dispatch.
    case "billing":
    case "accounts":
      return `lower(coalesce(${alias}.bill_type, '')) <> 'challan'`;
    default:
      return "TRUE";
  }
}

/**
 * Whether this role's department has anything to do with this order at all.
 * Roles without a department of their own (Central Visibility, Admin) see
 * every order. Used to keep an order that is none of a department's business
 * off its screens entirely, URL included.
 */
/** An SO that has gone out in full: its row is green in every list. */
export function isFullyDispatched(row: Record<string, unknown>): boolean {
  return String(row.so_dispatch_status ?? row.dispatch_status ?? "").trim().toLowerCase() === "fully dispatch";
}
/**
 * A row's colour from the SO's dispatch status: green once it has gone out
 * in full, blue while it has gone out in lots; nothing otherwise.
 */
export function dispatchRowTone(row: Record<string, unknown>): string | null {
  const s = String(row.so_dispatch_status ?? row.dispatch_status ?? "").trim().toLowerCase();
  return s === "fully dispatch" ? FULLY_DISPATCHED_ROW : s === "lot dispatch" ? LOT_DISPATCHED_ROW : null;
}
export const LOT_DISPATCHED_ROW = "bg-sky-50 hover:bg-sky-100/70 dark:bg-sky-500/10 dark:hover:bg-sky-500/15";
export const FULLY_DISPATCHED_ROW =
  "bg-emerald-50 hover:bg-emerald-100/70 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15";

/**
 * Whether an SO's Rep is one of this Rep's names (trimmed, case-insensitive):
 * their own, or for a Rep Manager anyone in their team (User.rep_names). No
 * names sees nothing.
 */
export function repMatches(orderRep: unknown, repNames: readonly string[] | null | undefined): boolean {
  const theirs = String(orderRep ?? "").trim().toLowerCase();
  return !!theirs && (repNames ?? []).some((n) => n.trim().toLowerCase() === theirs);
}

export function roleSeesOrder(
  role: string,
  order: {
    /** The SO's rep — a Rep sees only their own SOs. */
    reps?: unknown;
    boi?: unknown;
    qc_required?: unknown;
    bill_type?: unknown;
    order_type?: unknown;
    /** Until Central Visibility clears it, no department sees the SO. */
    clearance_status?: unknown;
    /** Held by Order Making: no department sees the SO. */
    om_status?: unknown;
    /**
     * The types of the ECs in view — every EC on an SO page, the one EC on an
     * EC page. Drawing reaches the page while any of them is not a Spare.
     */
    ec_types?: unknown[];
  },
  // A Rep's names: their own, and a Rep Manager's team (User.rep_names).
  repNames?: readonly string[] | null
): boolean {
  // Order Making fills Client and PO details from its own page; the SO's
  // pages carry everything else.
  if (role === "order_making" || role === "order_making_so") return false;
  // A Rep: their own SOs only; a Rep Manager, their team's too.
  if (isRep(role)) return repMatches(order.reps, repNames);
  const view = deptViewForRole(role);
  if (!view) return true;
  // Held by Order Making (the first step) or by Central Visibility (the
  // second): not forwarded to any department yet.
  if (String(order.clearance_status || "Clear") !== "Clear") return false;
  if (String(order.om_status || "") === "Hold") return false;
  if (view.key === "drawing") {
    const orderType = order.order_type == null ? null : String(order.order_type);
    const types = order.ec_types ?? [];
    if (types.length === 0) return !isSpareEc({ order_type: orderType });
    return types.some(
      (t) => !isSpareEc({ item_type: t == null ? null : String(t), order_type: orderType })
    );
  }
  return !view.hidden({
    boi: order.boi == null ? null : String(order.boi),
    qc_required: order.qc_required == null ? null : String(order.qc_required),
    bill_type: order.bill_type == null ? null : String(order.bill_type),
  } as OrderOverviewRow);
}
