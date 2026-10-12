import { eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSessions, users } from "@/lib/db/schema";
import { parseAuditWindow, windowCondition } from "@/lib/auditRange";
import { activeGapTable, gapsInWindow } from "@/lib/activeTime";

export const dynamic = "force-dynamic";

/** Per-user rollup for the "Usage & Time" tab: sessions, active time, pages
 * visited, last active -- within the given range. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const window = parseAuditWindow(searchParams);

  const rows = await db
    .select({
      userId: userSessions.userId,
      userName: sql<string | null>`max(${userSessions.userName})`,
      userEmail: sql<string | null>`max(${userSessions.userEmail})`,
      // Live role, not a snapshot -- null once the account is deleted, same
      // as every other "joined against users, may be gone" field in this app.
      userRole: sql<string | null>`max(${users.role})`,
      sessionCount: sql<number>`count(*)::int`,
      pageCount: sql<number>`coalesce(sum(${userSessions.pageViewCount}), 0)::int`,
      lastActive: sql<string>`max(${userSessions.lastSeenAt})`,
    })
    .from(userSessions)
    .leftJoin(users, eq(users.id, userSessions.userId))
    .where(windowCondition(userSessions.loginAt, window))
    .groupBy(userSessions.userId);

  // Active time = gaps of <= 15 min between each user's consecutive recorded actions (lib/activeTime.ts).
  const { rows: activeRows } = await db.execute<{ userId: string; seconds: number }>(
    sql`select g.user_id as "userId", coalesce(sum(g.secs), 0)::float as seconds
        from ${activeGapTable(window)} where ${gapsInWindow(window)} group by g.user_id`
  );
  const activeByUser = new Map(activeRows.map((r) => [r.userId, Number(r.seconds)]));
  rows.sort((a, b) => (activeByUser.get(b.userId) ?? 0) - (activeByUser.get(a.userId) ?? 0));

  return json(
    rows.map((r) => ({
      user_id: r.userId,
      user_name: r.userName,
      user_email: r.userEmail,
      user_role: r.userRole,
      session_count: r.sessionCount,
      active_seconds: Math.round(activeByUser.get(r.userId) ?? 0),
      page_count: r.pageCount,
      last_active: r.lastActive,
    }))
  );
}
