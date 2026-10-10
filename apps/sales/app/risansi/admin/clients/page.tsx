import type { CSSProperties } from 'react';
import { Topbar, Tag, StatusDot, MultiSelectFilter, ActiveFilterBar, SortableTH } from '@/components/risansi';
import { clientStatusLabel, statusDotKind, CLIENT_STATUS_FILTER_OPTIONS, CLIENT_STATUS_LABELS, CLIENT_STATUSES } from '@/lib/risansi-client-status';
import { AddClientButton } from '@/components/risansi/ClientFormDrawer';
import { EditClientLink } from '@/components/risansi/EditClientLink';
import { ArchiveClientToggle } from '@/components/risansi/ArchiveClientToggle';
import { ClientOwnershipButton, type AssignableRep } from '@/components/risansi/ClientOwnershipButton';
import risansiPool from '@/lib/db-risansi';
import { formatLastVisitShort } from '@/lib/risansi-utils';
import { getCurrentUser, clientVisibilitySql } from '@/lib/risansi-auth';
import { FilterBar } from '../../clients/FilterBar';
import { clientRepIdsSql, clientRepNamesSql } from '@/lib/risansi-client-rep';

const PAGE_SIZE = 50;

// Status is a lifecycle, not a word list, so it ranks by CLIENT_STATUSES rather
// than by the alphabet. A status added there orders itself here.
const STATUS_RANK_SQL = `CASE UPPER(c.status) ${
  CLIENT_STATUSES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')
} ELSE ${CLIENT_STATUSES.length} END`;

// Only columns confirmed to exist are listed here. A key that is not in this
// map never reaches the query — it falls back to the default below.
const SORT_MAP: Record<string, string> = {
  code:       'c.code',
  name:       'c.legal_name',
  industry:   'c.industry',
  // What the cell shows: the client's own zone, falling back to the route's.
  zone:       `COALESCE(NULLIF(c.zone, ''), tr.zone)`,
  last_visit: `COALESCE(c.last_visit_date, DATE '0001-01-01')`,
  status:     STATUS_RANK_SQL,
  tier:       'c.tier',
  rep:        'rep_name',
};

// The reps who work the client: primary first, then anyone covering it.
const OWNERS_SUBQUERY = clientRepNamesSql('c.id');

export default async function ClientMasterPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams;

  // Client Master is an admin surface, but still apply the predicate for any
  // non-admin who reaches it. clientVisibilitySql returns null for admin/sysadmin.
  const user = await getCurrentUser();

  const q_str     = typeof sp.q        === 'string' ? sp.q.trim()        : '';
  const sugarFilt = typeof sp.sugar    === 'string' ? sp.sugar.trim()    : '';
  // Archived rows are hidden everywhere else in the portal; this page is the one
  // that can show them, so the tick can be undone where it was made.
  const showArchived = sp.archived === '1';
  const sortKey   = typeof sp.sort     === 'string' ? sp.sort            : 'last_visit';
  // The headers write ?dir=; older links carry ?order=. Reading both means a
  // header click is never silently ignored and a bookmark still works.
  const dirParam  = typeof sp.dir === 'string' ? sp.dir : typeof sp.order === 'string' ? sp.order : '';
  const orderDir  = dirParam === 'desc'             ? 'DESC'             : 'ASC';
  const pageNum   = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const limit     = PAGE_SIZE;
  const offset    = (pageNum - 1) * limit;    // page 1 → offset 0  ✓

  // Multi-select filters — comma-separated in URL
  const indFilts  = typeof sp.industry === 'string' && sp.industry ? sp.industry.split(',').filter(Boolean) : [];
  const zoneFilts = typeof sp.zone     === 'string' && sp.zone     ? sp.zone.split(',').filter(Boolean)     : [];
  const tierFilts = typeof sp.tier     === 'string' && sp.tier     ? sp.tier.split(',').filter(Boolean)     : [];
  const statFilts = typeof sp.status   === 'string' && sp.status   ? sp.status.split(',').filter(Boolean).map(s => s.toUpperCase()) : [];
  const repFilts  = typeof sp.rep      === 'string' && sp.rep      ? sp.rep.split(',').filter(Boolean)      : [];

  const hasActiveFilters = !!(q_str || sugarFilt || indFilts.length || zoneFilts.length || tierFilts.length || statFilts.length || repFilts.length);
  const sortCol = SORT_MAP[sortKey] ?? 'c.last_visit_date';

  // ── Build parameterised WHERE conditions ──────────────────────
  const whereConditions: string[] = [showArchived ? 'c.deleted_at IS NOT NULL' : 'c.deleted_at IS NULL'];
  const params: (string | number | boolean | string[])[] = [];

  if (q_str) {
    const pIdx = params.push(`%${q_str}%`);
    whereConditions.push(
      `(c.legal_name ILIKE $${pIdx} OR c.trade_name ILIKE $${pIdx} OR c.code ILIKE $${pIdx} OR c.city ILIKE $${pIdx} OR c.state ILIKE $${pIdx})`
    );
  }
  if (indFilts.length > 0) {
    whereConditions.push(`c.industry = ANY($${params.push(indFilts)}::text[])`);
  }
  if (zoneFilts.length > 0) {
    // Zone lives on the tour (clients.zone is unused), so filter on tr.zone.
    whereConditions.push(`tr.zone = ANY($${params.push(zoneFilts)}::text[])`);
  }
  if (tierFilts.length > 0) {
    whereConditions.push(`c.tier = ANY($${params.push(tierFilts)}::text[])`);
  }
  if (statFilts.length > 0) {
    whereConditions.push(`UPPER(c.status) = ANY($${params.push(statFilts)}::text[])`);
  }
  if (repFilts.length > 0) {
    const rIdx = params.push(repFilts);
    whereConditions.push(
      `EXISTS (SELECT 1 FROM (${clientRepIdsSql('c.id')}) r
                JOIN users u ON u.id = r.user_id WHERE u.name = ANY($${rIdx}::text[]))`
    );
  }
  if (sugarFilt === 'true')  whereConditions.push('c.is_sugar = TRUE');
  if (sugarFilt === 'false') whereConditions.push('(c.is_sugar = FALSE OR c.is_sugar IS NULL)');

  // Per-user visibility — null for admin/sysadmin (no restriction), enforced otherwise.
  const visPred = clientVisibilitySql(user, 'c');
  if (visPred) whereConditions.push(`(${visPred})`);

  const whereClause = whereConditions.join(' AND ');
  const countParams = [...params]; // snapshot before limit/offset are pushed

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
    owner_name:      string | null;
    cover_count:     number;
    is_end_client:   boolean;
    is_archived:     boolean;
  }

  interface RepOption { rep_name: string; client_count: number; }

  // ── All queries in parallel ────────────────────────────────────
  const [clients, total, industries, zones, tiers, repOptions, assignableReps] = await Promise.all([

    (async (): Promise<ClientRow[]> => {
      try {
        const { rows } = await risansiPool.query<ClientRow>(
          `SELECT
             c.id, c.code, c.legal_name, c.trade_name,
             c.industry, c.is_sugar, c.state, c.city,
             c.status, c.tier, c.is_end_client, (c.deleted_at IS NOT NULL) AS is_archived,
             c.last_visit_date,
             c.zone,
             tr.name AS tour_name,
             tr.zone AS tour_zone,
             COALESCE(${OWNERS_SUBQUERY}, '—') AS rep_name,
             (SELECT u.name FROM users u WHERE u.id = c.primary_rep_id) AS owner_name,
             (SELECT COUNT(*)::int FROM client_secondary_reps s WHERE s.client_id = c.id) AS cover_count
           FROM clients c
           LEFT JOIN tour_routes tr ON tr.id = c.tour_id
           WHERE ${whereClause}
           -- NULLS LAST both ways: a row with no value is an absence, not the
           -- smallest value, and floating them to the top of either direction
           -- buries the rows the header was clicked to surface.
           -- c.id breaks ties, so a row cannot swap pages under the pager.
           ORDER BY ${sortCol} ${orderDir} NULLS LAST, c.id
           LIMIT  $${limIdx}
           OFFSET $${offIdx}`,
          mainParams as (string | number)[],
        );
        return rows;
      } catch (err) {
        console.error('[admin/clients/page] main query failed:', err);
        return [];
      }
    })(),

    (async (): Promise<number> => {
      try {
        const { rows } = await risansiPool.query<{ count: string }>(
          `SELECT COUNT(DISTINCT c.id)::text AS count
           FROM clients c
           LEFT JOIN tour_routes tr ON tr.id = c.tour_id
           WHERE ${whereClause}`,
          countParams as (string | number)[],
        );
        return Number(rows[0]?.count ?? 0);
      } catch (err) {
        console.error('[admin/clients/page] count query failed:', err);
        return 0;
      }
    })(),

    (async (): Promise<string[]> => {
      try {
        const { rows } = await risansiPool.query<{ industry: string }>(
          `SELECT DISTINCT industry FROM clients WHERE industry IS NOT NULL AND deleted_at IS NULL ORDER BY industry`,
        );
        return rows.map(r => r.industry);
      } catch { return []; }
    })(),

    (async (): Promise<string[]> => {
      try {
        const { rows } = await risansiPool.query<{ zone: string }>(
          `SELECT DISTINCT zone FROM tour_routes WHERE zone IS NOT NULL AND zone <> '' ORDER BY zone`,
        );
        return rows.map(r => r.zone);
      } catch { return []; }
    })(),

    (async (): Promise<string[]> => {
      try {
        const { rows } = await risansiPool.query<{ tier: string }>(
          `SELECT DISTINCT tier FROM clients WHERE tier IS NOT NULL AND deleted_at IS NULL ORDER BY tier`,
        );
        return rows.map(r => r.tier);
      } catch { return []; }
    })(),

    (async (): Promise<RepOption[]> => {
      try {
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

    // Everyone who can own or cover a client, for the ownership picker.
    (async (): Promise<AssignableRep[]> => {
      try {
        const { rows } = await risansiPool.query<AssignableRep>(
          `SELECT id::int AS id, name, role
             FROM users
            WHERE is_active = TRUE AND role IN ('rep', 'manager')
            ORDER BY role DESC, name ASC`,
        );
        return rows;
      } catch { return []; }
    })(),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function buildUrl(overrides: Record<string, string | number | undefined>): string {
    const base: Record<string, string> = {};
    if (q_str)              base.q        = q_str;
    if (indFilts.length)    base.industry = indFilts.join(',');
    if (zoneFilts.length)   base.zone     = zoneFilts.join(',');
    if (tierFilts.length)   base.tier     = tierFilts.join(',');
    if (statFilts.length)   base.status   = statFilts.join(',');
    if (repFilts.length)    base.rep      = repFilts.join(',');
    if (sugarFilt)          base.sugar    = sugarFilt;
    if (showArchived)       base.archived = '1';
    if (sortKey)            base.sort     = sortKey;
    // Same param the headers write, so turning a page keeps the chosen order.
    if (orderDir === 'DESC') base.dir     = 'desc';
    base.page = String(pageNum);
    const merged = { ...base, ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [k, v == null ? undefined : String(v)])
    )};
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v != null && v !== '') p.set(k, v);
    }
    return `/risansi/admin/clients?${p.toString()}`;
  }

  function tierKind(t: string | null): 'accent' | undefined {
    return t === 'Key' ? 'accent' : undefined;
  }

  const curSort = sortKey;
  const curDir  = orderDir === 'DESC' ? 'desc' : 'asc';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sticky topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Admin', 'Client Master']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* ── Page header ──────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Client Master
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              Client master · {total.toLocaleString('en-IN')} records
            </div>
          </div>
          <AddClientButton />
        </div>

        {/* ── Search + Sugar toggle ─────────────────────────────── */}
        <FilterBar q={q_str} sugar={sugarFilt} />
        {/* The only way back to an archived client from this page. */}
        <div style={{ margin: '8px 0 0' }}>
          <a
            href={buildUrl({ archived: showArchived ? undefined : '1', page: 1 })}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5,
              padding: '6px 12px', borderRadius: 'var(--radius)', textDecoration: 'none',
              border: `1px solid ${showArchived ? 'var(--warn)' : 'var(--line-strong)'}`,
              background: showArchived ? 'var(--warn-soft)' : 'var(--bg-paper)',
              color: showArchived ? 'var(--warn-strong, var(--warn))' : 'var(--fg-2)',
              fontWeight: showArchived ? 600 : 400,
            }}
          >
            <input type="checkbox" readOnly checked={showArchived} style={{ pointerEvents: 'none', width: 14, height: 14 }} />
            Show archived
            {showArchived && <span style={{ fontWeight: 400 }}>· untick a row to restore it</span>}
          </a>
        </div>

        {/* ── Multi-select filter row ───────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', paddingBottom: 8 }}>
          <MultiSelectFilter param="industry" label="Industry"  options={industries}      selected={indFilts}  />
          <MultiSelectFilter param="zone"     label="Zone"      options={zones}           selected={zoneFilts} />
          <MultiSelectFilter param="tier"     label="Tier"      options={tiers}           selected={tierFilts} />
          <MultiSelectFilter param="status"   label="Status"    options={CLIENT_STATUS_FILTER_OPTIONS} selected={statFilts} />
          <MultiSelectFilter param="rep"      label="Rep"       options={repOptions.map(r => ({ value: r.rep_name, label: r.rep_name, count: r.client_count }))} selected={repFilts} />
        </div>

        {/* ── Active filter pills ───────────────────────────────── */}
        <ActiveFilterBar filters={[
          { param: 'industry', label: 'Industry', values: indFilts  },
          { param: 'zone',     label: 'Zone',     values: zoneFilts },
          { param: 'tier',     label: 'Tier',     values: tierFilts },
          { param: 'status',   label: 'Status',   values: statFilts, valueLabels: CLIENT_STATUS_LABELS },
          { param: 'rep',      label: 'Rep',      values: repFilts  },
        ]} />

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
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    <SortableTH col="code"       label="Code"         kind="text"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="name"       label="Client"       kind="text"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="industry"   label="Industry"     kind="text"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="zone"       label="Zone / Route" kind="text"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="rep"        label="Rep"          kind="text"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="last_visit" label="Last Visit"   kind="date"   currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="status"     label="Status"       kind="status" currentSort={curSort} currentDir={curDir} />
                    <SortableTH col="tier"       label="Tier"         kind="text"   currentSort={curSort} currentDir={curDir} />
                    <th style={{ padding: '9px 12px', textAlign: 'center', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>Archive</th>
                    <th style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>Owner & cover</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c, i) => {
                    const lv = formatLastVisitShort(
                      c.last_visit_date ? new Date(c.last_visit_date).toISOString() : null,
                    );

                    return (
                      <tr key={c.id} style={{ borderBottom: i < clients.length - 1 ? '1px solid var(--line)' : 'none' }}>

                        {/* Code */}
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
                          {c.code}
                        </td>

                        {/* Client name — opens the edit drawer (Client Master lets you edit the code) */}
                        <td style={{ ...TD, minWidth: 180 }}>
                          <EditClientLink clientId={Number(c.id)} name={c.legal_name} />
                          {c.trade_name && c.trade_name !== c.legal_name && (
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{c.trade_name}</div>
                          )}
                        </td>

                        {/* Industry */}
                        <td style={TD}><Tag>{c.industry}</Tag></td>

                        {/* Zone / Route */}
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ fontSize: 12 }}>{c.zone || c.tour_zone || '—'}</div>
                          {c.tour_name && (
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{c.tour_name}</div>
                          )}
                        </td>

                        {/* Rep */}
                        <td style={{ padding: '0 12px' }}>
                          <span style={{
                            fontSize: 12,
                            color: 'var(--fg-2)',
                            fontWeight: 500,
                          }}>
                            {c.rep_name || '—'}
                          </span>
                        </td>

                        {/* Last visit */}
                        <td style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: lv.color, whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: lv.label === 'Never' ? 400 : 500 }}>{lv.label}</span>
                        </td>

                        {/* Status */}
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <StatusDot s={statusDotKind(c.status)} />
                            <span style={{ fontSize: 11 }}>{clientStatusLabel(c.status)}</span>
                          </div>
                        </td>

                        {/* Tier */}
                        <td style={TD}>
                          {c.tier ? <Tag kind={tierKind(c.tier)}>{c.tier}</Tag> : null}
                        </td>

                        {/* Archive. End Client moved to the client's own edit
                            form — it labels the account, this removes it. */}
                        <td style={{ ...TD, textAlign: 'center' }}>
                          <ArchiveClientToggle clientId={c.id} name={c.legal_name} archived={c.is_archived} />
                        </td>

                        {/* Who works it */}
                        <td style={TD}>
                          <ClientOwnershipButton
                            clientId={Number(c.id)}
                            clientCode={c.code}
                            clientName={c.legal_name}
                            reps={assignableReps}
                            ownerName={c.owner_name}
                            coverCount={c.cover_count}
                          />
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
            <div style={{ display: 'flex', gap: 4 }}>
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
  background: 'var(--accent)',
  color:      '#fff',
  border:     '1px solid var(--accent)',
  fontWeight: 500,
};
