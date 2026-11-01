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

// Opening the bell marks things read, but they stay listed (faded) for at
// least a day so they can still be checked (user, 2026-11-01). Only unread
// ones count on the badge and make the bell ring.
const KEEP_MS = 24 * 60 * 60 * 1000;

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

  const keepSince = new Date(Date.now() - KEEP_MS);
  // New bugs: everything since the watermark is unread; the day before it is
  // kept, read. (No watermark yet = everything before now counts as seen.)
  const newSince = seenAt && seenAt < keepSince ? seenAt : keepSince;

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
      reporterUnread: bugReportSelection.reporterUnread,
    })
    .from(bugReportSelection)
    .where(
      or(
        // Status changed on something I filed (unread, or changed in the last day).
        and(
          eq(bugReportSelection.reportedBy, claims.sub),
          or(eq(bugReportSelection.reporterUnread, true), gt(bugReportSelection.updatedAt, keepSince)),
        ),
        // Someone else filed a bug (admins only): since I last looked, or in the last day.
        ...(isAdmin
          ? [
              and(
                gt(bugReportSelection.createdAt, newSince),
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
    unread: r.isMine
      ? Boolean(r.reporterUnread)
      : Boolean(seenAt && r.createdAt && new Date(r.createdAt) > seenAt),
  }));

  // Third feed: enquiries someone else assigned to the caller - unread
  // (projects.assignee_unread, cleared by .../read) or seen within the last day.
  const assigned = await db
    .select({
      id: projects.id,
      code: projects.projectCode,
      client: projects.name,
      orderType: projects.orderType,
      assignedAt: projects.assignedAt,
      byName: assigner.name,
      unread: projects.assigneeUnread,
    })
    .from(projects)
    .leftJoin(assigner, eq(assigner.id, projects.assignedBy))
    .where(
      and(
        eq(projects.assignedTo, claims.sub),
        or(eq(projects.assigneeUnread, true), gt(projects.assigneeSeenAt, keepSince)),
      ),
    )
    .orderBy(desc(projects.assignedAt));
  const assignedItems = assigned.map((a) => ({
    id: a.id,
    title: [a.code, a.client].filter(Boolean).join(" · "),
    status: "Assigned",
    updatedAt: a.assignedAt,
    kind: "assigned" as const,
    reportedByName: a.byName,
    unread: a.unread,
  }));

  const all = [...assignedItems, ...items].sort(
    (x, y) => new Date(y.updatedAt ?? 0).getTime() - new Date(x.updatedAt ?? 0).getTime(),
  );
  // count = unread only (the badge); items = unread + the last day's read ones.
  return json({ count: all.filter((i) => i.unread).length, items: all });
}
