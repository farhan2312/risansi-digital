import { and, eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageViews } from "@/lib/db/schema";
import { parseAuditWindow, windowCondition } from "@/lib/auditRange";

export const dynamic = "force-dynamic";

/** Which pages one user actually visited within a range, and how often --
 * the "click a user for the page breakdown" drill-down on Usage & Time.
 * Uses page_views directly (already captured for the Pages count), so no
 * schema change was needed for this. */
export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { userId } = await params;
  const { searchParams } = new URL(req.url);
  const window = parseAuditWindow(searchParams);

  const conditions = [eq(pageViews.userId, userId)];
  conditions.push(windowCondition(pageViews.viewedAt, window));

  const rows = await db
    .select({
      path: pageViews.path,
      viewCount: sql<number>`count(*)::int`,
      lastViewed: sql<string>`max(${pageViews.viewedAt})`,
    })
    .from(pageViews)
    .where(and(...conditions))
    .groupBy(pageViews.path)
    .orderBy(sql`2 desc`); // viewCount

  return json(
    rows.map((r) => ({
      path: r.path,
      view_count: r.viewCount,
      last_viewed: r.lastViewed,
    }))
  );
}
