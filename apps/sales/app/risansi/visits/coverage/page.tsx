import type { CSSProperties } from 'react';
import { Topbar } from '@/components/risansi';
import { CoverageMapSvg, type ClientPin } from '@/components/risansi/CoverageMapSvg';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientVisibilitySql } from '@/lib/risansi-auth';
import { parseVisitFilters, getVisitFilterOptions } from '@/lib/risansi-visit-filters';
import { VisitFilterControls } from '@/components/risansi/VisitFilterControls';
import { clientRepIdsSql, clientRepNamesSql } from '@/lib/risansi-client-rep';
import { SortedTable } from '@/components/risansi/SortedTable';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

// ── Types ──────────────────────────────────────────────────────

interface TourRow {
  tour:         string;
  client_count: number;
  compliant:    number;
  overdue:      number;
}

// ── Page ───────────────────────────────────────────────────────

export default async function CoverageMapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // Per-user client visibility (inline integer ids, no params).
  const currentUser = await getCurrentUser();
  const cVis    = clientVisibilitySql(currentUser, 'c');
  const cVisAnd = cVis ? ` AND (${cVis})` : '';

  const filters    = parseVisitFilters(sp);
  const filterOpts = await getVisitFilterOptions(currentUser);

  const [clients, tours] = await Promise.all([

    // All active clients with location + visit data
    q<ClientPin[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; code: string; legal_name: string; industry: string | null;
        state: string | null; city: string | null;
        status: string; tier: string | null;
        last_visit_date: string | null;
        days_since: string | null;
        rep_name: string;
      }>(
        `SELECT
           c.id, c.code, c.legal_name, c.industry,
           c.state, c.city,
           c.status, c.tier, c.last_visit_date::text,
           (CURRENT_DATE - c.last_visit_date::date)::text AS days_since,
           COALESCE(${clientRepNamesSql('c.id')}, '—') AS rep_name
         FROM clients c
         WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE'${cVisAnd}${filters.clientAnd}
         ORDER BY c.last_visit_date ASC NULLS FIRST`,
      );
      return rows.map(r => ({
        id:              r.id,
        code:            r.code,
        legal_name:      r.legal_name,
        industry:        r.industry,
        state:           r.state,
        city:            r.city,
        tier:            r.tier,
        last_visit_date: r.last_visit_date,
        days_since:      r.days_since != null ? Number(r.days_since) : null,
        rep_name:        r.rep_name,
      }));
    }, []),

    // Tour route summary
    q<TourRow[]>(async () => {
      const { rows } = await risansiPool.query<{
        tour: string; client_count: string; compliant: string; overdue: string;
      }>(
        `SELECT
           COALESCE(tr.name, 'Unassigned') AS tour,
           COUNT(*)::text AS client_count,
           COUNT(*) FILTER (WHERE c.last_visit_date >= NOW() - INTERVAL '100 days')::text AS compliant,
           COUNT(*) FILTER (
             WHERE c.last_visit_date < NOW() - INTERVAL '100 days'
               OR c.last_visit_date IS NULL
           )::text AS overdue
         FROM clients c
         LEFT JOIN tour_routes tr ON tr.id = c.tour_id
         WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE'${cVisAnd}${filters.clientAnd}
         GROUP BY tr.name
         -- The route with the most overdue clients first: this table's job is
         -- to say where coverage is worst. The order used to be applied in JS
         -- after the query, which meant a sortable header had to fight it.
         ORDER BY COUNT(*) FILTER (
                    WHERE c.last_visit_date < NOW() - INTERVAL '100 days'
                       OR c.last_visit_date IS NULL
                  ) DESC,
                  COUNT(*) DESC`,
      );
      return rows.map(r => ({
        tour:         r.tour,
        client_count: Number(r.client_count),
        compliant:    Number(r.compliant),
        overdue:      Number(r.overdue),
      }));
    }, []),
  ]);

  // ── Derived stats ─────────────────────────────────────────────

  const total     = clients.length;
  const compliant = clients.filter(c => c.days_since != null && c.days_since <= 100).length;
  const dueSoon   = clients.filter(c => c.days_since != null && c.days_since > 100 && c.days_since <= 150).length;
  const overdue   = clients.filter(c => c.days_since == null || c.days_since > 150).length;

  const unassigned = tours.find(t => t.tour === 'Unassigned')?.client_count ?? 0;

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Visit Plan', 'Coverage Map']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
            Coverage Map
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {total} active clients · Field visit compliance overview
          </div>
        </div>

        {/* Zone / Tour / Rep filters */}
        <VisitFilterControls opts={filterOpts} sel={{ zones: filters.zones, tours: filters.tours, reps: filters.reps }} />

        {/* ── A. Stats strip ─────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <StatChip label="Total Active"      value={total}     />
          <StatChip label="Compliant"         value={compliant} sublabel="< 100 days"        color="var(--pos)" />
          <StatChip label="Due Soon"          value={dueSoon}   sublabel="100 – 150 days"    color="var(--warn)" />
          <StatChip label="Overdue / Never"   value={overdue}   sublabel="> 150 days or null" color="var(--neg)" />
        </div>

        {/* ── B. Map ─────────────────────────────────────────── */}
        <div style={PANEL}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>India · Client Coverage</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {total} active accounts · hover for details
            </span>
          </div>
          <div style={{ padding: '16px 24px 8px' }}>
            <CoverageMapSvg clients={clients} />
          </div>
        </div>

        {/* ── C. Route summary table ──────────────────────────── */}
        <div style={{ ...PANEL, marginTop: 14 }}>
          <div style={PANEL_H}>
            <span style={PANEL_TITLE}>Route Summary</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {tours.length} tour routes · sorted by overdue
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {tours.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                No tour route data
              </div>
            ) : (
              <SortedTable
                style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
                headRowStyle={{ background: 'var(--bg-elev)' }}
                divider="1px solid var(--line)"
                lastDivider={false}
                columns={[
                  { key: 'tour',       label: 'Tour Route', kind: 'text',   style: TH },
                  { key: 'clients',    label: 'Clients',    kind: 'number', style: TH },
                  { key: 'compliant',  label: 'Compliant',  kind: 'number', style: TH },
                  { key: 'overdue',    label: 'Overdue',    kind: 'number', style: TH },
                  { key: 'pct',        label: 'Coverage %', kind: 'number', style: TH },
                ]}
                rows={tours.map(t => {
                  const pct = t.client_count > 0 ? (t.compliant / t.client_count) * 100 : 0;
                  const barColor = pct >= 80 ? 'var(--pos)' : pct >= 50 ? 'var(--warn)' : 'var(--neg)';
                  return {
                    id: t.tour,
                    // Coverage sorts on the percentage behind the bar, not on
                    // the bar; a route with no clients has no coverage to rank,
                    // so it is blank rather than a 0% among real figures.
                    values: {
                      tour: t.tour, clients: t.client_count,
                      compliant: t.compliant, overdue: t.overdue,
                      pct: t.client_count > 0 ? pct : null,
                    },
                    cells: (
                      <>
                        <td style={{ ...TD, fontWeight: t.tour === 'Unassigned' ? 400 : 500, color: t.tour === 'Unassigned' ? 'var(--fg-3)' : 'var(--fg)' }}>
                          {t.tour}
                        </td>
                        <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                          {t.client_count}
                        </td>
                        <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--pos)', fontWeight: 500 }}>
                          {t.compliant}
                        </td>
                        <td style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)', color: t.overdue > 0 ? 'var(--neg)' : 'var(--fg-3)', fontWeight: t.overdue > 0 ? 600 : 400 }}>
                          {t.overdue}
                        </td>
                        <td style={{ ...TD, minWidth: 150 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 5, background: 'var(--accent-soft)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2 }} />
                            </div>
                            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)', minWidth: 34, textAlign: 'right' }}>
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </>
                    ),
                  };
                })}
              />
            )}
          </div>
          {unassigned > 0 && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--fg-3)' }}>
              {unassigned} client{unassigned !== 1 ? 's have' : ' has'} no tour route assigned.{' '}
              <a href="/risansi/clients?status=ACTIVE" style={{ color: 'var(--brand-blue)', textDecoration: 'none', fontWeight: 500 }}>
                View in Clients →
              </a>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function StatChip({
  label, value, sublabel, color = 'var(--title)',
}: {
  label: string; value: number; sublabel?: string; color?: string;
}) {
  return (
    <div style={{
      background:   'var(--bg-paper)',
      border:       '1px solid var(--line)',
      borderLeft:   `3px solid ${color}`,
      borderRadius: 6,
      padding:      '10px 16px',
      minWidth:     120,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color, letterSpacing: '-0.02em' }}>
        {value.toLocaleString('en-IN')}
      </div>
      {sublabel && (
        <div style={{ fontSize: 10, color: '#8BA3C7', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const PANEL: CSSProperties = {
  background:   'var(--bg-paper)',
  border:       '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  overflow:     'hidden',
};

const PANEL_H: CSSProperties = {
  padding:      '12px 16px',
  borderBottom: '1px solid var(--line)',
  display:      'flex',
  alignItems:   'center',
  gap:          10,
};

const PANEL_TITLE: CSSProperties = {
  fontSize:      11,
  fontWeight:    700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color:         'var(--title)',
};

const TH: CSSProperties = {
  padding:       '9px 12px',
  textAlign:     'left',
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight:    600,
  color:         'var(--fg-3)',
  background:    'var(--accent-soft)',
  borderBottom:  '2px solid var(--accent-line)',
  whiteSpace:    'nowrap',
};

const TD: CSSProperties = {
  padding:       '10px 12px',
  verticalAlign: 'middle',
};
