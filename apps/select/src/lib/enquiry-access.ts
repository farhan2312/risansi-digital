// Which enquiries a caller may see (lib/roles.ts): a worker only the ones
// assigned to them, the master / system admins / admins / selection heads all
// of them. Server-only.
import { and, eq, inArray, type SQL } from "drizzle-orm";

import type { TokenClaims } from "./auth";
import { db } from "./db";
import { projects, users } from "./db/schema";
import { ASSIGNABLE_ROLES, seesAllEnquiries } from "./roles";

type Caller = Pick<TokenClaims, "sub" | "role">;

/** Filter on `projects` for this caller; undefined = every enquiry. */
export function enquiryScope(caller: Caller): SQL | undefined {
  return seesAllEnquiries(caller.role) ? undefined : eq(projects.assignedTo, caller.sub);
}

/** False when the enquiry does not exist or the caller may not see it. */
export async function canSeeProject(caller: Caller, projectId: string): Promise<boolean> {
  const scope = enquiryScope(caller);
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(scope ? and(eq(projects.id, projectId), scope) : eq(projects.id, projectId))
    .limit(1);
  return Boolean(row);
}

export type Assignee = { id: string; name: string | null; email: string; role: string | null };

/** Active people an enquiry can go to: the workers and the master, plus the
 *  caller (a system admin assigning to themselves). */
export async function listAssignees(callerId: string): Promise<Assignee[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.status, "active"), inArray(users.role, [...ASSIGNABLE_ROLES])));
  if (!rows.some((r) => r.id === callerId)) {
    const [me] = await db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, callerId))
      .limit(1);
    if (me) rows.push(me);
  }
  return rows.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

/** The assignee if `id` is someone an enquiry can go to, else null. */
export async function findAssignee(callerId: string, id: string): Promise<Assignee | null> {
  return (await listAssignees(callerId)).find((a) => a.id === id) ?? null;
}
