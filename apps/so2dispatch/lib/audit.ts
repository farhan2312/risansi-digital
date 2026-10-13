import { query } from "@/lib/db";
import { ACTIVE_GAP_MINUTES } from "@/lib/audit-labels";
import { currentRequestMeta } from "@/lib/request-meta";
import {
  PAGE_SIZE,
  likePattern,
  offsetFor,
  pageWithTotal,
  type PageResult,
} from "@/lib/pagination";

export type AuditCategory = "auth" | "activity" | "ownership";

export type AuditActor = {
  id?: string | null;
  email?: string | null;
  role?: string | null;
};

/**
 * The order an event touched. SO No. and EC No. are recorded as they read at
 * the time, so the trail keeps naming an order after it is renamed or deleted.
 */
export type AuditSubject = {
  orderId?: string | null;
  itemId?: string | null;
  soNo?: string | null;
  ecNo?: string | null;
};

/**
 * Record an audit event. Never throws — a logging failure must not break the
 * action being logged.
 */
export async function logAudit(entry: {
  actor?: AuditActor;
  action: string;
  category: AuditCategory;
  target?: string | null;
  details?: string | null;
  subject?: AuditSubject | null;
}): Promise<void> {
  const s = entry.subject ?? {};
  try {
    // Every event carries where it came from, read off the request being
    // served, so no caller has to remember to pass it.
    const origin = await currentRequestMeta();
    await query(
      `INSERT INTO audit_log
         (user_id, user_email, user_role, action, category, target, details,
          order_id, item_id, so_no, ec_no,
          ip_address, user_agent, device_type, browser, os)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15, $16)`,
      [
        entry.actor?.id ?? null,
        entry.actor?.email ?? null,
        entry.actor?.role ?? null,
        entry.action,
        entry.category,
        entry.target ?? null,
        entry.details ?? null,
        s.orderId ?? null,
        s.itemId ?? null,
        s.soNo ?? null,
        s.ecNo ?? null,
        origin.ip,
        origin.userAgent,
        origin.device,
        origin.browser,
        origin.os,
      ]
    );
  } catch (error) {
    console.error("audit log failed:", error);
  }
}

export type AuditStats = {
  logins: number;
  failed: number;
  activeUsers: number;
  actions: number;
};

/** 24-hour headline counts for the stat cards. */
export async function getAuditStats(): Promise<AuditStats> {
  const result = await query<{
    logins: number;
    failed: number;
    active_users: number;
    actions: number;
  }>(
    `SELECT
        count(*) FILTER (WHERE action = 'login'
                          AND created_at > now() - interval '24 hours')::int AS logins,
        count(*) FILTER (WHERE action = 'login_failed'
                          AND created_at > now() - interval '24 hours')::int AS failed,
        count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL
                          AND created_at > now() - interval '24 hours')::int AS active_users,
        count(*) FILTER (WHERE category = 'activity'
                          AND created_at > now() - interval '24 hours')::int AS actions
       FROM audit_log`
  );
  const row = result.rows[0];
  return {
    logins: row?.logins ?? 0,
    failed: row?.failed ?? 0,
    activeUsers: row?.active_users ?? 0,
    actions: row?.actions ?? 0,
  };
}

export type AuditEvent = {
  id: string;
  created_at: string;
  user_email: string | null;
  user_role: string | null;
  action: string;
  category: string;
  target: string | null;
  details: string | null;
  order_id: string | null;
  item_id: string | null;
  so_no: string | null;
  ec_no: string | null;
  /** Where the request came from; null on events logged before it was kept. */
  ip_address: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  /** Whether the order / EC still exists — a link to a deleted one leads nowhere. */
  order_live: boolean;
  item_live: boolean;
};

/** A row of the "Usage by User" tab: per-user totals over the range. */
export type AuditUserRow = {
  email: string;
  name: string | null;
  role: string | null;
  actions: number;
  sessions: number;
  /** See ACTIVE_GAP: the short gaps between this user's actions, added up. */
  activeMinutes: number;
  lastActive: string | null;
  /** The address of their latest event, and how many distinct ones they used. */
  lastIp: string | null;
  ipCount: number;
  /** "Desktop · Chrome" — what their latest event came from. */
  lastDevice: string | null;
};

/**
 * The period being looked at, as timestamps. `until` is exclusive, so a range
 * ending on a date covers the whole of that day.
 */
export type AuditWindow = { since: string | null; until: string | null };

const ISO_FMT = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

const EVENT_COLUMNS = `id,
              to_char(created_at AT TIME ZONE 'UTC', ${ISO_FMT}) AS created_at,
              user_email, user_role, action, category, target, details,
              order_id, item_id, so_no, ec_no,
              ip_address, device_type, browser, os,
              EXISTS (SELECT 1 FROM orders o WHERE o.id = audit_log.order_id) AS order_live,
              EXISTS (SELECT 1 FROM order_items i WHERE i.id = audit_log.item_id) AS item_live`;

/** A row carrying the total alongside it, courtesy of count(*) OVER (). */
type Counted = { total_count: string };

async function countOf(sql: string, params: unknown[]): Promise<number> {
  const r = await query<{ count: string }>(sql, params);
  return Number(r.rows[0]?.count ?? 0);
}

// Pages come from pageWithTotal (lib/pagination.ts): one trip in the common case.
const paged = pageWithTotal;

// $1 category, $2 since, $3 until, $4 search. Search reaches the SO and EC as
// well as the free text, so "1455" finds everything done to that order.
const EVENT_WHERE = `WHERE ($1::text IS NULL OR category = $1)
        AND ($2::timestamptz IS NULL OR created_at >= $2)
        AND ($3::timestamptz IS NULL OR created_at < $3)
        AND ($4::text IS NULL OR user_email ILIKE $4 OR details ILIKE $4
                              OR target ILIKE $4 OR action ILIKE $4
                              OR so_no ILIKE $4 OR ec_no ILIKE $4
                              OR ip_address ILIKE $4)`;

/**
 * One page of audit events, filtered in SQL.
 *
 * Replaces the old "fetch the newest 1000 and slice in the browser" path,
 * which silently hid everything older once the table passed that cap.
 */
export async function listAuditEventsPage(opts: {
  page: number;
  category: string | null;
  window: AuditWindow;
  search: string;
}): Promise<PageResult<AuditEvent>> {
  const search = opts.search ? likePattern(opts.search) : null;
  const params = [opts.category, opts.window.since, opts.window.until, search];

  const fetchPage = (page: number) =>
    query<AuditEvent & Counted>(
      `SELECT ${EVENT_COLUMNS},
              count(*) OVER ()::text AS total_count
         FROM audit_log
         ${EVENT_WHERE}
        ORDER BY created_at DESC
        LIMIT $5 OFFSET $6`,
      [...params, PAGE_SIZE, offsetFor(page)]
    );

  return paged(opts.page, fetchPage, () =>
    countOf(`SELECT count(*) AS count FROM audit_log ${EVENT_WHERE}`, params)
  );
}

/**
 * Per-user totals over the window, with active time worked out as described
 * at ACTIVE_GAP_MINUTES.
 * Every action counts — sign-in and sign-out included — except a failed
 * sign-in, which names an email without its owner having been in the system.
 *
 * $1 since, $2 until, $3 search.
 */
const USERS_SQL = `
  WITH base AS (
    SELECT lower(user_email) AS key, user_email, user_role, action, category,
           created_at, ip_address, device_type, browser
      FROM audit_log
     WHERE user_email IS NOT NULL
       AND ($1::timestamptz IS NULL OR created_at >= $1)
       AND ($2::timestamptz IS NULL OR created_at < $2)
  ),
  gaps AS (
    SELECT key,
           created_at - lag(created_at)
             OVER (PARTITION BY key ORDER BY created_at) AS gap
      FROM base
     WHERE action <> 'login_failed'
  ),
  active AS (
    SELECT key,
           COALESCE(sum(extract(epoch FROM gap))
             FILTER (WHERE gap <= interval '${ACTIVE_GAP_MINUTES} minutes'), 0) AS seconds
      FROM gaps
     GROUP BY key
  ),
  ev AS (
    SELECT key,
           max(user_email) AS email,
           (array_agg(user_role ORDER BY created_at DESC)
              FILTER (WHERE user_role IS NOT NULL))[1] AS role,
           count(*) FILTER (WHERE category = 'activity')::int AS actions,
           count(*) FILTER (WHERE action = 'login')::int AS sessions,
           max(created_at) AS last_event,
           (array_agg(ip_address ORDER BY created_at DESC)
              FILTER (WHERE ip_address IS NOT NULL))[1] AS last_ip,
           count(DISTINCT ip_address)::int AS ip_count,
           (array_agg(device_type || coalesce(' · ' || browser, '') ORDER BY created_at DESC)
              FILTER (WHERE device_type IS NOT NULL))[1] AS last_device
      FROM base
     GROUP BY key
  ),
  merged AS (
    SELECT ev.email,
           (SELECT u.full_name FROM users u WHERE lower(u.email) = ev.key LIMIT 1) AS name,
           ev.role, ev.actions, ev.sessions,
           round(COALESCE(active.seconds, 0) / 60.0)::int AS active_minutes,
           ev.last_event, ev.last_ip, ev.ip_count, ev.last_device
      FROM ev LEFT JOIN active ON active.key = ev.key
  )
  SELECT email, name, role, actions, sessions,
         active_minutes AS "activeMinutes",
         to_char(last_event AT TIME ZONE 'UTC', ${ISO_FMT}) AS "lastActive",
         last_ip AS "lastIp", ip_count AS "ipCount", last_device AS "lastDevice"
    FROM merged
   WHERE ($3::text IS NULL OR email ILIKE $3 OR role ILIKE $3 OR name ILIKE $3
          OR last_ip ILIKE $3)`;

/**
 * One page of the per-user aggregate. Grouping happens in SQL so the totals
 * cover the whole range, not just the rows on screen.
 */
export async function listAuditUsersPage(opts: {
  page: number;
  window: AuditWindow;
  search: string;
}): Promise<PageResult<AuditUserRow>> {
  const search = opts.search ? likePattern(opts.search) : null;
  const params = [opts.window.since, opts.window.until, search];

  const fetchPage = (page: number) =>
    query<AuditUserRow & Counted>(
      `SELECT *, count(*) OVER ()::text AS total_count
         FROM (${USERS_SQL}) u
        ORDER BY "lastActive" DESC NULLS LAST
        LIMIT $4 OFFSET $5`,
      [...params, PAGE_SIZE, offsetFor(page)]
    );

  return paged(opts.page, fetchPage, () =>
    countOf(`SELECT count(*) AS count FROM (${USERS_SQL}) u`, params)
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** The event list in a report stops here; the summaries still cover it all. */
export const REPORT_EVENT_CAP = 5000;

export type AuditReport = {
  totals: {
    events: number;
    logins: number;
    failed: number;
    actions: number;
    activeUsers: number;
    activeMinutes: number;
    ordersTouched: number;
  };
  byAction: { action: string; count: number }[];
  topOrders: { so_no: string; count: number; users: number; last: string }[];
  users: AuditUserRow[];
  events: AuditEvent[];
  /** More events matched than the list carries. */
  truncated: boolean;
};

/**
 * Everything the PDF report prints, for one window and filter. Five queries in
 * parallel rather than one: each is a different shape, and the database is
 * remote, so the wait is the slowest of them, not the sum.
 */
export async function getAuditReport(opts: {
  category: string | null;
  window: AuditWindow;
  search: string;
}): Promise<AuditReport> {
  const search = opts.search ? likePattern(opts.search) : null;
  const params = [opts.category, opts.window.since, opts.window.until, search];

  const [totals, byAction, topOrders, users, events] = await Promise.all([
    query<{
      events: number;
      logins: number;
      failed: number;
      actions: number;
      orders_touched: number;
    }>(
      `SELECT count(*)::int AS events,
              count(*) FILTER (WHERE action = 'login')::int AS logins,
              count(*) FILTER (WHERE action = 'login_failed')::int AS failed,
              count(*) FILTER (WHERE category = 'activity')::int AS actions,
              count(DISTINCT so_no)::int AS orders_touched
         FROM audit_log ${EVENT_WHERE}`,
      params
    ),
    query<{ action: string; count: number }>(
      `SELECT action, count(*)::int AS count
         FROM audit_log ${EVENT_WHERE}
        GROUP BY action ORDER BY count DESC, action`,
      params
    ),
    query<{ so_no: string; count: number; users: number; last: string }>(
      `SELECT so_no, count(*)::int AS count,
              count(DISTINCT user_email)::int AS users,
              to_char(max(created_at) AT TIME ZONE 'UTC', ${ISO_FMT}) AS last
         FROM audit_log ${EVENT_WHERE} AND so_no IS NOT NULL
        GROUP BY so_no ORDER BY count DESC, max(created_at) DESC
        LIMIT 15`,
      params
    ),
    query<AuditUserRow>(
      `SELECT * FROM (${USERS_SQL}) u ORDER BY "activeMinutes" DESC, actions DESC`,
      [opts.window.since, opts.window.until, search]
    ),
    query<AuditEvent>(
      `SELECT ${EVENT_COLUMNS}
         FROM audit_log ${EVENT_WHERE}
        ORDER BY created_at DESC
        LIMIT ${REPORT_EVENT_CAP + 1}`,
      params
    ),
  ]);

  const t = totals.rows[0];
  const userRows = users.rows;
  return {
    totals: {
      events: t?.events ?? 0,
      logins: t?.logins ?? 0,
      failed: t?.failed ?? 0,
      actions: t?.actions ?? 0,
      // A failed sign-in names an email too; someone who never got in was not
      // an active user.
      activeUsers: userRows.filter(
        (u) => u.activeMinutes > 0 || u.actions > 0 || u.sessions > 0
      ).length,
      activeMinutes: userRows.reduce((sum, u) => sum + u.activeMinutes, 0),
      ordersTouched: t?.orders_touched ?? 0,
    },
    byAction: byAction.rows,
    topOrders: topOrders.rows,
    users: userRows,
    events: events.rows.slice(0, REPORT_EVENT_CAP),
    truncated: events.rows.length > REPORT_EVENT_CAP,
  };
}
