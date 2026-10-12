import { inArray, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import {
  daysBetween,
  istToday,
  parseAuditWindow,
  previousWindow,
  windowCondition,
  windowFor,
} from "@/lib/auditRange";
import { db } from "@/lib/db";
import { auditLogs, pageViews, userSessions, users } from "@/lib/db/schema";
import { activeGapTable, gapsInWindow } from "@/lib/activeTime";
import { parseUserAgent } from "@/lib/userAgent";

export const dynamic = "force-dynamic";

/** Per-day charts never draw more than this many bars... */
const MAX_CHART_DAYS = 62;
/** ...and the per-user day grids never more than this many columns. */
const MAX_MATRIX_DAYS = 14;
const MAX_MATRIX_USERS = 25;

const ACTION_EVENTS = ["create", "update", "delete"];
const ENTITY_PLURAL: Record<string, string> = {
  requisition: "Requisitions",
  report: "Reports",
  attachment: "Attachments",
  user: "Users",
  bug_report: "Bug reports",
};
const VERB_PAST: Record<string, string> = { create: "created", update: "updated", delete: "deleted" };

// All day/hour bucketing is IST (see lib/auditRange.ts). Literal, not a bound
// parameter, so identical expressions in SELECT and GROUP BY stay identical.
const ist = (col: unknown) => sql`(${col} AT TIME ZONE 'Asia/Kolkata')`;

const toNum = (v: unknown) => Number(v ?? 0);

const normalizeIp = (ip: string) => (["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(ip) ? "localhost" : ip);

/** Keep the top `keep` entries, folding the rest into "Other" -- the donuts
 * only have four validated series colors. */
function collapse(counts: Map<string, number>, total: number) {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, total - 1);
  const rest = sorted.slice(total - 1);
  if (rest.length === 1) head.push(rest[0]);
  else if (rest.length > 1) head.push(["Other", rest.reduce((s, [, n]) => s + n, 0)]);
  return head.map(([label, count]) => ({ label, count }));
}

/**
 * Everything the Audit Log's Overview tab draws, in one round trip.
 *
 * `?from=&to=` (IST calendar days, either optional) scopes the headline
 * numbers, breakdowns, heatmap and insights. The per-day trend covers that
 * window capped to its latest 62 days; the per-user day grids its latest 14.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const range = parseAuditWindow(searchParams);
  const today = istToday();

  // ---- Chart window: the range, capped, with an open start resolved to the first event ----
  let firstDay = range.fromDay;
  if (!firstDay) {
    const [row] = await db
      .select({ day: sql<string | null>`to_char(min(${ist(auditLogs.createdAt)}), 'YYYY-MM-DD')` })
      .from(auditLogs);
    firstDay = row?.day ?? today;
  }
  const lastDay = range.toDay ?? today;
  let days = firstDay <= lastDay ? daysBetween(firstDay, lastDay) : [];
  const dailyCapped = days.length > MAX_CHART_DAYS;
  if (dailyCapped) days = days.slice(-MAX_CHART_DAYS);
  const matrixDays = days.slice(-MAX_MATRIX_DAYS);
  const chartWindow = days.length ? windowFor(days[0], days[days.length - 1]) : windowFor(today, today);
  const matrixWindow = matrixDays.length ? windowFor(matrixDays[0], matrixDays[matrixDays.length - 1]) : chartWindow;

  const inRange = windowCondition(auditLogs.createdAt, range);
  const inChart = windowCondition(auditLogs.createdAt, chartWindow);
  const inMatrix = windowCondition(auditLogs.createdAt, matrixWindow);

  const dayOfAudit = sql<string>`to_char(${ist(auditLogs.createdAt)}, 'YYYY-MM-DD')`;
  const dowExpr = sql<number>`extract(dow from ${ist(auditLogs.createdAt)})::int`;
  const hourExpr = sql<number>`extract(hour from ${ist(auditLogs.createdAt)})::int`;
  // Active time = gaps of <= 15 min between a user's consecutive recorded actions (lib/activeTime.ts).
  const istDay = sql`to_char(g.at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;
  const activeFor = (userId: string) => sql`g.user_id = ${userId}`;
  const isAction = sql`${auditLogs.eventType} in ('create', 'update', 'delete')`;
  const isReqCreate = sql`${auditLogs.eventType} = 'create' and ${auditLogs.entityType} = 'requisition'`;
  const isReportCreate = sql`${auditLogs.eventType} = 'create' and ${auditLogs.entityType} = 'report'`;
  const notFailed = sql`${auditLogs.eventType} <> 'login_failed'`;

  const prev = previousWindow(range);

  const [
    countRows,
    dailyRows,
    dailyUserRows,
    dailySessionRows,
    heatRows,
    userDayRows,
    userDaySessionRows,
    topUserRows,
    ipRows,
    [ipTotal],
    uaRows,
    prevRows,
    leaderActionRows,
    leaderTimeRows,
    [timeTotal],
  ] = await Promise.all([
    db
      .select({ eventType: auditLogs.eventType, entityType: auditLogs.entityType, n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(inRange)
      .groupBy(auditLogs.eventType, auditLogs.entityType),
    db
      .select({ day: dayOfAudit, eventType: auditLogs.eventType, entityType: auditLogs.entityType, n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(inChart)
      .groupBy(dayOfAudit, auditLogs.eventType, auditLogs.entityType),
    db
      .select({ day: dayOfAudit, n: sql<number>`count(distinct ${auditLogs.userId})::int` })
      .from(auditLogs)
      .where(sql`${inChart} and ${notFailed} and ${auditLogs.userId} is not null`)
      .groupBy(dayOfAudit),
    db
      .execute<{ day: string; seconds: number }>(
        sql`select ${istDay} as day, coalesce(sum(g.secs), 0)::float as seconds
            from ${activeGapTable(chartWindow)} where ${gapsInWindow(chartWindow)} group by 1`
      )
      .then((r) => r.rows),
    db
      .select({ dow: dowExpr, hour: hourExpr, n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(sql`${inRange} and ${notFailed}`)
      .groupBy(dowExpr, hourExpr),
    db
      .select({
        userId: auditLogs.userId,
        email: sql<string | null>`max(${auditLogs.userEmail})`,
        name: sql<string | null>`max(${auditLogs.userName})`,
        day: dayOfAudit,
        actions: sql<number>`count(*) filter (where ${isAction})::int`,
        requisitions: sql<number>`count(*) filter (where ${isReqCreate})::int`,
        reports: sql<number>`count(*) filter (where ${isReportCreate})::int`,
      })
      .from(auditLogs)
      .where(sql`${inMatrix} and ${auditLogs.userId} is not null`)
      .groupBy(auditLogs.userId, dayOfAudit),
    db
      .execute<{ userId: string; day: string; seconds: number }>(
        sql`select g.user_id as "userId", ${istDay} as day, coalesce(sum(g.secs), 0)::float as seconds
            from ${activeGapTable(matrixWindow)} where ${gapsInWindow(matrixWindow)} group by 1, 2`
      )
      .then((r) => r.rows),
    db
      .select({
        userId: auditLogs.userId,
        email: sql<string | null>`max(${auditLogs.userEmail})`,
        name: sql<string | null>`max(${auditLogs.userName})`,
        actions: sql<number>`count(*) filter (where ${isAction})::int`,
      })
      .from(auditLogs)
      .where(sql`${inRange} and ${auditLogs.userId} is not null`)
      .groupBy(auditLogs.userId)
      .orderBy(sql`4 desc`)
      .limit(1),
    db
      .select({
        ip: auditLogs.ipAddress,
        events: sql<number>`count(*)::int`,
        users: sql<number>`count(distinct ${auditLogs.userId})::int`,
        failed: sql<number>`count(*) filter (where ${auditLogs.eventType} = 'login_failed')::int`,
        lastAt: sql<string>`max(${auditLogs.createdAt})`,
        emails: sql<string[] | null>`array_agg(distinct ${auditLogs.userEmail}) filter (where ${auditLogs.userEmail} is not null)`,
      })
      .from(auditLogs)
      .where(sql`${inRange} and ${auditLogs.ipAddress} is not null`)
      .groupBy(auditLogs.ipAddress)
      .orderBy(sql`2 desc`)
      .limit(40),
    db
      .select({ n: sql<number>`count(distinct ${auditLogs.ipAddress})::int` })
      .from(auditLogs)
      .where(sql`${inRange} and ${auditLogs.ipAddress} is not null`),
    db
      .select({ ua: auditLogs.userAgent, n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(sql`${inRange} and ${auditLogs.eventType} in ('login', 'login_failed')`)
      .groupBy(auditLogs.userAgent),
    prev
      ? db
          .select({
            requisitions: sql<number>`count(*) filter (where ${isReqCreate})::int`,
            reports: sql<number>`count(*) filter (where ${isReportCreate})::int`,
            signIns: sql<number>`count(*) filter (where ${auditLogs.eventType} = 'login')::int`,
          })
          .from(auditLogs)
          .where(windowCondition(auditLogs.createdAt, prev))
      : Promise.resolve([]),
    // Podium: the three busiest people by data-changing actions and by session time, over the whole range.
    db
      .select({
        userId: auditLogs.userId,
        email: sql<string | null>`max(${auditLogs.userEmail})`,
        name: sql<string | null>`max(${auditLogs.userName})`,
        value: sql<number>`count(*)::int`,
      })
      .from(auditLogs)
      .where(sql`${inRange} and ${isAction} and ${auditLogs.userId} is not null`)
      .groupBy(auditLogs.userId)
      .orderBy(sql`4 desc`)
      .limit(3),
    db
      .execute<{ userId: string; email: string | null; name: string | null; value: number }>(
        sql`select g.user_id as "userId", max(g.user_email) as email, max(g.user_name) as name, coalesce(sum(g.secs), 0)::float as value
            from ${activeGapTable(range)} where ${gapsInWindow(range)} group by g.user_id
            having coalesce(sum(g.secs), 0) > 0 order by 4 desc limit 3`
      )
      .then((r) => r.rows),
    db
      .execute<{ seconds: number }>(
        sql`select coalesce(sum(g.secs), 0)::float as seconds from ${activeGapTable(range)} where ${gapsInWindow(range)}`
      )
      .then((r) => r.rows),
  ]);

  // ---- Adoption: how many of the live accounts actually use the portal ----
  const [accountRows, everSessionRows, everLoginRows, rangeActivityRows, rangeSessionRows, [sessionCount], [pageViewCount]] = await Promise.all([
    db.select({ id: users.id }).from(users).where(sql`${users.status} = 'active'`),
    db.selectDistinct({ id: userSessions.userId }).from(userSessions),
    db.selectDistinct({ id: auditLogs.userId }).from(auditLogs).where(sql`${auditLogs.eventType} = 'login' and ${auditLogs.userId} is not null`),
    db.selectDistinct({ id: auditLogs.userId }).from(auditLogs).where(sql`${inRange} and ${notFailed} and ${auditLogs.userId} is not null`),
    db.selectDistinct({ id: userSessions.userId }).from(userSessions).where(windowCondition(userSessions.loginAt, range)),
    db.select({ n: sql<number>`count(*)::int` }).from(userSessions).where(windowCondition(userSessions.loginAt, range)),
    db.select({ n: sql<number>`count(*)::int` }).from(pageViews).where(windowCondition(pageViews.viewedAt, range)),
  ]);
  const accountIds = new Set(accountRows.map((r) => r.id));
  const everSignedIn = new Set([...everSessionRows, ...everLoginRows].map((r) => r.id).filter((id): id is string => !!id));
  const activeInRange = new Set([...rangeActivityRows, ...rangeSessionRows].map((r) => r.id).filter((id): id is string => !!id));
  const sessionTotalSeconds = Math.round(toNum(timeTotal?.seconds));
  const adoption = {
    accounts: accountIds.size,
    active_users: [...accountIds].filter((id) => activeInRange.has(id)).length,
    never_signed_in: [...accountIds].filter((id) => !everSignedIn.has(id) && !activeInRange.has(id)).length,
    dormant: [...accountIds].filter((id) => everSignedIn.has(id) && !activeInRange.has(id)).length,
    sessions: toNum(sessionCount?.n),
    avg_session_seconds: toNum(sessionCount?.n) ? Math.round(sessionTotalSeconds / toNum(sessionCount?.n)) : 0,
    active_seconds: sessionTotalSeconds,
    page_views: toNum(pageViewCount?.n),
    window_days: range.fromDay && range.toDay ? daysBetween(range.fromDay, range.toDay).length : null,
  };

  // ---- Range-wide event totals + action breakdown ----
  const eventTypes = { actions: 0, sign_ins: 0, failed_sign_ins: 0, sign_outs: 0 };
  let requisitionsCreated = 0;
  let reportsCreated = 0;
  const actionCounts = new Map<string, number>();
  for (const r of countRows) {
    const n = toNum(r.n);
    if (ACTION_EVENTS.includes(r.eventType)) {
      eventTypes.actions += n;
      const label = `${ENTITY_PLURAL[r.entityType ?? ""] ?? "Other"} ${VERB_PAST[r.eventType]}`;
      actionCounts.set(label, (actionCounts.get(label) ?? 0) + n);
      if (r.eventType === "create" && r.entityType === "requisition") requisitionsCreated += n;
      if (r.eventType === "create" && r.entityType === "report") reportsCreated += n;
    }
    if (r.eventType === "login") eventTypes.sign_ins += n;
    if (r.eventType === "login_failed") eventTypes.failed_sign_ins += n;
    if (r.eventType === "logout") eventTypes.sign_outs += n;
  }
  const actionBreakdown = [...actionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));

  // ---- Per-day series (aligned to `days`) ----
  const daily = new Map(
    days.map((day) => [
      day,
      { day, actions: 0, sign_ins: 0, failed: 0, sign_outs: 0, users: 0, active_seconds: 0, requisitions: 0, reports: 0 },
    ])
  );
  for (const r of dailyRows) {
    const d = daily.get(r.day);
    if (!d) continue;
    const n = toNum(r.n);
    if (ACTION_EVENTS.includes(r.eventType)) d.actions += n;
    if (r.eventType === "login") d.sign_ins += n;
    if (r.eventType === "login_failed") d.failed += n;
    if (r.eventType === "logout") d.sign_outs += n;
    if (r.eventType === "create" && r.entityType === "requisition") d.requisitions += n;
    if (r.eventType === "create" && r.entityType === "report") d.reports += n;
  }
  for (const r of dailyUserRows) {
    const d = daily.get(r.day);
    if (d) d.users = toNum(r.n);
  }
  for (const r of dailySessionRows) {
    const d = daily.get(r.day);
    if (d) d.active_seconds = Math.round(toNum(r.seconds));
  }
  const dailySeries = days.map((day) => daily.get(day)!);

  // ---- When people work: weekday (Mon=0..Sun=6) x hour ----
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const hourTotals = Array<number>(24).fill(0);
  let hottest: { dow: number; hour: number; events: number } | null = null;
  for (const r of heatRows) {
    const dow = (toNum(r.dow) + 6) % 7; // postgres: Sunday=0
    const n = toNum(r.n);
    heatmap[dow][toNum(r.hour)] += n;
    hourTotals[toNum(r.hour)] += n;
    if (!hottest || heatmap[dow][toNum(r.hour)] > hottest.events) {
      hottest = { dow, hour: toNum(r.hour), events: heatmap[dow][toNum(r.hour)] };
    }
  }
  const peakHourIndex = hourTotals.some((n) => n > 0) ? hourTotals.indexOf(Math.max(...hourTotals)) : -1;

  // ---- Insights ----
  let busiest: { day: string; events: number; users: number } | null = null;
  for (const d of dailySeries) {
    const events = d.actions + d.sign_ins + d.sign_outs;
    if (events > 0 && (!busiest || events > busiest.events)) busiest = { day: d.day, events, users: d.users };
  }
  const top = topUserRows[0];
  let topUser: { email: string | null; name: string | null; actions: number; active_seconds: number } | null = null;
  if (top?.userId && toNum(top.actions) > 0) {
    const {
      rows: [sess],
    } = await db.execute<{ seconds: number }>(
      sql`select coalesce(sum(g.secs), 0)::float as seconds from ${activeGapTable(range)} where ${gapsInWindow(range)} and ${activeFor(top.userId)}`
    );
    topUser = { email: top.email, name: top.name, actions: toNum(top.actions), active_seconds: Math.round(toNum(sess?.seconds)) };
  }

  // ---- Per-user day grids ----
  const dayIndex = new Map(matrixDays.map((d, i) => [d, i]));
  type UserRow = {
    user_id: string;
    email: string | null;
    name: string | null;
    actions: number[];
    active_seconds: number[];
    requisitions: number[];
    reports: number[];
  };
  const perUser = new Map<string, UserRow>();
  const rowFor = (id: string, email: string | null, name: string | null): UserRow => {
    let row = perUser.get(id);
    if (!row) {
      row = {
        user_id: id,
        email,
        name,
        actions: Array(matrixDays.length).fill(0),
        active_seconds: Array(matrixDays.length).fill(0),
        requisitions: Array(matrixDays.length).fill(0),
        reports: Array(matrixDays.length).fill(0),
      };
      perUser.set(id, row);
    }
    return row;
  };
  for (const r of userDayRows) {
    const i = dayIndex.get(r.day);
    if (i === undefined || !r.userId) continue;
    const row = rowFor(r.userId, r.email, r.name);
    row.actions[i] += toNum(r.actions);
    row.requisitions[i] += toNum(r.requisitions);
    row.reports[i] += toNum(r.reports);
  }
  for (const r of userDaySessionRows) {
    const i = dayIndex.get(r.day);
    if (i === undefined) continue;
    rowFor(r.userId, null, null).active_seconds[i] += Math.round(toNum(r.seconds));
  }
  const matrixUserIds = [...perUser.keys()];
  const roleRows = matrixUserIds.length
    ? await db
        .select({ id: users.id, role: users.role, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, matrixUserIds))
    : [];
  const roleById = new Map(roleRows.map((u) => [u.id, u]));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const userDays = [...perUser.values()]
    .map((row) => {
      const live = roleById.get(row.user_id);
      return {
        ...row,
        email: live?.email ?? row.email,
        name: live?.name ?? row.name,
        role: live?.role ?? null,
        active_days: row.active_seconds.filter((s) => s > 0).length,
      };
    })
    .sort((a, b) => sum(b.active_seconds) - sum(a.active_seconds) || sum(b.actions) - sum(a.actions))
    .slice(0, MAX_MATRIX_USERS);

  // ---- Podium (top 3 by time / by actions, over the whole range) ----
  const leaderIds = [...new Set([...leaderActionRows, ...leaderTimeRows].map((r) => r.userId).filter((id): id is string => !!id))];
  const leaderUsers = leaderIds.length
    ? await db.select({ id: users.id, role: users.role, name: users.name, email: users.email }).from(users).where(inArray(users.id, leaderIds))
    : [];
  const leaderUserById = new Map(leaderUsers.map((u) => [u.id, u]));
  const toLeaders = (rows: { userId: string | null; email: string | null; name: string | null; value: number }[], total: number) =>
    rows
      .filter((r) => r.userId && toNum(r.value) > 0)
      .map((r, i) => {
        const live = leaderUserById.get(r.userId!);
        const value = Math.round(toNum(r.value));
        return {
          rank: i + 1,
          user_id: r.userId!,
          email: live?.email ?? r.email,
          name: live?.name ?? r.name,
          role: live?.role ?? null,
          value,
          share_pct: total > 0 ? Math.round((value / total) * 100) : 0,
        };
      });
  const leaderboards = {
    by_time: toLeaders(leaderTimeRows, Math.round(toNum(timeTotal?.seconds))),
    by_actions: toLeaders(leaderActionRows, eventTypes.actions),
  };

  // ---- Devices / browsers / OS (sign-in events only; null UA = logged before tracking) ----
  const devices = new Map<string, number>();
  const browsers = new Map<string, number>();
  const systems = new Map<string, number>();
  for (const r of uaRows) {
    const parsed = parseUserAgent(r.ua);
    const n = toNum(r.n);
    devices.set(parsed.device, (devices.get(parsed.device) ?? 0) + n);
    browsers.set(parsed.browser, (browsers.get(parsed.browser) ?? 0) + n);
    systems.set(parsed.os, (systems.get(parsed.os) ?? 0) + n);
  }

  // ---- IP addresses (local addresses folded together) ----
  const ips = new Map<string, { ip: string; events: number; users: number; failed: number; emails: Set<string>; last_at: string }>();
  for (const r of ipRows) {
    if (!r.ip) continue;
    const ip = normalizeIp(r.ip);
    const cur = ips.get(ip) ?? { ip, events: 0, users: 0, failed: 0, emails: new Set<string>(), last_at: r.lastAt };
    cur.events += toNum(r.events);
    cur.users = Math.max(cur.users, toNum(r.users));
    cur.failed += toNum(r.failed);
    for (const e of r.emails ?? []) cur.emails.add(e);
    if (r.lastAt > cur.last_at) cur.last_at = r.lastAt;
    ips.set(ip, cur);
  }

  return json({
    days,
    daily_capped: dailyCapped,
    matrix_days: matrixDays,
    kpis: {
      requisitions_created: requisitionsCreated,
      reports_created: reportsCreated,
      sign_ins: eventTypes.sign_ins,
      failed_sign_ins: eventTypes.failed_sign_ins,
      distinct_ips: toNum(ipTotal?.n),
      previous: prevRows[0]
        ? {
            requisitions_created: toNum(prevRows[0].requisitions),
            reports_created: toNum(prevRows[0].reports),
            sign_ins: toNum(prevRows[0].signIns),
          }
        : null,
    },
    adoption,
    daily: dailySeries,
    event_types: eventTypes,
    action_breakdown: actionBreakdown,
    heatmap,
    insights: {
      busiest_day: busiest,
      peak_hour: peakHourIndex >= 0 ? { hour: peakHourIndex, events: hourTotals[peakHourIndex], hottest } : null,
      top_user: topUser,
    },
    leaderboards,
    user_days: userDays,
    devices: collapse(devices, 4),
    browsers: collapse(browsers, 4),
    operating_systems: collapse(systems, 4),
    ips: [...ips.values()]
      .sort((a, b) => b.events - a.events)
      .slice(0, 10)
      .map((i) => ({ ip: i.ip, events: i.events, users: i.users, failed: i.failed, emails: [...i.emails].sort(), last_at: new Date(i.last_at).toISOString() })),
  });
}
