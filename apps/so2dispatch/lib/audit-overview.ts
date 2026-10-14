// The Overview tab of the audit log: the whole period at a glance.
//
// Every figure is aggregated in SQL over the full window — never over a page
// of rows — and the queries run in parallel, since the database is remote and
// the wait is then the slowest query rather than the sum. Days and hours are
// read in IST, the timezone everyone using the tracker works in.

import { query } from "@/lib/db";
import type { AuditWindow } from "@/lib/audit";

const TZ = "Asia/Kolkata";

/** A failed sign-in names an email, not a person who was in the system. */
const REAL = `action <> 'login_failed'`;

/** Days shown in the per-user grid; a longer period shows its last days. */
export const USER_GRID_DAYS = 14;
/** Users shown in the per-user grid, busiest first. */
export const USER_GRID_USERS = 12;
/** The daily trend stops here so "All" on a long history stays drawable. */
const MAX_TREND_DAYS = 366;

export type OverviewKpis = {
  events: number;
  actions: number;
  logins: number;
  failed: number;
  activeUsers: number;
  ordersTouched: number;
  uniqueIps: number;
};

export type AuditOverview = {
  kpis: OverviewKpis;
  /** The same figures for the period of equal length just before, when there is one. */
  previous: OverviewKpis | null;
  /** 7 × 24 event counts: [ISO weekday 1–7 (Mon–Sun)][hour 0–23]. */
  heatmap: number[][];
  daily: {
    day: string;
    events: number;
    actions: number;
    logins: number;
    failed: number;
    activeUsers: number;
  }[];
  devices: { label: string; count: number }[];
  /** Browser and operating system together: "Chrome · Windows". */
  platforms: { label: string; count: number }[];
  actions: { action: string; count: number }[];
  /** Events per role of the person acting; roles with none are simply absent. */
  roles: { role: string | null; count: number; users: number }[];
  userGrid: {
    days: string[];
    users: {
      email: string;
      name: string | null;
      role: string | null;
      total: number;
      perDay: number[];
    }[];
  };
  failedByIp: {
    ip: string;
    attempts: number;
    emails: number;
    lastAt: string;
  }[];
  ipsByUser: {
    email: string;
    ips: number;
    lastIp: string | null;
    devices: number;
  }[];
  /** Events logged before addresses were recorded, so the reader knows the gaps. */
  withoutOrigin: number;
};

const ISO_FMT = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

/** The window with open ends closed, and the equal span before it. */
function bounds(w: AuditWindow): { since: string | null; until: string; prevSince: string | null } {
  const until = w.until ?? new Date().toISOString();
  if (!w.since) return { since: null, until, prevSince: null };
  const span = new Date(until).getTime() - new Date(w.since).getTime();
  return {
    since: w.since,
    until,
    prevSince: new Date(new Date(w.since).getTime() - span).toISOString(),
  };
}

// $1 since (nullable), $2 until.
const IN_WINDOW = `($1::timestamptz IS NULL OR created_at >= $1) AND created_at < $2`;

const KPI_SELECT = (range: string) => `
  count(*) FILTER (WHERE ${range})::int AS events,
  count(*) FILTER (WHERE ${range} AND category = 'activity')::int AS actions,
  count(*) FILTER (WHERE ${range} AND action = 'login')::int AS logins,
  count(*) FILTER (WHERE ${range} AND action = 'login_failed')::int AS failed,
  count(DISTINCT lower(user_email)) FILTER (WHERE ${range} AND ${REAL}
                                              AND user_email IS NOT NULL)::int AS active_users,
  count(DISTINCT so_no) FILTER (WHERE ${range})::int AS orders_touched,
  count(DISTINCT ip_address) FILTER (WHERE ${range})::int AS unique_ips,
  count(*) FILTER (WHERE ${range} AND ip_address IS NULL)::int AS without_origin`;

type KpiRow = {
  events: number;
  actions: number;
  logins: number;
  failed: number;
  active_users: number;
  orders_touched: number;
  unique_ips: number;
  without_origin?: number;
};

function kpis(r: KpiRow | undefined): OverviewKpis {
  return {
    events: r?.events ?? 0,
    actions: r?.actions ?? 0,
    logins: r?.logins ?? 0,
    failed: r?.failed ?? 0,
    activeUsers: r?.active_users ?? 0,
    ordersTouched: r?.orders_touched ?? 0,
    uniqueIps: r?.unique_ips ?? 0,
  };
}

export async function getAuditOverview(window: AuditWindow): Promise<AuditOverview> {
  const { since, until, prevSince } = bounds(window);
  const p = [since, until];

  const [
    kpiRes,
    heatRes,
    dailyRes,
    originRes,
    actionRes,
    roleRes,
    gridRes,
    failedRes,
    ipUserRes,
  ] = await Promise.all([
    // Both periods in one scan: the previous one is only read when it exists.
    query<KpiRow & { [k: string]: number }>(
      `SELECT ${KPI_SELECT(IN_WINDOW)}
              ${prevSince ? `, ${KPI_SELECT(`created_at >= $3 AND created_at < $1`)
                .replace(/ AS (\w+)/g, " AS prev_$1")}` : ""}
         FROM audit_log
        WHERE ${prevSince ? `created_at >= $3 AND created_at < $2` : IN_WINDOW}`,
      prevSince ? [...p, prevSince] : p
    ),

    query<{ dow: number; hour: number; count: number }>(
      `SELECT extract(isodow FROM created_at AT TIME ZONE '${TZ}')::int AS dow,
              extract(hour   FROM created_at AT TIME ZONE '${TZ}')::int AS hour,
              count(*)::int AS count
         FROM audit_log
        WHERE ${IN_WINDOW} AND ${REAL}
        GROUP BY 1, 2`,
      p
    ),

    // Every day of the period, quiet days included, so the line does not skip.
    query<{
      day: string;
      events: number;
      actions: number;
      logins: number;
      failed: number;
      active_users: number;
    }>(
      `WITH span AS (
         SELECT (COALESCE($1::timestamptz,
                          (SELECT min(created_at) FROM audit_log),
                          $2::timestamptz) AT TIME ZONE '${TZ}')::date AS first_day,
                ($2::timestamptz - interval '1 second') AT TIME ZONE '${TZ}' AS last_ts
       ),
       days AS (
         SELECT generate_series(
                  GREATEST(first_day, (last_ts::date - ${MAX_TREND_DAYS - 1})),
                  last_ts::date, interval '1 day')::date AS day
           FROM span
       ),
       ev AS (
         SELECT (created_at AT TIME ZONE '${TZ}')::date AS day,
                count(*)::int AS events,
                count(*) FILTER (WHERE category = 'activity')::int AS actions,
                count(*) FILTER (WHERE action = 'login')::int AS logins,
                count(*) FILTER (WHERE action = 'login_failed')::int AS failed,
                count(DISTINCT lower(user_email)) FILTER (WHERE ${REAL})::int AS active_users
           FROM audit_log
          WHERE ${IN_WINDOW}
          GROUP BY 1
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(ev.events, 0) AS events,
              COALESCE(ev.actions, 0) AS actions,
              COALESCE(ev.logins, 0) AS logins,
              COALESCE(ev.failed, 0) AS failed,
              COALESCE(ev.active_users, 0) AS active_users
         FROM days d LEFT JOIN ev ON ev.day = d.day
        ORDER BY d.day`,
      p
    ),

    // Device, and browser with OS, in one pass, told apart by `kind`.
    query<{ kind: string; label: string; count: number }>(
      `SELECT kind, label, count(*)::int AS count
         FROM (
           SELECT x.kind, COALESCE(x.label, 'Unknown') AS label
             FROM audit_log a
            CROSS JOIN LATERAL (VALUES
                 ('device', a.device_type),
                 ('platform', CASE WHEN a.browser IS NULL AND a.os IS NULL THEN NULL
                                   ELSE COALESCE(a.browser, 'Other') || ' · ' || COALESCE(a.os, 'Other')
                              END)) AS x(kind, label)
            WHERE ${IN_WINDOW.replace(/created_at/g, "a.created_at")}
              AND a.${REAL}
         ) t
        GROUP BY kind, label
        ORDER BY kind, count DESC`,
      p
    ),

    query<{ action: string; count: number }>(
      `SELECT action, count(*)::int AS count
         FROM audit_log
        WHERE ${IN_WINDOW}
        GROUP BY action
        ORDER BY count DESC, action`,
      p
    ),

    query<{ role: string | null; count: number; users: number }>(
      `SELECT user_role AS role, count(*)::int AS count,
              count(DISTINCT lower(user_email))::int AS users
         FROM audit_log
        WHERE ${IN_WINDOW} AND ${REAL} AND user_email IS NOT NULL
        GROUP BY user_role
        ORDER BY count DESC`,
      p
    ),

    // The busiest users over the days the grid shows, and what they did on each
    // — ranked and totalled over those days only, so a row adds up.
    query<{
      email: string;
      name: string | null;
      role: string | null;
      total: number;
      per_day: Record<string, number> | null;
      days: string[];
    }>(
      `WITH last_day AS (
         SELECT (($2::timestamptz - interval '1 second') AT TIME ZONE '${TZ}')::date AS d
       ),
       grid_days AS (
         SELECT generate_series(
                  GREATEST((SELECT d FROM last_day) - ${USER_GRID_DAYS - 1},
                           COALESCE(($1::timestamptz AT TIME ZONE '${TZ}')::date,
                                    (SELECT d FROM last_day) - ${USER_GRID_DAYS - 1})),
                  (SELECT d FROM last_day), interval '1 day')::date AS d
       ),
       ev AS (
         SELECT lower(user_email) AS key, user_email, user_role, created_at,
                (created_at AT TIME ZONE '${TZ}')::date AS d
           FROM audit_log
          WHERE ${IN_WINDOW} AND ${REAL} AND user_email IS NOT NULL
            AND (created_at AT TIME ZONE '${TZ}')::date IN (SELECT d FROM grid_days)
       ),
       top AS (
         SELECT key, max(user_email) AS email,
                (array_agg(user_role ORDER BY created_at DESC)
                   FILTER (WHERE user_role IS NOT NULL))[1] AS role,
                count(*)::int AS total
           FROM ev GROUP BY key
          ORDER BY total DESC LIMIT ${USER_GRID_USERS}
       )
       SELECT t.email,
              (SELECT u.full_name FROM users u WHERE lower(u.email) = t.key LIMIT 1) AS name,
              t.role, t.total,
              (SELECT jsonb_object_agg(to_char(g.d, 'YYYY-MM-DD'), g.n)
                 FROM (SELECT ev.d, count(*)::int AS n FROM ev
                        WHERE ev.key = t.key
                        GROUP BY ev.d) g) AS per_day,
              ARRAY(SELECT to_char(d, 'YYYY-MM-DD') FROM grid_days ORDER BY d) AS days
         FROM top t
        ORDER BY t.total DESC`,
      p
    ),

    // Failed sign-ins grouped by where they came from: several emails tried
    // from one address is the pattern worth noticing.
    query<{ ip: string; attempts: number; emails: number; last_at: string }>(
      `SELECT ip_address AS ip, count(*)::int AS attempts,
              count(DISTINCT lower(user_email))::int AS emails,
              to_char(max(created_at) AT TIME ZONE 'UTC', ${ISO_FMT}) AS last_at
         FROM audit_log
        WHERE ${IN_WINDOW} AND action = 'login_failed' AND ip_address IS NOT NULL
        GROUP BY ip_address
        ORDER BY attempts DESC, max(created_at) DESC
        LIMIT 8`,
      p
    ),

    query<{ email: string; ips: number; last_ip: string | null; devices: number }>(
      `SELECT max(user_email) AS email,
              count(DISTINCT ip_address)::int AS ips,
              (array_agg(ip_address ORDER BY created_at DESC)
                 FILTER (WHERE ip_address IS NOT NULL))[1] AS last_ip,
              count(DISTINCT (device_type, browser, os))
                FILTER (WHERE device_type IS NOT NULL)::int AS devices
         FROM audit_log
        WHERE ${IN_WINDOW} AND ${REAL} AND user_email IS NOT NULL
        GROUP BY lower(user_email)
       HAVING count(DISTINCT ip_address) > 0
        ORDER BY ips DESC, devices DESC, email
        LIMIT 8`,
      p
    ),
  ]);

  const k = kpiRes.rows[0];
  const previous =
    prevSince && k
      ? kpis({
          events: k.prev_events,
          actions: k.prev_actions,
          logins: k.prev_logins,
          failed: k.prev_failed,
          active_users: k.prev_active_users,
          orders_touched: k.prev_orders_touched,
          unique_ips: k.prev_unique_ips,
        })
      : null;

  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of heatRes.rows) heatmap[r.dow - 1][r.hour] = r.count;

  const byKind = (kind: string) =>
    originRes.rows
      .filter((r) => r.kind === kind)
      .map((r) => ({ label: r.label, count: r.count }));

  const gridDays = gridRes.rows[0]?.days ?? [];

  return {
    kpis: kpis(k),
    previous,
    heatmap,
    daily: dailyRes.rows.map((r) => ({
      day: r.day,
      events: r.events,
      actions: r.actions,
      logins: r.logins,
      failed: r.failed,
      activeUsers: r.active_users,
    })),
    devices: byKind("device"),
    platforms: byKind("platform"),
    actions: actionRes.rows,
    roles: roleRes.rows,
    userGrid: {
      days: gridDays,
      users: gridRes.rows.map((r) => ({
        email: r.email,
        name: r.name,
        role: r.role,
        total: r.total,
        perDay: gridDays.map((d) => r.per_day?.[d] ?? 0),
      })),
    },
    failedByIp: failedRes.rows.map((r) => ({
      ip: r.ip,
      attempts: r.attempts,
      emails: r.emails,
      lastAt: r.last_at,
    })),
    ipsByUser: ipUserRes.rows.map((r) => ({
      email: r.email,
      ips: r.ips,
      lastIp: r.last_ip,
      devices: r.devices,
    })),
    withoutOrigin: k?.without_origin ?? 0,
  };
}
