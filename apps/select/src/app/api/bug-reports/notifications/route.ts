import { and, desc, eq, gt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { bugReportSelection, projects, users } from "@/lib/db/schema";

const assigner = alias(users, "assigner");

export const dynamic = "force-dynamic";

// Top-bar bell. Independent feeds, merged into one list (the third, enquiries
// assigned to the caller, is at the bottom of GET):
//
//   "status"  every report the CALLER filed whose status has changed since
//             they last looked (bugReportSelection.reporterUnread). Any
//             logged-in user.
//   "new"     every report filed by SOMEONE ELSE since this admin last opened
//             the bell (users.bugFeedSeenAt watermark). Admins only — this is
//             the triage feed for the Bug Tracker page.
//
// An admin who files their own bug gets the status feed for it like anyone
// else, but is not told about their own filing, hence the `ne(reportedBy)`.

const ADMIN_ROLES = new Set(["admin", "system_admin"]);

export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const isAdmin = ADMIN_ROLES.has(claims.role ?? "");

  // The admin watermark. A NULL means this admin has never opened the bell —
  // treated as "everything before now is already seen" rather than surfacing
  // the entire history, which would be noise on first login.
  let seenAt: Date | null = null;
  if (isAdmin) {
    const [row] = await db
      .select({ bugFeedSeenAt: users.bugFeedSeenAt })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    seenAt = row?.bugFeedSeenAt ?? null;
  }

  const rows = await db
    .select({
      id: bugReportSelection.id,
      title: bugReportSelection.title,
      status: bugReportSelection.status,
      updatedAt: bugReportSelection.updatedAt,
      createdAt: bugReportSelection.createdAt,
      reportedByName: bugReportSelection.reportedByName,
      // Which feed put this row here. A report can qualify for both (an admin's
      // own report whose status changed) — `kind` reports the one that matters
      // to the reader, and the caller's own report is always about its status.
      isMine: sql<boolean>`${bugReportSelection.reportedBy} = ${claims.sub}`,
    })
    .from(bugReportSelection)
    .where(
      or(
        // Status changed on something I filed.
        and(
          eq(bugReportSelection.reportedBy, claims.sub),
          eq(bugReportSelection.reporterUnread, true),
        ),
        // Someone else filed a bug since I last looked (admins only).
        ...(isAdmin && seenAt
          ? [
              and(
                gt(bugReportSelection.createdAt, seenAt),
                ne(bugReportSelection.reportedBy, claims.sub),
              ),
            ]
          : []),
      ),
    )
    .orderBy(desc(bugReportSelection.updatedAt));

  const items = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    updatedAt: r.updatedAt,
    kind: r.isMine ? ("status" as const) : ("new" as const),
    reportedByName: r.isMine ? null : r.reportedByName,
  }));

  // Third feed: enquiries someone else assigned to the caller that they have
  // not seen yet (projects.assignee_unread, cleared by .../read).
  const assigned = await db
    .select({
      id: projects.id,
      code: projects.projectCode,
      client: projects.name,
      orderType: projects.orderType,
      assignedAt: projects.assignedAt,
      byName: assigner.name,
    })
    .from(projects)
    .leftJoin(assigner, eq(assigner.id, projects.assignedBy))
    .where(and(eq(projects.assignedTo, claims.sub), eq(projects.assigneeUnread, true)))
    .orderBy(desc(projects.assignedAt));
  const assignedItems = assigned.map((a) => ({
    id: a.id,
    title: [a.code, a.client].filter(Boolean).join(" · "),
    status: "Assigned",
    updatedAt: a.assignedAt,
    kind: "assigned" as const,
    reportedByName: a.byName,
  }));

  const all = [...assignedItems, ...items].sort(
    (x, y) => new Date(y.updatedAt ?? 0).getTime() - new Date(x.updatedAt ?? 0).getTime(),
  );
  return json({ count: all.length, items: all });
}
