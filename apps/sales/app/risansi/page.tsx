import type { CSSProperties, ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar, Sparkline, MiniBars, Donut, Tag } from '@/components/risansi';
import { ExportPdfButton } from '@/components/risansi/ExportPdfButton';
import { RefreshButton } from '@/components/risansi/RefreshButton';
import Link from 'next/link';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { clientStatusLabel, CLIENT_STATUSES } from '@/lib/risansi-client-status';
import { SortableTH } from '@/components/risansi/SortableTH';
import { sortRows, type SortableColumn } from '@/lib/risansi-table-sort';
import {
  getCurrentFY, fyShortLabel,
  fyYtdPct, fyDaysLeft, formatIndianDate, formatTime, fmtCr, fmtL,
  getGreeting, formatRev, PLAN_VISIT_LABEL,
} from '@/lib/risansi-utils';
import { DashDrilldownProvider, DashCell } from '@/components/risansi/DashDrilldown';
import type { DashDrillParams } from '@/app/actions/risansi-dashboard-drilldown';
// Every WHERE below comes from here, and so does every WHERE in
// app/actions/risansi-dashboard-drilldown.ts. A figure and the list behind it
// that build their scope separately agree today and disagree after the next
// edit — see the header comment on the module.
import {
  INR_TO_L, OPEN_STAGES, OTHERS_PCP, PIPELINE_STAGES,
  SO_SUM_JOIN, IN_HAND_CR, BOOKED_CR,
  activeClientWhere, atRiskExposureOn, atRiskWhere, dashScope, dashWindows,
  overdueClientWhere, repPipelineWhere, revClientWhere, revMonthsSql,
  stageWhere, visitsThisWeekWhere, wonClientWhere,
} from '@/lib/risansi-dashboard';

// ── Safe query wrapper ─────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) { console.error('[dashboard] panel query failed', e); return fallback; }
}

// ── Competitor colour palette ──────────────────────────────────

const COMP_COLORS: Record<string, string> = {
  RIL:      '#0A3D8F',
  Roto:     '#1A5CB8',
  Rotomac:  '#5B8DD9',
  Gita:     '#00B4D8',
  Sintech:  '#DC2626',
  PSP:      '#D97706',
  Netzsch:  '#2E7DD1',
  Tushaco:  '#B45309',
  Others:   '#DDE6F5',
};

function compColor(name: string): string {
  return COMP_COLORS[name] ?? COMP_COLORS.Others;
}

// ── Funnel stage colours ───────────────────────────────────────

const FUNNEL_COLORS: Record<string, string> = {
  Suspect:     '#93C5FD',
  Prospect:    '#3B82F6',
  Quoted:      '#1D4ED8',
  Negotiating: 'var(--warn)',
  'On Hold':   'var(--purple)',
};

// OPEN_STAGES and PIPELINE_STAGES live in lib/risansi-dashboard.ts so the
// drill-down behind each funnel bar is reading the same list of stages.

// ── Data shapes ────────────────────────────────────────────────

interface RevenueSplit { pump: number; spare: number; }
interface HistoricalFY { code: string; label: string; total: number; }
interface SegmentRow   { segment: string; ytd_inr: number; }
interface FunnelRow    { stage: string; count: number; value: number; }
interface MarketEntry  { supplier: string; units: number; pct: number; color: string; }
interface CIBTotals    { ril: number; roto: number; rotomac: number; netzsch: number; gita: number; psp: number; tushaco: number; others: number; total: number; }
interface TopAccount {
  client_code: string; legal_name: string; industry: string; zone: string; status: string;
  ytd: number; py: number;
}
interface VisitEntry {
  id: string; rep_name: string; client_name: string;
  visit_date: Date; outcome: string | null; purpose: string; status: string; synced: boolean;
}
interface AtRisk { count: number; exposure: number; }
interface UpcomingVisit {
  id: string; visit_date: string; purpose: string | null; status: string;
  client_name: string; client_code: string; city: string | null; rep_name: string;
}
interface AutoOpp {
  id: string; product: string | null; stage: string;
  auto_source: string | null; created_at: string;
  client_name: string; client_code: string;
}

// ── Top Accounts sort ──────────────────────────────────────────
//
// The one table on this page, and the only one sorted from the URL rather than
// in the browser. The panel is a server component: it runs fourteen queries and
// prints the result, and a React hook cannot live in it, so the sort travels as
// ?sort= & ?dir= and the page re-renders in the new order.
//
// The ordering itself still happens over the whole set the panel holds — all
// seven rows, already fetched — rather than being pushed into the SQL. That
// matters: "Top Accounts · YTD Revenue" means the seven largest accounts, so an
// ORDER BY in the query would change WHICH seven are listed the moment somebody
// sorted by name, and the panel would stop being what its heading promises.
//
// vs PY sorts on the ratio, not the "+12.4%" the cell prints, and an account
// with no previous year has no ratio at all — it reads null and sinks to the
// bottom either way, which is where its em-dash belongs.
const TOP_ACCOUNT_COLS: SortableColumn<TopAccount>[] = [
  { key: 'legal_name', kind: 'text' },
  { key: 'industry',   kind: 'text' },
  { key: 'zone',       kind: 'text' },
  { key: 'ytd',        kind: 'number' },
  { key: 'vspy',       kind: 'number', value: a => (a.py > 0 ? ((a.ytd - a.py) / a.py) * 100 : null) },
  // A client status is a lifecycle, not a word list, so it sorts by
  // CLIENT_STATUSES — the sequence the portal defines everywhere else.
  { key: 'status',     kind: 'status', order: CLIENT_STATUSES },
];

// ── Page ───────────────────────────────────────────────────────

export default async function ExecDashboardPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const sortKey = typeof sp.sort === 'string' ? sp.sort : '';
  const sortDir: 'asc' | 'desc' = sp.dir === 'asc' ? 'asc' : 'desc';

  // ── Mobile redirect (must live here, not in layout) ────────
  const headersList = await headers();
  const ua = headersList.get('user-agent') ?? '';
  if (/Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(ua)) {
    redirect('/risansi/mobile');
  }

  const session     = await getServerSession(authOptions);
  const displayName = session?.user?.name ?? session?.user?.email ?? 'Admin';
  const role        = session?.user?.role ?? '';

  // Per-user visibility predicates (inline integer ids, no params).
  const currentUser = await getCurrentUser();
  const scope = dashScope(currentUser);
  const { cVisAnd, oppOwnerAnd, visitOwnerAnd } = scope;

  // Only admin / sysadmin see the full company dashboard (incl. the target).
  // Reps AND managers always get the tour-scoped personal view — their tours'
  // numbers only, never the company-wide picture, and never the target.
  const showFull = hasRole(role, 'admin');

  // Fiscal year (dynamic, April→March) — shared by both dashboard views and
  // every revenue query, so nothing goes stale when the year rolls over.
  const fy      = getCurrentFY();
  const w       = dashWindows();
  const { cyStart, cyEnd, pyStart, histStart } = w;

  // ── Rep-specific dashboard (personal view) ─────────────────────
  if (!showFull) {
    const email = session?.user?.email ?? '';
    const today = new Date();

    // Prefer the linked rep_id from the session; fall back to email lookup
    // for reps approved before rep-linking existed.
    const repRow = await q<{ id: string } | null>(async () => {
      const { rows } = await risansiPool.query<{ id: string }>(
        'SELECT id::text AS id FROM users WHERE lower(email) = lower($1) LIMIT 1',
        [email],
      );
      return rows[0] ?? null;
    }, null);
    const repId = (session?.user?.repId != null ? String(session.user.repId) : null) ?? repRow?.id ?? null;

    const [myVisitsCount, myOverdueCount, myPipelineValue, myClientsCount, myRecentVisits, myOverdueClients, myRevenue] = await Promise.all([

      // My visits this week — owner visibility on v.rep_id
      q<number>(async () => {
        if (!repId) return 0;
        const { rows } = await risansiPool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM visits v
           WHERE ${visitsThisWeekWhere(scope)}`,
        );
        return Number(rows[0]?.cnt ?? 0);
      }, 0),

      // My overdue clients (no visit 90+ days) — client visibility
      q<number>(async () => {
        if (!repId) return 0;
        const { rows } = await risansiPool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM clients c
           WHERE ${overdueClientWhere(scope)}`,
        );
        return Number(rows[0]?.cnt ?? 0);
      }, 0),

      // My pipeline value (Crores) — owner visibility on o.rep_id
      q<number>(async () => {
        if (!repId) return 0;
        const { rows } = await risansiPool.query<{ total: string }>(
          `SELECT COALESCE(SUM(o.value_cr),0)::text AS total
           FROM opportunities o
           WHERE ${repPipelineWhere(scope)}`,
        );
        return Number(rows[0]?.total ?? 0);
      }, 0),

      // My active client count — client visibility
      q<number>(async () => {
        if (!repId) return 0;
        const { rows } = await risansiPool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM clients c
           WHERE ${activeClientWhere(scope)}`,
        );
        return Number(rows[0]?.cnt ?? 0);
      }, 0),

      // My recent visits (last 10) — owner visibility on v.rep_id
      q<VisitEntry[]>(async () => {
        if (!repId) return [];
        const { rows } = await risansiPool.query<{
          id: string; rep_name: string; client_name: string;
          visit_date: Date; outcome: string | null; purpose: string; status: string;
        }>(
          `SELECT v.id,
                  COALESCE(r.name, '—') AS rep_name,
                  c.legal_name          AS client_name,
                  v.visit_date, v.outcome, v.purpose, v.status
           FROM visits v
           JOIN clients c ON c.id = v.client_id
           LEFT JOIN users r ON r.id = v.rep_id
           WHERE v.status IN ('completed','checked-in')${visitOwnerAnd}
           ORDER BY v.visit_date DESC
           LIMIT 10`,
        );
        return rows.map(r => ({
          id: r.id, rep_name: r.rep_name,
          client_name: r.client_name, visit_date: new Date(r.visit_date),
          outcome: r.outcome, purpose: r.purpose, status: r.status, synced: false,
        }));
      }, []),

      // My overdue clients list — client visibility
      q<{ id: string; code: string; legal_name: string; days_overdue: number }[]>(async () => {
        if (!repId) return [];
        const { rows } = await risansiPool.query<{
          id: string; code: string; legal_name: string; days_overdue: number;
        }>(
          `SELECT c.id::text AS id, c.code, c.legal_name,
                  COALESCE(EXTRACT(DAY FROM NOW() - c.last_visit_date)::int, 999) AS days_overdue
           FROM clients c
           WHERE ${overdueClientWhere(scope)}
           ORDER BY 4 DESC
           LIMIT 20`,
        );
        return rows;
      }, []),

      // My tours' booked revenue this FY (Crores) — tour-scoped via client visibility
      q<number>(async () => {
        if (!repId) return 0;
        const { rows } = await risansiPool.query<{ total: string }>(
          `SELECT COALESCE(SUM(crm.total_value),0)::text AS total
           FROM client_revenue_monthly crm
           JOIN clients c ON c.id = crm.client_id
           WHERE ${revClientWhere(w, scope)}`,
        );
        return Number(rows[0]?.total ?? 0) / 10_000_000;
      }, 0),
    ]);

    return (
      <DashDrilldownProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
          <Topbar crumbs={['Risansi', 'My Dashboard']} primaryAction={PLAN_VISIT_LABEL} primaryActionHref="/risansi/field" />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

          {/* Greeting */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              {getGreeting()}, {displayName}.
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              {formatIndianDate(today)}
              {!repId && ' · Rep profile not linked — contact admin to sync your account'}
            </div>
          </div>

          {/* Account-not-linked warning */}
          {!repId && <RepNotLinkedWarning />}

          {/* 5 KPI cards — scoped to the clients you own or cover */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
            <RepKpi label={`Revenue (${fy.label})`} value={fmtCr(myRevenue)}       sub="Booked · your clients" drill={{ kind: 'my_revenue' }} />
            <RepKpi label="Visits This Week"   value={String(myVisitsCount)}  sub="Last 7 days" drill={{ kind: 'my_visits_week' }} />
            <RepKpi label="Overdue Clients"    value={String(myOverdueCount)} sub="No visit 90+ days" neg={myOverdueCount > 0} drill={{ kind: 'my_overdue' }} />
            <RepKpi label="Open Pipeline"      value={fmtCr(myPipelineValue)} sub="Quoted + negotiating" drill={{ kind: 'my_pipeline' }} />
            <RepKpi label="Active Clients"     value={String(myClientsCount)} sub="You own or cover" drill={{ kind: 'my_clients' }} />
          </div>

          {/* Two panels */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

            {/* Recent visits */}
            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>My Recent Visits</span>
                <div style={{ marginLeft: 'auto' }}>
                  <a href="/risansi/field" style={{ fontSize: 11, color: 'var(--brand-blue)', textDecoration: 'none', fontWeight: 500 }}>View all →</a>
                </div>
              </div>
              <div>
                {myRecentVisits.length === 0 ? (
                  <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
                    No visits logged yet
                  </div>
                ) : (
                  myRecentVisits.map((v, i) => {
                    const oKind: 'pos' | 'warn' = v.outcome?.toLowerCase().includes('positive') ? 'pos' : 'warn';
                    return (
                      <div key={v.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '10px 14px', borderBottom: i < myRecentVisits.length - 1 ? '1px solid var(--line)' : 'none', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{v.client_name}</div>
                          {v.purpose && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>{v.purpose}</div>}
                          {v.outcome && <div style={{ marginTop: 4 }}><Tag kind={oKind}>{v.outcome}</Tag></div>}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                          {formatTime(v.visit_date)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Overdue clients */}
            <div style={PANEL}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Overdue Clients</span>
                {myOverdueCount > 0 && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--neg)', fontFamily: 'var(--font-mono)' }}>
                    <DashCell params={{ kind: 'my_overdue' }}>
                      {myOverdueCount} need{myOverdueCount === 1 ? 's' : ''} a visit
                    </DashCell>
                  </span>
                )}
              </div>
              <div>
                {myOverdueClients.length === 0 ? (
                  <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 12, color: 'var(--pos)' }}>
                    All clients visited recently
                  </div>
                ) : (
                  myOverdueClients.map((c, i) => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: i < myOverdueClients.length - 1 ? '1px solid var(--line)' : 'none', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <a href={`/risansi/clients/${c.code}`} style={{ fontSize: 12, fontWeight: 500, color: 'inherit', textDecoration: 'none' }}>
                          {c.legal_name}
                        </a>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{c.code}</div>
                      </div>
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                        color: c.days_overdue >= 365 ? 'var(--neg)' : c.days_overdue >= 180 ? 'var(--warn)' : 'var(--warn-strong)',
                      }}>
                        {c.days_overdue >= 999 ? 'Never' : `${c.days_overdue}d`}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

        </div>
      </div>
      </DashDrilldownProvider>
    );
  }

  const ytdPct   = fyYtdPct(fy);
  const daysLeft = fyDaysLeft(fy);
  const today    = new Date();

  const fyLabel  = fy.label;

  // ── All queries in parallel — replaces 10 sequential awaits ──
  const [
    revSplit,
    pyTotal,
    annTarget,
    historical,
    segments,
    domExp,
    funnel,
    orderInHand,
    cibTotals,
    atRisk,
    topAccounts,
    visits,
    upcomingVisits,
    autoOpps,
  ] = await Promise.all([

    // 1. Current FY revenue: total + pump/spare breakdown
    q<RevenueSplit>(async () => {
      const { rows } = await risansiPool.query<{ total_inr: string; pump_inr: string; spare_inr: string }>(
        `SELECT
           COALESCE(SUM(total_value),0)::text AS total_inr,
           COALESCE(SUM(pump_value), 0)::text AS pump_inr,
           COALESCE(SUM(spare_value),0)::text AS spare_inr
         FROM client_revenue_monthly crm
         WHERE ${revMonthsSql(w, 'cy')}`,
      );
      return {
        pump:  Number(rows[0]?.pump_inr  ?? 0) / INR_TO_L,
        spare: Number(rows[0]?.spare_inr ?? 0) / INR_TO_L,
      };
    }, { pump: 0, spare: 0 }),

    // 2. Previous FY total (24-25)
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ total: string }>(
        `SELECT COALESCE(SUM(total_value),0)::text AS total
         FROM client_revenue_monthly crm
         WHERE ${revMonthsSql(w, 'py')}`,
      );
      return Number(rows[0]?.total ?? 0) / INR_TO_L;
    }, 0),

    // 3. Annual target (Crores) — sysadmin-editable app setting, fallback 32 Cr
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ value: string }>(
        `SELECT value FROM app_settings WHERE key = 'annual_target_cr' LIMIT 1`,
      );
      const v = parseFloat(rows[0]?.value ?? '');
      return Number.isFinite(v) && v > 0 ? v : 32;
    }, 32),

    // 4. Historical YoY revenue from client_revenue_monthly
    q<HistoricalFY[]>(async () => {
      const { rows } = await risansiPool.query<{ fy: string; ord: string; total_inr: string }>(
        `SELECT
           'FY' || LPAD(((CASE WHEN EXTRACT(MONTH FROM month) >= 4
                               THEN EXTRACT(YEAR FROM month)
                               ELSE EXTRACT(YEAR FROM month) - 1 END) % 100)::int::text, 2, '0') AS fy,
           (CASE WHEN EXTRACT(MONTH FROM month) >= 4
                 THEN EXTRACT(YEAR FROM month)
                 ELSE EXTRACT(YEAR FROM month) - 1 END)::int AS ord,
           COALESCE(SUM(total_value),0)::text AS total_inr
         FROM client_revenue_monthly
         WHERE month >= '${histStart}'
         GROUP BY 1, 2
         HAVING SUM(total_value) > 0
         ORDER BY ord ASC`,
      );
      return rows.map(r => ({ code: r.fy, label: r.fy, total: Number(r.total_inr) / INR_TO_L }));
    }, []),

    // 5. Revenue by industry segment
    q<SegmentRow[]>(async () => {
      const { rows } = await risansiPool.query<{ segment: string; ytd_inr: string }>(
        `SELECT
           COALESCE(c.industry, 'Other') AS segment,
           COALESCE(SUM(crm.total_value), 0)::text AS ytd_inr
         FROM client_revenue_monthly crm
         JOIN clients c ON crm.client_id = c.id
         WHERE ${revClientWhere(w, scope)}
         GROUP BY COALESCE(c.industry, 'Other')
         ORDER BY 2::numeric DESC
         LIMIT 8`,
      );
      return rows.map(r => ({ segment: r.segment, ytd_inr: Number(r.ytd_inr) / INR_TO_L }));
    }, []),

    // 6. Domestic / Export split
    q<{ domestic: number; export: number }>(async () => {
      const { rows } = await risansiPool.query<{ domestic_inr: string; export_inr: string }>(
        `SELECT
           COALESCE(SUM(CASE WHEN c.market_type = 'Domestic' THEN crm.total_value ELSE 0 END),0)::text AS domestic_inr,
           COALESCE(SUM(CASE WHEN c.market_type = 'Export'   THEN crm.total_value ELSE 0 END),0)::text AS export_inr
         FROM client_revenue_monthly crm
         JOIN clients c ON crm.client_id = c.id
         WHERE ${revClientWhere(w, scope)}`,
      );
      const r = rows[0];
      return {
        domestic: Number(r?.domestic_inr ?? 0) / INR_TO_L,
        export:   Number(r?.export_inr   ?? 0) / INR_TO_L,
      };
    }, { domestic: 0, export: 0 }),

    // 7. Opportunity stages — open pipeline + Won (all open stages, not just a subset).
    //    No FY filter: open opportunities are live/current, not tied to a fiscal year.
    q<FunnelRow[]>(async () => {
      const stages = [...OPEN_STAGES, 'Won'];
      const { rows } = await risansiPool.query<{ stage: string; cnt: string; val: string }>(
        `SELECT o.stage AS stage, COUNT(*)::text AS cnt, COALESCE(SUM(o.value_cr),0)::text AS val
         FROM opportunities o
         WHERE ${stageWhere(scope, stages)}
         GROUP BY o.stage`,
      );
      return stages.map(stage => {
        const row = rows.find(r => r.stage === stage);
        return { stage, count: Number(row?.cnt ?? 0), value: Number(row?.val ?? 0) };
      });
    }, [...OPEN_STAGES, 'Won'].map(stage => ({ stage, count: 0, value: 0 }))),

    // 7b. From Won opportunities: Order in Hand = won value NOT yet turned into a
    //     Sales Order (Σ max(final − ΣSO, 0)); Order Booked = value already in
    //     Sales Orders (Σ SO). Client-scoped for reps.
    q<{ inHand: number; booked: number; openCount: number }>(async () => {
      const { rows } = await risansiPool.query<{ in_hand: string; booked: string; open_count: string }>(
        `SELECT
           COALESCE(SUM(${IN_HAND_CR}), 0)::text AS in_hand,
           COALESCE(SUM(${BOOKED_CR}), 0)::text AS booked,
           COUNT(*) FILTER (WHERE ${IN_HAND_CR} > 0)::text AS open_count
         FROM opportunities o
         JOIN clients c ON c.id = o.client_id
         ${SO_SUM_JOIN}
         WHERE ${wonClientWhere(scope)}`,
      );
      return {
        inHand: Number(rows[0]?.in_hand ?? 0),
        booked: Number(rows[0]?.booked ?? 0),
        openCount: Number(rows[0]?.open_count ?? 0),
      };
    }, { inHand: 0, booked: 0, openCount: 0 }),

    // 8. Market share from competitor_installed_base
    q<CIBTotals>(async () => {
      const { rows } = await risansiPool.query<{
        ril: string; roto: string; rotomac: string; netzsch: string;
        gita: string; psp: string; tushaco: string; others: string; total: string;
      }>(
        `SELECT
           COALESCE(SUM(ril_pcp),0)::text     AS ril,
           COALESCE(SUM(roto_pcp),0)::text    AS roto,
           COALESCE(SUM(rotomac_pcp),0)::text AS rotomac,
           COALESCE(SUM(netzsch_pcp),0)::text AS netzsch,
           COALESCE(SUM(gita_pcp),0)::text    AS gita,
           COALESCE(SUM(psp_pcp),0)::text     AS psp,
           COALESCE(SUM(tushaco_pcp),0)::text AS tushaco,
           COALESCE(SUM(${OTHERS_PCP}),0)::text AS others,
           COALESCE(SUM(total_pcp),0)::text   AS total
         FROM competitor_installed_base`,
      );
      const r = rows[0];
      return {
        ril:     Number(r?.ril     ?? 0), roto:    Number(r?.roto    ?? 0),
        rotomac: Number(r?.rotomac ?? 0), netzsch: Number(r?.netzsch ?? 0),
        gita:    Number(r?.gita    ?? 0), psp:     Number(r?.psp     ?? 0),
        tushaco: Number(r?.tushaco ?? 0), others:  Number(r?.others  ?? 0),
        total:   Number(r?.total   ?? 0),
      };
    }, { ril: 0, roto: 0, rotomac: 0, netzsch: 0, gita: 0, psp: 0, tushaco: 0, others: 0, total: 0 }),

    // 9. At-risk: had revenue, no visit 18+ months
    q<AtRisk>(async () => {
      const { rows } = await risansiPool.query<{ cnt: string; exposure: string }>(
        `SELECT
           COUNT(DISTINCT c.id)::text AS cnt,
           COALESCE(SUM(crm.total_value), 0)::text AS exposure
         FROM clients c
         LEFT JOIN client_revenue_monthly crm
           ON crm.client_id = c.id AND ${atRiskExposureOn(w)}
         WHERE ${atRiskWhere(scope)}`,
      );
      return {
        count:    Number(rows[0]?.cnt      ?? 0),
        exposure: Number(rows[0]?.exposure ?? 0) / INR_TO_L,
      };
    }, { count: 0, exposure: 0 }),

    // 10. Top 7 accounts by current-FY revenue
    q<TopAccount[]>(async () => {
      const { rows } = await risansiPool.query<{
        client_code: string; legal_name: string; industry: string; zone: string; status: string;
        ytd: string; py: string;
      }>(
        `SELECT
           c.code AS client_code,
           c.legal_name,
           COALESCE(c.industry, '—') AS industry,
           COALESCE(c.zone, '—')     AS zone,
           c.status,
           COALESCE(curr.total_inr, 0)::text AS ytd,
           COALESCE(prev.total_inr, 0)::text AS py
         FROM clients c
         LEFT JOIN (
           SELECT client_id, SUM(total_value) AS total_inr
           FROM client_revenue_monthly
           WHERE month >= '${cyStart}' AND month < '${cyEnd}'
           GROUP BY client_id
         ) curr ON curr.client_id = c.id
         LEFT JOIN (
           SELECT client_id, SUM(total_value) AS total_inr
           FROM client_revenue_monthly
           WHERE month >= '${pyStart}' AND month < '${cyStart}'
           GROUP BY client_id
         ) prev ON prev.client_id = c.id
         WHERE c.deleted_at IS NULL
           AND c.status = 'ACTIVE'
           AND COALESCE(curr.total_inr, 0) > 0${cVisAnd}
         ORDER BY curr.total_inr DESC NULLS LAST
         LIMIT 7`,
      );
      return rows.map(r => ({
        client_code: r.client_code,
        legal_name:  r.legal_name,
        industry:    r.industry,
        zone:        r.zone,
        status:      r.status,
        ytd: Number(r.ytd) / INR_TO_L,
        py:  Number(r.py)  / INR_TO_L,
      }));
    }, []),

    // 11. Recent visit feed (last 10)
    q<VisitEntry[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; rep_name: string; client_name: string;
        visit_date: Date; outcome: string | null; purpose: string;
        status: string;
      }>(
        `SELECT v.id,
                COALESCE(r.name, '—') AS rep_name,
                c.legal_name          AS client_name,
                v.visit_date,
                v.outcome,
                v.purpose,
                v.status
         FROM visits v
         JOIN clients c ON c.id = v.client_id
         LEFT JOIN users r ON r.id = v.rep_id
         WHERE v.status IN ('completed','checked-in')
           AND v.visit_date >= CURRENT_DATE - INTERVAL '7 days'${visitOwnerAnd}
         ORDER BY v.visit_date DESC, v.check_in_time DESC NULLS LAST
         LIMIT 10`,
      );
      return rows.map(r => ({
        id:           r.id,
        rep_name:     r.rep_name,
        client_name:  r.client_name,
        visit_date:   new Date(r.visit_date),
        outcome:      r.outcome,
        purpose:      r.purpose,
        status:       r.status,
        synced:       false,
      }));
    }, []),

    // 12. Upcoming visits (next 7 days)
    q<UpcomingVisit[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; visit_date: string; purpose: string | null; status: string;
        client_name: string; client_code: string; city: string | null; rep_name: string;
      }>(
        `SELECT
           v.id::text, v.visit_date::text AS visit_date, v.purpose, v.status,
           c.legal_name AS client_name, c.code AS client_code, c.city,
           COALESCE(r.name, '—') AS rep_name
         FROM visits v
         JOIN clients c ON c.id = v.client_id
         LEFT JOIN users r ON r.id = v.rep_id
         WHERE v.status = 'planned'
           AND v.visit_date >= CURRENT_DATE
           AND v.visit_date <= CURRENT_DATE + INTERVAL '7 days'${visitOwnerAnd}
         ORDER BY v.visit_date ASC
         LIMIT 5`,
      );
      return rows;
    }, []),

    // 13. Recently auto-created opportunities (last 7 days)
    q<AutoOpp[]>(async () => {
      const { rows } = await risansiPool.query<{
        id: string; product: string | null; stage: string;
        auto_source: string | null; created_at: string;
        client_name: string; client_code: string;
      }>(
        `SELECT
           o.id::text, o.product, o.stage, o.auto_source,
           o.created_at::text AS created_at,
           c.legal_name AS client_name, c.code AS client_code
         FROM opportunities o
         JOIN clients c ON o.client_id = c.id
         WHERE o.auto_created = TRUE
           AND o.created_at >= NOW() - INTERVAL '7 days'${oppOwnerAnd}
         ORDER BY o.created_at DESC
         LIMIT 5`,
      );
      return rows;
    }, []),
  ]);

  // ── Derived values ────────────────────────────────────────────

  // Unsorted, this is the query's own order — highest revenue first, which is
  // what the panel is for. A third click on a header clears ?sort= and brings
  // it back.
  const topAccountRows = sortRows(topAccounts, TOP_ACCOUNT_COLS, { key: sortKey || null, dir: sortDir });
  const totalBooked = revSplit.pump + revSplit.spare;
  const pumpPct  = totalBooked > 0 ? Math.round((revSplit.pump  / totalBooked) * 100) : 0;
  const sparePct = totalBooked > 0 ? Math.round((revSplit.spare / totalBooked) * 100) : 0;

  // historical is returned directly from query 4 (zeros filtered, all FYs)

  // Split the opportunity stages into the open funnel and the landed Won outcome.
  const funnelOpen       = funnel.filter(r => (OPEN_STAGES as readonly string[]).includes(r.stage));
  const wonRow           = funnel.find(r => r.stage === 'Won') ?? { stage: 'Won', count: 0, value: 0 };
  // Open Pipeline is the quoted pipe: Quoted and Negotiating only (19 Sep).
  // A Suspect or Prospect carries no offer and On Hold is parked, so none of
  // them is money in play; the funnel below still shows every stage.
  const quotedPipe       = funnelOpen.filter(r => (PIPELINE_STAGES as readonly string[]).includes(r.stage));
  const pipelineTotal    = quotedPipe.reduce((s, r) => s + r.value, 0);
  const openCount        = quotedPipe.reduce((s, r) => s + r.count, 0);
  const quotedCount      = funnelOpen.find(r => r.stage === 'Quoted')?.count ?? 0;
  const negotiatingCount = funnelOpen.find(r => r.stage === 'Negotiating')?.count ?? 0;

  const shareTotal = Math.max(cibTotals.total, 1);
  const rilUnits   = cibTotals.ril;
  const rilShare   = (rilUnits / shareTotal) * 100;

  // Others is a remainder, not a column, and it is summed per site in SQL
  // (OTHERS_PCP) rather than subtracted here: the drill-down behind the slice
  // lists those same per-site remainders, and a site whose named suppliers
  // overshoot its own total must not be allowed to eat into another site's.
  const othersU    = cibTotals.others;

  const shareData: MarketEntry[] = [
    { supplier: 'RIL',           units: rilUnits,          pct: (rilUnits / shareTotal) * 100,          color: compColor('RIL') },
    { supplier: 'Roto',          units: cibTotals.roto,    pct: (cibTotals.roto / shareTotal) * 100,    color: compColor('Roto') },
    { supplier: 'Rotomac',       units: cibTotals.rotomac, pct: (cibTotals.rotomac / shareTotal) * 100, color: compColor('Rotomac') },
    { supplier: 'Netzsch',       units: cibTotals.netzsch, pct: (cibTotals.netzsch / shareTotal) * 100, color: compColor('Netzsch') },
    { supplier: 'Gita',          units: cibTotals.gita,    pct: (cibTotals.gita / shareTotal) * 100,    color: compColor('Gita') },
    { supplier: 'PSP',           units: cibTotals.psp,     pct: (cibTotals.psp / shareTotal) * 100,     color: compColor('PSP') },
    { supplier: 'Tushaco',       units: cibTotals.tushaco, pct: (cibTotals.tushaco / shareTotal) * 100, color: compColor('Tushaco') },
    ...(othersU > 0 ? [{ supplier: 'Others', units: othersU, pct: (othersU / shareTotal) * 100, color: compColor('Others') }] : []),
  ].filter(d => d.units > 0);

  // ── Derived display values ────────────────────────────────────
  // annTarget is in Crores; convert to Lakhs to compare with rev_* totals (in Lakhs)
  const annTargetL  = annTarget * 100;
  // fmtFromL: format a value-in-Lakhs using auto-scaling (same unit as totalBooked)
  const fmtFromL    = (lakhs: number) => formatRev(Math.round(lakhs * INR_TO_L));
  const bookedDelta = pyTotal > 0 ? ((totalBooked - pyTotal) / pyTotal) * 100 : 0;
  const achievedPct = annTargetL > 0 ? (totalBooked / annTargetL) * 100 : 0;
  const isOnTrack   = totalBooked >= (annTargetL * ytdPct / 100 * 0.9);
  const histValues  = historical.map(h => h.total);
  const histLabels  = historical.map(h => h.label);
  // Funnel bars are sized by opportunity COUNT (not ₹), so early stages full of
  // no-value leads stay visible instead of collapsing to a zero-width bar.
  const funnelMax   = Math.max(...funnelOpen.map(f => f.count), 1);

  // ── Render ───────────────────────────────────────────────────
  return (
    <DashDrilldownProvider>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sticky topbar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Executive Dashboard']} primaryAction={PLAN_VISIT_LABEL} primaryActionHref="/risansi/field" />
      </div>

      {/* Scrollable page body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* ── Page header ─────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              {getGreeting()}, {displayName}.
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              {formatIndianDate(today)}
              {daysLeft > 0
                ? ` · ${fy.label} closes in ${daysLeft} days`
                : ` · ${fy.label} completed`}
              {visits.length > 0 && ` · ${visits.filter(v => v.status === 'checked-in').length} reps active today`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ExportPdfButton />
            <RefreshButton />
          </div>
        </div>

        {/* ── Hero metrics row 1: full-width Revenue card ─────── */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...KPI_PANEL }}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>{fyLabel} Booked Revenue</span>
              <span style={META}>Updated {formatTime(today)} IST</span>
              <div style={{ marginLeft: 'auto' }}>
                <Tag kind={isOnTrack ? 'pos' : 'warn'} dot>{isOnTrack ? 'On Track' : 'Behind'}</Tag>
              </div>
            </div>
            <div style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr 300px', gap: 28, alignItems: 'center' }}>
              {/* Left: KPI numbers + progress bar + dom/exp/pump:spare */}
              <div>
                <div style={{ display: 'flex', gap: 32, alignItems: 'flex-end' }}>
                  {/* Total booked metric */}
                  <div style={{ flexShrink: 0 }}>
                    <div style={METRIC_LABEL}>Total Booked</div>
                    <div style={METRIC_VAL}>
                      <DashCell params={{ kind: 'rev_fy' }}>{fmtFromL(totalBooked)}</DashCell>
                    </div>
                    {pyTotal > 0 && (
                      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: bookedDelta >= 0 ? 'var(--pos)' : 'var(--neg)', marginTop: 4 }}>
                        {bookedDelta >= 0 ? '▲' : '▼'}{' '}
                        <DashCell params={{ kind: 'rev_delta' }}>
                          {fmtFromL(Math.abs(totalBooked - pyTotal))} vs PY
                        </DashCell>
                        {' · '}{bookedDelta >= 0 ? '+' : ''}{bookedDelta.toFixed(1)}%
                      </div>
                    )}
                  </div>
                  {/* Target metric */}
                  <div style={{ flexShrink: 0 }}>
                    <div style={METRIC_LABEL}>Annual Target</div>
                    <div style={METRIC_VAL}>{fmtFromL(annTargetL)}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                      {achievedPct.toFixed(1)}% achieved · {ytdPct}% YTD
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ marginTop: 14, height: 6, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(achievedPct, 100)}%`, background: 'var(--accent)', borderRadius: 3 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                  <span>₹0</span>
                  <span style={{ color: 'var(--accent)' }}>
                    ↑ <DashCell params={{ kind: 'rev_fy' }}>{fmtFromL(totalBooked)}</DashCell>
                  </span>
                  <span>{fmtFromL(annTargetL)}</span>
                </div>

                {/* Dom / Exp / Pump:Spare stats */}
                <div style={{ display: 'flex', gap: 28, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <StatBlock label="Domestic" value={fmtL(domExp.domestic)} drill={{ kind: 'rev_market', key: 'Domestic' }} />
                  <StatBlock label="Export"   value={fmtL(domExp.export)}   drill={{ kind: 'rev_market', key: 'Export' }} />
                  {/* A ratio, not a sum: no set of clients adds up to "62 : 38". */}
                  <StatBlock label="Pump : Spare" value={`${pumpPct} : ${sparePct}`} />
                </div>
              </div>

              {/* Right: YoY mini bars */}
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', fontWeight: 600, marginBottom: 8 }}>
                  Year-on-Year Revenue
                </div>
                <MiniBars
                  values={histValues.length ? histValues : [0]}
                  labels={histLabels}
                  color="var(--title)"
                  dimColor="#93C5FD"
                  width={280} height={90}
                />
                {/* The bars are an SVG shared with other pages, so the year a
                    reader wants to open is offered as a row of chips beneath
                    them rather than by making the rectangles clickable. */}
                {historical.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {historical.map(h => (
                      <DashCell key={h.code} params={{ kind: 'rev_fy_bar', key: h.code }}
                        style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}
                        title={`See the accounts behind ${h.label}`}>
                        {h.label}
                      </DashCell>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Hero metrics row 2: Pipeline · Order in Hand · Market · At-Risk ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>

          {/* Open pipeline small metric */}
          <SmallMetric
            label="Open Pipeline · Quoted + Negotiating"
            value={pipelineTotal > 0 ? fmtCr(pipelineTotal) : '—'}
            delta={pipelineTotal > 0 ? `${quotedCount} quoted · ${negotiatingCount} in negotiation` : 'No quoted opportunities'}
            deltaPos={pipelineTotal > 0}
            sub={pipelineTotal > 0 ? 'Quoted value at 100% · no Suspect, Prospect or On Hold' : 'Add via Opportunities →'}
            subHref={pipelineTotal === 0 ? '/risansi/pipeline' : undefined}
            spark={[]}
            drill={pipelineTotal > 0 ? { kind: 'pipeline' } : undefined}
            deltaDrill={pipelineTotal > 0 ? { kind: 'pipeline' } : undefined}
          />

          {/* Order in Hand — won value not yet turned into a Sales Order. */}
          <SmallMetric
            label="Order in Hand"
            value={orderInHand.inHand > 0 ? fmtCr(orderInHand.inHand) : '—'}
            delta={orderInHand.openCount > 0 ? `${orderInHand.openCount} won · awaiting SO` : 'All won orders in SOs'}
            deltaPos={orderInHand.inHand > 0}
            sub="Won, not yet in a Sales Order"
            spark={[]}
            drill={orderInHand.inHand > 0 ? { kind: 'order_in_hand' } : undefined}
            deltaDrill={orderInHand.openCount > 0 ? { kind: 'order_in_hand' } : undefined}
          />

          {/* Market share small metric */}
          <SmallMetric
            label="Market Share · PCP"
            value={shareTotal > 1 ? rilShare.toFixed(1) : '—'}
            unit={shareTotal > 1 ? '%' : ''}
            delta="National installed base"
            deltaPos
            sub={shareTotal > 1 ? `${shareTotal.toLocaleString()} units tracked` : 'Awaiting assessment data'}
            spark={[]}
            subDrill={shareTotal > 1 ? { kind: 'market_supplier', key: 'Total' } : undefined}
          />

          {/* At-risk small metric */}
          <SmallMetric
            label="At-Risk Accounts"
            value={String(atRisk.count)}
            delta={atRisk.exposure > 0 ? `${fmtFromL(atRisk.exposure)} revenue at risk` : 'None — all recently visited'}
            deltaPos={atRisk.count === 0}
            sub="Had revenue · no visit 18 mo+"
            spark={[]}
            drill={atRisk.count > 0 ? { kind: 'at_risk' } : undefined}
            deltaDrill={atRisk.exposure > 0 ? { kind: 'at_risk' } : undefined}
          />
        </div>

        {/* ── Action Items row ────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>

          {/* Upcoming Visits */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Upcoming Visits · Next 7 Days</span>
              <a href="/risansi/field?tab=calendar" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--brand-blue)', textDecoration: 'none', fontWeight: 500 }}>
                View calendar →
              </a>
            </div>
            {upcomingVisits.length === 0 ? (
              <div style={{ padding: 16, fontSize: 13, color: 'var(--fg-3)', textAlign: 'center' }}>
                No visits planned this week
              </div>
            ) : upcomingVisits.map((v, i) => (
              <a key={v.id} href={`/risansi/visits/${v.id}`} style={{
                display: 'flex', padding: '10px 14px', gap: 10, alignItems: 'center',
                borderBottom: i < upcomingVisits.length - 1 ? '1px solid var(--line)' : 'none',
                textDecoration: 'none',
              }}>
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--brand-blue)', minWidth: 56 }}>
                  {new Date(v.visit_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.client_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                    {v.rep_name} · {v.purpose ?? 'Visit'}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>→</span>
              </a>
            ))}
          </div>

          {/* Auto-Created Opportunities */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>⚡ Auto-Created Opportunities</span>
              <a href="/risansi/pipeline" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--brand-blue)', textDecoration: 'none', fontWeight: 500 }}>
                View pipeline →
              </a>
            </div>
            {autoOpps.length === 0 ? (
              <div style={{ padding: 16, fontSize: 13, color: 'var(--fg-3)', textAlign: 'center' }}>
                No auto-created opportunities this week
              </div>
            ) : autoOpps.map((o, i) => (
              <a key={o.id} href="/risansi/pipeline" style={{
                display: 'flex', padding: '10px 14px', gap: 10, alignItems: 'center',
                borderBottom: i < autoOpps.length - 1 ? '1px solid var(--line)' : 'none',
                textDecoration: 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {o.client_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {o.product?.slice(0, 50) ?? '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10,
                    background: 'var(--accent-soft)', color: 'var(--brand-blue)',
                  }}>
                    {o.auto_source === 'expansion_plan' ? 'Expansion' : 'Displacement'}
                  </span>
                  <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>
                    {new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* ── Mid row ─────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 1.5fr', gap: 14, marginBottom: 14 }}>

          {/* Revenue mix */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Revenue Mix · {fyLabel}</span>
            </div>
            <div style={{ padding: 14 }}>
              {segments.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '24px 0' }}>No revenue data</div>
              )}
              {segments.slice(0, 6).map((seg, i) => (
                <SegmentBar
                  key={seg.segment}
                  label={seg.segment}
                  value={seg.ytd_inr}
                  total={totalBooked || 1}
                  color={SEGMENT_COLORS[i] ?? 'var(--fg-3)'}
                  drill={{ kind: 'segment', key: seg.segment }}
                />
              ))}
              {segments.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <StatBlock label="Domestic" value={fmtL(domExp.domestic)} drill={{ kind: 'rev_market', key: 'Domestic' }} />
                  <StatBlock label="Export"   value={fmtL(domExp.export)}   drill={{ kind: 'rev_market', key: 'Export' }} />
                  <StatBlock label="Pump : Spare" value={`${pumpPct} : ${sparePct}`} />
                </div>
              )}
            </div>
          </div>

          {/* PCP Market share donut */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>PCP Market Share · National</span>
              <span style={META}>{shareTotal > 1 ? `${shareTotal.toLocaleString()} units in installed base` : 'No assessment data yet'}</span>
              <div style={{ marginLeft: 'auto' }}>
                <Tag kind="info">Live from field</Tag>
              </div>
            </div>
            <div style={{ padding: 14, display: 'flex', gap: 16, alignItems: 'center' }}>
              {shareData.length > 0 ? (
                <>
                  <Donut
                    data={shareData.map(d => ({ pct: d.pct, color: d.color, name: d.supplier }))}
                    size={140}
                    thick={20}
                    center={
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--fg)' }}>
                          {rilShare.toFixed(1)}%
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                          RIL Share
                        </div>
                      </div>
                    }
                  />
                  <div style={{ flex: 1 }}>
                    {shareData.map((d, i) => (
                      <div key={d.supplier} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 11 }}>
                        <span style={{ width: 8, height: 8, background: d.color, borderRadius: 2, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontWeight: i === 0 ? 500 : 400 }}>{d.supplier}</span>
                        {/* The slice is a share, so what opens is the pump
                            count the share was worked out from. */}
                        <span style={{ width: 44, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          <DashCell params={{ kind: 'market_supplier', key: d.supplier }}
                            title={`See the sites behind ${d.supplier}'s ${d.units.toLocaleString()} pumps`}>
                            {d.pct.toFixed(1)}%
                          </DashCell>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ flex: 1, fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '28px 0' }}>
                  Awaiting equipment assessments from field
                </div>
              )}
            </div>
          </div>

          {/* Opportunity — open pipeline funnel + order-in-hand / won summary */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Opportunity</span>
              <a href="/risansi/pipeline" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--brand-blue)', textDecoration: 'none', fontWeight: 500 }}>
                View all →
              </a>
            </div>

            {/* Summary strip: open pipeline · order in hand · order booked · won */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', borderBottom: '1px solid var(--line)' }}>
              <OppStat label="Open Pipeline" value={pipelineTotal > 0 ? fmtCr(pipelineTotal) : '—'}
                sub={`${openCount} quoted + negotiating`} color="var(--fg)"
                drill={openCount > 0 ? { kind: 'pipeline' } : undefined} />
              <OppStat label="Order in Hand" value={orderInHand.inHand > 0 ? fmtCr(orderInHand.inHand) : '—'}
                sub="won · not yet in SO" color="var(--accent)" divider
                drill={orderInHand.inHand > 0 ? { kind: 'order_in_hand' } : undefined} />
              <OppStat label="Order Booked" value={orderInHand.booked > 0 ? fmtCr(orderInHand.booked) : '—'}
                sub="value in sales orders" color="var(--fg-2)" divider
                drill={orderInHand.booked > 0 ? { kind: 'order_booked' } : undefined} />
              <OppStat label="Won" value={wonRow.value > 0 ? fmtCr(wonRow.value) : '—'}
                sub={`${wonRow.count} won`} color="var(--pos)" divider
                drill={wonRow.count > 0 ? { kind: 'stage', key: 'Won' } : undefined} />
            </div>

            {/* Open-stage funnel — bars sized by opportunity count, ₹ shown alongside */}
            <div style={{ padding: '8px 14px' }}>
              {funnelOpen.reduce((s, r) => s + r.count, 0) === 0 ? (
                <div style={{ textAlign: 'center', padding: '28px 16px' }}>
                  <div style={{ fontSize: 13, color: 'var(--fg-3)', marginBottom: 12 }}>No open opportunities</div>
                  <a
                    href="/risansi/pipeline"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent-fill)', color: 'var(--on-accent)', borderRadius: 6, textDecoration: 'none' }}
                  >
                    + Add Opportunity
                  </a>
                </div>
              ) : (
                funnelOpen.map(row => (
                  <FunnelBarRow
                    key={row.stage}
                    stage={row.stage}
                    count={row.count}
                    value={row.value}
                    max={funnelMax}
                    color={FUNNEL_COLORS[row.stage] ?? 'var(--fg-3)'}
                    drill={{ kind: 'stage', key: row.stage }}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Bottom row ──────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>

          {/* Top accounts table */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Top Accounts · YTD Revenue</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                <a href="/risansi/clients" style={{ fontSize: 11, color: 'var(--brand-blue)', textDecoration: 'none', fontWeight: 500 }}>View all →</a>
              </div>
            </div>
            <div style={{ padding: 0, overflowX: 'auto' }}>
              {topAccounts.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>No orders in {fy.label}</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-elev)' }}>
                      <SortableTH col="legal_name" label="Account"  kind="text"   currentSort={sortKey} currentDir={sortDir} style={TH} />
                      <SortableTH col="industry"   label="Industry" kind="text"   currentSort={sortKey} currentDir={sortDir} style={TH} />
                      <SortableTH col="zone"       label="Zone"     kind="text"   currentSort={sortKey} currentDir={sortDir} style={TH} />
                      <SortableTH col="ytd"        label="YTD Rev"  kind="number" currentSort={sortKey} currentDir={sortDir} align="right" style={TH} />
                      <SortableTH col="vspy"       label="vs PY"    kind="number" currentSort={sortKey} currentDir={sortDir} align="right" style={TH} />
                      <SortableTH col="status"     label="Status"   kind="status" currentSort={sortKey} currentDir={sortDir} style={TH} />
                    </tr>
                  </thead>
                  <tbody>
                    {topAccountRows.map(acc => {
                      const deltaPct = acc.py > 0 ? ((acc.ytd - acc.py) / acc.py) * 100 : 0;
                      return (
                        <tr key={acc.client_code} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                            {/* One row is already one client, so there is no
                                list to pop up — it goes straight to the
                                account. The cursor used to say otherwise. */}
                            <a href={`/risansi/clients/${acc.client_code}`}
                              style={{ fontWeight: 500, fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                              {acc.legal_name}
                            </a>
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                              {acc.client_code}
                            </div>
                          </td>
                          <td style={TD}><Tag>{acc.industry}</Tag></td>
                          <td style={{ ...TD, color: 'var(--fg-3)' }}>{acc.zone}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtL(acc.ytd)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', color: deltaPct >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                            {acc.py > 0 ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : '—'}
                          </td>
                          <td style={TD}>
                            <Tag kind="pos" dot>{clientStatusLabel(acc.status)}</Tag>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Live field activity */}
          <div style={PANEL}>
            <div style={PANEL_H}>
              <span style={PANEL_TITLE}>Live Field Activity</span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                <a href="/risansi/visits" style={{ fontSize: 11, color: 'var(--brand-blue)', textDecoration: 'none', fontWeight: 500 }}>View all →</a>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--pos)', display: 'inline-block', boxShadow: '0 0 0 3px rgba(5,150,105,0.20)' }} />
                <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>real-time</span>
              </div>
            </div>
            <div style={{ padding: 0 }}>
              {visits.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <div style={{ fontSize: 24, marginBottom: 10 }}>📅</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 6 }}>No field activity this week</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 16 }}>Visits will appear here in real-time as reps check in</div>
                  <a href="/risansi/visits" style={{ fontSize: 11, color: 'var(--brand-blue)', textDecoration: 'none', fontWeight: 500 }}>View visit history →</a>
                </div>
              )}
              {visits.map((v, i) => {
                const what = v.status === 'checked-in' ? 'checked in at' : 'completed visit at';
                const outcomeKind = v.outcome?.toLowerCase().includes('positive') ? 'pos' : 'warn';
                return (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '10px 14px', borderBottom: i < visits.length - 1 ? '1px solid var(--line)' : 'none', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12 }}>
                        <strong style={{ fontWeight: 500 }}>{v.rep_name.split(' ')[0]}</strong>
                        {' '}<span style={{ color: 'var(--fg-3)' }}>{what}</span>{' '}
                        <span style={{ fontWeight: 500 }}>{v.client_name}</span>
                      </div>
                      {v.outcome && (
                        <div style={{ marginTop: 2 }}>
                          <Tag kind={outcomeKind}>{v.outcome}</Tag>
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                        {formatTime(v.visit_date)}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: v.synced ? 'var(--pos)' : 'var(--warn)', marginTop: 1 }}>
                        ● {v.synced ? 'synced' : 'queued'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* ── Executive Review — link to the per-TSM review dashboards ── */}
        <Link href="/risansi/executive-review" style={{ display: 'block', marginTop: 28, paddingTop: 22, borderTop: '1px solid var(--line)', textDecoration: 'none' }}>
          <div style={{ ...KPI_PANEL, padding: '16px 18px' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--title)' }}>Executive Review →</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>Per-TSM monthly review — clients, turnover, quotations, offer status, leads &amp; attendance.</div>
          </div>
        </Link>
      </div>
    </div>
    </DashDrilldownProvider>
  );
}

// ── Segment colours (design system) ───────────────────────────

const SEGMENT_COLORS = [
  'var(--accent)',
  'var(--warn)',
  'var(--pos)',
  '#0891B2',
  'var(--purple)',
  'var(--fg-3)',
  'var(--neg)',
  '#6366F1',
];

// ── Shared style constants ─────────────────────────────────────

const PANEL: CSSProperties = {
  background:   'var(--bg-paper)',
  border:       '1px solid var(--line)',
  borderRadius: 'var(--radius)',
};

const KPI_PANEL: CSSProperties = {
  ...PANEL,
  borderLeft: '4px solid var(--title)',
};

const PANEL_H: CSSProperties = {
  padding:      '12px 14px',
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

const META: CSSProperties = {
  fontSize:    11,
  color:       'var(--fg-3)',
  fontFamily:  'var(--font-mono)',
};

const METRIC_LABEL: CSSProperties = {
  fontSize:       10,
  textTransform:  'uppercase',
  letterSpacing:  '0.08em',
  color:          'var(--fg-3)',
  fontWeight:     600,
};

const METRIC_VAL: CSSProperties = {
  fontFamily:         'var(--font-mono)',
  fontSize:           28,
  fontWeight:         700,
  letterSpacing:      '-0.02em',
  fontVariantNumeric: 'tabular-nums',
  lineHeight:         1.05,
  color:              'var(--fg)',
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

// ── Small server-side sub-components ──────────────────────────

function SmallMetric({ label, value, unit, delta, deltaPos, sub, subHref, spark, drill, deltaDrill, subDrill }: {
  label: string; value: string; unit?: string;
  delta?: string; deltaPos?: boolean; sub?: string; subHref?: string; spark: number[];
  drill?: DashDrillParams; deltaDrill?: DashDrillParams; subDrill?: DashDrillParams;
}) {
  return (
    <div style={{ ...KPI_PANEL, minHeight: 140 }}>
      <div style={{ padding: 14 }}>
        <div style={METRIC_LABEL}>{label}</div>
        <div style={METRIC_VAL}>
          <Drillable drill={drill}>{value}</Drillable>
          {unit && <span style={{ fontSize: 14, color: 'var(--fg-3)', marginLeft: 4, fontWeight: 400 }}>{unit}</span>}
        </div>
        {delta && (
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: deltaPos ? 'var(--pos)' : 'var(--neg)', marginTop: 4 }}>
            {deltaPos ? '▲' : '▼'} <Drillable drill={deltaDrill}>{delta}</Drillable>
          </div>
        )}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {subHref ? (
            <a href={subHref} style={{ fontSize: 11, color: 'var(--brand-blue)', textDecoration: 'none', fontWeight: 500 }}>{sub}</a>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--fg-3)' }}><Drillable drill={subDrill}>{sub}</Drillable></div>
          )}
          {spark.length > 0 && (
            <Sparkline values={spark} width={70} height={22} color={deltaPos ? 'var(--pos)' : 'var(--neg)'} />
          )}
        </div>
      </div>
    </div>
  );
}

function SegmentBar({ label, value, total, color, drill }: {
  label: string; value: number; total: number; color: string; drill?: DashDrillParams;
}) {
  const pct = Math.min((value / total) * 100, 100);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
        <span style={{ color: 'var(--fg-2)' }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>
          <Drillable drill={drill}>{formatRev(Math.round(value * 100_000))}</Drillable>
          {' '}<span style={{ color: 'var(--fg-3)' }}>({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--accent-soft)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function StatBlock({ label, value, drill }: { label: string; value: string; drill?: DashDrillParams }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, marginTop: 2 }}>
        <Drillable drill={drill}>{value}</Drillable>
      </div>
    </div>
  );
}

/**
 * A figure that opens its own breakdown — or, where there is no honest list
 * behind it, the plain text it already was.
 *
 * The second half matters as much as the first. A percentage, a ratio and the
 * annual target have no set of clients that adds up to them, so they are passed
 * no drill and come out of here undecorated: nothing on the page invites a
 * click it cannot answer.
 */
function Drillable({ drill, children }: { drill?: DashDrillParams; children: ReactNode }) {
  if (!drill) return <>{children}</>;
  return <DashCell params={drill}>{children}</DashCell>;
}

// One open-stage row. The bar is sized by opportunity COUNT (so a stage full of
// no-value leads still shows), with a minimum width so any non-zero stage is
// visible. Count and ₹ are rendered as legible dark text beside the bar — not as
// low-contrast white text painted on top of it.
function FunnelBarRow({ stage, count, value, max, color, drill }: {
  stage: string; count: number; value: number; max: number; color: string; drill?: DashDrillParams;
}) {
  const pct = count > 0 && max > 0 ? Math.max((count / max) * 100, 5) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px dashed var(--line)' }}>
      <div style={{ width: 96, fontSize: 11, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500, flexShrink: 0 }}>
        {stage}
      </div>
      <div style={{ flex: 1, height: 14, background: 'var(--bg-sunk)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, opacity: 0.9, borderRadius: 2 }} />
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, minWidth: 62, textAlign: 'right', color: 'var(--fg)', flexShrink: 0 }}>
        <Drillable drill={count > 0 ? drill : undefined}>
          {count}<span style={{ fontWeight: 400, color: 'var(--fg-3)' }}> opp{count === 1 ? '' : 's'}</span>
        </Drillable>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 74, textAlign: 'right', color: value > 0 ? 'var(--fg)' : 'var(--fg-3)', flexShrink: 0 }}>
        {value > 0 ? <Drillable drill={drill}>{fmtCr(value)}</Drillable> : '—'}
      </div>
    </div>
  );
}

// One figure in the Opportunity summary strip (open pipeline / order in hand / won).
function OppStat({ label, value, sub, color, divider = false, drill }: {
  label: string; value: string; sub: string; color: string; divider?: boolean; drill?: DashDrillParams;
}) {
  return (
    <div style={{ padding: '10px 14px', borderLeft: divider ? '1px solid var(--line)' : 'none' }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 19, marginTop: 3, color, lineHeight: 1.1 }}>
        <Drillable drill={drill}>{value}</Drillable>
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
        <Drillable drill={drill}>{sub}</Drillable>
      </div>
    </div>
  );
}

function RepKpi({ label, value, sub, neg = false, drill }: {
  label: string; value: string; sub: string; neg?: boolean; drill?: DashDrillParams;
}) {
  return (
    <div style={{ ...KPI_PANEL, minHeight: 110 }}>
      <div style={{ padding: 14 }}>
        <div style={METRIC_LABEL}>{label}</div>
        <div style={{ ...METRIC_VAL, fontSize: 32 }}>
          <Drillable drill={drill}>{value}</Drillable>
        </div>
        <div style={{ fontSize: 11, color: neg ? 'var(--neg)' : 'var(--fg-3)', marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  );
}

// Shown on the rep dashboard when the signed-in user has no linked rep record.
function RepNotLinkedWarning() {
  return (
    <div style={{
      padding: '11px 16px', marginBottom: 18,
      background: 'var(--warn-soft)', border: '1px solid rgba(217,119,6,0.30)',
      borderRadius: 6, fontSize: 13, color: 'var(--warn-strong)', fontWeight: 500,
      display: 'flex', gap: 8, alignItems: 'flex-start',
    }}>
      <span aria-hidden style={{ flexShrink: 0 }}>⚠</span>
      <span>
        Your account is not linked to a rep record. Some features may not work
        correctly. Please contact your system administrator.
      </span>
    </div>
  );
}
