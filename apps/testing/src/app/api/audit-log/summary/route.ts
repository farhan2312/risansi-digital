import { sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The four headline tiles at the top of the Audit Log page -- always a
 * trailing-24h window, independent of whichever range a tab below is showing.
 *
 * Plain `SELECT (subquery), (subquery), ...` with no FROM -- Postgres is
 * happy to evaluate that as a single row unconditionally. Selecting FROM
 * audit_logs instead (to hang the scalar subqueries off) would return ZERO
 * rows whenever that table is empty, silently dropping every figure to
 * "no row" rather than 0 -- exactly the bug this sidesteps. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const result = await db.execute<{
    logins_24h: number;
    failed_24h: number;
    active_users_24h: number;
    actions_24h: number;
  }>(sql`
    SELECT
      (SELECT count(*) FROM audit_logs WHERE event_type = 'login' AND created_at > now() - interval '24 hours')::int AS logins_24h,
      (SELECT count(*) FROM audit_logs WHERE event_type = 'login_failed' AND created_at > now() - interval '24 hours')::int AS failed_24h,
      (SELECT count(DISTINCT user_id) FROM user_sessions WHERE last_seen_at > now() - interval '24 hours')::int AS active_users_24h,
      (SELECT count(*) FROM audit_logs WHERE event_type IN ('create', 'update', 'delete') AND created_at > now() - interval '24 hours')::int AS actions_24h
  `);
  const row = result.rows[0];

  return json({
    logins_24h: row?.logins_24h ?? 0,
    failed_24h: row?.failed_24h ?? 0,
    active_users_24h: row?.active_users_24h ?? 0,
    actions_24h: row?.actions_24h ?? 0,
  });
}
