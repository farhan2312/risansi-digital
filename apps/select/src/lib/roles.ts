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

export type AppRole =
  | "user_master"
  | "user_worker"
  | "user"
  | "rep"
  | "rep_manager"
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
 *  price, edit its documents)? */
export const canWorkOn = (
  user: { id: string; role: string | null | undefined } | null | undefined,
  enquiry: { assigned_to?: string | null; assignedTo?: string | null },
): boolean =>
  Boolean(user) && (worksOnAnyEnquiry(user!.role) || (enquiry.assigned_to ?? enquiry.assignedTo ?? null) === user!.id);

/** Rep / Rep Manager: read-only, and only their own enquiries. */
export const REP_ROLES = ["rep", "rep_manager"] as const;
export const isRepRole = (role: string | null | undefined): boolean => (REP_ROLES as readonly string[]).includes(role ?? "");

/** The only pages a rep can open. */
export const REP_PAGES = ["/dashboard", "/projects", "/pump-selection", "/selection-summary", "/my-bug-reports"] as const;

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
