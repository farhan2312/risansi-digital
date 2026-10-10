'use server';

// Click a number on the Audit Log's Overall tab, see what it is made of.
//
// Every tile on that page is a count of something nameable — people, clients,
// actions — and a count nobody can open is a number you either trust or ignore.
// The rows are fetched on click rather than with the page: the tab already runs
// a dozen aggregates, and a reader opens at most one or two of these.
//
// Each kind reuses the same window/role/user clauses the tile itself used, so
// the popup can never list a different population than the number above it.
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { clauses, type OverallFilters } from '@/lib/risansi-audit-overall';
import { LIVE_CLIENT } from '@/lib/risansi-opportunity-scope';

export type DrillKind =
  | 'accounts' | 'active' | 'never' | 'dormant'
  | 'sessions' | 'hours' | 'records' | 'pageviews' | 'logins' | 'failed'
  | 'unowned' | 'overdue' | 'complaints' | 'unvisited' | 'stale_quotes';

export interface AuditDrillRow {
  /** Person's name, or the client / record this row is about. */
  label: string;
  /** Role and zone for a person; code, owner or due date for a record. */
  meta: string;
  /** The figure this row contributes, already formatted. Blank where the row
   *  IS the whole contribution (a person who has never signed in counts once). */
  value: string;
  /** Client 360 link where the row is a client. */
  href?: string;
}

export interface AuditDrillResult {
  title: string;
  note: string;
  rows: AuditDrillRow[];
  /** True when the list was cut off at the cap. Deliberately not a count of the
   *  remainder: getting one would mean a second aggregate for a number the tile
   *  the reader just clicked is already showing them. */
  capped: boolean;
}

const LIMIT = 300;

const PEOPLE: Record<string, { title: string; note: string }> = {
  accounts: { title: 'Active accounts', note: 'everyone who can sign in' },
  active:   { title: 'Active users', note: 'recorded time in the app during this period' },
  never:    { title: 'Never signed in', note: 'an account exists but has never been used' },
  dormant:  { title: 'Dormant', note: 'signed in at least once, nothing in the last 30 days' },
  sessions: { title: 'Sessions', note: 'distinct sessions in this period, by person' },
  hours:    { title: 'Active hours', note: 'seconds the page was in focus, summed, by person' },
  records:  { title: 'Records touched', note: 'created, edited, submitted or deleted, by person' },
  pageviews:{ title: 'Page views', note: 'screens opened in this period, by person' },
  logins:   { title: 'Sign-ins', note: 'successful sign-ins in this period, by person' },
  failed:   { title: 'Failed sign-ins', note: 'rejected attempts in this period, by address' },
};

export async function auditDrilldown(
  kind: DrillKind, f: OverallFilters,
): Promise<AuditDrillResult | null> {
  // Same gate as the page this is opened from.
  const me = await getCurrentUser();
  if (me.role !== 'sysadmin') return null;

  const act = clauses(f, 'p.occurred_at', 'p.role', 'p.user_email');
  const aud = clauses(f, 'al.created_at', 'al.actor_role', 'al.actor_email');
  const auth = clauses(f, 'a.created_at', 'a.role', 'a.email');
  const roleFilter = f.role ? ` AND u.role = '${f.role.replace(/'/g, "''")}'` : '';
  const userFilter = f.user ? ` AND lower(u.email) = lower('${f.user.replace(/'/g, "''")}')` : '';
  const who = `u.is_active AND COALESCE(u.email,'') <> ''${roleFilter}${userFilter}`;

  const q = async (sql: string): Promise<Record<string, string | null>[]> => {
    try { return (await risansiPool.query(sql)).rows as Record<string, string | null>[]; }
    catch (e) { console.error('[audit/drilldown]', kind, e); return []; }
  };

  // ── people ──────────────────────────────────────────────────────
  if (kind in PEOPLE) {
    const meta = PEOPLE[kind];
    let sql: string;

    if (kind === 'failed') {
      // Keyed on the address attempted, not on a user: a failed sign-in for an
      // address with no account is exactly the row worth seeing here.
      sql = `SELECT lower(a.email) AS label,
                    COALESCE(max(a.reason), '') AS meta,
                    count(*)::text AS value
               FROM auth_audit a WHERE a.event = 'login_failed'${auth.where}
              GROUP BY 1 ORDER BY count(*) DESC LIMIT ${LIMIT + 1}`;
    } else {
      // One expression per kind, over the same population the tile counted.
      const measure = ({
        accounts:  `''`,
        never:     `''`,
        dormant:   `COALESCE((SELECT max(p.occurred_at)::date::text FROM page_activity p WHERE p.user_id = u.id), 'never')`,
        active:    `COALESCE((SELECT round(sum(p.active_seconds)/3600.0,1)::text FROM page_activity p WHERE p.user_id = u.id${act.where}), '0') || 'h'`,
        sessions:  `COALESCE((SELECT count(DISTINCT p.session_id)::text FROM page_activity p WHERE p.user_id = u.id${act.where}), '0')`,
        hours:     `COALESCE((SELECT round(sum(p.active_seconds)/3600.0,1)::text FROM page_activity p WHERE p.user_id = u.id${act.where}), '0') || 'h'`,
        pageviews: `COALESCE((SELECT count(*)::text FROM page_activity p WHERE p.user_id = u.id${act.where}), '0')`,
        records:   `COALESCE((SELECT count(*)::text FROM audit_log al WHERE lower(al.actor_email) = lower(u.email)${aud.where}), '0')`,
        logins:    `COALESCE((SELECT count(*)::text FROM auth_audit a WHERE lower(a.email) = lower(u.email) AND a.event = 'login'${auth.where}), '0')`,
      } as Record<string, string>)[kind];

      // The rule that decides who appears, matching the tile exactly.
      const having = ({
        accounts: 'TRUE',
        active:   `EXISTS (SELECT 1 FROM page_activity p WHERE p.user_id = u.id${act.where})`,
        never:    `NOT EXISTS (SELECT 1 FROM auth_audit a2 WHERE lower(a2.email) = lower(u.email) AND a2.event = 'login')`,
        dormant:  `EXISTS (SELECT 1 FROM auth_audit a2 WHERE lower(a2.email) = lower(u.email) AND a2.event = 'login')
                   AND NOT EXISTS (SELECT 1 FROM page_activity p2 WHERE p2.user_id = u.id
                                    AND p2.occurred_at >= NOW() - INTERVAL '30 days')`,
        sessions:  `EXISTS (SELECT 1 FROM page_activity p WHERE p.user_id = u.id${act.where})`,
        hours:     `EXISTS (SELECT 1 FROM page_activity p WHERE p.user_id = u.id${act.where})`,
        pageviews: `EXISTS (SELECT 1 FROM page_activity p WHERE p.user_id = u.id${act.where})`,
        records:   `EXISTS (SELECT 1 FROM audit_log al WHERE lower(al.actor_email) = lower(u.email)${aud.where})`,
        logins:    `EXISTS (SELECT 1 FROM auth_audit a WHERE lower(a.email) = lower(u.email) AND a.event = 'login'${auth.where})`,
      } as Record<string, string>)[kind];

      // Sorted by the figure where there is one, by name where there is not —
      // a list of people who never signed in has no order but alphabetical.
      const order = ['accounts', 'never'].includes(kind)
        ? 'u.name'
        : kind === 'dormant' ? '3, u.name'
        : `NULLIF(regexp_replace(${measure}, '[^0-9.]', '', 'g'), '')::numeric DESC NULLS LAST`;

      sql = `SELECT u.name AS label,
                    u.role || CASE WHEN COALESCE(u.zone,'') <> '' THEN ' · ' || u.zone ELSE '' END AS meta,
                    ${measure} AS value
               FROM users u WHERE ${who} AND (${having})
              ORDER BY ${order} LIMIT ${LIMIT + 1}`;
    }

    const rows = await q(sql);
    return {
      title: meta.title, note: meta.note,
      rows: rows.slice(0, LIMIT).map(r => ({
        label: r.label ?? '—', meta: r.meta ?? '', value: r.value ?? '',
      })),
      capped: rows.length > LIMIT,
    };
  }

  // ── the standing problems ───────────────────────────────────────
  // Not windowed, exactly as the tiles are not: these are true now.
  const STANDING: Record<string, { title: string; note: string; sql: string }> = {
    unowned: {
      title: 'Clients with no owner', note: 'no primary rep and nobody covering',
      sql: `SELECT c.legal_name AS label, c.code AS meta, '' AS value, c.id::text AS id
              FROM clients c
             WHERE c.deleted_at IS NULL AND c.primary_rep_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM client_secondary_reps s WHERE s.client_id = c.id)
             ORDER BY c.legal_name LIMIT ${LIMIT + 1}`,
    },
    overdue: {
      title: 'Overdue actions', note: 'past their due date and not completed',
      sql: `SELECT t.title AS label,
                   COALESCE(c.legal_name, '—') || ' · ' || COALESCE(u.name, 'unassigned') AS meta,
                   'due ' || t.due_date::text AS value, c.id::text AS id
              FROM tasks t
              LEFT JOIN clients c ON c.id = t.client_id
              LEFT JOIN users u ON u.id = t.assigned_to_rep
             WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE
             ORDER BY t.due_date LIMIT ${LIMIT + 1}`,
    },
    complaints: {
      title: 'Open complaints', note: 'not resolved and not closed',
      sql: `SELECT COALESCE(NULLIF(cm.complaint_no,''), 'Complaint #' || cm.id) AS label,
                   COALESCE(c.legal_name, '—')
                     || COALESCE(' · ' || NULLIF(left(cm.details, 60), ''), '') AS meta,
                   cm.status AS value, c.id::text AS id
              FROM complaints cm LEFT JOIN clients c ON c.id = cm.client_id
             WHERE cm.status NOT IN ('Resolved','Closed')
             ORDER BY cm.created_at DESC LIMIT ${LIMIT + 1}`,
    },
    unvisited: {
      title: 'Active clients never visited', note: 'status ACTIVE with no visit on record',
      sql: `SELECT c.legal_name AS label,
                   c.code || COALESCE(' · ' || u.name, '') AS meta,
                   '' AS value, c.id::text AS id
              FROM clients c LEFT JOIN users u ON u.id = c.primary_rep_id
             WHERE c.status = 'ACTIVE' AND c.deleted_at IS NULL AND c.last_visit_date IS NULL
             ORDER BY c.legal_name LIMIT ${LIMIT + 1}`,
    },
    stale_quotes: {
      title: 'Opportunities quoted over 60 days', note: 'still Quoted or Negotiating, no decision',
      sql: `SELECT COALESCE(NULLIF(o.product,''), 'Opportunity #' || o.id) AS label,
                   COALESCE(c.legal_name, '—') || ' · ' || o.stage AS meta,
                   COALESCE(o.quote_date, o.created_at::date)::text AS value, c.id::text AS id
              FROM opportunities o LEFT JOIN clients c ON c.id = o.client_id
             WHERE o.stage IN ('Quoted','Negotiating')
               AND COALESCE(o.quote_date, o.created_at::date) < CURRENT_DATE - 60
               AND ${LIVE_CLIENT('o')}
             ORDER BY COALESCE(o.quote_date, o.created_at::date) LIMIT ${LIMIT + 1}`,
    },
  };

  const std = STANDING[kind];
  if (!std) return null;
  const rows = await q(std.sql);
  return {
    title: std.title, note: std.note,
    rows: rows.slice(0, LIMIT).map(r => ({
      label: r.label ?? '—', meta: r.meta ?? '', value: r.value ?? '',
      href: r.id ? `/risansi/clients/${r.id}` : undefined,
    })),
    capped: rows.length > LIMIT,
  };
}
