import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Topbar, Tag, SortableTH } from '@/components/risansi';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { AccessDenied } from '../_components/AccessDenied';
import { AuditOverall } from '@/components/risansi/AuditOverall';
import {
  UsageUsersTable, UsagePagesTable, UsageSessionsTable,
  type UsageUserRow, type UsagePageRow, type UsageSessionRow,
} from '@/components/risansi/AuditTables';
import { MobileSortUrl } from '@/components/risansi/MobileSort';
import type { SortKind } from '@/lib/risansi-table-sort';
import { loadOverall, OVERALL_WINDOWS, type OverallData } from '@/lib/risansi-audit-overall';
import { PERSON_WINDOWS } from '@/lib/risansi-person-metrics';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) { console.error('[admin/audit]', err); return fallback; }
}

interface ExhibitionAuditRow {
  created_at: string; kind: string; exhibition: string; what: string | null;
  detail: string | null; who: string; who_role: string | null;
  amount: number | null; existing_client: boolean | null;
}

type Tab = 'overall' | 'usage' | 'logins' | 'activity' | 'changes' | 'exhibitions';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overall',  label: 'Overall' },
  { id: 'usage',    label: 'Usage & Time' },
  { id: 'logins',   label: 'Logins & Sessions' },
  { id: 'activity', label: 'Activity' },
  { id: 'changes',  label: 'Ownership Changes' },
  { id: 'exhibitions', label: 'Exhibitions' },
];

// Time windows for the Usage tab.
const WINDOWS: { id: string; label: string; interval: string | null }[] = [
  { id: '1d',  label: 'Today',   interval: '1 day' },
  { id: '7d',  label: '7 days',  interval: '7 days' },
  { id: '30d', label: '30 days', interval: '30 days' },
  { id: 'all', label: 'All',     interval: null },
];

// Friendly labels for normalised page paths (ActivityTracker stores :id paths).
const PAGE_LABELS: Record<string, string> = {
  '/risansi': 'Dashboard',
  '/risansi/clients': 'Client 360 · list',
  '/risansi/clients/:id': 'Client 360 · detail',
  '/risansi/field': 'Field Activity',
  '/risansi/revenue': 'Revenue',
  '/risansi/pipeline': 'Opportunities',
  '/risansi/compete': 'Competition',
  '/risansi/complaints': 'Complaints',
  '/risansi/visits/:id': 'Visit detail',
  '/risansi/mobile': 'Mobile dashboard',
  '/risansi/admin/reps': 'Reps & Managers',
  '/risansi/admin/clients': 'Client Master',
  '/risansi/admin/revenue': 'Revenue Upload',
  '/risansi/admin/audit': 'Audit Log',
  '/risansi/admin/settings': 'Settings',
  '/admin': 'Users & Access',
};
function pageLabel(path: string): string { return PAGE_LABELS[path] ?? path; }

const LOGIN_EVENTS = ['login', 'login_failed', 'logout', 'password_changed'];
const ACTIVITY_ACTIONS = ['create', 'update', 'delete', 'submit', 'assign', 'export', 'activity'];

// ── Sorting ─────────────────────────────────────────────────────
//
// Every table on this page below the Overall and Usage tabs is one page of a
// much longer trail — fifty rows out of tens of thousands. So the sort has to
// happen in SQL. Reordering the fifty rows in the browser would reorder the
// page and nothing else, and a column clicked to find the earliest sign-in
// would answer with the earliest of the fifty it happens to be showing.
//
// The clicked key never reaches the query. It is looked up in the map for the
// tab being shown, and anything unmapped falls back to the tab's own default
// order, which is also what an unsorted table gets.
const SORT_MAPS: Record<string, Record<string, string>> = {
  logins: {
    when: 'created_at', event: 'event', user: 'lower(email)', role: 'role',
    ip: 'ip', device: 'user_agent', reason: 'reason',
  },
  activity: {
    when: 'created_at', actor: 'lower(actor_email)', action: 'action',
    entity: 'entity_type', what: 'COALESCE(summary, entity_label)', ip: 'ip',
  },
  changes: {
    when: 'changed_at', entity: 'entity_type', id: 'entity_id',
    action: 'action', by: 'lower(changed_by)',
  },
  exhibitions: {
    when: 'created_at', kind: 'kind', exhibition: 'lower(exhibition)',
    what: 'lower(what)', who: 'lower(who)', amount: 'amount',
  },
};

// What each tab's phone sort menu offers, and which way each column opens.
// These tables are cards on a handset with no header row to tap, so without
// this they are fixed in their default order there. Every key is a key of that
// tab's SORT_MAPS entry — anything else is dropped by the lookup in
// orderByFor() and the tap would appear to do nothing.
const MOBILE_SORTS: Record<string, { options: { key: string; label: string }[]; kinds: Record<string, SortKind> }> = {
  logins: {
    options: [
      { key: 'when',   label: 'When' },
      { key: 'event',  label: 'Event' },
      { key: 'user',   label: 'User' },
      { key: 'role',   label: 'Role' },
      { key: 'ip',     label: 'IP address' },
      { key: 'device', label: 'Device' },
      { key: 'reason', label: 'Reason' },
    ],
    kinds: {
      when: 'date', event: 'text', user: 'text', role: 'text',
      ip: 'text', device: 'text', reason: 'text',
    },
  },
  activity: {
    options: [
      { key: 'when',   label: 'When' },
      { key: 'actor',  label: 'Actor' },
      { key: 'action', label: 'Action' },
      { key: 'entity', label: 'Entity' },
      { key: 'what',   label: 'What' },
      { key: 'ip',     label: 'IP address' },
    ],
    kinds: {
      when: 'date', actor: 'text', action: 'text',
      entity: 'text', what: 'text', ip: 'text',
    },
  },
  changes: {
    options: [
      { key: 'when',   label: 'When' },
      { key: 'entity', label: 'Entity' },
      { key: 'id',     label: 'Record ID' },
      { key: 'action', label: 'Action' },
      { key: 'by',     label: 'Changed by' },
    ],
    kinds: { when: 'date', entity: 'text', id: 'text', action: 'text', by: 'text' },
  },
};

/**
 * The ORDER BY for a tab. NULLS LAST on both directions: Postgres puts nulls
 * first on a DESC sort, so a descending Amount would open on a screenful of
 * approvals carrying no money and bury the largest figures underneath them.
 */
function orderByFor(tab: string, key: string, dir: 'ASC' | 'DESC', fallback: string): string {
  const col = SORT_MAPS[tab]?.[key];
  return col ? `ORDER BY ${col} ${dir} NULLS LAST` : fallback;
}

interface LoginRow { id: number; event: string; email: string | null; role: string | null; ip: string | null; user_agent: string | null; reason: string | null; created_at: string; }
interface ActivityRow { id: number; actor_email: string | null; actor_role: string | null; action: string; entity_type: string | null; entity_id: string | null; entity_label: string | null; summary: string | null; ip: string | null; created_at: string; }
interface ChangeRow { id: number; entity_type: string; entity_id: string; action: string; old_value: unknown; new_value: unknown; changed_by: string | null; changed_at: string; }
interface UsageUser { email: string; role: string | null; total: number; sessions: number; pages: number; last_active: string; }
interface UsagePage { path: string; total: number; hits: number; last: string; }
interface UsageSession { session_id: string; started: string; ended: string; active: number; }

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const me = await getCurrentUser();
  if (me.role !== 'sysadmin') {
    return <AccessDenied crumbs={['System Admin', 'Audit Log']} />;
  }

  const sp = await searchParams;
  const tab: Tab = (typeof sp.tab === 'string' && TABS.some(t => t.id === sp.tab) ? sp.tab : 'overall') as Tab;
  const win = typeof sp.win === 'string' && WINDOWS.some(w => w.id === sp.win) ? sp.win : '7d';
  const winInterval = WINDOWS.find(w => w.id === win)?.interval ?? null;
  const winClause = winInterval ? `AND occurred_at >= NOW() - INTERVAL '${winInterval}'` : '';
  const selUser = typeof sp.user === 'string' ? sp.user.trim().toLowerCase() : '';
  const ovWin = typeof sp.win === 'string' && OVERALL_WINDOWS.some(w => w.id === sp.win) ? sp.win : '30d';
  const ovRole = typeof sp.role === 'string' && ['rep', 'manager', 'admin', 'sysadmin'].includes(sp.role) ? sp.role : '';
  const qStr = typeof sp.q === 'string' ? sp.q.trim() : '';
  const evt  = typeof sp.event === 'string' ? sp.event : '';
  const act  = typeof sp.action === 'string' ? sp.action : '';
  const pageNum = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  // Unset until a header is clicked, so each tab opens in the order it chose.
  const sortKey = typeof sp.sort === 'string' ? sp.sort : '';
  const curDir: 'asc' | 'desc' = sp.dir === 'asc' ? 'asc' : 'desc';
  const sortDir: 'ASC' | 'DESC' = curDir === 'asc' ? 'ASC' : 'DESC';
  const sorted = Boolean(SORT_MAPS[tab]?.[sortKey]);

  // ── Top stats (security/overview) ──
  const stats = await q(async () => {
    const { rows } = await risansiPool.query<{ logins24: string; failed24: string; users24: string; acts24: string }>(`
      SELECT
        (SELECT COUNT(*) FROM auth_audit WHERE event='login'        AND created_at >= NOW() - INTERVAL '24 hours')::text AS logins24,
        (SELECT COUNT(*) FROM auth_audit WHERE event='login_failed' AND created_at >= NOW() - INTERVAL '24 hours')::text AS failed24,
        (SELECT COUNT(DISTINCT lower(email)) FROM auth_audit WHERE event='login' AND created_at >= NOW() - INTERVAL '24 hours')::text AS users24,
        (SELECT COUNT(*) FROM audit_log WHERE created_at >= NOW() - INTERVAL '24 hours')::text AS acts24
    `);
    return rows[0] ?? { logins24: '0', failed24: '0', users24: '0', acts24: '0' };
  }, { logins24: '0', failed24: '0', users24: '0', acts24: '0' });

  // ── Tab data ──
  let total = 0;
  let logins: LoginRow[] = [], activity: ActivityRow[] = [], changes: ChangeRow[] = [];
  let exhibitionRows: ExhibitionAuditRow[] = [];
  let usageUsers: UsageUser[] = [], usagePages: UsagePage[] = [], usageSessions: UsageSession[] = [];
  let overall: OverallData | null = null;

  const people = await q<{ email: string; name: string; role: string }[]>(async () => (
    await risansiPool.query<{ email: string; name: string; role: string }>(
      `SELECT lower(email) AS email, COALESCE(NULLIF(name,''), email) AS name, role
         FROM users WHERE is_active AND COALESCE(email,'') <> ''
        ORDER BY role DESC, 2`)).rows, []);

  if (tab === 'overall') {
    overall = await q<OverallData | null>(
      () => loadOverall(risansiPool, { win: ovWin, role: ovRole, user: selUser }), null);
  } else if (tab === 'usage') {
    if (selUser) {
      [usagePages, usageSessions] = await Promise.all([
        q<UsagePage[]>(async () => (await risansiPool.query<UsagePage>(
          `SELECT path, SUM(active_seconds)::int total, COUNT(*)::int hits, MAX(occurred_at)::text last
             FROM page_activity WHERE lower(user_email) = $1 ${winClause}
            GROUP BY path ORDER BY total DESC`, [selUser])).rows, []),
        q<UsageSession[]>(async () => (await risansiPool.query<UsageSession>(
          `SELECT COALESCE(session_id,'(unknown)') AS session_id, MIN(occurred_at)::text AS started,
                  MAX(occurred_at)::text AS ended, SUM(active_seconds)::int AS active
             FROM page_activity WHERE lower(user_email) = $1 ${winClause}
            GROUP BY session_id ORDER BY MIN(occurred_at) DESC LIMIT 50`, [selUser])).rows, []),
      ]);
    } else {
      usageUsers = await q<UsageUser[]>(async () => (await risansiPool.query<UsageUser>(
        `SELECT lower(user_email) AS email, MAX(role) AS role, SUM(active_seconds)::int AS total,
                COUNT(DISTINCT session_id)::int AS sessions, COUNT(DISTINCT path)::int AS pages,
                MAX(occurred_at)::text AS last_active
           FROM page_activity WHERE user_email IS NOT NULL ${winClause}
          GROUP BY lower(user_email) ORDER BY total DESC LIMIT 200`)).rows, []);
    }
  } else if (tab === 'logins') {
    const conds: string[] = [], params: (string)[] = [];
    if (qStr) { params.push(`%${qStr.toLowerCase()}%`); conds.push(`(lower(email) LIKE $${params.length} OR ip LIKE $${params.length})`); }
    if (LOGIN_EVENTS.includes(evt)) { params.push(evt); conds.push(`event = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    [logins, total] = await Promise.all([
      q<LoginRow[]>(async () => (await risansiPool.query<LoginRow>(
        `SELECT id, event, email, role, ip, user_agent, reason, created_at::text FROM auth_audit ${where} ${orderByFor(tab, sortKey, sortDir, 'ORDER BY created_at DESC')} LIMIT ${PAGE_SIZE} OFFSET ${offset}`, params)).rows, []),
      q<number>(async () => Number((await risansiPool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM auth_audit ${where}`, params)).rows[0]?.c ?? 0), 0),
    ]);
  } else if (tab === 'activity') {
    const conds: string[] = [], params: (string)[] = [];
    if (qStr) { params.push(`%${qStr.toLowerCase()}%`); conds.push(`(lower(actor_email) LIKE $${params.length} OR lower(COALESCE(entity_label,'')) LIKE $${params.length} OR lower(COALESCE(summary,'')) LIKE $${params.length})`); }
    if (ACTIVITY_ACTIONS.includes(act)) { params.push(act); conds.push(`action = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    [activity, total] = await Promise.all([
      q<ActivityRow[]>(async () => (await risansiPool.query<ActivityRow>(
        `SELECT id, actor_email, actor_role, action, entity_type, entity_id, entity_label, summary, ip, created_at::text FROM audit_log ${where} ${orderByFor(tab, sortKey, sortDir, 'ORDER BY created_at DESC')} LIMIT ${PAGE_SIZE} OFFSET ${offset}`, params)).rows, []),
      q<number>(async () => Number((await risansiPool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM audit_log ${where}`, params)).rows[0]?.c ?? 0), 0),
    ]);
  } else if (tab === 'exhibitions') {
    // One feed for the whole module: approval decisions, every meeting captured
    // (with who captured it and their role), expenses logged, and reviews filed.
    // Meetings and expenses are read from their own tables rather than audit_log
    // so the company, the existing-client flag and the amount are all present.
    const like = qStr ? `%${qStr.toLowerCase()}%` : null;
    const feedSql = `
      WITH feed AS (
        SELECT a.created_at, 'Approval' AS kind, e.name AS exhibition,
               a.decision AS what, COALESCE(a.comments,'') AS detail,
               COALESCE(a.actor_name, u.name, '—') AS who, u.role AS who_role,
               NULL::numeric AS amount, NULL::boolean AS existing_client
          FROM exhibition_approvals a
          JOIN exhibitions e ON e.id = a.exhibition_id
          LEFT JOIN users u ON u.id = a.actor_id
        UNION ALL
        SELECT m.created_at, 'Meeting', e.name,
               m.company_name,
               NULLIF(CONCAT_WS(' · ', m.contact_person, m.interest, NULLIF(m.outcome,'')), ''),
               COALESCE(m.met_by_name, u.name, '—'), u.role,
               m.potential_value_inr, (m.client_id IS NOT NULL)
          FROM exhibition_meetings m
          JOIN exhibitions e ON e.id = m.exhibition_id
          LEFT JOIN users u ON u.id = m.met_by
        UNION ALL
        SELECT x.created_at, 'Expense', e.name, x.category,
               NULLIF(CONCAT_WS(' · ', x.vendor, x.description), ''),
               COALESCE(u.name,'—'), u.role, x.actual_inr, NULL
          FROM exhibition_expenses x
          JOIN exhibitions e ON e.id = x.exhibition_id
          LEFT JOIN users u ON u.id = x.created_by
        UNION ALL
        SELECT r.reviewed_at, 'Review', e.name, 'Post-event review',
               NULLIF(CONCAT_WS(' · ', r.attend_next_year, r.key_learnings), ''),
               COALESCE(r.reviewed_by_name, u.name, '—'), u.role,
               r.business_won_inr, NULL
          FROM exhibition_reviews r
          JOIN exhibitions e ON e.id = r.exhibition_id
          LEFT JOIN users u ON u.id = r.reviewed_by
         WHERE r.reviewed_at IS NOT NULL
      )
      SELECT * FROM feed
      ${like ? `WHERE lower(exhibition) LIKE $1 OR lower(who) LIKE $1 OR lower(COALESCE(what,'')) LIKE $1 OR lower(COALESCE(detail,'')) LIKE $1` : ''}`;
    const params = like ? [like] : [];
    [exhibitionRows, total] = await Promise.all([
      q<ExhibitionAuditRow[]>(async () => (await risansiPool.query<ExhibitionAuditRow>(
        `SELECT created_at::text AS created_at, kind, exhibition, what, detail, who, who_role,
                amount::float8 AS amount, existing_client
           FROM (${feedSql}) t
          ${orderByFor(tab, sortKey, sortDir, 'ORDER BY created_at DESC NULLS LAST')}
          LIMIT ${PAGE_SIZE} OFFSET ${offset}`, params)).rows, []),
      q<number>(async () => Number((await risansiPool.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM (${feedSql}) t`, params)).rows[0]?.c ?? 0), 0),
    ]);
  } else {
    const conds: string[] = [], params: (string)[] = [];
    if (qStr) { params.push(`%${qStr.toLowerCase()}%`); conds.push(`(lower(COALESCE(changed_by,'')) LIKE $${params.length} OR lower(entity_type) LIKE $${params.length})`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    [changes, total] = await Promise.all([
      q<ChangeRow[]>(async () => (await risansiPool.query<ChangeRow>(
        `SELECT id, entity_type, entity_id, action, old_value, new_value, changed_by, changed_at::text FROM assignment_audit ${where} ${orderByFor(tab, sortKey, sortDir, 'ORDER BY changed_at DESC')} LIMIT ${PAGE_SIZE} OFFSET ${offset}`, params)).rows, []),
      q<number>(async () => Number((await risansiPool.query<{ c: string }>(`SELECT COUNT(*)::text c FROM assignment_audit ${where}`, params)).rows[0]?.c ?? 0), 0),
    ]);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function url(over: Record<string, string | number | undefined>): string {
    const base: Record<string, string> = { tab };
    if (qStr) base.q = qStr;
    if (evt)  base.event = evt;
    if (act)  base.action = act;
    // Prev/Next keep the chosen column. Paging out of a sort and silently back
    // into newest-first would make page 2 a different list from page 1.
    if (sorted) { base.sort = sortKey; base.dir = curDir; }
    base.page = String(pageNum);
    const merged = { ...base, ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, v == null ? undefined : String(v)])) };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v != null && v !== '') p.set(k, v);
    return `/risansi/admin/audit?${p.toString()}`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['System Admin', 'Audit Log']} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }} className="r-page">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Audit Log</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              Full activity trail · who signed in, when, and everything they did
            </div>
          </div>

          {/* The same trail, summarised per user for management. Built on request
              rather than on a schedule: the point of pressing it is that the
              numbers are current, and it is a few seconds of queries. */}
          <a
            href="/api/risansi/reports/user-adoption"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0,
              padding: '9px 15px', borderRadius: 'var(--radius)', border: '1px solid var(--accent-fill)',
              background: 'var(--accent-fill)', color: 'var(--on-accent)', fontSize: 12.5, fontWeight: 600,
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}
            title="Excel workbook: every user's logins, time in the app and records created, all-time and month by month, with charts"
          >
            ⭳ Adoption report (Excel)
          </a>
        </div>

        {/* One person, as a PDF you can send them. A plain GET form opening in a
            new tab — the print route auto-opens the browser's print dialog, and
            "Save as PDF" there is the download. */}
        <form
          method="GET" action="/print/portal-usage" target="_blank"
          style={{
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
            padding: '10px 14px', marginBottom: 16,
            background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)' }}>
            Individual report
          </span>
          <select name="user" defaultValue={selUser} required style={SELECT} aria-label="Person">
            <option value="">Select a person…</option>
            {people.map(p => (
              <option key={p.email} value={p.email}>{p.name}{p.role ? ` · ${p.role}` : ''}</option>
            ))}
          </select>
          <select name="win" defaultValue="30d" style={SELECT} aria-label="Period">
            {PERSON_WINDOWS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
          <button type="submit" style={{
            padding: '8px 15px', fontSize: 12.5, fontWeight: 600, background: 'var(--accent-fill)',
            color: 'var(--on-accent)', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            ⭳ Their metrics vs the team average (PDF)
          </button>
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
            opens a print view · choose Save as PDF
          </span>
        </form>

        {/* Stat strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }} className="r-grid-4">
          <Stat label="Logins · 24h"  value={stats.logins24} />
          <Stat label="Failed · 24h"  value={stats.failed24} accent={Number(stats.failed24) > 0 ? 'var(--neg)' : undefined} />
          <Stat label="Active users · 24h" value={stats.users24} />
          <Stat label="Actions · 24h" value={stats.acts24} />
        </div>

        {/* Tabs */}
        <div className="field-tabs" style={{ display: 'flex', gap: 2, marginBottom: 14, borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
          {TABS.map(t => (
            <Link key={t.id} href={`/risansi/admin/audit?tab=${t.id}`} aria-current={tab === t.id} style={{
              display: 'block', padding: '9px 16px', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0,
              fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? 'var(--accent)' : 'var(--fg-3)',
              textDecoration: 'none', borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1,
            }}>{t.label}</Link>
          ))}
        </div>

        {tab === 'overall' ? (
          overall
            ? <AuditOverall d={overall} win={ovWin} role={ovRole} user={selUser} people={people} />
            : <div style={{ padding: 30, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>Could not load the overview.</div>
        ) : tab === 'usage' ? (
          <UsageView users={usageUsers} pages={usagePages} sessions={usageSessions} selUser={selUser} win={win} />
        ) : (<>
        {/* Search + filters */}
        <form method="GET" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={qStr} placeholder={tab === 'logins' ? 'Search email or IP…' : 'Search user, entity, action…'}
            style={{ flex: '1 1 220px', minWidth: 180, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 8, color: 'var(--fg)' }} />
          {tab === 'logins' && (
            <select name="event" defaultValue={evt} style={SELECT}>
              <option value="">All events</option>
              {LOGIN_EVENTS.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          )}
          {tab === 'activity' && (
            <select name="action" defaultValue={act} style={SELECT}>
              <option value="">All actions</option>
              {ACTIVITY_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <button type="submit" style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>Search</button>
          {(qStr || evt || act) && <Link href={`/risansi/admin/audit?tab=${tab}`} style={{ fontSize: 12, color: 'var(--fg-3)' }}>Clear</Link>}
        </form>

        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 8 }}>
          {total.toLocaleString('en-IN')} entr{total !== 1 ? 'ies' : 'y'}
          {sorted ? ' · sorted across every page' : ' · newest first'}
        </div>

        {/* Table */}
        <div style={PANEL}>
          <div style={{ overflowX: 'auto' }}>
            {tab === 'logins' && <LoginsTable rows={logins} sort={sortKey} dir={curDir} />}
            {tab === 'activity' && <ActivityTable rows={activity} sort={sortKey} dir={curDir} />}
            {tab === 'changes' && <ChangesTable rows={changes} sort={sortKey} dir={curDir} />}
            {tab === 'exhibitions' && <ExhibitionAuditTable rows={exhibitionRows} sort={sortKey} dir={curDir} />}
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString('en-IN')}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {pageNum > 1 && <Link href={url({ page: pageNum - 1 })} style={PAGE_BTN}>← Prev</Link>}
              <span style={{ ...PAGE_BTN, ...PAGE_ACTIVE }}>{pageNum}</span>
              {pageNum < totalPages && <Link href={url({ page: pageNum + 1 })} style={PAGE_BTN}>Next →</Link>}
            </div>
          </div>
        )}
        </>)}
      </div>
    </div>
  );
}

// ── Tables ──────────────────────────────────────────────────────

/** What every table below is handed: the page of rows, and which column the
 *  SQL was ordered by, so the header can show the arrow on the right one. */
interface SortedTable { sort: string; dir: 'asc' | 'desc' }

/**
 * The same header, for the phone. These tables are cards on a handset and the
 * header row above is hidden, so the menu is the only way to reorder them
 * there — and the order still has to be decided in SQL, because each tab shows
 * fifty rows of a trail that runs to thousands.
 */
function MobileSortFor({ tab, sort, dir }: { tab: string } & SortedTable) {
  const m = MOBILE_SORTS[tab];
  if (!m) return null;
  return (
    <div className="r-mobile-only" style={{ padding: '8px 10px 0' }}>
      <MobileSortUrl
        options={m.options}
        kinds={m.kinds}
        currentSort={sort}
        currentDir={dir}
        restingLabel="Newest first"
      />
    </div>
  );
}

function LoginsTable({ rows, sort, dir }: { rows: LoginRow[] } & SortedTable) {
  return (
    <>
    <MobileSortFor tab="logins" sort={sort} dir={dir} />
    <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr style={{ background: 'var(--bg-elev)' }}>
        <SortableTH col="when"   label="When"   kind="date" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="event"  label="Event"  kind="text" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="user"   label="User"   kind="text" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="role"   label="Role"   kind="text" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="ip"     label="IP"     kind="text" currentSort={sort} currentDir={dir} style={TH} />
        {/* Device is read off the user-agent string, which is what it sorts on:
            every Chrome-on-Windows row lands together, whatever the version. */}
        <SortableTH col="device" label="Device" kind="text" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="reason" label="Reason" kind="text" currentSort={sort} currentDir={dir} style={TH} />
      </tr></thead>
      <tbody>
        {rows.length === 0 ? <tr><td colSpan={7} style={EMPTY}>No login events yet</td></tr> : rows.map((r, i) => (
          <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <td data-label="When" style={MONO}>{fmtWhen(r.created_at)}</td>
            <td data-label="Event" style={TD}><Tag kind={eventKind(r.event)} dot>{eventLabel(r.event)}</Tag></td>
            <td data-label="" style={{ ...TD, fontWeight: 500 }}>{r.email ?? '—'}</td>
            <td data-label="Role" style={TD}>{r.role ? <Tag kind={r.role === 'sysadmin' || r.role === 'admin' ? 'accent' : undefined}>{r.role}</Tag> : '—'}</td>
            <td data-label="IP" style={MONO}>{r.ip ?? '—'}</td>
            <td data-label="Device" style={{ ...TD, fontSize: 11, color: 'var(--fg-3)', maxWidth: 220 }} title={r.user_agent ?? ''}>{deviceOf(r.user_agent)}</td>
            <td data-label="Reason" style={{ ...TD, fontSize: 11, color: r.reason ? 'var(--neg)' : 'var(--fg-3)' }}>{r.reason ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

function ActivityTable({ rows, sort, dir }: { rows: ActivityRow[] } & SortedTable) {
  return (
    <>
    <MobileSortFor tab="activity" sort={sort} dir={dir} />
    <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr style={{ background: 'var(--bg-elev)' }}>
        <SortableTH col="when"   label="When"   kind="date" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="actor"  label="Actor"  kind="text" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="action" label="Action" kind="text" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="entity" label="Entity" kind="text" currentSort={sort} currentDir={dir} style={TH} />
        {/* The cell falls back from summary to entity_label, and so does the
            sort — otherwise the rows with only a label would all read blank. */}
        <SortableTH col="what"   label="What"   kind="text" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="ip"     label="IP"     kind="text" currentSort={sort} currentDir={dir} style={TH} />
      </tr></thead>
      <tbody>
        {rows.length === 0 ? <tr><td colSpan={6} style={EMPTY}>No activity recorded yet</td></tr> : rows.map((r, i) => (
          <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <td data-label="When" style={MONO}>{fmtWhen(r.created_at)}</td>
            <td data-label="" style={{ ...TD, fontWeight: 500 }}>{r.actor_email ?? '—'}{r.actor_role ? <span style={{ color: 'var(--fg-3)', fontWeight: 400, fontSize: 11 }}> · {r.actor_role}</span> : null}</td>
            <td data-label="Action" style={TD}><Tag kind={actionKind(r.action)}>{r.action}</Tag></td>
            <td data-label="Entity" style={{ ...TD, fontSize: 11 }}>{r.entity_type ?? '—'}{r.entity_id ? <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}> #{r.entity_id}</span> : null}</td>
            <td data-label="What" style={{ ...TD, maxWidth: 360 }}>{r.summary ?? r.entity_label ?? '—'}</td>
            <td data-label="IP" style={MONO}>{r.ip ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

/**
 * Everything that happened in the Exhibition module, in one feed: approval
 * decisions, every meeting captured, expenses logged and reviews filed — each
 * with the person who recorded it and their role, which is the question this tab
 * exists to answer.
 */
function ExhibitionAuditTable({ rows, sort, dir }: { rows: ExhibitionAuditRow[] } & SortedTable) {
  if (rows.length === 0) {
    return <div style={{ padding: 30, textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' }}>
      No exhibition activity yet.
    </div>;
  }
  const tone: Record<string, string> = {
    Approval: 'var(--accent-soft)', Meeting: 'var(--pos-soft)',
    Expense: 'var(--bg-elev)', Review: 'var(--accent-soft)',
  };
  const inr = (v: number | null) => v == null ? '' :
    v >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : `₹${Math.round(v).toLocaleString('en-IN')}`;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          <SortableTH col="when"       label="When"        kind="date"   currentSort={sort} currentDir={dir} style={FEED_TH} />
          <SortableTH col="kind"       label="Type"        kind="text"   currentSort={sort} currentDir={dir} style={FEED_TH} />
          <SortableTH col="exhibition" label="Exhibition"  kind="text"   currentSort={sort} currentDir={dir} style={FEED_TH} />
          <SortableTH col="what"       label="What"        kind="text"   currentSort={sort} currentDir={dir} style={FEED_TH} />
          <SortableTH col="who"        label="Recorded by" kind="text"   currentSort={sort} currentDir={dir} style={FEED_TH} />
          {/* Money: the largest on the first click, and read off the numeric
              column rather than the "₹1.4 L" the cell prints. */}
          <SortableTH col="amount"     label="Amount"      kind="number" currentSort={sort} currentDir={dir} style={FEED_TH} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
            <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
              {r.created_at?.slice(0, 16).replace('T', ' ')}
            </td>
            <td style={{ padding: '9px 12px' }}>
              <span style={{
                padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                background: tone[r.kind] ?? 'var(--bg-elev)', color: 'var(--fg-2)',
              }}>{r.kind}</span>
            </td>
            <td style={{ padding: '9px 12px', color: 'var(--fg-2)' }}>{r.exhibition}</td>
            <td style={{ padding: '9px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--fg)' }}>{r.what ?? '—'}</span>
                {/* Only meetings carry this: it says whether the company was
                    already in the client master when it was captured. */}
                {r.existing_client === true && (
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'var(--pos-soft)', color: 'var(--pos-strong)' }}>
                    existing client
                  </span>
                )}
                {r.existing_client === false && (
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: 'var(--bg-elev)', color: 'var(--fg-3)' }}>
                    new
                  </span>
                )}
              </div>
              {r.detail && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>{r.detail}</div>}
            </td>
            <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
              <div style={{ color: 'var(--fg-2)' }}>{r.who}</div>
              {r.who_role && <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{r.who_role}</div>}
            </td>
            <td style={{ padding: '9px 12px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', color: 'var(--fg-2)' }}>
              {inr(r.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChangesTable({ rows, sort, dir }: { rows: ChangeRow[] } & SortedTable) {
  return (
    <>
    <MobileSortFor tab="changes" sort={sort} dir={dir} />
    <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr style={{ background: 'var(--bg-elev)' }}>
        <SortableTH col="when"   label="When"   kind="date" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="entity" label="Entity" kind="text" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="id"     label="ID"     kind="text" currentSort={sort} currentDir={dir} style={TH} />
        <SortableTH col="action" label="Action" kind="text" currentSort={sort} currentDir={dir} style={TH} />
        {/* Two JSON blobs rendered side by side. There is no single value under
            the cell to order by, so this one stays a plain header. */}
        <th style={TH}>Old → New</th>
        <SortableTH col="by"     label="By"     kind="text" currentSort={sort} currentDir={dir} style={TH} />
      </tr></thead>
      <tbody>
        {rows.length === 0 ? <tr><td colSpan={6} style={EMPTY}>No ownership changes</td></tr> : rows.map((r, i) => (
          <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none' }}>
            <td data-label="When" style={MONO}>{fmtWhen(r.changed_at)}</td>
            <td data-label="Entity" style={TD}><Tag>{r.entity_type}</Tag></td>
            <td data-label="ID" style={MONO}>{r.entity_id}</td>
            <td data-label="Action" style={TD}><Tag kind={actionKind(r.action)}>{r.action}</Tag></td>
            <td data-label="Old → New" style={{ ...TD, maxWidth: 360 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, overflow: 'hidden' }}>
                <span style={{ color: 'var(--neg)' }}>{fmtVal(r.old_value)}</span>
                <span style={{ color: 'var(--fg-3)' }}>→</span>
                <span style={{ color: 'var(--pos)' }}>{fmtVal(r.new_value)}</span>
              </div>
            </td>
            <td data-label="By" style={MONO}>{r.changed_by ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function fmtWhen(s: string): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
function eventLabel(e: string): string { return e === 'login_failed' ? 'failed login' : e === 'password_changed' ? 'password change' : e; }
function eventKind(e: string): 'pos' | 'neg' | 'warn' | undefined { return e === 'login' ? 'pos' : e === 'login_failed' ? 'neg' : e === 'password_changed' ? 'warn' : undefined; }
function actionKind(a: string): 'pos' | 'neg' | 'warn' | 'accent' | undefined { return a === 'create' ? 'pos' : a === 'delete' ? 'neg' : a === 'update' ? 'warn' : a === 'submit' || a === 'assign' ? 'accent' : undefined; }
function deviceOf(ua: string | null): string {
  if (!ua) return '—';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ') || ua.slice(0, 28);
}
function fmtVal(v: unknown): string {
  if (v == null) return '∅';
  if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > 100 ? s.slice(0, 97) + '…' : s; }
  return String(v);
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ ...PANEL, padding: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600, color: accent ?? 'var(--fg)', marginTop: 4 }}>{Number(value).toLocaleString('en-IN')}</div>
    </div>
  );
}

function fmtDuration(sec: number): string {
  if (!sec || sec < 0) return '0m';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

// ── Usage & Time tab ────────────────────────────────────────────

// The three tables here are complete sets rather than pages of a longer list —
// everyone active in the window, every page one person opened, every session
// they had — so they sort in the browser. What this component does is format
// the durations and dates once, on the server, and hand the island both the
// label to print and the raw seconds or ISO date to order by.

function UsageView({ users, pages, sessions, selUser, win }: {
  users: UsageUser[]; pages: UsagePage[]; sessions: UsageSession[]; selUser: string; win: string;
}) {
  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams({ tab: 'usage', win, ...over });
    return `/risansi/admin/audit?${p.toString()}`;
  };
  const windowPills = (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
      {WINDOWS.map(w => (
        <Link key={w.id} href={link({ ...(selUser ? { user: selUser } : {}), win: w.id })} style={{
          padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 999, textDecoration: 'none',
          border: `1px solid ${w.id === win ? 'var(--accent-fill)' : 'var(--line-strong)'}`,
          background: w.id === win ? 'var(--accent-fill)' : 'var(--bg-paper)', color: w.id === win ? 'var(--on-accent)' : 'var(--fg-3)',
        }}>{w.label}</Link>
      ))}
    </div>
  );

  // ── Per-user drill-down ──
  if (selUser) {
    const totalActive = pages.reduce((s, p) => s + p.total, 0);
    const pageRows: UsagePageRow[] = pages.map(p => ({
      path: p.path, label: pageLabel(p.path),
      total: p.total, totalLabel: fmtDuration(p.total),
      hits: p.hits,
    }));
    const sessionRows: UsageSessionRow[] = sessions.map(s => {
      const span = Math.max(0, Math.round((new Date(s.ended).getTime() - new Date(s.started).getTime()) / 1000));
      return {
        key: s.session_id,
        started: s.started, startedLabel: fmtWhen(s.started),
        active: s.active, activeLabel: fmtDuration(s.active),
        span, spanLabel: fmtDuration(span),
      };
    });
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <Link href={link({})} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>← All users</Link>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>{selUser}</span>
          <span style={{ ...DUR_BADGE }}>{fmtDuration(totalActive)} active</span>
          <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>· {sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
        </div>
        {windowPills}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 14 }} className="r-grid-2">
          {/* Time per page */}
          <div style={PANEL}>
            <div style={SECTION_H}>Time per page</div>
            <UsagePagesTable rows={pageRows} />
          </div>
          {/* Sessions */}
          <div style={PANEL}>
            <div style={SECTION_H}>Sessions</div>
            <UsageSessionsTable rows={sessionRows} />
          </div>
        </div>
      </div>
    );
  }

  // ── Per-user summary ──
  const grandTotal = users.reduce((s, u) => s + u.total, 0);
  const userRows: UsageUserRow[] = users.map(u => ({
    email: u.email, role: u.role,
    total: u.total, totalLabel: fmtDuration(u.total),
    sessions: u.sessions, pages: u.pages,
    lastActive: u.last_active, lastActiveLabel: fmtWhen(u.last_active),
  }));
  return (
    <div>
      {windowPills}
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 8 }}>
        {users.length} user{users.length !== 1 ? 's' : ''} active · {fmtDuration(grandTotal)} total active time · click a user for the page breakdown
      </div>
      <div style={PANEL}>
        <div style={{ overflowX: 'auto' }}>
          <UsageUsersTable rows={userRows} win={win} />
        </div>
      </div>
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const SECTION_H: CSSProperties = { padding: '10px 14px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, color: 'var(--title)', textTransform: 'uppercase', letterSpacing: '0.07em' };
const DUR_BADGE: CSSProperties = { padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: 'var(--accent-soft)', color: 'var(--title)', fontFamily: 'var(--font-mono)' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
// The exhibition feed's own header, lifted out of the JSX so the sortable
// headers wear exactly the style the plain ones did.
// `background` is named only to keep it unset, the way the plain <th> had it:
// this one table has no tinted header band, and SortableTH's own base style
// would otherwise hand it one.
const FEED_TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: 'transparent' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
const MONO: CSSProperties = { ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' };
const EMPTY: CSSProperties = { padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' };
const SELECT: CSSProperties = { padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 8, color: 'var(--fg)' };
const PAGE_BTN: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 30, height: 28, padding: '0 8px', fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 5, color: 'var(--fg)', textDecoration: 'none' };
const PAGE_ACTIVE: CSSProperties = { background: 'var(--accent-fill)', color: 'var(--on-accent)', border: '1px solid var(--accent-fill)', fontWeight: 500 };
