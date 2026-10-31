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

export type AppRole =
  | "user_master"
  | "user_worker"
  | "user"
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

/** Who an enquiry can be assigned to: the workers and the master. */
export const ASSIGNABLE_ROLES = ["user_worker", "user_master", "user"] as const;

export type OrderType = "pump" | "spare";
export const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "pump", label: "Pump" },
  { value: "spare", label: "Spare" },
];
export const orderTypeLabel = (v: string | null | undefined): string => (v === "spare" ? "Spare" : "Pump");
