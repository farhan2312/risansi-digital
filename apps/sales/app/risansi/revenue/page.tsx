import type { CSSProperties } from 'react';
import Link from 'next/link';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar, Donut } from '@/components/risansi';
import { periodLabel } from '@/lib/risansi-revenue-period';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientVisibilitySql } from '@/lib/risansi-auth';
import { formatRev } from '@/lib/risansi-utils';
import { RevenueTopClients, type RevenueClientRow } from '@/components/risansi/RevenueTopClients';
import { UrlSelect } from '@/components/risansi/UrlSelect';
import { clientPrimaryRepSql, clientRepNamesSql } from '@/lib/risansi-client-rep';
import { SortedTable } from '@/components/risansi/SortedTable';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

const INR_TO_L = 100_000;

// 'YYYY-MM-DD' + n months (n may be negative); the day is kept, so a
// fortnight on the 16th shifts to the 16th.
function addMonths(ymd: string, n: number): string {
  const [y, m, d0] = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m - 1) + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d0 || 1).padStart(2, '0')}`;
}
/** The exclusive end of a period key: a 16th runs to the next month; a 1st runs to the 16th in the 15-day view, else to next month. */
function periodEndOf(ymd: string, fortnight: boolean): string {
  const day = Number(ymd.slice(8, 10));
  if (day >= 16) return addMonths(ymd.slice(0, 8) + '01', 1);
  return fortnight ? ymd.slice(0, 8) + '16' : addMonths(ymd, 1);
}
function monthLabel(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}
function monthLabelLong(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function fyLabel(start: number): string {
  return `FY ${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

interface ByIndustry { industry: string; clients: number; pump: number; spare: number; total: number; }
interface ByRep { rep: string; zone: string | null; clients: number; total: number; target_cr: number | null; }
interface ByCat { category: string; clients: number; total: number; }
interface YoY { fyStart: number; pump: number; spare: number; total: number; }
interface MonthPoint { ym: string; half: number | null; pump: number; spare: number; total: number; }

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // ── Role / rep scoping ──────────────────────────────────────
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';
  const isRep   = role === 'rep';
  let repId: number | null = session?.user?.repId ?? null;
  if (isRep && repId == null && session?.user?.email) {
    const r = await risansiPool.query<{ id: number }>('SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [session.user.email]);
    repId = r.rows[0]?.id ?? null;
  }
  const personal = isRep && sp.view !== 'full';

  // Per-user client visibility (inline integer ids, no params). Replaces the old
  // primary_rep_id-based personal scoping: rep → own clients, manager → tour scope,
  // admin/sysadmin → null (everything). Applied to every clients-joined query below.
  const currentUser = await getCurrentUser();
  const cVis    = clientVisibilitySql(currentUser, 'c');
  const repCond = cVis ? ` AND (${cVis})` : '';

  // The visibility predicate carries no params, so this just strips the legacy
  // $REP placeholder and passes the base params through unchanged.
  function withRep(sql: string, baseParams: (string | number)[]): [string, (string | number)[]] {
    return [sql.replace(/ AND c\.primary_rep_id = \$REP/g, repCond), baseParams];
  }

  // ── Fiscal year selection (data spans multiple FYs) ─────────
  const availableFys = await q<number[]>(async () => {
    const { rows } = await risansiPool.query<{ fy: number }>(
      `SELECT DISTINCT (CASE WHEN EXTRACT(MONTH FROM crm.month) >= 4 THEN EXTRACT(YEAR FROM crm.month) ELSE EXTRACT(YEAR FROM crm.month) - 1 END)::int AS fy
         FROM client_revenue_monthly crm JOIN clients c ON c.id = crm.client_id
        WHERE c.deleted_at IS NULL${repCond} ORDER BY fy DESC`);
    return rows.map(r => r.fy);
  }, []);
  const fyList = availableFys.length ? availableFys : [2025];
  const reqFy = typeof sp.fy === 'string' ? parseInt(sp.fy, 10) : NaN;
  const selectedFy = fyList.includes(reqFy) ? reqFy : fyList[0];
  const CUR_FY_START  = `${selectedFy}-04-01`;
  const CUR_FY_END    = `${selectedFy + 1}-04-01`;
  const PREV_FY_START = `${selectedFy - 1}-04-01`;
  const PREV_FY_END   = `${selectedFy}-04-01`;

  // ── Granularity: by month, or by fortnight where the upload recorded halves ──
  const fortnight = sp.gran === '15';
  // Period keys are the stored dates: the 1st of a month (a whole month, or
  // its first half) or the 16th (its second half).
  // ── Period (one period, or the full FY) ─────────────────────
  const monthSel = typeof sp.month === 'string' && /^\d{4}-\d{2}-(01|16)$/.test(sp.month) ? sp.month : null;
  const periodStart = monthSel ?? CUR_FY_START;
  const periodEnd   = monthSel ? periodEndOf(monthSel, fortnight) : CUR_FY_END;
  const prevStart   = monthSel ? addMonths(monthSel, -12) : PREV_FY_START;
  const prevEnd     = monthSel ? addMonths(periodEnd, -12) : PREV_FY_END;
  // The key each recorded row groups under: its own date in the 15-day view,
  // the month's first in the monthly view (so two halves add up to a month).
  const periodKey = fortnight ? `to_char(crm.month,'YYYY-MM-DD')` : `to_char(crm.month,'YYYY-MM-01')`;

  function buildUrl(over: { view?: string | null; month?: string | null; fy?: number | null; gran?: string | null }): string {
    const view  = 'view' in over ? over.view  : (personal ? null : (isRep ? 'full' : null));
    const month = 'month' in over ? over.month : monthSel;
    const fy    = 'fy' in over ? over.fy : selectedFy;
    const gran  = 'gran' in over ? over.gran : (fortnight ? '15' : null);
    const p = new URLSearchParams();
    if (view) p.set('view', view);
    if (fy && fy !== fyList[0]) p.set('fy', String(fy));
    if (gran) p.set('gran', gran);
    if (month) p.set('month', month);
    const qs = p.toString();
    return `/risansi/revenue${qs ? `?${qs}` : ''}`;
  }

  const [summary, activeClients, yoy, monthly, byIndustry, byRep, topClients, byCat, monthTiles] = await Promise.all([

    // 1. FY summary — current + previous period, pump/spare, clients billed
    q(async () => {
      const [sql, params] = withRep(
        `SELECT
           COALESCE(SUM(crm.total_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS cur_total,
           COALESCE(SUM(crm.pump_value)  FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS cur_pump,
           COALESCE(SUM(crm.spare_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS cur_spare,
           COALESCE(SUM(crm.total_value) FILTER (WHERE crm.month >= $3 AND crm.month < $4),0)::text AS prev_total,
           COUNT(DISTINCT crm.client_id) FILTER (WHERE crm.month >= $1 AND crm.month < $2 AND crm.total_value > 0)::text AS billed
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         WHERE c.deleted_at IS NULL${repCond}`,
        [periodStart, periodEnd, prevStart, prevEnd],
      );
      const { rows } = await risansiPool.query<{ cur_total: string; cur_pump: string; cur_spare: string; prev_total: string; billed: string }>(sql, params);
      const r = rows[0];
      return {
        total: Number(r?.cur_total ?? 0), pump: Number(r?.cur_pump ?? 0), spare: Number(r?.cur_spare ?? 0),
        prevTotal: Number(r?.prev_total ?? 0), billed: Number(r?.billed ?? 0),
      };
    }, { total: 0, pump: 0, spare: 0, prevTotal: 0, billed: 0 }),

    // 2. Total active clients (scope-aware)
    q(async () => {
      const [sql, params] = withRep(`SELECT COUNT(*)::text AS n FROM clients c WHERE c.deleted_at IS NULL AND c.status = 'ACTIVE'${repCond}`, []);
      const { rows } = await risansiPool.query<{ n: string }>(sql, params);
      return Number(rows[0]?.n ?? 0);
    }, 0),

    // 3. YoY by FY (not month-filtered — it's a trend)
    q<YoY[]>(async () => {
      const [sql, params] = withRep(
        `SELECT (CASE WHEN EXTRACT(MONTH FROM crm.month) >= 4 THEN EXTRACT(YEAR FROM crm.month) ELSE EXTRACT(YEAR FROM crm.month) - 1 END)::int AS fy_start,
                COALESCE(SUM(crm.pump_value),0)::text AS pump,
                COALESCE(SUM(crm.spare_value),0)::text AS spare,
                COALESCE(SUM(crm.total_value),0)::text AS total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         WHERE c.deleted_at IS NULL${repCond}
         GROUP BY 1 ORDER BY 1 DESC LIMIT 5`,
        [],
      );
      const { rows } = await risansiPool.query<{ fy_start: number; pump: string; spare: string; total: string }>(sql, params);
      return rows.map(r => ({ fyStart: Number(r.fy_start), pump: Number(r.pump), spare: Number(r.spare), total: Number(r.total) })).reverse();
    }, []),

    // 4. Monthly trend — distinct months present (annual snapshots), most recent 24
    q<MonthPoint[]>(async () => {
      const [sql, params] = withRep(
        `SELECT ${periodKey} AS ym, MAX(crm.half) AS half,
                COALESCE(SUM(crm.pump_value),0)::text AS pump,
                COALESCE(SUM(crm.spare_value),0)::text AS spare,
                COALESCE(SUM(crm.total_value),0)::text AS total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         WHERE c.deleted_at IS NULL${repCond}
         GROUP BY ym ORDER BY ym DESC LIMIT ${fortnight ? 36 : 24}`,
        [],
      );
      const { rows } = await risansiPool.query<{ ym: string; half: number | null; pump: string; spare: string; total: string }>(sql, params);
      return rows.map(r => ({ ym: r.ym, half: r.half, pump: Number(r.pump), spare: Number(r.spare), total: Number(r.total) })).reverse();
    }, []),

    // 5. By industry (period)
    q<ByIndustry[]>(async () => {
      const [sql, params] = withRep(
        `SELECT COALESCE(c.industry,'Other') AS industry,
                COUNT(DISTINCT crm.client_id)::text AS clients,
                COALESCE(SUM(crm.pump_value),0)::text AS pump,
                COALESCE(SUM(crm.spare_value),0)::text AS spare,
                COALESCE(SUM(crm.total_value),0)::text AS total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         WHERE c.deleted_at IS NULL AND crm.month >= $1 AND crm.month < $2${repCond}
         GROUP BY COALESCE(c.industry,'Other') HAVING SUM(crm.total_value) > 0
         ORDER BY SUM(crm.total_value) DESC LIMIT 15`,
        [periodStart, periodEnd],
      );
      const { rows } = await risansiPool.query<{ industry: string; clients: string; pump: string; spare: string; total: string }>(sql, params);
      return rows.map(r => ({ industry: r.industry, clients: Number(r.clients), pump: Number(r.pump), spare: Number(r.spare), total: Number(r.total) }));
    }, []),

    // 6. By owner / zone (period) + target — owners from client_assignments → users.
    //    Revenue is attributed to each assigned owner (a client may have several).
    q<ByRep[]>(async () => {
      const [sql, params] = withRep(
        `SELECT COALESCE(u.name, 'Unassigned') AS rep,
                u.zone, u.target_cr::text AS target_cr,
                COUNT(DISTINCT crm.client_id)::text AS clients,
                COALESCE(SUM(crm.total_value),0)::text AS total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         -- Revenue is credited to the client's own rep. Under tours this joined
         -- every rep on the route, so a two-rep route double-counted the client's
         -- revenue into both of their totals.
         LEFT JOIN users u ON u.id = ${clientPrimaryRepSql('c.id')}
         WHERE c.deleted_at IS NULL AND crm.month >= $1 AND crm.month < $2${repCond}
         GROUP BY COALESCE(u.name, 'Unassigned'), u.zone, u.target_cr
         HAVING SUM(crm.total_value) > 0 ORDER BY SUM(crm.total_value) DESC LIMIT 30`,
        [periodStart, periodEnd],
      );
      const { rows } = await risansiPool.query<{ rep: string; zone: string | null; target_cr: string | null; clients: string; total: string }>(sql, params);
      return rows.map(r => ({ rep: r.rep, zone: r.zone, clients: Number(r.clients), total: Number(r.total), target_cr: r.target_cr != null ? Number(r.target_cr) : null }));
    }, []),

    // 7. Top clients (current + previous period for vs LY) — fetch up to 100, paginated client-side
    q<RevenueClientRow[]>(async () => {
      const [sql, params] = withRep(
        `SELECT c.id::text AS id, c.code, c.legal_name, c.industry, c.state, c.tier,
                COALESCE(${clientRepNamesSql('c.id')}, '—') AS rep_name,
                COALESCE(SUM(crm.pump_value)  FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS pump,
                COALESCE(SUM(crm.spare_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS spare,
                COALESCE(SUM(crm.total_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2),0)::text AS total,
                COALESCE(SUM(crm.total_value) FILTER (WHERE crm.month >= $3 AND crm.month < $4),0)::text AS prev_total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         WHERE c.deleted_at IS NULL${repCond}
         GROUP BY c.id, c.code, c.legal_name, c.industry, c.state, c.tier
         HAVING SUM(crm.total_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2) > 0
         ORDER BY SUM(crm.total_value) FILTER (WHERE crm.month >= $1 AND crm.month < $2) DESC
         LIMIT 100`,
        [periodStart, periodEnd, prevStart, prevEnd],
      );
      const { rows } = await risansiPool.query<Record<string, string | null>>(sql, params);
      return rows.map(r => ({
        id: r.id as string, code: r.code as string, legal_name: r.legal_name as string,
        industry: r.industry, state: r.state, tier: r.tier, rep_name: (r.rep_name as string) ?? '—',
        pump: Number(r.pump ?? 0), spare: Number(r.spare ?? 0), total: Number(r.total ?? 0), prev_total: Number(r.prev_total ?? 0),
      }));
    }, []),

    // 8. Business category (client_type — no business_category column exists)
    q<ByCat[]>(async () => {
      const [sql, params] = withRep(
        `SELECT COALESCE(NULLIF(TRIM(c.client_type),''),'Unclassified') AS category,
                COUNT(DISTINCT crm.client_id)::text AS clients,
                COALESCE(SUM(crm.total_value),0)::text AS total
         FROM client_revenue_monthly crm
         JOIN clients c ON c.id = crm.client_id
         WHERE c.deleted_at IS NULL AND crm.month >= $1 AND crm.month < $2${repCond}
         GROUP BY category HAVING SUM(crm.total_value) > 0 ORDER BY SUM(crm.total_value) DESC`,
        [periodStart, periodEnd],
      );
      const { rows } = await risansiPool.query<{ category: string; clients: string; total: string }>(sql, params);
      return rows.map(r => ({ category: r.category, clients: Number(r.clients), total: Number(r.total) }));
    }, []),

    // 9. Period tiles — the periods recorded in the current FY: months, or in
    //    the 15-day view each recorded half (a month uploaded whole stays one tile).
    q<{ ym: string; half: number | null }[]>(async () => {
      const { rows } = await risansiPool.query<{ ym: string; half: number | null }>(
        `SELECT ${periodKey} AS ym, MAX(crm.half) AS half
           FROM client_revenue_monthly crm JOIN clients c ON c.id = crm.client_id
          WHERE crm.month >= $1 AND crm.month < $2 AND c.deleted_at IS NULL${repCond} GROUP BY 1 ORDER BY 1`,
        [CUR_FY_START, CUR_FY_END],
      );
      return rows;
    }, []),
  ]);

  // ── Derived ─────────────────────────────────────────────────
  const delta      = summary.prevTotal > 0 ? ((summary.total - summary.prevTotal) / summary.prevTotal) * 100 : null;

  // Month on month, derived from the trend rather than a second query: `monthly`
  // already holds every recorded month for this scope, in order.
  //
  // Distinct from the headline delta above, which compares a month against the
  // SAME MONTH LAST YEAR. Both are worth having and they answer different
  // questions -- year-on-year takes the seasonality out, month-on-month is what
  // actually changed since the last billing run -- so the card carries both
  // rather than one standing in for the other.
  const momRows = monthly.map((m, i) => {
    const prev = i > 0 ? monthly[i - 1] : null;
    const change = prev && prev.total > 0 ? ((m.total - prev.total) / prev.total) * 100 : null;
    return { ...m, prevTotal: prev?.total ?? null, change };
  });
  const momSelected = monthSel ? momRows.find(r => r.ym === monthSel) ?? null : null;
  const pumpPct    = summary.total > 0 ? (summary.pump / summary.total) * 100 : 0;
  const sparePct   = summary.total > 0 ? (summary.spare / summary.total) * 100 : 0;
  const maxIndustry = Math.max(...byIndustry.map(r => r.total), 1);
  const maxRep      = Math.max(...byRep.map(r => r.total), 1);
  const catTotal    = byCat.reduce((s, r) => s + r.total, 0);
  const hasAnyData  = summary.total > 0 || byIndustry.length > 0 || topClients.length > 0 || yoy.some(y => y.total > 0);

  const selTile = monthTiles.find(m => m.ym === monthSel);
  const subtitle = monthSel ? `Showing ${periodLabel(monthSel, selTile?.half ?? (fortnight && monthSel.endsWith('-01') ? null : undefined), { long: true })}` : `${fyLabel(selectedFy)} · ${fortnight ? 'all periods, by fortnight' : 'all months'}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Revenue']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Revenue</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
            {subtitle}{personal ? ' · your clients' : ''}
          </div>
        </div>

        {/* Section 0 — rep toggle */}
        {isRep && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            <a href={buildUrl({ view: null })} style={toggle(personal)}>My Revenue</a>
            <a href={buildUrl({ view: 'full' })} style={toggle(!personal)}>All Revenue</a>
          </div>
        )}

        {!hasAnyData ? (
          <div style={{ ...PANEL, padding: '48px 24px', textAlign: 'center', color: 'var(--fg-3)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💹</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-2)', marginBottom: 6 }}>No revenue recorded yet</div>
            <div style={{ fontSize: 13 }}>
              Upload monthly revenue data from{' '}
              <Link href="/risansi/admin/revenue" style={{ color: 'var(--accent)' }}>Admin → Revenue Upload</Link>
            </div>
          </div>
        ) : (
          <>
            {/* Section 0b — fiscal year selector (chips on desktop, dropdown on mobile) */}
            {fyList.length > 1 && (
              <>
                <div className="r-desktop-only" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Financial Year</span>
                  {fyList.map(fy => (
                    <a key={fy} href={buildUrl({ fy, month: null })} style={tile(selectedFy === fy)}>{fyLabel(fy)}</a>
                  ))}
                </div>
                <div className="r-mobile-only" style={{ marginBottom: 10 }}>
                  <UrlSelect prefix="FY" ariaLabel="Financial Year" value={String(selectedFy)}
                    options={fyList.map(fy => ({ value: String(fy), label: fyLabel(fy), href: buildUrl({ fy, month: null }) }))} />
                </div>
              </>
            )}

            {/* Section 1 — period tiles (chips on desktop, dropdown on mobile),
                and the Monthly / 15-day switch. The 15-day view shows halves
                where the upload recorded them; a month uploaded whole is still
                one tile, labelled as the month. */}
            <div className="r-desktop-only" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', border: '1px solid var(--line-strong)', borderRadius: 7, overflow: 'hidden', marginRight: 8 }}>
                {([['30', 'Monthly'], ['15', '15-day']] as const).map(([g, l]) => {
                  const on = (g === '15') === fortnight;
                  return <a key={g} href={buildUrl({ gran: g === '15' ? '15' : null, month: null })} title={g === '15' ? 'Each recorded fortnight (1–15, 16–end); months uploaded whole stay whole' : 'Whole months; fortnights add up into their month'}
                    style={{ padding: '6px 12px', fontSize: 12, fontWeight: on ? 600 : 400, textDecoration: 'none', background: on ? 'var(--accent-fill)' : 'var(--bg-paper)', color: on ? 'var(--on-accent)' : 'var(--fg-2)' }}>{l}</a>;
                })}
              </div>
              <a href={buildUrl({ month: null })} style={tile(!monthSel)}>All</a>
              {monthTiles.map(m => (
                <a key={m.ym} href={buildUrl({ month: m.ym })} style={tile(monthSel === m.ym)}>{periodLabel(m.ym, m.half)}</a>
              ))}
            </div>
            {/* mobile.css forces .r-mobile-only to display:block, so each select gets its own row. */}
            <div className="r-mobile-only" style={{ marginBottom: 8 }}>
              <UrlSelect prefix="View" ariaLabel="Granularity" value={fortnight ? '15' : '30'}
                options={[{ value: '30', label: 'Monthly', href: buildUrl({ gran: null, month: null }) }, { value: '15', label: '15-day', href: buildUrl({ gran: '15', month: null }) }]} />
            </div>
            <div className="r-mobile-only" style={{ marginBottom: 14 }}>
              <UrlSelect prefix={fortnight ? 'Period' : 'Month'} ariaLabel="Period" value={monthSel ?? 'all'}
                options={[{ value: 'all', label: fortnight ? 'All periods' : 'All months', href: buildUrl({ month: null }) },
                          ...monthTiles.map(m => ({ value: m.ym, label: periodLabel(m.ym, m.half), href: buildUrl({ month: m.ym }) }))]} />
            </div>

            {/* Section 2 — KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
              <Kpi label={monthSel ? 'Period Total' : `${fyLabel(selectedFy)} Total`} value={formatRev(summary.total)}
                sub={delta != null ? `${delta >= 0 ? '▲' : '▼'} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs ${monthSel ? (fortnight ? 'same period LY' : 'same month LY') : fyLabel(selectedFy - 1)}` : 'no prior-period data'}
                subColor={delta == null ? 'var(--fg-3)' : delta >= 0 ? 'var(--pos)' : 'var(--neg)'}
                sub2={momSelected
                  ? (momSelected.change != null
                      ? `${momSelected.change >= 0 ? '▲' : '▼'} ${momSelected.change >= 0 ? '+' : ''}${momSelected.change.toFixed(1)}% vs ${(() => { const pr = monthly[monthly.findIndex(x => x.ym === monthSel) - 1]; return pr ? periodLabel(pr.ym, pr.half) : ''; })()}`
                      : `no prior ${fortnight ? 'period' : 'month'} recorded`)
                  : undefined}
                sub2Color={momSelected?.change == null ? 'var(--fg-3)' : momSelected.change >= 0 ? 'var(--pos)' : 'var(--neg)'} />
              <Kpi label="Pump Revenue" value={formatRev(summary.pump)} sub={`${pumpPct.toFixed(0)}% of total`} />
              <Kpi label="Spare Revenue" value={formatRev(summary.spare)} sub={`${sparePct.toFixed(0)}% of total`} />
              <Kpi label="Clients Billed" value={summary.billed.toLocaleString('en-IN')} sub={`of ${activeClients.toLocaleString('en-IN')} active clients`} />
            </div>

            {/* Section 3 — YoY + pump/spare donut */}
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, marginBottom: 14 }}>
              <div style={PANEL}>
                <div style={PANEL_H}><span style={PANEL_TITLE}>Year-on-Year Revenue</span><span style={META}>Pump vs Spare · ₹ Lakhs</span></div>
                <div style={{ padding: '16px 18px' }}>
                  {yoy.some(y => y.total > 0) ? <YoYChart rows={yoy} curFyStart={selectedFy} /> : <Empty>No historical data</Empty>}
                  <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: 11, color: 'var(--fg-3)' }}>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--title)', borderRadius: 2, marginRight: 5 }} />Pump</span>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--brand-cyan)', borderRadius: 2, marginRight: 5 }} />Spare</span>
                  </div>
                </div>
              </div>

              <div style={PANEL}>
                <div style={PANEL_H}><span style={PANEL_TITLE}>Pump vs Spare</span></div>
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                  {summary.total > 0 ? (
                    <>
                      <Donut
                        data={[{ pct: pumpPct, color: 'var(--title)', name: 'Pump' }, { pct: sparePct, color: 'var(--brand-cyan)', name: 'Spare' }]}
                        size={150} thick={22}
                        center={<div style={{ textAlign: 'center' }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, color: 'var(--fg)' }}>{formatRev(summary.total)}</div>
                          <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>Total</div>
                        </div>}
                      />
                      <div style={{ display: 'flex', gap: 18, fontSize: 12 }}>
                        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--title)', borderRadius: 2, marginRight: 5 }} />Pump {pumpPct.toFixed(0)}%</span>
                        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--brand-cyan)', borderRadius: 2, marginRight: 5 }} />Spare {sparePct.toFixed(0)}%</span>
                      </div>
                    </>
                  ) : <Empty>No revenue in this period</Empty>}
                </div>
              </div>
            </div>

            {/* Section 4 — industry + rep tables */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginBottom: 14 }}>
              {/* Industry */}
              <div style={PANEL}>
                <div style={PANEL_H}><span style={PANEL_TITLE}>Revenue by Industry</span></div>
                {byIndustry.length === 0 ? <Empty>No data</Empty> : (
                  <div style={{ overflowX: 'auto' }}>
                    <SortedTable
                      className="r-cards"
                      style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
                      headRowStyle={{ background: 'var(--bg-elev)' }}
                      divider="1px solid var(--line)"
                      columns={[
                        { key: 'industry', label: 'Industry', kind: 'text',   style: TH },
                        { key: 'clients',  label: 'Clients',  kind: 'number', style: TH },
                        { key: 'pump',     label: 'Pump',     kind: 'number', align: 'right', style: TH },
                        { key: 'spare',    label: 'Spare',    kind: 'number', align: 'right', style: TH },
                        { key: 'total',    label: 'Total',    kind: 'number', style: TH },
                        { key: 'share',    label: '% Share',  kind: 'number', align: 'right', style: TH },
                      ]}
                      rows={byIndustry.map(r => {
                        const share = summary.total > 0 ? (r.total / summary.total) * 100 : 0;
                        return {
                          id: r.industry,
                          // Rupee figures sort on the number, not on the '₹1.2 Cr'
                          // the cell prints, and Total sorts on the value behind
                          // its bar.
                          values: {
                            industry: r.industry, clients: r.clients,
                            pump: r.pump, spare: r.spare, total: r.total,
                            share: summary.total > 0 ? share : null,
                          },
                          cells: (
                            <>
                              <td data-label="" style={{ ...TD, fontWeight: 500 }}>{r.industry}</td>
                              <td data-label="Clients" style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{r.clients}</td>
                              <td data-label="Pump" style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r.pump > 0 ? formatRev(r.pump) : '—'}</td>
                              <td data-label="Spare" style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{r.spare > 0 ? formatRev(r.spare) : '—'}</td>
                              <td data-label="Total" style={{ ...TD, minWidth: 130 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ flex: 1, height: 5, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden', minWidth: 50 }}>
                                    <div style={{ width: `${(r.total / maxIndustry) * 100}%`, height: '100%', background: 'var(--brand-blue)', borderRadius: 3 }} />
                                  </div>
                                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, minWidth: 56, textAlign: 'right' }}>{formatRev(r.total)}</span>
                                </div>
                              </td>
                              <td data-label="% Share" style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{share.toFixed(0)}%</td>
                            </>
                          ),
                        };
                      })}
                    />
                  </div>
                )}
              </div>

              {/* Rep */}
              <div style={PANEL}>
                <div style={PANEL_H}><span style={PANEL_TITLE}>Revenue by Rep</span></div>
                {byRep.length === 0 ? <Empty>No data</Empty> : (
                  <div style={{ overflowX: 'auto' }}>
                    <SortedTable
                      className="r-cards"
                      style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
                      headRowStyle={{ background: 'var(--bg-elev)' }}
                      divider="1px solid var(--line)"
                      columns={[
                        { key: 'rep',     label: 'Rep',       kind: 'text',   style: TH },
                        { key: 'zone',    label: 'Zone',      kind: 'text',   style: TH },
                        { key: 'clients', label: 'Clients',   kind: 'number', style: TH },
                        { key: 'total',   label: 'Total',     kind: 'number', align: 'right', style: TH },
                        { key: 'pct',     label: 'vs Target', kind: 'number', style: TH },
                      ]}
                      rows={byRep.map(r => {
                        const targetInr = r.target_cr != null ? r.target_cr * 1_00_00_000 : null; // Cr → INR
                        const pct = targetInr && targetInr > 0 ? (r.total / targetInr) * 100 : null;
                        return {
                          id: r.rep,
                          // A rep with no target has no attainment, so vs Target
                          // is blank and sinks to the bottom either way rather
                          // than reading as 0%.
                          values: { rep: r.rep, zone: r.zone, clients: r.clients, total: r.total, pct },
                          cells: (
                            <>
                              <td data-label="" style={{ ...TD, fontWeight: 500 }}>{r.rep}</td>
                              <td data-label="Zone" style={{ ...TD, color: 'var(--fg-3)', fontSize: 11 }}>{r.zone ?? '—'}</td>
                              <td data-label="Clients" style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{r.clients}</td>
                              <td data-label="Total" style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatRev(r.total)}</td>
                              <td data-label="vs Target" style={{ ...TD, minWidth: 110 }}>
                                {pct == null ? <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>—</span> : (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <div style={{ flex: 1, height: 5, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden', minWidth: 40 }}>
                                      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: pct >= 100 ? 'var(--pos)' : pct >= 60 ? 'var(--accent)' : 'var(--warn)', borderRadius: 3 }} />
                                    </div>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: pct >= 100 ? 'var(--pos)' : 'var(--fg-3)', minWidth: 32, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                                  </div>
                                )}
                              </td>
                            </>
                          ),
                        };
                      })}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Section 5 — monthly trend */}
            <div style={{ ...PANEL, marginBottom: 14 }}>
              <div style={PANEL_H}><span style={PANEL_TITLE}>Revenue Trend</span><span style={META}>{fortnight ? 'per recorded fortnight' : 'per month'} · ₹ Lakhs</span></div>
              <div style={{ padding: '16px 18px' }}>
                {monthly.some(m => m.total > 0) ? <MonthlyTrend rows={monthly} selected={monthSel} /> : <Empty>No trend data</Empty>}
              </div>
            </div>

            {/* Section 5b — month on month. The chart above shows the shape; this
                puts a number on each step, which is what gets quoted in a review. */}
            <div style={{ ...PANEL, marginBottom: 14 }}>
              <div style={PANEL_H}>
                <span style={PANEL_TITLE}>Month on Month</span>
                <span style={META}>each month against the one before · ₹ Lakhs</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                {momRows.length < 2 ? <Empty>Not enough recorded months to compare</Empty> : (
                  <SortedTable
                    style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
                    columns={[
                      { key: 'ym',        label: 'Month',      kind: 'date',   style: { ...TH, textAlign: 'left' } },
                      { key: 'pump',      label: 'Pump',       kind: 'number', align: 'right', style: TH },
                      { key: 'spare',     label: 'Spare',      kind: 'number', align: 'right', style: TH },
                      { key: 'total',     label: 'Total',      kind: 'number', align: 'right', style: TH },
                      { key: 'prevTotal', label: 'Prev month', kind: 'number', align: 'right', style: TH },
                      { key: 'diff',      label: 'Change',     kind: 'number', align: 'right', style: TH },
                      { key: 'change',    label: '%',          kind: 'number', align: 'right', style: TH },
                    ]}
                    rows={[...momRows].reverse().map(m => {
                      const diff = m.prevTotal == null ? null : m.total - m.prevTotal;
                      const tone = m.change == null ? 'var(--fg-3)' : m.change >= 0 ? 'var(--pos)' : 'var(--neg)';
                      return {
                        id: m.ym,
                        // Change and % sort signed, so a descending click puts the
                        // biggest rise at the top and the steepest fall at the
                        // bottom. The first month has nothing to compare against,
                        // so both are blank rather than zero.
                        values: {
                          ym: m.ym, pump: m.pump, spare: m.spare, total: m.total,
                          prevTotal: m.prevTotal, diff, change: m.change,
                        },
                        style: { background: m.ym === monthSel ? 'var(--bg-elev)' : undefined },
                        cells: (
                          <>
                            <td style={{ ...TD, fontWeight: m.ym === monthSel ? 700 : 500 }}>
                              <a href={buildUrl({ month: m.ym })} style={{ color: 'inherit', textDecoration: 'none' }}>
                                {monthLabelLong(m.ym)}
                              </a>
                            </td>
                            <td style={NUM}>{lakh(m.pump)}</td>
                            <td style={NUM}>{lakh(m.spare)}</td>
                            <td style={{ ...NUM, fontWeight: 600 }}>{lakh(m.total)}</td>
                            <td style={{ ...NUM, color: 'var(--fg-3)' }}>{m.prevTotal == null ? '—' : lakh(m.prevTotal)}</td>
                            <td style={{ ...NUM, color: tone }}>
                              {diff == null ? '—' : `${diff >= 0 ? '+' : '−'}${lakh(Math.abs(diff))}`}
                            </td>
                            <td style={{ ...NUM, color: tone, fontWeight: 600 }}>
                              {m.change == null ? '—' : `${m.change >= 0 ? '▲' : '▼'} ${Math.abs(m.change).toFixed(1)}%`}
                            </td>
                          </>
                        ),
                      };
                    })}
                  />
                )}
              </div>
            </div>

            {/* Section 6 — top clients (interactive) */}
            <div style={{ marginBottom: 14 }}>
              <RevenueTopClients clients={topClients} />
            </div>

            {/* Section 7 — business category */}
            <div style={PANEL}>
              <div style={PANEL_H}><span style={PANEL_TITLE}>Business Category</span><span style={META}>by client type</span></div>
              {byCat.length === 0 ? <Empty>No data</Empty> : (
                <SortedTable
                  className="r-cards"
                  style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
                  headRowStyle={{ background: 'var(--bg-elev)' }}
                  divider="1px solid var(--line)"
                  columns={[
                    { key: 'category', label: 'Category',   kind: 'text',   style: TH },
                    { key: 'clients',  label: 'Clients',    kind: 'number', style: TH },
                    { key: 'total',    label: 'Revenue',    kind: 'number', align: 'right', style: TH },
                    { key: 'pct',      label: '% of Total', kind: 'number', style: TH },
                  ]}
                  rows={byCat.map((r, i) => {
                    const pct = catTotal > 0 ? (r.total / catTotal) * 100 : 0;
                    return {
                      id: r.category,
                      // The category pill keeps the colour it was given by the
                      // query's order, so re-sorting the table does not recolour
                      // the rows underneath the reader.
                      values: {
                        category: r.category, clients: r.clients, total: r.total,
                        pct: catTotal > 0 ? pct : null,
                      },
                      cells: (
                        <>
                          <td data-label="" style={{ ...TD }}><span style={catPill(i)}>{r.category}</span></td>
                          <td data-label="Clients" style={{ ...TD, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{r.clients}</td>
                          <td data-label="Revenue" style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatRev(r.total)}</td>
                          <td data-label="% of Total" style={{ ...TD, minWidth: 120 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, height: 5, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: CAT_COLORS[i % CAT_COLORS.length], borderRadius: 3 }} />
                              </div>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', minWidth: 34, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                        </>
                      ),
                    };
                  })}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Charts (server-rendered SVG) ───────────────────────────────

function YoYChart({ rows, curFyStart }: { rows: YoY[]; curFyStart: number }) {
  const max = Math.max(...rows.map(r => Math.max(r.pump, r.spare) / INR_TO_L), 1);
  const H = 150, barW = 16, pairGap = 4, groupGap = 38, padL = 38, padB = 24;
  const groupW = barW * 2 + pairGap;
  const totalW = rows.length * (groupW + groupGap) - groupGap;
  return (
    <svg width="100%" height={H + padB} viewBox={`0 0 ${totalW + padL + 10} ${H + padB}`} preserveAspectRatio="xMinYMin meet" style={{ overflow: 'visible' }}>
      {[0.25, 0.5, 0.75, 1].map(p => {
        const y = H - p * H;
        return (
          <g key={p}>
            <line x1={padL} x2={totalW + padL} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 3" />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--fg-3)" fontFamily="var(--font-mono)">{Math.round(max * p)}</text>
          </g>
        );
      })}
      {rows.map((r, i) => {
        const x = padL + i * (groupW + groupGap);
        const ph = (r.pump / INR_TO_L / max) * H;
        const sh = (r.spare / INR_TO_L / max) * H;
        const cur = r.fyStart === curFyStart;
        return (
          <g key={i}>
            <rect x={x} y={H - ph} width={barW} height={ph} rx={1.5} fill="var(--title)" opacity={cur ? 1 : 0.6} />
            <rect x={x + barW + pairGap} y={H - sh} width={barW} height={sh} rx={1.5} fill="var(--brand-cyan)" opacity={cur ? 1 : 0.6} />
            <text x={x + groupW / 2} y={H + 14} textAnchor="middle" fontSize="10" fontWeight={cur ? 700 : 400} fill={cur ? 'var(--title)' : 'var(--fg-3)'} fontFamily="var(--font-mono)">{fyLabel(r.fyStart)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function MonthlyTrend({ rows, selected }: { rows: MonthPoint[]; selected: string | null }) {
  const max = Math.max(...rows.map(r => r.total / INR_TO_L), 1);
  const H = 120, padL = 38, padB = 24, gap = 10;
  const bw = Math.max(10, Math.min(40, Math.floor((640 - padL) / rows.length) - gap));
  const totalW = rows.length * (bw + gap) - gap;
  return (
    <svg width="100%" height={H + padB} viewBox={`0 0 ${totalW + padL + 10} ${H + padB}`} preserveAspectRatio="xMinYMin meet" style={{ overflow: 'visible' }}>
      {[0.5, 1].map(p => {
        const y = H - p * H;
        return (
          <g key={p}>
            <line x1={padL} x2={totalW + padL} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 3" />
            <text x={padL - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--fg-3)" fontFamily="var(--font-mono)">{Math.round(max * p)}</text>
          </g>
        );
      })}
      {rows.map((r, i) => {
        const x = padL + i * (bw + gap);
        const h = (r.total / INR_TO_L / max) * H;
        const sel = selected === r.ym;
        return (
          <g key={r.ym}>
            <title>{`${periodLabel(r.ym, r.half)} · Pump ${formatRev(r.pump)} · Spare ${formatRev(r.spare)} · Total ${formatRev(r.total)}`}</title>
            <rect x={x} y={H - h} width={bw} height={h} rx={2} fill={sel ? 'var(--warn)' : r.half ? (r.half === 1 ? '#1A5CB8' : '#5B8FD6') : '#1A5CB8'} />
            <text x={x + bw / 2} y={H - h - 3} textAnchor="middle" fontSize="8" fill="var(--fg-2)" fontFamily="var(--font-mono)">{r.total > 0 ? Math.round(r.total / INR_TO_L) : ''}</text>
            <text x={x + bw / 2} y={H + 14} textAnchor="middle" fontSize="9" fill={sel ? 'var(--warn)' : 'var(--fg-3)'} fontFamily="var(--font-mono)">{r.half ? `${monthLabel(r.ym)} ${r.half === 1 ? '¹' : '²'}` : monthLabel(r.ym)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Small sub-components ───────────────────────────────────────

function Kpi({ label, value, sub, subColor, sub2, sub2Color }: {
  label: string; value: string; sub: string; subColor?: string;
  // A second comparison line. A month has two worth quoting — against the same
  // month last year, and against the month before — and picking one would leave
  // the reader doing the other in their head.
  sub2?: string; sub2Color?: string;
}) {
  return (
    <div style={{ ...PANEL, borderLeft: '3px solid var(--title)', padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--fg)', letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: subColor ?? 'var(--fg-3)', marginTop: 4 }}>{sub}</div>
      {sub2 && <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: sub2Color ?? 'var(--fg-3)', marginTop: 2 }}>{sub2}</div>}
    </div>
  );
}

// Rupees as lakhs, for the month-on-month table where every figure is a lakh
// or two and full rupee amounts would be unreadable side by side.
function lakh(v: number): string {
  return (v / INR_TO_L).toFixed(2);
}

const NUM: CSSProperties = { padding: '7px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--line-2)' };

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: '32px 0' }}>{children}</div>;
}

const CAT_COLORS = ['#0A3D8F', '#1A5CB8', '#00B4D8', '#059669', '#D97706', '#7C3AED', '#DC2626', '#6B7FA3'];

function toggle(active: boolean): CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
    background: active ? 'var(--accent-fill)' : 'var(--bg-elev)', color: active ? 'var(--on-accent)' : 'var(--fg-3)',
    textDecoration: 'none', border: '1px solid var(--line)',
  };
}
function tile(active: boolean): CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: active ? 600 : 500,
    background: active ? 'var(--accent-fill)' : 'var(--bg-paper)', color: active ? 'var(--on-accent)' : 'var(--fg-2)',
    textDecoration: 'none', border: `1px solid ${active ? 'var(--accent-fill)' : 'var(--line-strong)'}`,
    fontFamily: 'var(--font-mono)',
  };
}
function catPill(i: number): CSSProperties {
  const c = CAT_COLORS[i % CAT_COLORS.length];
  return { display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 500, background: c + '18', color: c, border: `1px solid ${c}40`, whiteSpace: 'nowrap' };
}

// ── Styles ─────────────────────────────────────────────────────

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500, letterSpacing: '-0.005em' };
const META: CSSProperties = { fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' };
const TH: CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)' };
const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
