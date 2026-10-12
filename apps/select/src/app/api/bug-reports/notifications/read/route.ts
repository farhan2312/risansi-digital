import { and, eq, inArray } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { bugReportSelection, users } from "@/lib/db/schema";

const ADMIN_ROLES = new Set(["admin", "system_admin"]);

export const dynamic = "force-dynamic";

// Clears the reporter's bell — marks their unread status-change
// notifications as read. Body { ids?: string[] } clears just those reports;
// omitted/empty clears every unread notification for the caller. Scoped to
// reportedBy = the caller, so one user can never clear another's bell.
export async function POST(req: Request) {
  let claims;
  try {
    claims = decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Empty/absent body is fine — treated as "mark all read".
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((v) => typeof v === "string") : null;

  await db
    .update(bugReportSelection)
    .set({ reporterUnread: false })
    .where(
      and(
        eq(bugReportSelection.reportedBy, claims.sub),
        eq(bugReportSelection.reporterUnread, true),
        ...(ids && ids.length > 0 ? [inArray(bugReportSelection.id, ids)] : []),
      ),
    );

  // Admins also have the "new bug filed" feed, which is a watermark rather
  // than a per-report flag — opening the bell moves it to now(), so anything
  // filed from this moment on is what shows up next. Per-user, so one admin
  // clearing their bell never clears another's.
  if (ADMIN_ROLES.has(claims.role ?? "")) {
    await db
      .update(users)
      .set({ bugFeedSeenAt: new Date() })
      .where(eq(users.id, claims.sub));
  }

  return json({ ok: true });
}
