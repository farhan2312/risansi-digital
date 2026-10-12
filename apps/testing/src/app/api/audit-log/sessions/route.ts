import { and, desc, inArray, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { parseAuditWindow, windowCondition } from "@/lib/auditRange";
import { offsetFor, PAGE_SIZE, parsePage } from "@/lib/pagination";

export const dynamic = "force-dynamic";

/** Raw login / login_failed / logout event list for the "Logins & Sessions"
 * tab. Server-paginated, 25/page. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const window = parseAuditWindow(searchParams);
  const page = parsePage(req);

  const conditions = [inArray(auditLogs.eventType, ["login", "login_failed", "logout"])];
  conditions.push(windowCondition(auditLogs.createdAt, window));
  const where = and(...conditions);

  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(PAGE_SIZE).offset(offsetFor(page)),
    db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where),
  ]);

  return json({
    entries: rows.map((r) => ({
      id: r.id,
      user_name: r.userName,
      user_email: r.userEmail,
      event_type: r.eventType,
      details: r.details,
      ip_address: r.ipAddress,
      created_at: r.createdAt,
    })),
    total: count,
    page,
    page_size: PAGE_SIZE,
  });
}
