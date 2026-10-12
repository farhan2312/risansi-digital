import { and, desc, eq, gt, ne, or, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { bugReportSelection, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Top-bar bell. Two independent feeds, merged into one list:
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
    claims = decodeToken(req);
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

  return json({ count: items.length, items });
}
