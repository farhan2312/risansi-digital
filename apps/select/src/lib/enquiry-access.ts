// Who may work on an enquiry (lib/roles.ts): everyone sees every enquiry, but
// a worker works only on the ones assigned to them. Server-only.
import { and, eq, inArray } from "drizzle-orm";

import { error } from "./api";
import { tryDecodeToken } from "./auth";
import { db } from "./db";
import { enquiryTags, projects, quotation, users } from "./db/schema";
import { ASSIGNABLE_ROLES, worksOnAnyEnquiry } from "./roles";

/**
 * A 403 when the caller is a worker and the enquiry is not assigned to them,
 * else null. Called at the top of every route that changes an enquiry or its
 * tags (wizard inputs, tags, approvals sent, prices, quotations, documents).
 * The enquiry is found from whichever id the route has; an id that resolves
 * to nothing returns null so the route answers its own 404.
 */
export async function workDenied(
  req: Request,
  ref: { projectId?: string | null; tagId?: string | null; quotationId?: string | null },
): Promise<Response | null> {
  const claims = await tryDecodeToken(req);
  if (!claims) return null; // the route's own auth check answers this
  if (worksOnAnyEnquiry(claims.role)) return null;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let projectId = ref.projectId && UUID.test(ref.projectId) ? ref.projectId : null;
  if (!projectId && ref.tagId && UUID.test(ref.tagId)) {
    const [t] = await db.select({ p: enquiryTags.projectId }).from(enquiryTags).where(eq(enquiryTags.id, ref.tagId)).limit(1);
    projectId = t?.p ?? null;
  }
  if (!projectId && ref.quotationId && UUID.test(ref.quotationId)) {
    const [q] = await db.select({ p: quotation.projectId }).from(quotation).where(eq(quotation.id, ref.quotationId)).limit(1);
    projectId = q?.p ?? null;
  }
  if (!projectId) return null;

  const [p] = await db
    .select({ assignedTo: projects.assignedTo, assigneeName: users.name })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.assignedTo))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!p || p.assignedTo === claims.sub) return null;
  return error(
    `This enquiry is assigned to ${p.assigneeName || "someone else"} - you can view it and copy its tags, but only they can work on it.`,
    403,
  );
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
