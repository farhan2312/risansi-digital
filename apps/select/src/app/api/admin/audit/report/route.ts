import { and, desc, sql, type SQL } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireSystemAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  activityByUser,
  eventSelection,
  IDLE_CUTOFF_SECONDS,
  latestRole,
  resolveWindow,
  windowCondition,
  withEnquiryJoins,
} from "@/lib/audit-stats";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Everything the Audit Log PDF report needs, for ONE window, in one call.
// System-admin only. Takes the same `from` / `to` / `range` as the page.
//
// Differs from /api/admin/audit on purpose:
//   - every section at once (the page only loads the tab in view);
//   - the headline figures are for the SELECTED window, not the page's fixed
//     "last 24h" counters - a report for 30 days should total 30 days;
//   - a higher row cap per section, and the report says when it was hit
//     rather than silently truncating.

const SECTION_CAP = 2000;

export async function GET(req: Request) {
  try {
    requireSystemAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return error(err.message, err.statusCode);
    throw err;
  }

  const params = new URL(req.url).searchParams;
  const rangeKey = params.get("range") ?? "7d";
  const window = resolveWindow(params);
  const inWindow = windowCondition(window);
  const custom = Boolean(params.get("from") || params.get("to"));
  const within = (extra: SQL) => (inWindow ? and(inWindow, extra) : extra);

  // --- Headline figures, for the selected window ---
  const [totals] = await db
    .select({
      events: sql<number>`count(*)::int`,
      logins: sql<number>`count(*) filter (where ${auditLog.eventType} = 'login')::int`,
      failed: sql<number>`count(*) filter (where ${auditLog.eventType} = 'login_failed')::int`,
      actions: sql<number>`count(*) filter (where ${auditLog.eventType} = 'action')::int`,
      activeUsers: sql<number>`count(distinct ${auditLog.userEmail})::int`,
      first: sql<string | null>`min(${auditLog.createdAt})`,
      last: sql<string | null>`max(${auditLog.createdAt})`,
    })
    .from(auditLog)
    .where(inWindow);

  // --- Usage by user, with active time ---
  const activity = await activityByUser(window);
  const usageRaw = await db
    .select({
      email: auditLog.userEmail,
      role: latestRole,
      actions: sql<number>`count(*) filter (where ${auditLog.eventType} = 'action')::int`,
      sessions: sql<number>`count(*) filter (where ${auditLog.eventType} = 'login')::int`,
      failed: sql<number>`count(*) filter (where ${auditLog.eventType} = 'login_failed')::int`,
      firstSeen: sql<string>`min(${auditLog.createdAt})`,
      lastActive: sql<string>`max(${auditLog.createdAt})`,
      lastIp: sql<string | null>`(array_agg(${auditLog.ip} order by ${auditLog.createdAt} desc)
        filter (where ${auditLog.ip} is not null))[1]`,
      ipCount: sql<number>`count(distinct ${auditLog.ip})::int`,
    })
    .from(auditLog)
    .where(inWindow)
    .groupBy(auditLog.userEmail)
    .orderBy(desc(sql`max(${auditLog.createdAt})`));

  const usage = usageRaw
    .filter((r) => r.email)
    .map((r) => ({
      ...r,
      activeSeconds: activity.get(r.email as string)?.activeSeconds ?? 0,
    }))
    // Most engaged first - that's the question a usage report is read for.
    .sort((a, b) => b.activeSeconds - a.activeSeconds);

  const totalActiveSeconds = usage.reduce((sum, u) => sum + u.activeSeconds, 0);

  // --- What was done, by action type ---
  const byAction = await db
    .select({
      action: auditLog.action,
      count: sql<number>`count(*)::int`,
      users: sql<number>`count(distinct ${auditLog.userEmail})::int`,
    })
    .from(auditLog)
    .where(within(sql`${auditLog.eventType} = 'action'`))
    .groupBy(auditLog.action)
    .orderBy(desc(sql`count(*)`));

  // --- Row-level sections (+1 so we can tell whether the cap was hit) ---
  const section = async (filter: SQL) => {
    const rows = await withEnquiryJoins(db.select(eventSelection).from(auditLog))
      .where(within(filter))
      .orderBy(desc(auditLog.createdAt))
      .limit(SECTION_CAP + 1);
    return { rows: rows.slice(0, SECTION_CAP), truncated: rows.length > SECTION_CAP };
  };

  const [logins, access, activityEvents] = await Promise.all([
    section(sql`${auditLog.eventType} in ('login', 'login_failed', 'logout')`),
    section(sql`${auditLog.action} like 'user.%'`),
    section(sql`${auditLog.eventType} = 'action'`),
  ]);

  // Generating the report is itself worth recording - it exports the trail.
  const scopeText = custom
    ? `${window.since?.toISOString().slice(0, 10) ?? "start"} to ${
        window.until?.toISOString().slice(0, 10) ?? "now"
      }`
    : rangeKey;
  await logAudit(req, {
    action: "audit.report",
    entity: "audit_log",
    detail: `Generated audit report (${scopeText})`,
  });

  return json({
    range: custom ? "custom" : rangeKey,
    since: window.since ? window.since.toISOString() : null,
    until: window.until ? window.until.toISOString() : null,
    generatedAt: new Date().toISOString(),
    idleCutoffMinutes: IDLE_CUTOFF_SECONDS / 60,
    totals: {
      ...totals,
      totalActiveSeconds,
    },
    usage,
    byAction,
    logins,
    access,
    activity: activityEvents,
  });
}
