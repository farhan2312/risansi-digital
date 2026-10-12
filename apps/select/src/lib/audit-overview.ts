/**
 * Server-side figures for the Audit Log "Overview" tab: trends, heatmaps and
 * breakdowns for one window, in one call.
 *
 * Days and hours are IST (Asia/Kolkata): the team works in India, and a
 * UTC day would split one working day into two.
 *
 * Active time uses the same gap rule as the Usage tab (lib/audit-stats.ts),
 * so the totals here match that tab.
 */
import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import {
  activityByUser,
  IDLE_CUTOFF_SECONDS,
  windowCondition,
  type AuditWindow,
} from "@/lib/audit-stats";
import { IST_OFFSET_MS } from "@/lib/ist";
import { parseUserAgent } from "@/lib/user-agent";
import {
  actionGroup,
  OVERVIEW_MAX_DAYS,
  type AuditBreakdownItem,
  type AuditOverview,
  type AuditOverviewKpis,
  type AuditOverviewUser,
} from "@/lib/audit-overview-shared";

const IST_DAY = sql`to_char(${auditLog.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;

const whereOf = (window: AuditWindow, ...extra: SQL[]): SQL => {
  const parts = [windowCondition(window), ...extra].filter(Boolean) as SQL[];
  return parts.length ? sql`where ${sql.join(parts, sql` and `)}` : sql``;
};

const istDayKey = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Every IST day from `start` to `end`, inclusive. */
function daysBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const first = istDayKey(start);
  const last = istDayKey(end);
  let t = Date.parse(`${first}T00:00:00Z`);
  const stop = Date.parse(`${last}T00:00:00Z`);
  while (t <= stop) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400_000;
  }
  return out;
}

async function kpisFor(window: AuditWindow): Promise<AuditOverviewKpis> {
  const res = await db.execute<Omit<AuditOverviewKpis, "totalActiveSeconds">>(sql`
    select count(*)::int as events,
           count(*) filter (where event_type = 'action')::int as actions,
           count(*) filter (where event_type = 'login')::int as logins,
           count(*) filter (where event_type = 'login_failed')::int as failed,
           count(distinct user_email) filter (where event_type <> 'login_failed')::int as "activeUsers",
           count(distinct ip)::int as "uniqueIps",
           count(*) filter (where action = 'enquiry.create')::int as enquiries,
           count(*) filter (where action in ('enquiry.create', 'tag.create', 'tag.copy'))::int as tags,
           count(*) filter (where action = 'report.generate')::int as reports,
           count(*) filter (where action = 'approval.send')::int as "approvalsSent"
    from ${auditLog} ${whereOf(window)}
  `);
  const activity = await activityByUser(window);
  let totalActiveSeconds = 0;
  for (const v of activity.values()) totalActiveSeconds += v.activeSeconds;
  return { ...res.rows[0]!, totalActiveSeconds };
}

const toBreakdown = (m: Map<string, { count: number; users: Set<string> }>): AuditBreakdownItem[] =>
  [...m.entries()]
    .map(([label, v]) => ({ label, count: v.count, users: v.users.size }))
    .sort((a, b) => b.count - a.count);

const bump = (
  m: Map<string, { count: number; users: Set<string> }>,
  key: string,
  count: number,
  emails: string[],
) => {
  const cur = m.get(key) ?? { count: 0, users: new Set<string>() };
  cur.count += count;
  for (const e of emails) cur.users.add(e);
  m.set(key, cur);
};

export async function getAuditOverview(window: AuditWindow): Promise<AuditOverview> {
  const end = window.until ?? new Date();

  // --- Day axis -------------------------------------------------------------
  let start = window.since;
  if (!start) {
    const first = await db.execute<{ first: string | null }>(
      sql`select min(created_at) as first from ${auditLog} ${whereOf(window)}`,
    );
    start = first.rows[0]?.first ? new Date(first.rows[0].first) : null;
  }
  let days = start ? daysBetween(start, end) : [];
  const daysCapped = days.length > OVERVIEW_MAX_DAYS;
  if (daysCapped) days = days.slice(-OVERVIEW_MAX_DAYS);

  // --- The window just before, for trend arrows ----------------------------
  const previousWindow: AuditWindow | null = window.since
    ? {
        since: new Date(window.since.getTime() - (end.getTime() - window.since.getTime())),
        until: new Date(window.since.getTime() - 1),
      }
    : null;

  const [kpis, previous, dailyRes, heatRes, actionRes, uaRes, userDayRes, activeDayRes, userRes, ipRes] =
    await Promise.all([
      kpisFor(window),
      previousWindow ? kpisFor(previousWindow) : Promise.resolve(null),

      db.execute<{
        day: string; actions: number; logins: number; failed: number; users: number; enquiries: number; tags: number;
      }>(sql`
        select ${IST_DAY} as day,
               count(*) filter (where event_type = 'action')::int as actions,
               count(*) filter (where event_type = 'login')::int as logins,
               count(*) filter (where event_type = 'login_failed')::int as failed,
               count(distinct user_email) filter (where event_type <> 'login_failed')::int as users,
               count(*) filter (where action = 'enquiry.create')::int as enquiries,
               count(*) filter (where action in ('enquiry.create', 'tag.create', 'tag.copy'))::int as tags
        from ${auditLog} ${whereOf(window)}
        group by 1
      `),

      db.execute<{ dow: number; hour: number; n: number }>(sql`
        select extract(isodow from created_at at time zone 'Asia/Kolkata')::int as dow,
               extract(hour from created_at at time zone 'Asia/Kolkata')::int as hour,
               count(*)::int as n
        from ${auditLog} ${whereOf(window, sql`event_type <> 'login_failed'`)}
        group by 1, 2
      `),

      db.execute<{ action: string; event_type: string; n: number; emails: string[] | null }>(sql`
        select action, event_type, count(*)::int as n,
               array_agg(distinct user_email) filter (where user_email is not null) as emails
        from ${auditLog} ${whereOf(window)}
        group by 1, 2
      `),

      db.execute<{ ua: string | null; n: number; emails: string[] | null }>(sql`
        select user_agent as ua, count(*)::int as n,
               array_agg(distinct user_email) filter (where user_email is not null) as emails
        from ${auditLog} ${whereOf(window, sql`event_type <> 'login_failed'`)}
        group by 1
      `),

      db.execute<{ email: string; day: string; actions: number; enquiries: number; tags: number }>(sql`
        select user_email as email, ${IST_DAY} as day,
               count(*) filter (where event_type = 'action')::int as actions,
               count(*) filter (where action = 'enquiry.create')::int as enquiries,
               count(*) filter (where action in ('enquiry.create', 'tag.create', 'tag.copy'))::int as tags
        from ${auditLog}
        ${whereOf(window, sql`user_email is not null`, sql`event_type <> 'login_failed'`)}
        group by 1, 2
      `),

      // Active time per user per IST day - the gap rule from audit-stats.ts,
      // with each gap credited to the day of the event that closes it.
      db.execute<{ email: string; day: string; active: number }>(sql`
        with ev as (
          select user_email as email, created_at,
                 extract(epoch from created_at - lag(created_at)
                   over (partition by user_email order by created_at)) as gap
          from ${auditLog}
          ${whereOf(window, sql`user_email is not null`, sql`event_type <> 'login_failed'`)}
        )
        select email, to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day,
               coalesce(sum(gap) filter (where gap <= ${IDLE_CUTOFF_SECONDS}), 0)::float8 as active
        from ev group by 1, 2
      `),

      db.execute<{ email: string; role: string | null; last_ip: string | null }>(sql`
        select user_email as email,
               (array_agg(user_role order by created_at desc) filter (where user_role is not null))[1] as role,
               (array_agg(ip order by created_at desc) filter (where ip is not null))[1] as last_ip
        from ${auditLog}
        ${whereOf(window, sql`user_email is not null`, sql`event_type <> 'login_failed'`)}
        group by 1
      `),

      db.execute<{ ip: string; events: number; users: number; failed: number; emails: string[] | null; last_at: string | null }>(sql`
        select ip, count(*)::int as events,
               count(distinct user_email)::int as users,
               count(*) filter (where event_type = 'login_failed')::int as failed,
               array_agg(distinct user_email) filter (where user_email is not null) as emails,
               max(created_at) as last_at
        from ${auditLog} ${whereOf(window, sql`ip is not null`)}
        group by 1 order by 2 desc limit 12
      `),

    ]);

  // --- Daily trend (every day present, zero-filled) --------------------------
  const activeByDay = new Map<string, number>();
  for (const r of activeDayRes.rows) activeByDay.set(r.day, (activeByDay.get(r.day) ?? 0) + Number(r.active));
  const dailyMap = new Map(dailyRes.rows.map((r) => [r.day, r]));
  const daily = days.map((day) => {
    const r = dailyMap.get(day);
    return {
      day,
      actions: r?.actions ?? 0,
      logins: r?.logins ?? 0,
      failed: r?.failed ?? 0,
      users: r?.users ?? 0,
      enquiries: r?.enquiries ?? 0,
      tags: r?.tags ?? 0,
      activeSeconds: Math.round(activeByDay.get(day) ?? 0),
    };
  });

  // --- Weekday x hour heatmap ------------------------------------------------
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of heatRes.rows) heatmap[r.dow - 1]![r.hour] = r.n;

  // --- Actions and event types -----------------------------------------------
  const groups = new Map<string, { count: number; users: Set<string> }>();
  const types = new Map<string, { count: number; users: Set<string> }>();
  for (const r of actionRes.rows) {
    const emails = r.emails ?? [];
    if (r.event_type === "action") bump(groups, actionGroup(r.action), r.n, emails);
    const typeLabel =
      r.event_type === "login"
        ? "Sign-ins"
        : r.event_type === "login_failed"
          ? "Failed sign-ins"
          : r.event_type === "logout"
            ? "Sign-outs"
            : "Actions";
    bump(types, typeLabel, r.n, emails);
  }

  // --- Devices ------------------------------------------------------------------
  const devices = new Map<string, { count: number; users: Set<string> }>();
  const browsers = new Map<string, { count: number; users: Set<string> }>();
  const os = new Map<string, { count: number; users: Set<string> }>();
  for (const r of uaRes.rows) {
    const d = parseUserAgent(r.ua);
    const emails = r.emails ?? [];
    bump(devices, d.device, r.n, emails);
    bump(browsers, d.browser, r.n, emails);
    bump(os, d.os, r.n, emails);
  }

  // --- Per-user daily metrics ---------------------------------------------
  const users = new Map<string, AuditOverviewUser>();
  for (const r of userRes.rows) {
    users.set(r.email, {
      email: r.email,
      role: r.role,
      actions: 0,
      enquiries: 0,
      tags: 0,
      activeSeconds: 0,
      activeDays: 0,
      lastIp: r.last_ip,
      days: {},
    });
  }
  const daySet = new Set(days);
  for (const r of userDayRes.rows) {
    const u = users.get(r.email);
    if (!u) continue;
    u.actions += r.actions;
    u.enquiries += r.enquiries;
    u.tags += r.tags;
    u.activeDays += 1;
    if (daySet.has(r.day)) {
      u.days[r.day] = { day: r.day, actions: r.actions, enquiries: r.enquiries, tags: r.tags, activeSeconds: 0 };
    }
  }
  for (const r of activeDayRes.rows) {
    const u = users.get(r.email);
    if (!u) continue;
    const secs = Math.round(Number(r.active));
    u.activeSeconds += secs;
    const cell = u.days[r.day];
    if (cell) cell.activeSeconds = secs;
  }

  return {
    since: window.since ? window.since.toISOString() : null,
    until: window.until ? window.until.toISOString() : null,
    days,
    daysCapped,
    kpis,
    previous,
    daily,
    heatmap,
    actionBreakdown: toBreakdown(groups),
    eventTypes: toBreakdown(types),
    devices: toBreakdown(devices),
    browsers: toBreakdown(browsers),
    os: toBreakdown(os),
    users: [...users.values()].sort(
      (a, b) => b.activeSeconds - a.activeSeconds || b.actions - a.actions,
    ),
    ips: ipRes.rows.map((r) => ({
      ip: r.ip,
      events: r.events,
      users: r.users,
      failed: r.failed,
      emails: r.emails ?? [],
      lastAt: r.last_at,
    })),
  };
}
