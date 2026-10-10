import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ExportColumnsButton } from '@/components/risansi/ExportColumnsButton';
import {
  ClientSelectionProvider, ClientSelectionBar, SelectClientBox, SelectPageBox,
} from '@/components/risansi/ClientSelection';
import { Topbar, Tag, StatusDot, MultiSelectFilter, ActiveFilterBar, SortableTH, Donut } from '@/components/risansi';
import { MobileSortUrl } from '@/components/risansi/MobileSort';
import risansiPool from '@/lib/db-risansi';
import { formatLastVisitShort, formatRev } from '@/lib/risansi-utils';
import { getCurrentUser, clientVisibilitySql } from '@/lib/risansi-auth';
import { OWNERS_SUBQUERY, REV_JOIN, REV_BUCKETS, VISIT_BUCKETS, buildClientFilter } from '@/lib/risansi-client-filter';
import { clientStatusLabel, statusDotKind, CLIENT_STATUS_FILTER_OPTIONS, CLIENT_STATUS_LABELS, CLIENT_STATUS_COLORS, PROSPECTIVE_STATUSES, CLIENT_STATUSES } from '@/lib/risansi-client-status';
import { FilterBar } from './FilterBar';

const PAGE_SIZE = 50;

// Status is a lifecycle, not a word list: Prospective-Lead comes before Active
// which comes before Closed, and the alphabet agrees with none of that. The
// rank comes straight off CLIENT_STATUSES so a status added there orders itself.
const STATUS_RANK_SQL = `CASE UPPER(c.status) ${
  CLIENT_STATUSES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')
} ELSE ${CLIENT_STATUSES.length} END`;

// Only columns confirmed to exist are listed here. A key that is not in this
// map never reaches the query — it falls back to the default below.
// A client nobody has ever visited is not a blank in these two columns, it is
// the extreme: infinitely long since the last visit, infinitely overdue. Left
// as NULL it sorted as an absence and sank to the bottom, which on a list whose
// whole point is "who needs visiting" put the most neglected accounts last.
// Ordering on a floor date instead keeps them at the top of the overdue end and
// at the bottom of the recently-visited end, which is true both ways round. The
// SELECT still returns NULL, so the cell still reads "Never".
// What the phone sort menu offers, and which way each column should open. The
// keys have to be SORT_MAP's keys: anything else is dropped by the whitelist and
// the tap would appear to do nothing.
const CLIENT_SORT_OPTIONS = [
  { key: 'last_visit', label: 'Last visit' },
  { key: 'name',       label: 'Client name' },
  { key: 'code',       label: 'Code' },
  { key: 'industry',   label: 'Industry' },
  { key: 'zone',       label: 'Zone / route' },
  { key: 'rep',        label: 'Rep' },
  { key: 'status',     label: 'Status' },
  { key: 'tier',       label: 'Tier' },
];
const CLIENT_SORT_KINDS = {
  last_visit: 'date', name: 'text', code: 'text', industry: 'text',
  zone: 'text', rep: 'text', status: 'status', tier: 'text',
} as const;

const SORT_MAP: Record<string, string> = {
  code:       'c.code',
  name:       'c.legal_name',
  industry:   'c.industry',
  // Matches what the cell shows (c.zone falling back to the route's zone),
  // rather than the route's zone alone.
  zone:       `COALESCE(NULLIF(c.zone, ''), tr.zone)`,
  last_visit: `COALESCE(c.last_visit_date, DATE '0001-01-01')`,
  status:     STATUS_RANK_SQL,
  tier:       'c.tier',
  rep:        'rep_name',
};

export default async function ClientListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams;

  const user = await getCurrentUser();

  // Tab — 'all' (default) or 'prospective'. The tab's status constraint lives in
  // buildClientFilter, so the list, the counts and the Excel export all agree.
  const tab       = sp.tab === 'prospective' ? 'prospective' : 'all';
  const q_str     = typeof sp.q        === 'string' ? sp.q.trim()        : '';
  const sugarFilt = typeof sp.sugar    === 'string' ? sp.sugar.trim()    : '';
  const sortKey   = typeof sp.sort     === 'string' ? sp.sort            : 'last_visit';
  // The headers write ?dir=; the mobile sort sheet writes ?order=. Reading both
  // keeps an existing bookmark working and stops a header click being ignored.
  const dirParam  = typeof sp.dir === 'string' ? sp.dir : typeof sp.order === 'string' ? sp.order : '';
  const orderDir  = dirParam === 'desc'             ? 'DESC'             : 'ASC';
  const pageNum   = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const limit     = PAGE_SIZE;
  const offset    = (pageNum - 1) * limit;    // page 1 → offset 0  ✓

  // Multi-select filters — comma-separated in URL
  const indFilts  = typeof sp.industry === 'string' && sp.industry ? sp.industry.split(',').filter(Boolean) : [];
  const zoneFilts = typeof sp.zone     === 'string' && sp.zone     ? sp.zone.split(',').filter(Boolean)     : [];
  const countryFilts = typeof sp.country === 'string' && sp.country ? sp.country.split(',').filter(Boolean) : [];
  const tierFilts = typeof sp.tier     === 'string' && sp.tier     ? sp.tier.split(',').filter(Boolean)     : [];
  const ctypeFilts = typeof sp.ctype   === 'string' && sp.ctype    ? sp.ctype.split(',').filter(Boolean)    : [];
  const statFilts = typeof sp.status   === 'string' && sp.status   ? sp.status.split(',').filter(Boolean).map(s => s.toUpperCase()) : [];
  const repFilts  = typeof sp.rep      === 'string' && sp.rep      ? sp.rep.split(',').filter(Boolean)      : [];
  const fyFilts   = typeof sp.fy       === 'string' && sp.fy       ? sp.fy.split(',').filter(Boolean)       : [];
  const revFilts  = typeof sp.rev      === 'string' && sp.rev      ? sp.rev.split(',').filter(Boolean)      : [];
  const visitFilts = typeof sp.visit   === 'string' && sp.visit    ? sp.visit.split(',').filter(Boolean)    : [];

  const hasActiveFilters = !!(q_str || sugarFilt || indFilts.length || zoneFilts.length || countryFilts.length || tierFilts.length || ctypeFilts.length || statFilts.length || repFilts.length || fyFilts.length || revFilts.length || visitFilts.length);
  const sortCol = SORT_MAP[sortKey] ?? 'c.last_visit_date';

  // ── WHERE + params (shared with the Excel export so they always match) ──
  const { whereClause, params } = buildClientFilter(sp, user);
  const countParams = [...params]; // snapshot before limit/offset are pushed

  // Tab counts share every OTHER filter but not the tab's own status constraint,
  // so each label reads "how many rows would this tab show right now".
  const { whereClause: tabWhere, params: tabParams } = buildClientFilter({ ...sp, tab: undefined }, user);

  // Prospective summary stats use the tab scope + every other filter but NOT the
  // in-tab status pick — faceted-search behaviour, so drilling into "Leads"
  // doesn't collapse the split donut to a single 100% segment.
  const { whereClause: statsWhere, params: statsParams } = buildClientFilter({ ...sp, status: undefined }, user);

  const limIdx = params.length + 1;
  const offIdx = params.length + 2;
  const mainParams = [...params, limit, offset];

  // ── Interfaces ─────────────────────────────────────────────────
  interface ClientRow {
    id:              string;
    code:            string;
    legal_name:      string;
    trade_name:      string | null;
    industry:        string;
    is_sugar:        boolean;
    state:           string | null;
    city:            string | null;
    status:          string;
    tier:            string | null;
    last_visit_date: Date | null;
    zone:            string | null;
    tour_name:       string | null;
    tour_zone:       string | null;
    rep_name:        string | null;
  }

  interface RepOption { rep_name: string; client_count: number; }

  interface ProspStats {
    total: number; leads: number; pclients: number;
    visited: number; overdue: number; neverVisited: number;
    inPlay: number; openValue: number;   // openValue in rupees
  }

  // ── All queries in parallel ────────────────────────────────────
  const [clients, total, tabCounts, prospStats, industries, zones, countries, tiers, clientTypes, repOptions, fyYears, revBuckets, visitBuckets] = await Promise.all([

    (async (): Promise<ClientRow[]> => {
      try {
        const { rows } = await risansiPool.query<ClientRow>(
          `SELECT
             c.id, c.code, c.legal_name, c.trade_name,
             c.industry, c.is_sugar, c.state, c.city,
             c.status, c.tier,
             c.last_visit_date,
             c.zone,
             tr.name AS tour_name,
             tr.zone AS tour_zone,
             COALESCE(${OWNERS_SUBQUERY}, '—') AS rep_name
           FROM clients c
           LEFT JOIN tour_routes tr ON tr.id = c.tour_id
           ${REV_JOIN}
           WHERE ${whereClause}
           -- NULLS LAST both ways. Postgres defaults to NULLS FIRST on DESC and
           -- this clause used to ask for it explicitly on ASC, so either end of
           -- a column could open on a screenful of empty cells with the rows
           -- somebody clicked the header to find pushed off the page.
           -- c.id breaks ties. Without it two rows sharing a value can swap
           -- between pages, so one repeats on page 2 and another is never seen.
           ORDER BY ${sortCol} ${orderDir} NULLS LAST, c.id
           LIMIT  $${limIdx}
           OFFSET $${offIdx}`,
          mainParams as (string | number)[],
        );
        return rows;
      } catch (err) {
        console.error('[clients/page] main query failed:', err);
        return [];
      }
    })(),

    (async (): Promise<number> => {
      try {
        const { rows } = await risansiPool.query<{ count: string }>(
          `SELECT COUNT(DISTINCT c.id)::text AS count
           FROM clients c
           LEFT JOIN tour_routes tr ON tr.id = c.tour_id
           ${REV_JOIN}
           WHERE ${whereClause}`,
          countParams as (string | number)[],
        );
        return Number(rows[0]?.count ?? 0);
      } catch (err) {
        console.error('[clients/page] count query failed:', err);
        return 0;
      }
    })(),

    // Per-tab counts under the current non-tab filters (one pass, two FILTERs).
    (async (): Promise<{ all: number; prospective: number }> => {
      try {
        const { rows } = await risansiPool.query<{ all_n: string; prosp_n: string }>(
          `SELECT COUNT(DISTINCT c.id)::text AS all_n,
                  COUNT(DISTINCT c.id) FILTER (
                    WHERE UPPER(c.status) IN ('PROSPECTIVE_LEAD','PROSPECTIVE_CLIENT')
                  )::text AS prosp_n
           FROM clients c
           LEFT JOIN tour_routes tr ON tr.id = c.tour_id
           ${REV_JOIN}
           WHERE ${tabWhere}`,
          tabParams as (string | number)[],
        );
        return { all: Number(rows[0]?.all_n ?? 0), prospective: Number(rows[0]?.prosp_n ?? 0) };
      } catch (err) {
        console.error('[clients/page] tab count query failed:', err);
        return { all: 0, prospective: 0 };
      }
    })(),

    // Prospectives-tab summary. One pass; skipped entirely on the All tab.
    // Neither join fans out (tour_routes is 1:1 on tour_id, REV_JOIN is grouped
    // per client), so the correlated open-value SUM can't double-count.
    (async (): Promise<ProspStats | null> => {
      if (tab !== 'prospective') return null;
      try {
        const { rows } = await risansiPool.query<Record<string, string>>(
          `SELECT
             COUNT(DISTINCT c.id)::text AS total,
             COUNT(DISTINCT c.id) FILTER (WHERE UPPER(c.status) = 'PROSPECTIVE_LEAD')::text   AS leads,
             COUNT(DISTINCT c.id) FILTER (WHERE UPPER(c.status) = 'PROSPECTIVE_CLIENT')::text AS pclients,
             COUNT(DISTINCT c.id) FILTER (WHERE c.last_visit_date >= CURRENT_DATE - INTERVAL '90 days')::text AS visited,
             COUNT(DISTINCT c.id) FILTER (WHERE c.last_visit_date IS NOT NULL
               AND c.last_visit_date < CURRENT_DATE - INTERVAL '90 days')::text AS overdue,
             COUNT(DISTINCT c.id) FILTER (WHERE c.last_visit_date IS NULL)::text AS never_visited,
             COUNT(DISTINCT c.id) FILTER (WHERE EXISTS (
               SELECT 1 FROM opportunities o
                WHERE o.client_id = c.id AND o.stage NOT IN ('Won','Lost','Dropped')))::text AS in_play,
             COALESCE(SUM((SELECT COALESCE(SUM(COALESCE(o.offer_value_inr, o.value_cr * 10000000, 0)), 0)
                             FROM opportunities o
                            WHERE o.client_id = c.id AND o.stage NOT IN ('Won','Lost','Dropped'))), 0)::text AS open_value
           FROM clients c
           LEFT JOIN tour_routes tr ON tr.id = c.tour_id
           ${REV_JOIN}
           WHERE ${statsWhere}`,
          statsParams as (string | number)[],
        );
        const r = rows[0] ?? {};
        const n = (k: string) => Number(r[k] ?? 0);
        return {
          total: n('total'), leads: n('leads'), pclients: n('pclients'),
          visited: n('visited'), overdue: n('overdue'), neverVisited: n('never_visited'),
          inPlay: n('in_play'), openValue: n('open_value'),
        };
      } catch (err) {
        console.error('[clients/page] prospective stats query failed:', err);
        return null;
      }
    })(),

    // Industry, Zone, Country and Tier all listed the whole company. Client Type
    // and Rep below were already scoped, so a rep saw four dropdowns offering
    // values that return nothing and two that behaved — the filter bar told them
    // the business had 5 zones and their own list had 2.
    (async (): Promise<string[]> => {
      try {
        const vis = clientVisibilitySql(user, 'c');
        const { rows } = await risansiPool.query<{ industry: string }>(
          `SELECT DISTINCT c.industry AS industry FROM clients c
            WHERE c.industry IS NOT NULL AND c.deleted_at IS NULL${vis ? ` AND (${vis})` : ''}
            ORDER BY 1`,
        );
        return rows.map(r => r.industry);
      } catch { return []; }
    })(),

    (async (): Promise<string[]> => {
      try {
        // Zone lives on the route, so it is scoped through the clients sitting on
        // that route rather than on the route table itself — a route with no
        // visible client contributes no zone.
        const vis = clientVisibilitySql(user, 'c');
        const { rows } = await risansiPool.query<{ zone: string }>(
          `SELECT DISTINCT tr.zone AS zone FROM tour_routes tr
            WHERE tr.zone IS NOT NULL AND tr.zone <> ''${vis ? `
              AND EXISTS (SELECT 1 FROM clients c
                           WHERE c.tour_id = tr.id AND c.deleted_at IS NULL AND (${vis}))` : ''}
            ORDER BY 1`,
        );
        return rows.map(r => r.zone);
      } catch { return []; }
    })(),

    // Country options, with counts. 2,535 of 2,757 clients are in India and the
    // other 49 countries hold a handful each, so the count is what makes the
    // list readable — without it every export market looks the same size.
    (async (): Promise<{ country: string; n: number }[]> => {
      try {
        const countryVis = clientVisibilitySql(user, 'c');
        const { rows } = await risansiPool.query<{ country: string; n: number }>(
          `SELECT btrim(c.country) AS country, count(*)::int AS n
             FROM clients c
            WHERE btrim(COALESCE(c.country,'')) <> '' AND c.deleted_at IS NULL${countryVis ? ` AND (${countryVis})` : ''}
            GROUP BY 1 ORDER BY 2 DESC, 1`,
        );
        return rows;
      } catch { return []; }
    })(),

    (async (): Promise<string[]> => {
      try {
        const tierVis = clientVisibilitySql(user, 'c');
        const { rows } = await risansiPool.query<{ tier: string }>(
          `SELECT DISTINCT c.tier AS tier FROM clients c
            WHERE c.tier IS NOT NULL AND c.deleted_at IS NULL${tierVis ? ` AND (${tierVis})` : ''}
            ORDER BY 1`,
        );
        return rows.map(r => r.tier);
      } catch { return []; }
    })(),

    // Client-type options, derived from the data with counts. Deriving (rather
    // than using the CLIENT_TYPES picklist) keeps legacy values that predate it
    // — DIRECT MILL, TRADER, GROUP, CHANNEL PARTNER — filterable instead of
    // silently unreachable. Scoped to the clients this user may see.
    (async (): Promise<{ value: string; label: string; count: number }[]> => {
      try {
        const visForCt = clientVisibilitySql(user, 'c');
        const ctClause = visForCt ? `AND (${visForCt})` : '';
        const { rows } = await risansiPool.query<{ t: string; n: string }>(
          `SELECT c.client_type AS t, COUNT(*)::text AS n
             FROM clients c
            WHERE c.client_type IS NOT NULL AND btrim(c.client_type) <> '' AND c.deleted_at IS NULL ${ctClause}
            GROUP BY c.client_type ORDER BY COUNT(*) DESC`,
        );
        return rows.map(r => ({ value: r.t, label: r.t, count: Number(r.n) }));
      } catch { return []; }
    })(),

    (async (): Promise<RepOption[]> => {
      try {
        // Owner names sourced from users (active), counted via client_assignments,
        // restricted to the clients this user may see.
        const visForOptions = clientVisibilitySql(user, 'c');
        const ownerVisClause = visForOptions ? `AND (${visForOptions})` : '';
        const { rows } = await risansiPool.query<RepOption>(
          `SELECT u.name AS rep_name, COUNT(DISTINCT c.id)::int AS client_count
           FROM users u
           -- The reps who work these clients, rather than everyone sharing a
           -- route with them. A two-rep route used to credit both with the whole
           -- route's client count.
           JOIN clients c ON (c.primary_rep_id = u.id
                              OR c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = u.id))
           WHERE u.is_active = TRUE
             AND c.deleted_at IS NULL
             ${ownerVisClause}
           GROUP BY u.name
           ORDER BY client_count DESC
           LIMIT 30`,
        );
        return rows;
      } catch { return []; }
    })(),

    // Financial-year options from clients.since_year, shown as FY labels.
    (async (): Promise<{ value: string; label: string; count: number }[]> => {
      try {
        const { rows } = await risansiPool.query<{ y: string; n: string }>(
          `SELECT since_year AS y, COUNT(*)::text AS n FROM clients
           WHERE since_year IS NOT NULL AND since_year <> '' AND deleted_at IS NULL
           GROUP BY since_year ORDER BY since_year DESC`,
        );
        return rows.map(r => {
          const yr = parseInt(r.y, 10);
          const label = Number.isFinite(yr)
            ? `FY ${String(yr % 100).padStart(2, '0')}-${String((yr + 1) % 100).padStart(2, '0')}`
            : r.y;
          return { value: r.y, label, count: Number(r.n) };
        });
      } catch { return []; }
    })(),

    // Revenue-bucket option counts (lifetime revenue), scoped to visible clients.
    (async (): Promise<{ value: string; label: string; count: number }[]> => {
      try {
        const visForRev = clientVisibilitySql(user, 'c');
        const visClause = visForRev ? `AND (${visForRev})` : '';
        const selects = REV_BUCKETS
          .map((b, i) => `COUNT(*) FILTER (WHERE ${b.cond('r')}) AS b${i}`)
          .join(', ');
        const { rows } = await risansiPool.query<Record<string, string>>(
          `WITH rev AS (
             SELECT c.id,
                    COALESCE((SELECT SUM(total_value) FROM client_revenue_monthly m WHERE m.client_id = c.id), 0) AS r
             FROM clients c
             WHERE c.deleted_at IS NULL ${visClause})
           SELECT ${selects} FROM rev`,
        );
        const row = rows[0] ?? {};
        return REV_BUCKETS.map((b, i) => ({ value: b.value, label: b.value, count: Number(row[`b${i}`] ?? 0) }));
      } catch { return REV_BUCKETS.map(b => ({ value: b.value, label: b.value, count: 0 })); }
    })(),

    // Last-visit bucket option counts, scoped to visible clients.
    (async (): Promise<{ value: string; label: string; count: number }[]> => {
      try {
        const visForVisit = clientVisibilitySql(user, 'c');
        const visitClause = visForVisit ? `AND (${visForVisit})` : '';
        const selects = VISIT_BUCKETS
          .map((b, i) => `COUNT(*) FILTER (WHERE ${b.cond('c.last_visit_date')}) AS b${i}`)
          .join(', ');
        const { rows } = await risansiPool.query<Record<string, string>>(
          `SELECT ${selects} FROM clients c WHERE c.deleted_at IS NULL ${visitClause}`,
        );
        const row = rows[0] ?? {};
        return VISIT_BUCKETS.map((b, i) => ({ value: b.value, label: b.label, count: Number(row[`b${i}`] ?? 0) }));
      } catch { return VISIT_BUCKETS.map(b => ({ value: b.value, label: b.label, count: 0 })); }
    })(),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Every link this page builds — tab, sort, page — starts from EVERYTHING in
  // the current URL and changes only what it is asked to. It used to rebuild
  // the URL from a list of known filters, and the list was behind the filters:
  // Country was added to the bar and not to the list, so choosing a country and
  // then switching tab, or turning a page, quietly dropped it. A filter added
  // tomorrow cannot be forgotten here again.
  function buildUrl(overrides: Record<string, string | number | undefined>): string {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v) base[k] = v;
    if (tab === 'all') delete base.tab;
    base.page = String(pageNum);
    const merged = { ...base, ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [k, v == null ? undefined : String(v)])
    )};
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v != null && v !== '') p.set(k, v);
    }
    return `/risansi/clients?${p.toString()}`;
  }

  function tierKind(t: string | null): 'accent' | undefined {
    return t === 'Key' ? 'accent' : undefined;
  }

  const curSort = sortKey;
  const curDir  = orderDir === 'DESC' ? 'desc' : 'asc';

  // Switching tab keeps every other filter but clears `status` (the tab defines
  // the status scope, so carrying a pick across would silently narrow the other
  // tab) and `page` (the new result set has its own pagination).
  const tabHref = (id: 'all' | 'prospective') =>
    buildUrl({ tab: id === 'all' ? undefined : id, status: undefined, page: 1 });

  // Export link — carries the current filters so the .xlsx matches this view.
  const exportQs = new URLSearchParams();
  if (tab !== 'all')    exportQs.set('tab', tab);
  if (q_str)            exportQs.set('q', q_str);
  if (indFilts.length)  exportQs.set('industry', indFilts.join(','));
  if (zoneFilts.length) exportQs.set('zone', zoneFilts.join(','));
  if (tierFilts.length) exportQs.set('tier', tierFilts.join(','));
  if (ctypeFilts.length) exportQs.set('ctype', ctypeFilts.join(','));
  if (statFilts.length) exportQs.set('status', statFilts.join(','));
  if (countryFilts.length) exportQs.set('country', countryFilts.join(','));
  if (repFilts.length)  exportQs.set('rep', repFilts.join(','));
  if (fyFilts.length)   exportQs.set('fy', fyFilts.join(','));
  if (revFilts.length)  exportQs.set('rev', revFilts.join(','));
  if (visitFilts.length) exportQs.set('visit', visitFilts.join(','));
  if (sugarFilt)        exportQs.set('sugar', sugarFilt);
  const exportHref = `/api/risansi/clients/export${exportQs.toString() ? `?${exportQs}` : ''}`;

  return (
    <ClientSelectionProvider>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sticky topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Clients']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* ── Page header ──────────────────────────────────────── */}
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Clients
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              {tab === 'prospective' ? 'Prospective leads & clients' : 'Client master'} · {total.toLocaleString('en-IN')} records
            </div>
          </div>
          {/* Opens the column picker rather than downloading straight away. The
              filters still ride on exportHref; the picker only adds ?cols=. */}
          <ExportColumnsButton
            href={exportHref}
            count={total}
            label={`⭳ Export${hasActiveFilters ? ' (filtered)' : ''} · ${total.toLocaleString('en-IN')}`}
          />
        </div>

        {/* ── Tabs ─────────────────────────────────────────────── */}
        <div className="field-tabs" style={{
          display: 'flex', gap: 2, marginBottom: 12, borderBottom: '1px solid var(--line)',
          overflowX: 'auto', scrollSnapType: 'x proximity',
        }}>
          {([
            { id: 'all' as const,         label: 'All Clients',  n: tabCounts.all },
            { id: 'prospective' as const, label: 'Prospectives', n: tabCounts.prospective },
          ]).map(t => (
            <a key={t.id} href={tabHref(t.id)} aria-current={tab === t.id} style={{
              display: 'block', padding: '8px 16px', fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--accent)' : 'var(--fg-3)',
              textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap', scrollSnapAlign: 'center',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.1s',
            }}>
              {t.label} ({t.n.toLocaleString('en-IN')})
            </a>
          ))}
        </div>

        {/* ── Prospectives summary ─────────────────────────────── */}
        {tab === 'prospective' && prospStats && prospStats.total > 0 && (() => {
          const s   = prospStats;
          const pct = (n: number) => s.total ? Math.round((n / s.total) * 100) : 0;
          const leadColor   = CLIENT_STATUS_COLORS.PROSPECTIVE_LEAD[0];
          const clientColor = CLIENT_STATUS_COLORS.PROSPECTIVE_CLIENT[0];

          // Each tile/segment links to the list filtered to match it. Status links
          // toggle: clicking the one already applied clears it.
          const statusHref = (v: string) =>
            buildUrl({ status: statFilts.length === 1 && statFilts[0] === v ? undefined : v, page: 1 });
          const visitHref = (v: string) =>
            buildUrl({ visit: visitFilts.length === 1 && visitFilts[0] === v ? undefined : v, page: 1 });

          const Tile = ({ label, value, sub, color, href }: {
            label: string; value: string; sub: string; color?: string; href?: string;
          }) => {
            const body = (
              <>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.10em', color: 'var(--fg-3)', fontWeight: 600 }}>{label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 27, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.05, marginTop: 5, color: color ?? 'var(--fg)' }}>{value}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>
              </>
            );
            const style: CSSProperties = {
              background: 'var(--bg-paper)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius)', padding: '13px 15px', display: 'block',
              textDecoration: 'none', ...(color ? { borderLeft: `3px solid ${color}` } : {}),
            };
            return href
              ? <Link href={href} className="exec-kpi-link" style={style}>{body}</Link>
              : <div style={style}>{body}</div>;
          };

          // Donut + clickable legend, shared by both charts.
          const Chart = ({ title, note, slices }: {
            title: string; note: string;
            slices: { name: string; n: number; color: string; href: string }[];
          }) => (
            <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '13px 15px' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.10em', color: 'var(--fg-3)', fontWeight: 600 }}>{title}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
                <Donut
                  size={112} thick={17}
                  data={slices.filter(x => x.n > 0).map(x => ({ pct: x.n, color: x.color, name: x.name }))}
                  center={<>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 700, color: 'var(--fg)', lineHeight: 1 }}>
                      {s.total.toLocaleString('en-IN')}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--fg-3)', marginTop: 2 }}>total</div>
                  </>}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 150 }}>
                  {slices.map(x => (
                    <Link key={x.name} href={x.href} className="exec-kpi-link"
                      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, textDecoration: 'none', color: 'var(--fg)' }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: x.color, flexShrink: 0 }} />
                      <span style={{ color: 'var(--fg-2)', flex: 1 }}>{x.name}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{x.n.toLocaleString('en-IN')}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', width: 34, textAlign: 'right' }}>{pct(x.n)}%</span>
                    </Link>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 10, lineHeight: 1.5 }}>{note}</div>
            </div>
          );

          return (
            <div style={{ marginBottom: 14 }}>
              <div className="r-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
                <Tile label="Total Prospectives" value={s.total.toLocaleString('en-IN')}
                  sub={`${s.leads.toLocaleString('en-IN')} leads · ${s.pclients.toLocaleString('en-IN')} clients`}
                  href={statFilts.length ? buildUrl({ status: undefined, page: 1 }) : undefined} />
                <Tile label="Visited (≤90d)" value={s.visited.toLocaleString('en-IN')}
                  sub={`${pct(s.visited)}% of prospects`} color="var(--pos)" href={visitHref('visited')} />
                <Tile label="Never Visited" value={s.neverVisited.toLocaleString('en-IN')}
                  sub={`${pct(s.neverVisited)}% — no visit on record`} color="var(--neg)" href={visitHref('never')} />
                <Tile label="In Play" value={s.inPlay.toLocaleString('en-IN')}
                  sub={`${formatRev(s.openValue)} in open opportunities`} color="var(--accent)" />
              </div>

              <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <Chart
                  title="Lead vs Client"
                  note="A Prospective-Lead is an unqualified lead on an auto LEAD_ code; a Prospective-Client has an enquiry and a real ERP code."
                  slices={[
                    { name: 'Prospective-Client', n: s.pclients, color: clientColor, href: statusHref('PROSPECTIVE_CLIENT') },
                    { name: 'Prospective-Lead',   n: s.leads,    color: leadColor,   href: statusHref('PROSPECTIVE_LEAD') },
                  ]} />
                <Chart
                  title="Visit Coverage"
                  note="Based on each client's last recorded visit. Visited means within the last 90 days — the same definition the Field page and Executive Review use."
                  slices={[
                    { name: 'Visited (≤90d)', n: s.visited,      color: 'var(--pos)', href: visitHref('visited') },
                    { name: 'Overdue (90d+)', n: s.overdue,      color: 'var(--warn)', href: visitHref('overdue') },
                    { name: 'Never visited',  n: s.neverVisited, color: 'var(--neg)', href: visitHref('never') },
                  ]} />
              </div>
            </div>
          );
        })()}

        {/* ── Filter toolbar (search + filters, grouped) ────────── */}
        <div style={{
          background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
          padding: 12, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <FilterBar q={q_str} sugar={sugarFilt} />
          {/* Mobile-only sort (the sortable table headers are hidden in card view) */}
          <MobileSortUrl
            options={CLIENT_SORT_OPTIONS}
            kinds={CLIENT_SORT_KINDS}
            currentSort={sortKey}
            currentDir={orderDir === 'DESC' ? 'desc' : 'asc'}
          />
          <div className="r-filter-row" style={{
            display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
            paddingTop: 10, borderTop: '1px solid var(--line-2)',
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', marginRight: 2 }}>Filter</span>
            <MultiSelectFilter param="industry" label="Industry"       options={industries}      selected={indFilts}  />
            <MultiSelectFilter param="zone"     label="Zone"           options={zones}           selected={zoneFilts} />
            <MultiSelectFilter param="country"  label="Country"
              options={countries.map(c => ({ value: c.country, label: c.country, count: c.n }))}
              selected={countryFilts} />
            <MultiSelectFilter param="tier"     label="Tier"           options={tiers}           selected={tierFilts} />
            <MultiSelectFilter param="ctype"    label="Client Type"    options={clientTypes}     selected={ctypeFilts} />
            {/* On the Prospectives tab the Status filter narrows WITHIN the tab
                (Lead vs Client), so it only offers those two — picking neither
                shows both. buildClientFilter enforces the same intersection. */}
            <MultiSelectFilter param="status"   label="Status"
              options={tab === 'prospective'
                ? CLIENT_STATUS_FILTER_OPTIONS.filter(o => (PROSPECTIVE_STATUSES as readonly string[]).includes(o.value))
                : CLIENT_STATUS_FILTER_OPTIONS}
              selected={statFilts} />
            <MultiSelectFilter param="rep"      label="Rep"            options={repOptions.map(r => ({ value: r.rep_name, label: r.rep_name, count: r.client_count }))} selected={repFilts} />
            <MultiSelectFilter param="fy"       label="Customer Since" options={fyYears}         selected={fyFilts} />
            <MultiSelectFilter param="rev"      label="Revenue"        options={revBuckets}      selected={revFilts}  />
            <MultiSelectFilter param="visit"    label="Last Visit"     options={visitBuckets}    selected={visitFilts} />
          </div>
        </div>

        {/* ── Active filter pills ───────────────────────────────── */}
        <ActiveFilterBar filters={[
          { param: 'industry', label: 'Industry', values: indFilts  },
          { param: 'zone',     label: 'Zone',     values: zoneFilts },
          { param: 'country',  label: 'Country',  values: countryFilts },
          { param: 'tier',     label: 'Tier',     values: tierFilts },
          { param: 'ctype',    label: 'Client Type', values: ctypeFilts },
          { param: 'status',   label: 'Status',   values: statFilts, valueLabels: CLIENT_STATUS_LABELS },
          { param: 'rep',      label: 'Rep',      values: repFilts  },
          { param: 'fy',       label: 'Customer Since', values: fyFilts },
          { param: 'rev',      label: 'Revenue',  values: revFilts },
          { param: 'visit',    label: 'Last Visit', values: visitFilts, valueLabels: Object.fromEntries(VISIT_BUCKETS.map(b => [b.value, b.label])) },
        ]} />

        {/* Appears only once something is ticked. */}
        <ClientSelectionBar pageCodes={clients.map(c => c.code)} filteredTotal={total} />

        {/* ── Table ────────────────────────────────────────────── */}
        <div style={{
          background:   'var(--bg-paper)',
          border:       '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          overflow:     'hidden',
          marginTop:    8,
        }}>
          {clients.length === 0 ? (
            <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--fg-3)' }}>
              {hasActiveFilters ? (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 4 }}>
                    No clients match the current filters
                  </div>
                  <div style={{ fontSize: 13 }}>
                    Try removing some filters or clearing the search
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 4 }}>
                    No clients found
                  </div>
                  <div style={{ fontSize: 13 }}>
                    The client database appears to be empty
                  </div>
                </>
              )}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    <th style={{ width: 34, padding: '8px 0 8px 12px', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)' }}>
                      <SelectPageBox codes={clients.map(c => c.code)} />
                    </th>
                    <SortableTH col="code"       label="Code"         kind="text"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="name"       label="Client"       kind="text"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="industry"   label="Industry"     kind="text"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="zone"       label="Zone / Route" kind="text"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="rep"        label="Rep"          kind="text"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="last_visit" label="Last Visit"   kind="date"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="status"     label="Status"       kind="status" currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="tier"       label="Tier"         kind="text"   currentSort={curSort} currentDir={curDir} />
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c, i) => {
                    const lv = formatLastVisitShort(
                      c.last_visit_date ? new Date(c.last_visit_date).toISOString() : null,
                    );

                    return (
                      <tr key={c.id} style={{ borderBottom: i < clients.length - 1 ? '1px solid var(--line)' : 'none' }}>

                        {/* Selection */}
                        <td data-label="" style={{ ...TD, width: 34, paddingRight: 0 }}>
                          <SelectClientBox code={c.code} />
                        </td>

                        {/* Code */}
                        <td data-label="Code" style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                          {c.code}
                        </td>

                        {/* Client name */}
                        <td data-label="" style={{ ...TD, minWidth: 180 }}>
                          <Link
                            href={`/risansi/clients/${c.code}`}
                            style={{ fontWeight: 500, fontSize: 12, color: 'var(--fg)', textDecoration: 'none' }}
                          >
                            {c.legal_name}
                          </Link>
                          {c.trade_name && c.trade_name !== c.legal_name && (
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{c.trade_name}</div>
                          )}
                        </td>

                        {/* Industry */}
                        <td data-label="Industry" style={TD}><Tag>{c.industry}</Tag></td>

                        {/* Zone / Route */}
                        <td data-label="Zone / Route" style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 12 }}>{c.zone || c.tour_zone || '—'}</div>
                          {c.tour_name && (
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{c.tour_name}</div>
                          )}
                        </td>

                        {/* Rep */}
                        <td data-label="Rep" style={{ padding: '0 12px' }}>
                          <span style={{
                            fontSize: 12,
                            color: 'var(--fg-2)',
                            fontWeight: 500,
                          }}>
                            {c.rep_name || '—'}
                          </span>
                        </td>

                        {/* Last visit */}
                        <td data-label="Last Visit" style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: lv.color, whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: lv.label === 'Never' ? 400 : 500 }}>{lv.label}</span>
                        </td>

                        {/* Status */}
                        <td data-label="Status" style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <StatusDot s={statusDotKind(c.status)} />
                            <span style={{ fontSize: 11 }}>{clientStatusLabel(c.status)}</span>
                          </div>
                        </td>

                        {/* Tier */}
                        <td data-label="Tier" style={TD}>
                          {c.tier ? <Tag kind={tierKind(c.tier)}>{c.tier}</Tag> : null}
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Pagination ────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString('en-IN')}
            </span>
            <div className="r-pager" style={{ display: 'flex', gap: 4 }}>
              {pageNum > 1 && (
                <a href={buildUrl({ page: pageNum - 1 })} style={PAGE_BTN}>← Prev</a>
              )}
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let p = i + 1;
                if (totalPages > 7) {
                  const start = Math.max(1, Math.min(pageNum - 3, totalPages - 6));
                  p = start + i;
                }
                return (
                  <a key={p} href={buildUrl({ page: p })}
                    style={{ ...PAGE_BTN, ...(p === pageNum ? PAGE_ACTIVE : {}) }}>
                    {p}
                  </a>
                );
              })}
              {pageNum < totalPages && (
                <a href={buildUrl({ page: pageNum + 1 })} style={PAGE_BTN}>Next →</a>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
    </ClientSelectionProvider>
  );
}

// ── Style constants ────────────────────────────────────────────

const TD: CSSProperties = {
  padding:       '10px 12px',
  verticalAlign: 'middle',
};

const PAGE_BTN: CSSProperties = {
  display:        'inline-flex',
  alignItems:     'center',
  justifyContent: 'center',
  minWidth:       30,
  height:         28,
  padding:        '0 8px',
  fontSize:       12,
  fontFamily:     'var(--font-mono)',
  background:     'var(--bg-paper)',
  border:         '1px solid var(--line-strong)',
  borderRadius:   5,
  color:          'var(--fg)',
  textDecoration: 'none',
  cursor:         'pointer',
};

const PAGE_ACTIVE: CSSProperties = {
  background: 'var(--accent-fill)',
  color:      'var(--on-accent)',
  border:     '1px solid var(--accent-fill)',
  fontWeight: 500,
};
