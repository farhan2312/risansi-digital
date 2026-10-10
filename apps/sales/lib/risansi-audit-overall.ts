// The Overall tab: everything the audit trail can say about how the portal is
// being used, in the order somebody running a sales team would ask it.
//
//   Are people using it?        adoption, sessions, the daily curve
//   When do they work?          hour × weekday, desktop against mobile
//   What do they use it for?    time by module
//   Who is doing the work?      per person, against the size of their book
//   What came out of it?        records created, and the funnel they form
//   What needs attention?       the accounts and people nothing is happening on
//
// Every figure honours the same filters, and every timestamp is read in IST.
// page_activity stores timestamptz and the server runs in UTC, so a visit logged
// at 9am in Lucknow would otherwise land in the 03:00 column of the heatmap and
// the working day would appear to start before dawn.

import type { Pool } from 'pg';
import { LIVE_CLIENT } from '@/lib/risansi-opportunity-scope';

export const IST = `AT TIME ZONE 'Asia/Kolkata'`;

export interface OverallFilters {
  /** '1d' | '7d' | '30d' | '90d' | 'all' */
  win: string;
  role: string;
  user: string;
}

// Windows are whole IST calendar days ending today: "7 days" is today and the
// six before it. They used to be rolling — NOW() minus seven times 24 hours —
// which at two in the afternoon starts at two in the afternoon eight dates ago,
// so a person seen every day showed 8 under Days in a 7-day window. `days` is
// how many dates the window holds; null is all time.
export const OVERALL_WINDOWS = [
  { id: '1d', label: 'Today', days: 1 },
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
] as const;

/** SQL for the first instant of the window: IST midnight, `days - 1` days ago, as a timestamptz. */
export const windowStartSql = (days: number) =>
  `((date_trunc('day', NOW() ${IST}) - INTERVAL '${days - 1} days') ${IST})`;

export interface OverallData {
  windowLabel: string;
  from: string | null; to: string | null;

  kpi: {
    accounts: number; activeUsers: number; neverIn: number; dormant: number;
    sessions: number; hours: number; avgSessionMin: number;
    logins: number; failed: number; records: number; pageViews: number;
  };

  daily: { d: string; users: number; hours: number; records: number }[];
  heat: { dow: number; hour: number; hours: number }[];
  devices: { kind: string; sessions: number; hours: number }[];
  modules: { module: string; hours: number; views: number; users: number }[];
  people: {
    email: string; name: string; role: string; zone: string;
    hours: number; sessions: number; days: number; records: number;
    clientsOwned: number; lastSeen: string | null;
    /** The same three buckets the Adoption tiles count, per person, so the
     *  table and the headline numbers cannot disagree about who is dormant. */
    state: 'never' | 'dormant' | 'active';
  }[];
  output: { label: string; n: number; per: string }[];
  funnel: { stage: string; n: number; value: number }[];
  attention: { label: string; n: number; detail: string; tone: 'neg' | 'warn' | 'ok' }[];
  actions: { action: string; n: number }[];
}

/** A window clause for a column, plus the filter clauses shared by every query.
 *  Exported so the KPI drill-downs answer for exactly the same population the
 *  tile counted — a popup listing a different set than the number above it is
 *  worse than no popup. */
export function clauses(f: OverallFilters, col: string, roleCol?: string, emailCol?: string) {
  const win = OVERALL_WINDOWS.find(w => w.id === f.win) ?? OVERALL_WINDOWS[1];
  const parts: string[] = [];
  if (win.days) parts.push(`${col} >= ${windowStartSql(win.days)}`);
  // Role and user are matched against the users table wherever the source table
  // does not carry them, which is why the caller says which columns it has.
  if (f.role && roleCol) parts.push(`${roleCol} = '${f.role.replace(/'/g, "''")}'`);
  if (f.user && emailCol) parts.push(`lower(${emailCol}) = lower('${f.user.replace(/'/g, "''")}')`);
  return { where: parts.length ? ' AND ' + parts.join(' AND ') : '', label: win.label, days: win.days };
}

export async function loadOverall(pool: Pool, f: OverallFilters): Promise<OverallData> {
  const act = clauses(f, 'p.occurred_at', 'p.role', 'p.user_email');
  const aud = clauses(f, 'al.created_at', 'al.actor_role', 'al.actor_email');
  const auth = clauses(f, 'a.created_at', 'a.role', 'a.email');

  const q = async <T>(sql: string, fallback: T): Promise<T> => {
    try { return (await pool.query(sql)).rows as T; } catch (e) {
      console.error('[audit/overall]', e); return fallback;
    }
  };

  // Everyone in scope, so "active" always has a denominator.
  const roleFilter = f.role ? ` AND u.role = '${f.role.replace(/'/g, "''")}'` : '';
  const userFilter = f.user ? ` AND lower(u.email) = lower('${f.user.replace(/'/g, "''")}')` : '';

  // The output and funnel tables record who did the work in three different
  // shapes — an email on `created_by`, a user id on `rep_id`, a user id on
  // `uploaded_by` — and none of them carry a role. Rather than a join per table,
  // resolve the filter to a set of people once and match against that. Without
  // this the tiles would show company-wide totals under a heading that says the
  // page is filtered to one person, which is the kind of number that ends up in
  // a review deck.
  let whoIds: string | null = null, whoEmails: string | null = null;
  if (f.role || f.user) {
    const { rows } = await pool.query<{ id: number; email: string }>(
      `SELECT u.id, lower(u.email) AS email FROM users u
        WHERE COALESCE(u.email,'') <> ''${roleFilter}${userFilter}`);
    whoIds = rows.length ? rows.map(r => Number(r.id)).join(',') : null;
    whoEmails = rows.length ? rows.map(r => `'${r.email.replace(/'/g, "''")}'`).join(',') : null;
  }
  /** Restrict to the filtered people by user-id column. */
  const byId = (col: string) => (f.role || f.user) ? (whoIds ? ` AND ${col} IN (${whoIds})` : ' AND FALSE') : '';
  /** Restrict to the filtered people by an email-bearing column. */
  const byEmail = (col: string) => (f.role || f.user) ? (whoEmails ? ` AND lower(${col}) IN (${whoEmails})` : ' AND FALSE') : '';

  const [kpiRows, daily, heat, devices, modules, people, output, funnel, actions, attention, span] = await Promise.all([
    q<{ [k: string]: string }[]>(`
      SELECT
        (SELECT count(*) FROM users u WHERE u.is_active AND COALESCE(u.email,'') <> ''${roleFilter}${userFilter}) AS accounts,
        (SELECT count(DISTINCT p.user_id) FROM page_activity p WHERE TRUE${act.where}) AS active_users,
        (SELECT count(DISTINCT p.session_id) FROM page_activity p WHERE TRUE${act.where}) AS sessions,
        (SELECT COALESCE(round(sum(p.active_seconds)/3600.0, 1), 0) FROM page_activity p WHERE TRUE${act.where}) AS hours,
        (SELECT count(*) FROM page_activity p WHERE TRUE${act.where}) AS page_views,
        (SELECT count(*) FROM auth_audit a WHERE a.event = 'login'${auth.where}) AS logins,
        (SELECT count(*) FROM auth_audit a WHERE a.event = 'login_failed'${auth.where}) AS failed,
        (SELECT count(*) FROM audit_log al WHERE TRUE${aud.where}) AS records,
        (SELECT count(*) FROM users u WHERE u.is_active AND COALESCE(u.email,'') <> ''${roleFilter}${userFilter}
           AND NOT EXISTS (SELECT 1 FROM auth_audit a2 WHERE lower(a2.email) = lower(u.email) AND a2.event = 'login')) AS never_in,
        (SELECT count(*) FROM users u WHERE u.is_active AND COALESCE(u.email,'') <> ''${roleFilter}${userFilter}
           AND EXISTS (SELECT 1 FROM auth_audit a2 WHERE lower(a2.email) = lower(u.email) AND a2.event = 'login')
           AND NOT EXISTS (SELECT 1 FROM page_activity p2 WHERE p2.user_id = u.id
                            AND p2.occurred_at >= NOW() - INTERVAL '30 days')) AS dormant`, []),

    // The daily curve. Records are joined in so a spike in time can be read
    // against whether anything came of it.
    q<{ d: string; users: string; hours: string; records: string }[]>(`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS d,
             COALESCE(pa.users, 0)::text AS users,
             COALESCE(pa.hours, 0)::text AS hours,
             COALESCE(ac.n, 0)::text AS records
        FROM (SELECT generate_series(
                COALESCE((SELECT min(p.occurred_at ${IST})::date FROM page_activity p WHERE TRUE${act.where}), CURRENT_DATE),
                CURRENT_DATE, '1 day')::date AS day) d
        LEFT JOIN (SELECT (p.occurred_at ${IST})::date AS day,
                          count(DISTINCT p.user_id) AS users,
                          round(sum(p.active_seconds)/3600.0, 1) AS hours
                     FROM page_activity p WHERE TRUE${act.where}
                    GROUP BY 1) pa ON pa.day = d.day
        LEFT JOIN (SELECT (al.created_at ${IST})::date AS day, count(*) AS n
                     FROM audit_log al WHERE TRUE${aud.where} GROUP BY 1) ac ON ac.day = d.day
       ORDER BY d.day`, []),

    // Hour by weekday. 0 = Sunday, matching EXTRACT(DOW).
    q<{ dow: string; hour: string; hours: string }[]>(`
      SELECT EXTRACT(DOW FROM p.occurred_at ${IST})::int::text AS dow,
             EXTRACT(HOUR FROM p.occurred_at ${IST})::int::text AS hour,
             round(sum(p.active_seconds)/3600.0, 2)::text AS hours
        FROM page_activity p WHERE TRUE${act.where}
       GROUP BY 1, 2`, []),

    // Mobile against desktop, read off the session's login user agent. Sessions
    // with no matching auth row are left out rather than guessed at.
    q<{ kind: string; sessions: string; hours: string }[]>(`
      WITH s AS (
        SELECT p.session_id, min(p.user_email) AS email,
               sum(p.active_seconds) AS secs, min(p.occurred_at) AS started
          FROM page_activity p WHERE TRUE${act.where} GROUP BY p.session_id)
      SELECT CASE WHEN a.user_agent ~* 'Mobile|Android|iPhone|iPad' THEN 'Mobile'
                  WHEN a.user_agent IS NULL THEN 'Unknown' ELSE 'Desktop' END AS kind,
             count(*)::text AS sessions,
             round(sum(s.secs)/3600.0, 1)::text AS hours
        FROM s
        LEFT JOIN LATERAL (
          SELECT a2.user_agent FROM auth_audit a2
           WHERE lower(a2.email) = lower(s.email) AND a2.created_at <= s.started
           ORDER BY a2.created_at DESC LIMIT 1) a ON TRUE
       GROUP BY 1 ORDER BY count(*) DESC`, []),

    // Where the time goes, by module rather than by path: /risansi/clients and
    // /risansi/clients/123 are the same job.
    q<{ module: string; hours: string; views: string; users: string }[]>(`
      SELECT COALESCE(NULLIF(split_part(regexp_replace(p.path, '^/risansi/?', ''), '/', 1), ''), 'Dashboard') AS module,
             round(sum(p.active_seconds)/3600.0, 1)::text AS hours,
             count(*)::text AS views,
             count(DISTINCT p.user_id)::text AS users
        FROM page_activity p WHERE TRUE${act.where}
       GROUP BY 1 HAVING sum(p.active_seconds) > 0 ORDER BY sum(p.active_seconds) DESC`, []),

    // Per person, with the size of their book alongside — the denominator that
    // turns "quiet" into "quiet across 740 clients".
    q<{ email: string; name: string; role: string; zone: string; hours: string; sessions: string;
        days: string; records: string; clients_owned: string; last_seen: string | null;
        state: 'never' | 'dormant' | 'active' }[]>(`
      SELECT u.email, u.name, u.role, COALESCE(u.zone,'') AS zone,
             COALESCE((SELECT round(sum(p.active_seconds)/3600.0,1) FROM page_activity p
                        WHERE p.user_id = u.id${act.where}),0)::text AS hours,
             COALESCE((SELECT count(DISTINCT p.session_id) FROM page_activity p
                        WHERE p.user_id = u.id${act.where}),0)::text AS sessions,
             COALESCE((SELECT count(DISTINCT (p.occurred_at ${IST})::date) FROM page_activity p
                        WHERE p.user_id = u.id${act.where}),0)::text AS days,
             COALESCE((SELECT count(*) FROM audit_log al
                        WHERE lower(al.actor_email) = lower(u.email)${aud.where}),0)::text AS records,
             (SELECT count(*) FROM clients c WHERE c.primary_rep_id = u.id AND c.deleted_at IS NULL)::text AS clients_owned,
             (SELECT max(p.occurred_at)::date::text FROM page_activity p WHERE p.user_id = u.id) AS last_seen,
             -- Word for word the rules behind the Never signed in and Dormant
             -- tiles above, so a row highlighted here is one of the people
             -- those tiles counted. Both are all-time regardless of the window
             -- filter: "has not been here in 30 days" is a fact about now, and
             -- narrowing the window would make everyone outside it look dormant.
             CASE
               WHEN NOT EXISTS (SELECT 1 FROM auth_audit a2
                                 WHERE lower(a2.email) = lower(u.email) AND a2.event = 'login') THEN 'never'
               WHEN NOT EXISTS (SELECT 1 FROM page_activity p2
                                 WHERE p2.user_id = u.id
                                   AND p2.occurred_at >= NOW() - INTERVAL '30 days') THEN 'dormant'
               ELSE 'active'
             END AS state
        FROM users u
       WHERE u.is_active AND COALESCE(u.email,'') <> ''${roleFilter}${userFilter}
       ORDER BY 5 DESC`, []),

    // What was actually produced in the window.
    q<{ label: string; n: string; per: string }[]>(`
      SELECT 'Visits logged' AS label, count(*)::text AS n, 'visits' AS per FROM visits v WHERE TRUE${clauses(f, 'v.created_at').where}${byId('v.rep_id')}
      UNION ALL SELECT 'Visit reports filed', count(*)::text, 'reports' FROM visits v WHERE v.submitted_at IS NOT NULL${clauses(f, 'v.submitted_at').where}${byId('v.rep_id')}
      UNION ALL SELECT 'Opportunities raised', count(*)::text, 'opportunities' FROM opportunities o WHERE TRUE${clauses(f, 'o.created_at').where}${byEmail('o.created_by')}
      UNION ALL SELECT 'Quotation documents', count(*)::text, 'documents' FROM opportunity_quotation_files qf WHERE TRUE${clauses(f, 'qf.uploaded_at').where}${byId('qf.uploaded_by')}
      UNION ALL SELECT 'Sales orders recorded', count(*)::text, 'orders' FROM opportunity_sales_orders so WHERE TRUE${clauses(f, 'so.created_at').where}${byEmail('so.created_by')}
      UNION ALL SELECT 'Clients added', count(*)::text, 'clients' FROM clients c WHERE TRUE${clauses(f, 'c.created_at').where}${byEmail('c.created_by')}
      UNION ALL SELECT 'Actions raised', count(*)::text, 'actions' FROM tasks t WHERE TRUE${clauses(f, 't.created_at').where}${byEmail('t.created_by')}
      UNION ALL SELECT 'Complaints raised', count(*)::text, 'complaints' FROM complaints cm WHERE TRUE${clauses(f, 'cm.created_at').where}${byEmail('cm.created_by')}`, []),

    // The funnel the opportunities raised in this window have reached SO FAR.
    // Deliberately their current stage rather than movements during the window:
    // this answers "what became of the work done then", which is the question a
    // sales head asks about a period after it has closed.
    q<{ stage: string; n: string; value: string }[]>(`
      SELECT o.stage, count(*)::text AS n,
             COALESCE(round(sum(COALESCE(o.offer_value_inr, o.value_cr*10000000, 0))),0)::text AS value
        FROM opportunities o WHERE TRUE${clauses(f, 'o.created_at').where}${byEmail('o.created_by')}
       GROUP BY 1`, []),

    q<{ action: string; n: string }[]>(`
      SELECT al.action, count(*)::text AS n FROM audit_log al
       WHERE TRUE${aud.where} GROUP BY 1
       -- ORDER BY count(*), not by the aliased text column: ordinal 2 sorts the
       -- cast string, which puts 'submit:83' above 'update:1688'.
       ORDER BY count(*) DESC LIMIT 10`, []),

    // Standing problems. Not windowed — they are true now regardless of period.
    q<{ label: string; n: string; detail: string; tone: string }[]>(`
      SELECT 'Clients with no owner' AS label,
             (SELECT count(*) FROM clients c WHERE c.deleted_at IS NULL AND c.primary_rep_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = c.id))::text AS n,
             'visible to admins only' AS detail, 'neg' AS tone
      UNION ALL SELECT 'Overdue actions',
             (SELECT count(*) FROM tasks t WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE)::text,
             'past their due date', 'warn'
      UNION ALL SELECT 'Open complaints',
             (SELECT count(*) FROM complaints WHERE status NOT IN ('Resolved','Closed'))::text,
             'unresolved', 'warn'
      UNION ALL SELECT 'Active clients never visited',
             (SELECT count(*) FROM clients c WHERE c.status='ACTIVE' AND c.deleted_at IS NULL AND c.last_visit_date IS NULL)::text,
             'no visit on record', 'warn'
      UNION ALL SELECT 'Opportunities quoted over 60 days',
             (SELECT count(*) FROM opportunities o WHERE o.stage IN ('Quoted','Negotiating')
               AND COALESCE(o.quote_date, o.created_at::date) < CURRENT_DATE - 60
               AND ${LIVE_CLIENT('o')})::text,
             'still open, no decision', 'warn'`, []),

    q<{ from: string | null; to: string | null }[]>(`
      SELECT min(p.occurred_at ${IST})::date::text AS from, max(p.occurred_at ${IST})::date::text AS to
        FROM page_activity p WHERE TRUE${act.where}`, []),
  ]);

  const k = kpiRows[0] ?? {};
  const n = (v: unknown) => Number(v ?? 0);
  const sessions = n(k.sessions), hours = n(k.hours);

  return {
    windowLabel: act.label,
    from: span[0]?.from ?? null, to: span[0]?.to ?? null,
    kpi: {
      accounts: n(k.accounts), activeUsers: n(k.active_users),
      neverIn: n(k.never_in), dormant: n(k.dormant),
      sessions, hours, avgSessionMin: sessions > 0 ? (hours * 60) / sessions : 0,
      logins: n(k.logins), failed: n(k.failed), records: n(k.records), pageViews: n(k.page_views),
    },
    daily: daily.map(r => ({ d: r.d, users: n(r.users), hours: n(r.hours), records: n(r.records) })),
    heat: heat.map(r => ({ dow: n(r.dow), hour: n(r.hour), hours: n(r.hours) })),
    devices: devices.map(r => ({ kind: r.kind, sessions: n(r.sessions), hours: n(r.hours) })),
    modules: modules.map(r => ({ module: r.module, hours: n(r.hours), views: n(r.views), users: n(r.users) })),
    people: people.map(r => ({
      email: r.email, name: r.name, role: r.role, zone: r.zone,
      hours: n(r.hours), sessions: n(r.sessions), days: n(r.days), records: n(r.records),
      clientsOwned: n(r.clients_owned), lastSeen: r.last_seen, state: r.state,
    })),
    output: output.map(r => ({ label: r.label, n: n(r.n), per: r.per })),
    funnel: funnel.map(r => ({ stage: r.stage, n: n(r.n), value: n(r.value) })),
    attention: attention.map(r => ({ label: r.label, n: n(r.n), detail: r.detail, tone: r.tone as 'neg' | 'warn' | 'ok' })),
    actions: actions.map(r => ({ action: r.action, n: n(r.n) })),
  };
}
