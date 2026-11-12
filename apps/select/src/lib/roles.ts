// Pump Selection roles and what each may do with enquiries. Client-safe (no
// DB import) so the pages and the API routes read the same rules.
//
// User split into two (user, 2026-10-31; migrations/identity/0011):
//   user_master - creates enquiries, assigns them to a worker or to herself,
//                 reassigns them, edits and deletes them, and works them.
//   user_worker - sees every enquiry, but works only on the ones assigned to
//                 them (copying a tag out of any enquiry is fine); cannot
//                 create an enquiry or edit its details.
// system_admin can do everything the master does. A leftover "user" (the
// role before the split) reads as a worker.
//
// rep / rep_manager (user, 2026-11-01; migrations/identity/0012) are
// read-only: Dashboard, Enquiries, Pump Selection and Reports for their own
// enquiries only - the clients they cover in the sales portal, live (see
// lib/rep-scope.ts); a Rep Manager also sees the reps under them.
//
// operation (user, 2026-11-05; migrations/identity/0014) has two pages only,
// Pump Docs and Spare Docs: the saved documents of the enquiries reviewed and
// sent to operation, read-only. middleware.ts closes every other page and API.
//
// crm (user, 2026-11-12; migrations/identity/0015) is read-only like a rep, but
// for EVERY enquiry (no rep scope): Dashboard, Enquiries, Pump Selection and
// Client Operation Docs only (CRM_PAGES).

export type AppRole =
  | "user_master"
  | "user_worker"
  | "user"
  | "rep"
  | "rep_manager"
  | "operation"
  | "crm"
  | "selection_head"
  | "pulley_owner"
  | "admin"
  | "system_admin";

export const ROLE_LABELS: Record<string, string> = {
  system_admin: "System Admin",
  admin: "Admin",
  selection_head: "Selection Head",
  pulley_owner: "Pulley Owner",
  user_master: "User-Master",
  user_worker: "User-Worker",
  rep: "Rep",
  rep_manager: "Rep Manager",
  operation: "Operation",
  crm: "CRM",
  user: "User",
};

export const roleLabel = (role: string | null | undefined): string =>
  role ? (ROLE_LABELS[role] ?? role) : "—";

/** Create, edit, delete, assign and reassign enquiries. */
export const ENQUIRY_MANAGER_ROLES = ["user_master", "system_admin"] as const;

export const canManageEnquiries = (role: string | null | undefined): boolean =>
  (ENQUIRY_MANAGER_ROLES as readonly string[]).includes(role ?? "");

/** Roles that may work on any enquiry. Everyone else (workers, the legacy
 *  "user", pulley_owner) sees every enquiry but works only on the ones
 *  assigned to them, and their enquiry lists open on "Assigned to me".
 *  Selection heads review every tag, and admins look after the master data
 *  behind every enquiry, so both keep working on all of them. */
export const worksOnAnyEnquiry = (role: string | null | undefined): boolean =>
  canManageEnquiries(role) || role === "admin" || role === "selection_head";

/** May this person work on this enquiry (open the wizard, edit tags, quote,
 *  price, edit its documents)? An older version is view only for everyone. */
export const canWorkOn = (
  user: { id: string; role: string | null | undefined } | null | undefined,
  enquiry: { assigned_to?: string | null; assignedTo?: string | null; is_latest?: boolean },
): boolean =>
  Boolean(user) && enquiry.is_latest !== false && (worksOnAnyEnquiry(user!.role) || (enquiry.assigned_to ?? enquiry.assignedTo ?? null) === user!.id);

/** Rep / Rep Manager: read-only, and only their own enquiries. */
export const REP_ROLES = ["rep", "rep_manager"] as const;
export const isRepRole = (role: string | null | undefined): boolean => (REP_ROLES as readonly string[]).includes(role ?? "");

/** The only pages a rep can open. */
export const REP_PAGES = ["/dashboard", "/projects", "/pump-selection", "/selection-summary", "/my-bug-reports"] as const;

/** CRM: view only, every enquiry (no rep scope). */
export const isCrmRole = (role: string | null | undefined): boolean => role === "crm";
/** The only pages CRM can open (Client Operation Docs in Reports' place). */
export const CRM_PAGES = ["/dashboard", "/projects", "/pump-selection", "/client-operation-docs", "/my-bug-reports"] as const;
/** View only everywhere: the reps and CRM (nothing to work on, nothing to copy). */
export const isViewOnlyRole = (role: string | null | undefined): boolean => isRepRole(role) || isCrmRole(role);

/** Operation's only pages. */
export const OPERATION_PAGES = ["/pump-docs", "/spare-docs"] as const;
export const isOperationRole = (role: string | null | undefined): boolean => role === "operation";

/** Client Operation Docs replaces Reports for these (a leftover "user" reads as a worker).
 *  Reps, selection heads and pulley owners keep Reports. */
export const CLIENT_OPERATION_DOCS_ROLES = ["system_admin", "admin", "user_master", "user_worker", "user", "crm"] as const;
export const hasClientOperationDocs = (role: string | null | undefined): boolean => (CLIENT_OPERATION_DOCS_ROLES as readonly string[]).includes(role ?? "");
/** Who may read the documents sent to operation. */
export const canSeeOperationDocs = (role: string | null | undefined): boolean => isOperationRole(role) || hasClientOperationDocs(role);

/** Who an enquiry can be assigned to: the workers and the master. */
export const ASSIGNABLE_ROLES = ["user_worker", "user_master", "user"] as const;

export type OrderType = "pump" | "spare";
export const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "pump", label: "Pump" },
  { value: "spare", label: "Spare" },
];
export const orderTypeLabel = (v: string | null | undefined): string => (v === "spare" ? "Spare" : "Pump");

/** What kind of pump / spare (user, 2026-11-01). Every older enquiry is a PCP
 *  pump; the DB CHECK pairs each subtype with its order type. */
export type OrderSubtype = "pcp" | "mmp" | "barrel" | "online_blind" | "spare" | "retrofit_spare";
export const ORDER_SUBTYPES: Record<OrderType, { value: OrderSubtype; label: string }[]> = {
  pump: [
    { value: "pcp", label: "PCP" },
    { value: "mmp", label: "MMP" },
    { value: "barrel", label: "Barrel" },
    { value: "online_blind", label: "Online blind" },
  ],
  spare: [
    { value: "spare", label: "Spare" },
    { value: "retrofit_spare", label: "Retrofit spare" },
  ],
};
/** The first one: PCP for a pump, a plain spare for a spare. */
export const defaultSubtype = (t: OrderType): OrderSubtype => ORDER_SUBTYPES[t][0].value;
export const orderSubtypeLabel = (v: string | null | undefined): string =>
  [...ORDER_SUBTYPES.pump, ...ORDER_SUBTYPES.spare].find((o) => o.value === v)?.label ?? "";
