import { and, desc, gte, sql, type SQL } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireSystemAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import {
  activityByUser,
  eventSelection,
  latestRole,
  resolveWindow,
  searchCondition,
  windowCondition,
  withEnquiryJoins,
} from "@/lib/audit-stats";
import { getAuditOverview } from "@/lib/audit-overview";

export const dynamic = "force-dynamic";

// Read side of the audit trail (system_admin only). One request returns the
// four header counters plus ONE PAGE of rows for whichever tab is showing, so
// the page doesn't fan out into several calls per filter change.
//
//   window  : `from` / `to` (ISO instants) if given, else the `range` chip
//   paging  : `page` (1-based), PAGE_SIZE rows, `total` counts the whole
//             filtered set so the page numbers are real
//
// The header counters are always "last 24h" regardless of the window - they
// answer "what is happening right now", a different question from the table.

const PAGE_SIZE = 30;

export async function GET(req: Request) {
  try {
    requireSystemAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return error(err.message, err.statusCode);
    throw err;
  }

  const params = new URL(req.url).searchParams;
  const tab = params.get("tab") ?? "usage";
  const q = (params.get("q") ?? "").trim();
  const page = Math.max(1, Math.trunc(Number(params.get("page"))) || 1);
  const window = resolveWindow(params);
  const inWindow = windowCondition(window);
  const day = new Date(Date.now() - 86400_000);

  // --- Header counters: always the last 24 hours ---
  const [counts] = await db
    .select({
      logins: sql<number>`count(*) filter (where ${auditLog.eventType} = 'login')::int`,
      failed: sql<number>`count(*) filter (where ${auditLog.eventType} = 'login_failed')::int`,
      activeUsers: sql<number>`count(distinct ${auditLog.userEmail})::int`,
      actions: sql<number>`count(*) filter (where ${auditLog.eventType} = 'action')::int`,
    })
    .from(auditLog)
    .where(gte(auditLog.createdAt, day));

  const summary = {
    logins24h: counts?.logins ?? 0,
    failed24h: counts?.failed ?? 0,
    activeUsers24h: counts?.activeUsers ?? 0,
    actions24h: counts?.actions ?? 0,
  };

  // --- Overview: charts and breakdowns for the whole window ---
  if (tab === "overview") {
    const overview = await getAuditOverview(window);
    return json({ summary, overview, rows: [], total: 0, page: 1, pageSize: PAGE_SIZE });
  }

  // --- Usage by user: one row per person in the window ---
  if (tab === "usage") {
    const rows = await db
      .select({
        email: auditLog.userEmail,
        role: latestRole,
        actions: sql<number>`count(*) filter (where ${auditLog.eventType} = 'action')::int`,
        sessions: sql<number>`count(*) filter (where ${auditLog.eventType} = 'login')::int`,
        lastActive: sql<string>`max(${auditLog.createdAt})`,
        lastIp: sql<string | null>`(array_agg(${auditLog.ip} order by ${auditLog.createdAt} desc)
          filter (where ${auditLog.ip} is not null))[1]`,
        ipCount: sql<number>`count(distinct ${auditLog.ip})::int`,
      })
      .from(auditLog)
      .where(inWindow)
      .groupBy(auditLog.userEmail)
      .orderBy(desc(sql`max(${auditLog.createdAt})`));

    // Active time comes from the gaps between each user's events - see
    // lib/audit-stats.ts for why it is not login-to-logout.
    const activity = await activityByUser(window);
    const needle = q.toLowerCase();

    const all = rows
      .filter((r) => r.email)
      .map((r) => ({
        ...r,
        activeSeconds: activity.get(r.email as string)?.activeSeconds ?? 0,
      }))
      .filter(
        (r) =>
          !needle ||
          (r.email ?? "").toLowerCase().includes(needle) ||
          (r.role ?? "").toLowerCase().includes(needle) ||
          (r.lastIp ?? "").toLowerCase().includes(needle),
      );

    // One row per person, so the whole set is small; it is still paged on the
    // server so the response shape and page numbers match the other tabs.
    const start = (page - 1) * PAGE_SIZE;
    return json({
      summary,
      rows: all.slice(start, start + PAGE_SIZE),
      total: all.length,
      page,
      pageSize: PAGE_SIZE,
    });
  }

  // --- Row-level tabs ---
  // activity  : everything the user did (excludes sign-in events)
  // logins    : sign-in / sign-out / failed attempts
  // access    : role, status and account changes — this app's equivalent of
  //             the "ownership changes" view (who was granted or lost access)
  const tabFilter =
    tab === "logins"
      ? sql`${auditLog.eventType} in ('login', 'login_failed', 'logout')`
      : tab === "access"
        ? sql`${auditLog.action} like 'user.%'`
        : sql`${auditLog.eventType} = 'action'`;

  const where = and(
    ...([tabFilter, inWindow, searchCondition(q)].filter(Boolean) as SQL[]),
  );

  // The count shares the joins so a search on an enquiry no. or tag name
  // counts the same rows the page shows.
  const [{ total }] = await withEnquiryJoins(
    db.select({ total: sql<number>`count(*)::int` }).from(auditLog),
  ).where(where);

  const rows = await withEnquiryJoins(db.select(eventSelection).from(auditLog))
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return json({ summary, rows, total, page, pageSize: PAGE_SIZE });
}
