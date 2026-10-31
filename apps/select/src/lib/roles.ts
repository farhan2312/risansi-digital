// Pump Selection roles and what each may do with enquiries. Client-safe (no
// DB import) so the pages and the API routes read the same rules.
//
// User split into two (user, 2026-10-31; migrations/identity/0011):
//   user_master - creates enquiries, assigns them to a worker or to herself,
//                 reassigns them, edits and deletes them, and works them.
//   user_worker - sees and works only the enquiries assigned to them; cannot
//                 create one or edit its details.
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

/** Roles that see every enquiry. Everyone else (workers, the legacy "user",
 *  pulley_owner) sees only the enquiries assigned to them. Selection heads
 *  review every tag on /approvals, and admins look after the master data
 *  behind every enquiry, so both keep the whole list. */
export const seesAllEnquiries = (role: string | null | undefined): boolean =>
  canManageEnquiries(role) || role === "admin" || role === "selection_head";

/** Who an enquiry can be assigned to: the workers and the master. */
export const ASSIGNABLE_ROLES = ["user_worker", "user_master", "user"] as const;

export type OrderType = "pump" | "spare";
export const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "pump", label: "Pump" },
  { value: "spare", label: "Spare" },
];
export const orderTypeLabel = (v: string | null | undefined): string => (v === "spare" ? "Spare" : "Pump");
