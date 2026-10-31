import { and, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { enquiryTags, projects, users } from "@/lib/db/schema";
import { listAssignees } from "@/lib/enquiry-access";
import { enquiryStatusSql } from "@/lib/enquiry-filters-server";
import type { AssigneeStats } from "@/lib/assignee-stats";
import { ASSIGNABLE_ROLES, canManageEnquiries, isRepRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

const instant = (v: string | null) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * GET ?from&to - one card per person enquiries go to (the KPI strip on the
 * Enquiries page): the User-Master and system admins get everyone's card, a
 * worker only their own (user, 2026-11-01). The enquiries assigned to
 * them in the window (by assigned_at; open-ended = all time) with their status
 * rolled up from the tags, and those enquiries' tags by status. Only the
 * User-Workers and the User-Master get a card (user, 2026-11-01) - with zeros
 * when they have nothing; enquiries held by anyone else (e.g. old ones a system
 * admin created) are not shown here.
 */
export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
    if (isRepRole(claims.role)) return json([]);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const p = new URL(req.url).searchParams;
  const from = instant(p.get("from"));
  const to = instant(p.get("to"));
  const window: SQL[] = [isNotNull(projects.assignedTo)];
  if (from) window.push(gte(projects.assignedAt, from));
  if (to) window.push(lte(projects.assignedAt, to));
  const where = and(...window);

  const [enquiryRows, tagRows, people] = await Promise.all([
    db.select({ who: projects.assignedTo, status: enquiryStatusSql }).from(projects).where(where),
    db
      .select({ who: projects.assignedTo, status: enquiryTags.status, n: sql<number>`count(*)::int` })
      .from(enquiryTags)
      .innerJoin(projects, eq(projects.id, enquiryTags.projectId))
      .where(where)
      .groupBy(projects.assignedTo, enquiryTags.status),
    listAssignees(claims.sub),
  ]);

  const cards = new Map<string, AssigneeStats>();
  const card = (id: string): AssigneeStats => {
    let c = cards.get(id);
    if (!c) {
      c = {
        userId: id,
        name: null,
        email: "",
        role: null,
        enquiries: { total: 0, pending: 0, inProgress: 0, completed: 0 },
        tags: { total: 0, pending: 0, inProgress: 0, completed: 0 },
      };
      cards.set(id, c);
    }
    return c;
  };
  const bump = (b: AssigneeStats["tags"], status: string | null, n: number) => {
    b.total += n;
    if (status === "Completed") b.completed += n;
    else if (status === "In Progress") b.inProgress += n;
    else b.pending += n;
  };

  for (const a of people) Object.assign(card(a.id), { name: a.name, email: a.email, role: a.role });
  for (const r of enquiryRows) if (r.who) bump(card(r.who).enquiries, r.status, 1);
  for (const r of tagRows) if (r.who) bump(card(r.who).tags, r.status, Number(r.n));

  // Someone holding enquiries who is no longer assignable (deactivated, role
  // changed) still gets a card, named from the users table.
  const unnamed = [...cards.values()].filter((c) => !c.email).map((c) => c.userId);
  if (unnamed.length) {
    const rows = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(inArray(users.id, unnamed));
    for (const u of rows) Object.assign(card(u.id), { name: u.name, email: u.email, role: u.role });
  }

  // Workers and the master only (a leftover "user" reads as a worker);
  // busiest first, then by name.
  const assignable = new Set<string>(ASSIGNABLE_ROLES);
  const manager = canManageEnquiries(claims.role);
  const list = [...cards.values()]
    .filter((c) => assignable.has(c.role ?? "") && (manager || c.userId === claims.sub))
    .sort(
    (a, b) => b.enquiries.total - a.enquiries.total || (a.name || a.email).localeCompare(b.name || b.email),
  );
  return json(list);
}
