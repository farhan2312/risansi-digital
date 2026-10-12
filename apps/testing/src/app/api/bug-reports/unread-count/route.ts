import { eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { bugReports } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/** Backs the sidebar notification bell -- a lightweight count-only query
 * (not a full list fetch) so it's cheap enough to poll from every page,
 * not just the Bug Reports board itself. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bugReports)
    .where(eq(bugReports.isRead, false));

  return json({ count });
}
