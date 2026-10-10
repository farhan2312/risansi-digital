// One row per active user, every metric the portal can attribute to a person.
//
// Shared by the adoption workbook (lib/risansi-adoption-report.ts) and the
// individual PDF (app/print/portal-usage). Both are answers to the same
// management question, so they read from one query: a workbook and a handout
// that disagree about how many visits somebody logged is worse than either one
// alone.
//
// Two things worth knowing before quoting these numbers:
//
//   * Active time is measured, not inferred. page_activity records seconds a
//     page was actually in focus, so an hour is an hour of use rather than a tab
//     left open over lunch.
//   * Admin and sysadmin numbers are not comparable with a rep's. They are doing
//     data administration — uploads, corrections, client master work — which is
//     why the comparisons below are drawn within a role rather than across all.
import type { Pool } from 'pg';
import { windowStartSql } from '@/lib/risansi-audit-overall';

export interface PersonRow {
  id: number; name: string; email: string; role: string; zone: string;
  logins: number; login_failed: number; last_login: string | null;
  sessions: number; days_active: number; hours: number; page_views: number;
  first_seen: string | null; top_path: string | null;
  clients_owned: number; clients_covered: number; clients_in_view: number;
  visits_owned: number; visits_done: number; reports_filed: number;
  opps_created: number; stage_moves: number; quotes_uploaded: number;
  sales_orders: number; clients_created: number;
  actions_raised: number; actions_done: number;
  complaints_raised: number; exhibition_meetings: number; audited_actions: number;
}

/** Windows the individual report offers, in whole IST calendar days ending today; `null` is all time. */
export const PERSON_WINDOWS = [
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: '180d', label: 'Last 6 months', days: 182 },
  { id: 'all', label: 'All time', days: null },
] as const;

/**
 * Every active user with every metric.
 *
 * `days` is the window applied to the EVENT counts — time in the app, sign-ins,
 * and everything they recorded — as whole IST calendar days ending today, so
 * "days active" can never exceed it (a rolling 30×24h window spans 31 dates).
 * It is deliberately NOT applied to the client-book columns: how many clients
 * somebody is responsible for is a fact about today, not a thing that happened
 * in the last 30 days, and windowing it would make the denominator move with
 * the numerator.
 */
export async function loadPersonMetrics(pool: Pool, days: number | null = null): Promise<PersonRow[]> {
  // A window clause for one column, or nothing at all when the report is
  // all-time. The number is from PERSON_WINDOWS, never from user input.
  const w = (col: string) => (days ? ` AND ${col} >= ${windowStartSql(days)}` : '');

  // One row per active user. Every count is a scalar subquery keyed on the user
  // rather than a pile of joins: a user with 300 page views and 40 visits would
  // otherwise multiply out and report 12,000 of each.
  const { rows } = await pool.query<PersonRow>(`
    SELECT
      u.id, u.name, COALESCE(u.email,'') AS email, u.role, COALESCE(u.zone,'') AS zone,

      -- Signing in
      (SELECT count(*)::int FROM auth_audit a WHERE lower(a.email) = lower(u.email) AND a.event = 'login'${w('a.created_at')}) AS logins,
      (SELECT count(*)::int FROM auth_audit a WHERE lower(a.email) = lower(u.email) AND a.event = 'login_failed'${w('a.created_at')}) AS login_failed,
      -- Not windowed: "when did they last sign in" is the question, and a window
      -- would answer it with a blank for exactly the people it is asked about.
      (SELECT max(a.created_at)::date::text FROM auth_audit a WHERE lower(a.email) = lower(u.email) AND a.event = 'login') AS last_login,

      -- Being there
      (SELECT count(DISTINCT p.session_id)::int FROM page_activity p WHERE p.user_id = u.id${w('p.occurred_at')}) AS sessions,
      (SELECT count(DISTINCT p.occurred_at::date)::int FROM page_activity p WHERE p.user_id = u.id${w('p.occurred_at')}) AS days_active,
      (SELECT COALESCE(round(sum(p.active_seconds)/3600.0, 1), 0) FROM page_activity p WHERE p.user_id = u.id${w('p.occurred_at')}) AS hours,
      (SELECT count(*)::int FROM page_activity p WHERE p.user_id = u.id${w('p.occurred_at')}) AS page_views,
      (SELECT min(p.occurred_at)::date::text FROM page_activity p WHERE p.user_id = u.id) AS first_seen,
      (SELECT p.path FROM page_activity p WHERE p.user_id = u.id${w('p.occurred_at')}
        GROUP BY p.path ORDER BY sum(p.active_seconds) DESC NULLS LAST LIMIT 1) AS top_path,

      -- The book they are responsible for. Without it every activity figure is a
      -- numerator with no denominator: twelve visits means something different
      -- against 274 clients than against nine.
      (SELECT count(*)::int FROM clients cl
        WHERE cl.primary_rep_id = u.id AND cl.deleted_at IS NULL) AS clients_owned,
      (SELECT count(*)::int FROM client_secondary_reps sr
         JOIN clients cl ON cl.id = sr.client_id AND cl.deleted_at IS NULL
        WHERE sr.rep_id = u.id) AS clients_covered,
      -- Everything they can actually see, which for a manager is their team's book
      -- as well as their own. Same rule as clientRuleSql in lib/risansi-auth.ts, so
      -- this column and the application agree about what "their clients" means.
      (SELECT count(*)::int FROM clients cl
        WHERE cl.deleted_at IS NULL
          AND (cl.primary_rep_id = u.id
               OR cl.primary_rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = u.id)
               OR cl.id IN (SELECT sr.client_id FROM client_secondary_reps sr
                             WHERE sr.rep_id = u.id
                                OR sr.rep_id IN (SELECT rep_id FROM manager_reps WHERE manager_id = u.id)))
      ) AS clients_in_view,

      -- Doing things
      (SELECT count(*)::int FROM visits v WHERE v.rep_id = u.id${w('v.created_at')}) AS visits_owned,
      (SELECT count(*)::int FROM visits v WHERE v.rep_id = u.id AND v.status = 'completed'${w('v.created_at')}) AS visits_done,
      (SELECT count(*)::int FROM visits v WHERE v.rep_id = u.id AND v.submitted_at IS NOT NULL${w('v.submitted_at')}) AS reports_filed,
      (SELECT count(*)::int FROM opportunities o WHERE lower(COALESCE(o.created_by,'')) = lower(u.email)${w('o.created_at')}) AS opps_created,
      (SELECT count(*)::int FROM opportunity_stage_log l WHERE lower(COALESCE(l.changed_by,'')) = lower(u.email)${w('l.changed_at')}) AS stage_moves,
      -- uploaded_by is a user id here, unlike the created_by columns around it
      -- which all hold emails.
      (SELECT count(*)::int FROM opportunity_quotation_files f WHERE f.uploaded_by = u.id${w('f.uploaded_at')}) AS quotes_uploaded,
      (SELECT count(*)::int FROM opportunity_sales_orders s WHERE lower(COALESCE(s.created_by,'')) = lower(u.email)${w('s.created_at')}) AS sales_orders,
      (SELECT count(*)::int FROM clients cl WHERE lower(COALESCE(cl.created_by,'')) = lower(u.email)${w('cl.created_at')}) AS clients_created,
      (SELECT count(*)::int FROM tasks t WHERE lower(COALESCE(t.created_by,'')) = lower(u.email)${w('t.created_at')}) AS actions_raised,
      -- Closed by them, dated by when it was closed rather than when it was raised.
      (SELECT count(*)::int FROM tasks t WHERE t.assigned_to_rep = u.id AND t.status = 'completed'${w("COALESCE(t.completed_at, t.updated_at, t.created_at)")}) AS actions_done,
      (SELECT count(*)::int FROM complaints cm WHERE lower(COALESCE(cm.created_by,'')) = lower(u.email)${w('cm.created_at')}) AS complaints_raised,
      (SELECT count(*)::int FROM exhibition_meetings em WHERE em.met_by = u.id${w('em.created_at')}) AS exhibition_meetings,

      -- Everything the audit log attributes to them, as one number
      (SELECT count(*)::int FROM audit_log al WHERE lower(COALESCE(al.actor_email,'')) = lower(u.email)${w('al.created_at')}) AS audited_actions
    FROM users u
    WHERE u.is_active = TRUE AND COALESCE(u.email,'') <> ''
    ORDER BY u.role DESC, u.name`);

  return rows.map(r => ({ ...r, hours: Number(r.hours ?? 0) }));
}

// ── the comparison ────────────────────────────────────────────────

export interface MetricDef {
  key: string;
  label: string;
  group: string;
  /** Read from the row, so derived figures sit in the same list as raw counts. */
  get: (r: PersonRow) => number;
  /** Decimal places when shown. */
  dp?: number;
  /** A word for the unit, appended in the PDF where it helps. */
  unit?: string;
  /** False where more is not obviously better, so the report does not imply it. */
  better?: 'more' | 'neutral';
  hint?: string;
}

const per = (a: number, b: number) => (b > 0 ? a / b : 0);

/**
 * Every metric the individual report compares, in reading order.
 *
 * Derived rows sit alongside the raw counts because they are the ones that
 * survive a difference in book size: "visits per 10 clients" says something
 * about a rep with 274 clients and a rep with 9 that "visits" cannot.
 */
export const METRIC_DEFS: MetricDef[] = [
  { group: 'Time in the app', key: 'hours', label: 'Active hours', get: r => r.hours, dp: 1, hint: 'seconds the page was actually in focus, summed' },
  { group: 'Time in the app', key: 'days_active', label: 'Days active', get: r => r.days_active },
  { group: 'Time in the app', key: 'sessions', label: 'Sessions', get: r => r.sessions },
  { group: 'Time in the app', key: 'avg_session', label: 'Average session', get: r => per(r.hours * 60, r.sessions), dp: 0, unit: 'min', better: 'neutral' },
  { group: 'Time in the app', key: 'hours_per_day', label: 'Hours per active day', get: r => per(r.hours, r.days_active), dp: 1, better: 'neutral' },
  { group: 'Time in the app', key: 'page_views', label: 'Pages viewed', get: r => r.page_views },
  { group: 'Time in the app', key: 'logins', label: 'Sign-ins', get: r => r.logins },

  { group: 'The book', key: 'clients_owned', label: 'Clients owned', get: r => r.clients_owned, better: 'neutral', hint: 'primary rep · as it stands today, not windowed' },
  { group: 'The book', key: 'clients_covered', label: 'Clients covered', get: r => r.clients_covered, better: 'neutral', hint: 'secondary rep' },
  { group: 'The book', key: 'clients_in_view', label: 'Clients visible', get: r => r.clients_in_view, better: 'neutral', hint: 'own, covered, and for a manager the team book' },

  { group: 'Field work', key: 'visits_owned', label: 'Visits logged', get: r => r.visits_owned },
  { group: 'Field work', key: 'visits_done', label: 'Visits completed', get: r => r.visits_done },
  { group: 'Field work', key: 'reports_filed', label: 'Visit reports filed', get: r => r.reports_filed },
  { group: 'Field work', key: 'visits_per_10', label: 'Visits per 10 clients owned', get: r => per(r.visits_owned * 10, r.clients_owned), dp: 1, hint: 'the figure that survives a difference in book size' },

  { group: 'Pipeline', key: 'opps_created', label: 'Opportunities raised', get: r => r.opps_created },
  { group: 'Pipeline', key: 'stage_moves', label: 'Stage moves recorded', get: r => r.stage_moves },
  { group: 'Pipeline', key: 'quotes_uploaded', label: 'Quotation documents uploaded', get: r => r.quotes_uploaded },
  { group: 'Pipeline', key: 'sales_orders', label: 'Sales orders recorded', get: r => r.sales_orders },

  { group: 'Everything else recorded', key: 'clients_created', label: 'Clients added', get: r => r.clients_created },
  { group: 'Everything else recorded', key: 'actions_raised', label: 'Actions raised', get: r => r.actions_raised },
  { group: 'Everything else recorded', key: 'actions_done', label: 'Actions completed', get: r => r.actions_done },
  { group: 'Everything else recorded', key: 'complaints_raised', label: 'Complaints raised', get: r => r.complaints_raised, better: 'neutral' },
  { group: 'Everything else recorded', key: 'exhibition_meetings', label: 'Exhibition meetings', get: r => r.exhibition_meetings },
  { group: 'Everything else recorded', key: 'audited_actions', label: 'Recorded actions, all types', get: r => r.audited_actions, hint: 'everything the audit log attributes to them' },
  { group: 'Everything else recorded', key: 'records_per_hour', label: 'Records per active hour', get: r => per(r.audited_actions, r.hours), dp: 1, better: 'neutral', hint: 'output against time spent' },
];

export interface MetricComparison extends MetricDef {
  value: number;
  avg: number;
  /** Shown next to the average because the two disagreeing is the finding: a
   *  mean well above the median means one person is carrying the cohort. */
  median: number;
  best: number;
  /** 1 = highest in the cohort. Ties share a rank. */
  rank: number;
  /** value − avg, as a share of avg. Null when the cohort average is zero. */
  vsAvg: number | null;
  /** False when nobody in the cohort has any of this. Ranking ten people who
   *  all scored zero and calling the first one top is a number that means
   *  nothing, so the report prints a dash instead. */
  applicable: boolean;
}

/**
 * Compare one person against a cohort, metric by metric.
 *
 * The cohort is passed in rather than derived here so the caller decides what a
 * fair comparison is — a rep against reps, not against a sysadmin who spends the
 * day on data uploads.
 */
export function comparePerson(subject: PersonRow, cohort: PersonRow[]): MetricComparison[] {
  const pool = cohort.length ? cohort : [subject];
  return METRIC_DEFS.map(def => {
    const values = pool.map(def.get);
    const value = def.get(subject);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const best = Math.max(...values);
    // Ties share a rank: two people on 14 visits are both second, and calling
    // one of them third would be an artefact of the sort order.
    const rank = values.filter(v => v > value).length + 1;
    return {
      ...def, value, avg, median, best, rank,
      vsAvg: avg > 0 ? (value - avg) / avg : null,
      applicable: best > 0 || value > 0,
    };
  });
}

/**
 * The people a person should be measured against: same role, active accounts.
 *
 * Reps are compared with reps. An admin's day is data administration and a
 * rep's is selling, so putting them in one ranking would tell you about their
 * job titles rather than about their work.
 */
export function cohortFor(subject: PersonRow, all: PersonRow[]): { rows: PersonRow[]; label: string } {
  const rows = all.filter(r => r.role === subject.role);
  const label = `${rows.length} ${subject.role}${rows.length === 1 ? '' : 's'}`;
  return { rows, label };
}
