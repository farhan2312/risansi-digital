// Roles and per-department edit permissions. Plain module (no server imports)
// so both client components and server actions can use it.

import type { OrderTable } from "@/lib/order-schema";

export const ROLE_LABELS = {
  admin: "Admin",
  central_visibility: "Central Visibility",
  operations: "Proforma Invoice",
  accounts: "Accounts",
  drawing: "Drawing",
  planning: "Planning",
  purchase: "Purchase",
  qc: "Quality",
  assembly: "Assembly & Packing",
  // Dispatch is its own department, after Assembly & Packing: it invoices what
  // has been packed and records the dispatch. The role named `dispatch` used to
  // be the packing team — see the guarded rename in db/schema.sql.
  dispatch: "Dispatch",
  // Order Making PO: creates SOs, fills their Client and Purchase Order
  // details (and may fill the Sales Order details too), and assigns each SO
  // to an Order Making SO member. Central Visibility does the rest.
  order_making: "Order Making PO",
  // Order Making SO: fills the Sales Order details (SO No., date, value,
  // currency, quantity) of the SOs assigned to them — nothing else.
  order_making_so: "Order Making SO",
  // Sees what Central Visibility sees, read-only, for their own SOs only (the
  // orders whose Rep is the name Admin linked to the user). May post in an
  // SO's discussion.
  rep: "Rep",
  // A sales manager: a Rep's view of their own SOs and of every SO of the
  // reps who report to them. Who reports to whom is the sales portal's
  // manager_reps, read live (lib/market-intell.ts) — never kept here.
  rep_manager: "Rep Manager",
} as const;

export type Role = keyof typeof ROLE_LABELS;

export const ALL_ROLES = Object.keys(ROLE_LABELS) as Role[];

// Roles selectable when requesting access. `central_visibility` grants
// cross-department access; `admin` also manages users.
export const REQUESTABLE_ROLES: Role[] = [
  "order_making",
  "order_making_so",
  "operations",
  "accounts",
  "drawing",
  "planning",
  "purchase",
  "qc",
  "assembly",
  "dispatch",
  "central_visibility",
  "admin",
];

// The single department role that owns (can edit) each order section table.
// The core `orders` identity is owned by Central Visibility. QC is owned by
// the `qc` role, but its Required QC Documents / Target Date fields are
// marked `centralOnly` in order-schema.ts (Mitali fills those; QC only fills
// Actual Date of Doc. Submission and Remarks).
const TABLE_OWNER: Record<OrderTable, Role> = {
  orders: "central_visibility",
  order_items: "central_visibility",
  order_billing: "operations",
  order_accounts: "accounts",
  order_drawing: "drawing",
  order_purchase: "purchase",
  order_qc: "qc",
  order_planning: "planning",
  order_assembly_dispatch: "assembly",
  // Dispatch owns its own SO-level row; the invoice cards hang off it.
  order_dispatch: "dispatch",
};

/** Admin and Central Visibility (Mitali). Own `centralOnly` fields. */
export function isCentral(role: string): boolean {
  return role === "admin" || role === "central_visibility";
}

/**
 * A sales Rep or Rep Manager: Central's view, read-only, of the SOs whose rep
 * is theirs — their own, and for a manager their team's too (User.rep_names).
 */
export function isRep(role: string): boolean {
  return role === "rep" || role === "rep_manager";
}

/** Sees the whole tracker's screens (the Orders list, every department): Central, Admin, a Rep. */
export function canViewAll(role: string): boolean {
  return isCentral(role) || isRep(role);
}

/** May open a department's queue — its own, or (Central, Admin, a Rep) any. Editing is canEditSection. */
export function canViewDepartment(role: string, table: OrderTable): boolean {
  return canAccessDepartment(role, table) || isRep(role);
}

/** Admin and Central Visibility can edit any section; others only their own. */
export function canEditSection(role: string, table: OrderTable): boolean {
  if (isCentral(role)) return true;
  return TABLE_OWNER[table] === role;
}

/** Who can open a department workspace (view). Same as edit access. */
export function canAccessDepartment(role: string, table: OrderTable): boolean {
  return canEditSection(role, table);
}

/**
 * Admin, Central Visibility and Order Making create orders (form or Excel
 * import). Order Making's go in with their Client and Purchase Order details
 * only — see ORDER_MAKING_GROUPS.
 */
export function canCreateOrders(role: string): boolean {
  return role === "admin" || role === "central_visibility" || role === "order_making";
}

/**
 * Who fills an SO's EC form (Pump or Spare Add-On) and edits or deletes its
 * ECs: an Order Making SO member, on the SOs assigned to them, and Central
 * Visibility / Admin on any.
 */
export function canManageEcs(role: string): boolean {
  return isCentral(role) || role === "order_making_so";
}

/** Bulk Excel import of orders: Admin and Central Visibility only. */
export function canImportOrders(role: string): boolean {
  return role === "admin" || role === "central_visibility";
}

/** Order Making PO: an SO's Client, Purchase Order and Sales Order details, nothing more. */
export function isOrderMaking(role: string): boolean {
  return role === "order_making";
}

/** Order Making SO: the Sales Order details of the SOs assigned to them. */
export function isOrderMakingSo(role: string): boolean {
  return role === "order_making_so";
}

/** Either Order Making role — they see the Order Making page and nothing of the tracker beyond it. */
export function isOrderMakingAny(role: string): boolean {
  return isOrderMaking(role) || isOrderMakingSo(role);
}

/** Who opens the Order Making page: either Order Making role, and Central Visibility / Admin. */
export function canAccessOrderMaking(role: string): boolean {
  return isOrderMakingAny(role) || isCentral(role);
}

/** Who assigns an SO's Sales Order details to an Order Making SO member. */
export function canAssignSo(role: string): boolean {
  return isOrderMaking(role) || isCentral(role);
}

/** Payment holds escalate to Central Visibility (and Admin). */
/**
 * Who the customer is does not change what Planning or Assembly & Packing do
 * — they work to dates and statuses — so they are not shown client details.
 */
export function canSeeClient(role: string): boolean {
  return role !== "planning" && role !== "assembly";
}

export function canSeeEscalations(role: string): boolean {
  return role === "admin" || role === "central_visibility";
}

/** The central full-visibility dashboard is for Central Visibility and Admin. */
export function canSeeCentralDashboard(role: string): boolean {
  return role === "admin" || role === "central_visibility" || isRep(role);
}

/**
 * The dispatch-completed / LR register: oversight for Central Visibility and
 * Admin, and Dispatch's own record of what it has sent out.
 */
export function canSeeDispatched(role: string): boolean {
  return role === "admin" || role === "central_visibility" || role === "dispatch";
}

/**
 * Who may edit each 1:many list. PIs (`order_billing_docs`) are Billing-only
 * now — Accounts views them read-only.
 */
export function canEditChild(
  role: string,
  table:
    | "order_payment_terms"
    | "order_lots"
    | "order_boi_items"
    | "order_billing_docs"
    | "order_packing_slips"
    | "order_invoices"
    | "order_drawing_revisions"
    | "order_ready_lots"
): boolean {
  // Drawing owns the revision rows; Central Visibility also edits them so it
  // can record approval (the two approval fields are `centralOnly`).
  if (table === "order_drawing_revisions") {
    return canEditSection(role, "order_drawing") || isCentral(role);
  }
  if (table === "order_boi_items") return canEditSection(role, "order_purchase");
  // A Spare's readiness lots are Planning's.
  if (table === "order_ready_lots") return canEditSection(role, "order_planning");
  // The order's payment terms are part of its identity: Central Visibility's.
  if (table === "order_payment_terms") return canEditSection(role, "orders");
  // PIs are Billing's; the invoice-and-dispatch cards are Dispatch's.
  if (table === "order_billing_docs") return canEditSection(role, "order_billing");
  if (table === "order_invoices") return canEditSection(role, "order_dispatch");
  // Packing slips are Assembly & Packing's (Planning no longer files a
  // tentative set).
  if (table === "order_packing_slips") return canEditSection(role, "order_assembly_dispatch");
  return canEditSection(role, "order_assembly_dispatch");
}

/**
 * QC document attachments — unlike the rest of the QC section (filled by
 * Central Visibility), the QC role itself uploads/deletes these.
 */
export function canEditQcDocuments(role: string): boolean {
  return role === "qc" || isCentral(role);
}

/**
 * QC requirement documents — the reverse direction: Central Visibility
 * uploads reference/requirement files for QC to work from. Only Central may
 * upload/delete; QC (+ Central) may view/download via canAccessDepartment.
 */
export function canEditQcRequirementDocs(role: string): boolean {
  return isCentral(role);
}

// Departments that work to a target date and therefore get deadline reminders
// (7 days / 72h / 24h out). Billing and Accounts have no such date. Planning
// has no target date of its own, so it borrows the order's Dispatch Target
// Date — pump/order readiness (planning_readiness_date) must be in before
// dispatch — which is also the date Dispatch itself works to, while
// Assembly & Packing works to the packing team's own target.
export type ReminderDept =
  | "drawing"
  | "purchase"
  | "qc"
  | "planning"
  | "assembly"
  | "dispatch";

const REMINDER_DEPT_BY_ROLE: Partial<Record<Role, ReminderDept>> = {
  drawing: "drawing",
  purchase: "purchase",
  qc: "qc",
  planning: "planning",
  assembly: "assembly",
  dispatch: "dispatch",
};

const REMINDER_DEPT_BY_TABLE: Partial<Record<OrderTable, ReminderDept>> = {
  order_drawing: "drawing",
  order_purchase: "purchase",
  order_qc: "qc",
  order_planning: "planning",
  order_assembly_dispatch: "assembly",
  order_dispatch: "dispatch",
};

/** The reminder department a role is responsible for, if any. */
export function reminderDeptForRole(role: string): ReminderDept | null {
  return REMINDER_DEPT_BY_ROLE[role as Role] ?? null;
}

/** The reminder department a section table belongs to, if any. */
export function reminderDeptForTable(table: OrderTable): ReminderDept | null {
  return REMINDER_DEPT_BY_TABLE[table] ?? null;
}

// Each department role's workspace page (mirrors the sidebar's DEPARTMENT_NAV).
const DEPARTMENT_HREF: Partial<Record<Role, string>> = {
  order_making: "/risansi/departments/order-making",
  order_making_so: "/risansi/departments/order-making",
  operations: "/risansi/departments/billing",
  accounts: "/risansi/departments/accounts",
  drawing: "/risansi/departments/drawing",
  planning: "/risansi/departments/planning",
  purchase: "/risansi/departments/purchase",
  qc: "/risansi/departments/qc",
  assembly: "/risansi/departments/assembly-dispatch",
  dispatch: "/risansi/departments/dispatch",
};

/** The department workspace page a role owns, if any (null for central/admin). */
export function departmentHrefForRole(role: string): string | null {
  return DEPARTMENT_HREF[role as Role] ?? null;
}

export function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role;
}
