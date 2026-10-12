import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { bugReportNotifications } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const LIST_LIMIT = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in user's own "your bug report's status changed" notifications (newest first) plus how many
 * are still unseen -- backs the top-bar bell every role has. Never returns anyone else's. */
export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(bugReportNotifications)
      .where(eq(bugReportNotifications.userId, claims.sub))
      .orderBy(desc(bugReportNotifications.createdAt))
      .limit(LIST_LIMIT),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bugReportNotifications)
      .where(and(eq(bugReportNotifications.userId, claims.sub), isNull(bugReportNotifications.readAt))),
  ]);

  return json({
    unread: count,
    items: rows.map((n) => ({
      id: n.id,
      bug_report_id: n.bugReportId,
      bug_title: n.bugTitle,
      old_status: n.oldStatus,
      new_status: n.newStatus,
      changed_by_name: n.changedByName,
      created_at: n.createdAt,
      is_read: n.readAt !== null,
    })),
  });
}

/** Marks the signed-in user's notifications as seen: `{ ids: [...] }` for specific ones, or `{ all: true }`. */
export async function PATCH(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const mine = and(eq(bugReportNotifications.userId, claims.sub), isNull(bugReportNotifications.readAt));
  if (body.all === true) {
    await db.update(bugReportNotifications).set({ readAt: new Date() }).where(mine);
    return json({ ok: true });
  }
  if (Array.isArray(body.ids) && body.ids.length > 0 && body.ids.length <= 100 && body.ids.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    await db
      .update(bugReportNotifications)
      .set({ readAt: new Date() })
      .where(and(mine, inArray(bugReportNotifications.id, body.ids as string[])));
    return json({ ok: true });
  }
  return error("Send { all: true } or { ids: [...] }", 400);
}
