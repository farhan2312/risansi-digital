import { getServerSession } from 'next-auth/next';
import { redirect } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getCurrentUser, getReviewableRepIds, getManagerAssignableReps, clientVisibilitySql, clientScopeSql , OWN_OPEN } from '@/lib/risansi-auth';
import risansiPool from '@/lib/db-risansi';
import { ExecutiveViews, ExecTabs, type ExecData, type Row, type ExecTab } from '@/components/risansi/ExecutiveViews';
import { ProjectionFilters } from '@/components/risansi/ProjectionFilters';
import { ExecutiveSelector, type SelRep } from '@/components/risansi/ExecutiveSelector';
import { ExecDrilldownProvider } from '@/components/risansi/ExecDrilldown';
import { SalesProjection } from '@/components/risansi/SalesProjection';
import { loadProjection, loadProjectionOptions, parseProjectionFilters } from '@/lib/risansi-sales-projection';
// CANON / CATS / TURN_ORDER live in the lib the drill-down also reads, so the
// page and its breakdowns cannot classify a client two different ways.
import {
  CANON, CATS, CAT_OTHER, CAT_OTHER_LABEL, TURN_ORDER, STAGE_TO_OFFER, OFFER_STATUS_ORDER,
  CONVERSION_STAGES, CONVERSION_WON_STAGES, CONVERSION_INCLUDES, CONVERSION_EXCLUDES, conversionWhereSql,
  execScopeSql, fyWindows, parseFy, fyChoices, OPP_WINDOW_DATE, OPEN_STAGES, type AccountScope,
} from '@/lib/risansi-exec-review';
import { AccountSelector, type NameOpt } from '@/components/risansi/AccountSelector';
import type { CurrentFyView } from '@/components/risansi/AccountReview';
import { GroupReview, OemReview, type GroupReviewData, type GroupUnit, type OemReviewData } from '@/components/risansi/AccountReview';
import { CLIENT_STATUS_COLORS } from '@/lib/risansi-client-status';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fb: T): Promise<T> { try { return await fn(); } catch (e) { console.error('[exec-review]', e); return fb; } }
const n = (v: unknown) => Math.round(Number(v ?? 0));
const yy = (y: number) => `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
function fmtMoney(v: number): string {
  if (!v) return '₹0';
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

// Canonical client-type bucket (Mona's five categories).

// FY label in the app's key format: start year 2025 → '25-26'.
const fyLabel = (startYear: number) => `${String(startYear % 100).padStart(2, '0')}-${String((startYear + 1) % 100).padStart(2, '0')}`;
// Bucket a date column into that same FY label (April–March).
const FY_EXPR = (col: string) => `CASE WHEN EXTRACT(MONTH FROM ${col}) >= 4
  THEN LPAD((EXTRACT(YEAR FROM ${col})::int % 100)::text,2,'0')||'-'||LPAD(((EXTRACT(YEAR FROM ${col})::int + 1) % 100)::text,2,'0')
  ELSE LPAD(((EXTRACT(YEAR FROM ${col})::int - 1) % 100)::text,2,'0')||'-'||LPAD((EXTRACT(YEAR FROM ${col})::int % 100)::text,2,'0') END`;

export default async function ExecutiveReviewPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined> & { tsm?: string; month?: string; months?: string; view?: string; tab?: string; ctype?: string; name?: string; tview?: string; scope?: string; proj?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/api/auth/signin');
  const sp = await searchParams;

  // Open to every signed-in role, scoped server-side. `allowedRepIds` is null
  // for admin/sysadmin (no restriction), otherwise the exact set of TSMs this
  // user may review; `clientVis` is the matching predicate for the Account
  // Review side. Both the tsm and name params are validated against the scoped
  // option lists below, so a hand-typed id can never widen access.
  const me = await getCurrentUser();
  const allowedRepIds = await getReviewableRepIds(me);
  const clientVis = clientVisibilitySql(me, 'c');
  const visAnd = clientVis ? ` AND (${clientVis})` : '';

  // ── Which tab. `view=account` is the older spelling, kept for saved links. ──
  const tab: ExecTab = sp.tab === 'account' || (sp.tab == null && sp.view === 'account') ? 'account'
    : sp.tab === 'projection' ? 'projection' : 'tsm';
  // A tab link keeps the params that mean something on the target tab and
  // drops the rest, so switching never carries a stale picker across.
  // `fy` rides along to the projection tab too: that tab forecasts closures for
  // the same fiscal year the review is showing, so dropping it would switch the
  // year under the reader as they change tab.
  const KEEP: Record<ExecTab, string[]> = {
    tsm: ['tsm', 'scope', 'fy'], account: ['ctype', 'name', 'tview'],
    projection: ['fy', 'proj', 'prep', 'pptype', 'pind', 'pctype', 'pstage', 'pprob', 'pmarket', 'pmin'],
  };
  const tabHref = (t: ExecTab) => {
    const q = new URLSearchParams();
    if (t !== 'tsm') q.set('tab', t);
    for (const k of KEEP[t]) { const v = sp[k]; if (typeof v === 'string' && v) q.set(k, v); }
    const qs = q.toString();
    return `/risansi/executive-review${qs ? `?${qs}` : ''}`;
  };
  const tabs = <ExecTabs active={tab} hrefFor={tabHref} />;

  // ── Account Review: a group of mills, or a single OEM ──────────
  if (tab === 'account') {
    // 'group' aggregates the units of a named group. Every other value is one of
    // the CANON buckets and gives a single-client review — which is what the OEM
    // branch always was, just filtered to one type. Traders, Direct Mills and the
    // 1,017 clients that classify as Other had no Account Review at all, because
    // this line offered exactly two options.
    const ACCOUNT_TYPES = ['group', ...CATS, 'Other'];
    const ctype = ACCOUNT_TYPES.includes(sp.ctype ?? '') ? sp.ctype! : 'group';
    const nowD = new Date();
    const curFy = (nowD.getMonth() + 1) >= 4 ? nowD.getFullYear() : nowD.getFullYear() - 1;
    const FYS = Array.from({ length: 5 }, (_, i) => fyLabel(curFy - 4 + i));

    // Scoped to the accounts this user may see: a rep only gets the groups/OEMs
    // among their own clients, a manager theirs, admins everything. The unit
    // counts in the labels reflect the same scope.
    const options = await q<NameOpt[]>(async () => (await risansiPool.query<NameOpt>(
      ctype === 'group'
        ? `SELECT c.group_name AS value, c.group_name || ' (' || count(*) || ' units)' AS label
             FROM clients c
            WHERE c.group_name IS NOT NULL AND btrim(c.group_name) <> '' AND c.deleted_at IS NULL${visAnd}
            GROUP BY c.group_name ORDER BY c.group_name`
        // Matched on the canonical bucket, not the raw column: 'End User' and
        // 'DIRECT MILL' are the same thing to this page, and 'CHANNEL PARTNER'
        // is stored in a different case from everything around it.
        : `SELECT c.code AS value, c.legal_name AS label FROM clients c
            WHERE ${CANON} = '${ctype.replace(/'/g, "''")}'
              AND c.deleted_at IS NULL${visAnd} ORDER BY c.legal_name`)).rows, []);

    // Only offer a type that has something in it for THIS viewer. A dropdown
    // entry that opens on "— none —" reads as a broken page rather than as an
    // empty category.
    const typeCounts = await q<{ bucket: string; n: string }[]>(async () => (await risansiPool.query<{ bucket: string; n: string }>(
      `SELECT ${CANON} AS bucket, count(*)::text AS n FROM clients c
        WHERE c.deleted_at IS NULL${visAnd} GROUP BY 1`)).rows, []);
    const groupCount = await q<number>(async () => Number((await risansiPool.query<{ n: string }>(
      `SELECT count(DISTINCT btrim(c.group_name))::text AS n FROM clients c
        WHERE btrim(COALESCE(c.group_name,'')) <> '' AND c.deleted_at IS NULL${visAnd}`)).rows[0]?.n ?? 0), 0);
    const typeOptions: NameOpt[] = [
      ...(groupCount > 0 ? [{ value: 'group', label: `Mills (Group) · ${groupCount}` }] : []),
      ...typeCounts
        .filter(t => Number(t.n) > 0 && ACCOUNT_TYPES.includes(t.bucket))
        .sort((a, b) => Number(b.n) - Number(a.n))
        .map(t => ({ value: t.bucket, label: `${t.bucket} · ${t.n}` })),
    ];
    const picked = options.some(o => o.value === sp.name) ? sp.name! : (options[0]?.value ?? '');

    // This fiscal year's trading position for a set of clients. April to March,
    // bucketed on the quotation date and falling back to when the record was
    // created — the same COALESCE the TSM review and the pipeline use, so an
    // opportunity lands in the same year wherever it is counted.
    const fyFrom = `${curFy}-04-01`;
    const fyTo   = `${curFy + 1}-04-01`;
    const currentFyFor = async (ids: number[]): Promise<CurrentFyView> => {
      const empty: CurrentFyView = {
        label: fyLabel(curFy), pendingValue: 0, pendingCount: 0,
        wonValue: 0, wonCount: 0, orderInHand: 0, lostValue: 0, lostCount: 0, revenue: 0,
      };
      if (!ids.length) return empty;
      const r = await q<Record<string, string> | null>(async () => (await risansiPool.query(
        `WITH o AS (
           SELECT o.id, o.stage,
                  COALESCE(o.offer_value_inr, o.value_cr * 10000000, 0) AS val,
                  GREATEST(COALESCE(o.final_value_cr * 10000000, o.value_cr * 10000000, 0)
                    - COALESCE((SELECT sum(so.so_value_cr) * 10000000
                                  FROM opportunity_sales_orders so WHERE so.opportunity_id = o.id), 0), 0) AS oih
             FROM opportunities o
            WHERE o.client_id = ANY($1)
              AND COALESCE(o.quote_date, o.created_at::date) >= $2::date
              AND COALESCE(o.quote_date, o.created_at::date) <  $3::date)
         SELECT
           COALESCE(round(sum(val) FILTER (WHERE stage NOT IN ('Won','Lost','Dropped'))),0)::text AS pending_value,
           count(*) FILTER (WHERE stage NOT IN ('Won','Lost','Dropped'))::text                     AS pending_count,
           COALESCE(round(sum(val) FILTER (WHERE stage = 'Won')),0)::text                          AS won_value,
           count(*) FILTER (WHERE stage = 'Won')::text                                             AS won_count,
           COALESCE(round(sum(oih) FILTER (WHERE stage = 'Won')),0)::text                          AS order_in_hand,
           COALESCE(round(sum(val) FILTER (WHERE stage = 'Lost')),0)::text                          AS lost_value,
           count(*) FILTER (WHERE stage = 'Lost')::text                                            AS lost_count,
           (SELECT COALESCE(round(sum(m.total_value)),0) FROM client_revenue_monthly m
             WHERE m.client_id = ANY($1) AND m.month >= $2::date AND m.month < $3::date)::text     AS revenue
         FROM o`, [ids, fyFrom, fyTo])).rows[0] ?? null, null);
      if (!r) return empty;
      return {
        label: fyLabel(curFy),
        pendingValue: n(r.pending_value), pendingCount: Number(r.pending_count),
        wonValue: n(r.won_value), wonCount: Number(r.won_count),
        orderInHand: n(r.order_in_hand),
        lostValue: n(r.lost_value), lostCount: Number(r.lost_count),
        revenue: n(r.revenue),
      };
    };

    const shell = (body: React.ReactNode, title: string, sub: string) => (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10 }}><Topbar crumbs={['Risansi', 'Executive Review']} /></div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)', margin: 0 }}>{title}</h1>
              <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>
            </div>
            <AccountSelector ctype={ctype} name={picked} options={options} typeOptions={typeOptions} />
          </div>
          {tabs}
          {body}
        </div>
      </div>
    );

    if (!picked) return shell(
      <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
        No {ctype === 'group' ? 'groups' : `${ctype} clients`} {clientVis ? 'among your accounts' : 'on record'}.
      </div>, 'Account Review', '—');

    // ── Group of mills ──
    if (ctype === 'group') {
      // Units are scoped too, so a viewer who can see part of a group sees that
      // part's figures rather than the whole group's.
      const units = await q<{ id: string; code: string; legal_name: string; tcd: number | null }[]>(async () => (await risansiPool.query(
        `SELECT c.id::text, c.code, c.legal_name, c.tcd FROM clients c
          WHERE c.group_name = $1 AND c.deleted_at IS NULL${visAnd} ORDER BY c.legal_name`, [picked])).rows, []);
      const ids = units.map(u => Number(u.id));

      const [foot, rev, comps] = await Promise.all([
        q<{ client_id: number; ril_pcp: number; roto_pcp: number; total_pcp: number; ril_mmp: number; total_mmp: number; total_pumps: number }[]>(async () => (await risansiPool.query(
          `SELECT DISTINCT ON (client_id) client_id,
                  COALESCE(ril_pcp,0) ril_pcp, COALESCE(roto_pcp,0) roto_pcp, COALESCE(total_pcp,0) total_pcp,
                  COALESCE(ril_mmp,0) ril_mmp, COALESCE(total_mmp,0) total_mmp, COALESCE(total_pumps,0) total_pumps
             FROM competitor_installed_base WHERE client_id = ANY($1::int[])
            ORDER BY client_id, assessed_at DESC NULLS LAST, id DESC`, [ids])).rows, []),
        q<{ client_id: number; fy: string; pump: string; spare: string }[]>(async () => (await risansiPool.query(
          `SELECT client_id, ${FY_EXPR('month')} fy, SUM(pump_value)::text pump, SUM(spare_value)::text spare
             FROM client_revenue_monthly WHERE client_id = ANY($1::int[]) GROUP BY 1,2`, [ids])).rows, []),
        // NB: `year` is reserved in Postgres — alias as yr.
        q<{ yr: number; nature: string; n: string }[]>(async () => (await risansiPool.query(
          `SELECT EXTRACT(YEAR FROM complaint_date)::int AS yr,
                  COALESCE(NULLIF(btrim(root_cause),''), 'Not classified') AS nature, count(*)::text AS n
             FROM complaints WHERE client_id = ANY($1::int[]) AND complaint_date IS NOT NULL
            GROUP BY 1,2 ORDER BY 1 DESC, count(*) DESC`, [ids])).rows, []),
      ]);

      const fMap = new Map(foot.map(f => [f.client_id, f]));
      const rMap = new Map(rev.map(r => [`${r.client_id}|${r.fy}`, r]));
      const gu: GroupUnit[] = units.map(u => {
        const id = Number(u.id); const f = fMap.get(id);
        const totalPcp = f?.total_pcp ?? 0, rilPcp = f?.ril_pcp ?? 0, rotoPcp = f?.roto_pcp ?? 0;
        const totalMmp = f?.total_mmp ?? 0, rilMmp = f?.ril_mmp ?? 0;
        const totalPumps = f?.total_pumps ?? (totalPcp + totalMmp);
        const pumpByFy = FYS.map(fy => { const v = rMap.get(`${id}|${fy}`); return v ? Number(v.pump) || null : null; });
        const spareByFy = FYS.map(fy => { const v = rMap.get(`${id}|${fy}`); return v ? Number(v.spare) || null : null; });
        const spareTotal = spareByFy.reduce<number>((a, b) => a + (b ?? 0), 0);
        const sparesPerPump = totalPumps > 0 && spareTotal > 0 ? (spareTotal / FYS.length) / totalPumps : null;
        return {
          code: u.code, name: u.legal_name, tcd: u.tcd,
          rilPcp, rotoPcp, otherPcp: Math.max(0, totalPcp - rilPcp - rotoPcp), totalPcp,
          rilMmp, otherMmp: Math.max(0, totalMmp - rilMmp), totalPumps,
          sparesPerPump, pumpByFy, spareByFy, actions: [],
        };
      });

      const F = gu.reduce((a, u) => ({
        pcpRil: a.pcpRil + u.rilPcp, pcpRoto: a.pcpRoto + u.rotoPcp, pcpOther: a.pcpOther + u.otherPcp,
        pcpTotal: a.pcpTotal + u.totalPcp, mmpRil: a.mmpRil + u.rilMmp, mmpOther: a.mmpOther + u.otherMmp,
        mmpTotal: a.mmpTotal + u.rilMmp + u.otherMmp,
      }), { pcpRil: 0, pcpRoto: 0, pcpOther: 0, pcpTotal: 0, mmpRil: 0, mmpOther: 0, mmpTotal: 0 });

      const withSpares = gu.filter(u => u.sparesPerPump != null);
      const avgPerPump = withSpares.length ? withSpares.reduce((a, u) => a + (u.sparesPerPump ?? 0), 0) / withSpares.length : null;
      // Derived, from real numbers — never a hardcoded flag.
      for (const u of gu) {
        if (u.totalPumps === 0) u.actions.push('Pump footprint not recorded');
        else if (u.sparesPerPump == null) u.actions.push('No spares recorded');
        else if (avgPerPump != null && u.sparesPerPump < avgPerPump) u.actions.push('Spares below group avg');
      }
      const data: GroupReviewData = {
        group: picked, fys: FYS, units: gu, footprint: F,
        sparesPerPumpAvg: avgPerPump,
        attention: gu.filter(u => u.actions.length).map(u => u.name.replace(/^BALRAMPUR CHINI MILLS.*?[.(]?\s*/i, '').trim() || u.code),
        complaints: comps.map(c => ({ year: c.yr, nature: c.nature, count: Number(c.n) })),
        currentFy: await currentFyFor(ids),
      };
      return shell(<GroupReview d={data} />, picked, `${gu.length} units · FY ${FYS[0]} to ${FYS[FYS.length - 1]} · live data`);
    }

    // ── Single OEM ──
    const cl = await q<{ id: string; code: string; legal_name: string }[]>(async () => (await risansiPool.query(
      `SELECT c.id::text, c.code, c.legal_name FROM clients c
        WHERE c.code = $1 AND c.deleted_at IS NULL${visAnd} LIMIT 1`, [picked])).rows, []);
    const c0 = cl[0];
    if (!c0) return shell(<div style={{ fontSize: 13, color: 'var(--fg-3)' }}>Client not found.</div>, 'Account Review', '—');
    const cid = Number(c0.id);

    const [rev, pumps, opps] = await Promise.all([
      q<{ fy: string; total: string }[]>(async () => (await risansiPool.query(
        `SELECT ${FY_EXPR('month')} fy, SUM(total_value)::text total
           FROM client_revenue_monthly WHERE client_id = $1 GROUP BY 1`, [cid])).rows, []),
      q<{ n: string }[]>(async () => (await risansiPool.query(
        `SELECT COALESCE((SELECT total_pumps FROM competitor_installed_base WHERE client_id=$1
                           ORDER BY assessed_at DESC NULLS LAST, id DESC LIMIT 1),
                         (SELECT COALESCE(SUM(quantity),0) FROM client_pumps WHERE client_id=$1))::text n`, [cid])).rows, []),
      q<{ fy: string; stage: string; v: string }[]>(async () => (await risansiPool.query(
        `SELECT ${FY_EXPR('COALESCE(quote_date, created_at::date)')} fy, stage,
                SUM(COALESCE(offer_value_inr, value_cr * 10000000, 0))::text v
           FROM opportunities WHERE client_id = $1 GROUP BY 1,2`, [cid])).rows, []),
    ]);

    const revMap = new Map(rev.map(r => [r.fy, Number(r.total)]));
    const revenueByFy = FYS.map(fy => revMap.get(fy) ?? null);
    const totalRevenue = revenueByFy.reduce<number>((a, b) => a + (b ?? 0), 0);
    const oppFys = [...new Set(opps.map(o => o.fy))].sort();
    const stages = [...new Set(opps.map(o => o.stage))].sort();
    const oMap = new Map(opps.map(o => [`${o.stage}|${o.fy}`, Number(o.v)]));
    const data: OemReviewData = {
      code: c0.code, name: c0.legal_name, fys: FYS, revenueByFy,
      totalRevenue, avgPerYear: totalRevenue / FYS.length,
      totalPumps: Number(pumps[0]?.n ?? 0),
      stages, oppFys, oppMatrix: stages.map(s => oppFys.map(fy => oMap.get(`${s}|${fy}`) ?? null)),
      currentFy: await currentFyFor([cid]),
    };
    return shell(<OemReview d={data} />, c0.legal_name, `${c0.code} · ${ctype} · FY ${FYS[0]} to ${FYS[FYS.length - 1]} · live data`);
  }

  // TSM roster. Admins get every user who has tours; everyone else gets exactly
  // the ids getReviewableRepIds allowed — selected by id rather than through the
  // tour join, so a rep with no tour assignment still lands on their own
  // (empty) review instead of a blank page.
  const reps = await q<SelRep[]>(async () => {
    if (allowedRepIds === null) {
      return (await risansiPool.query<SelRep>(
        `SELECT u.id::text AS id, u.name FROM users u
          WHERE u.role IN ('rep','manager') AND u.is_active ORDER BY u.name`)).rows;
    }
    if (allowedRepIds.length === 0) return [];
    return (await risansiPool.query<SelRep>(
      `SELECT u.id::text AS id, u.name FROM users u
        WHERE u.id = ANY($1::int[]) AND u.role IN ('rep','manager') ORDER BY u.name`,
      [allowedRepIds])).rows;
  }, []);

  // Default to the viewer's own review when they are in the roster, not to
  // whoever is alphabetically first. A manager opening this page is normally
  // looking at their own book, and landing on a team member meant the target
  // card — which exists so a rep or manager sees their OWN number — opened on
  // somebody else's. An admin is not in the roster, so they still land on the
  // first name as before.
  const mine = reps.find(r => String(r.id) === String(me.id))?.id;
  const tsm = (sp.tsm && reps.some(r => r.id === sp.tsm)) ? sp.tsm : (mine ?? reps[0]?.id ?? '');
  const tsmName = reps.find(r => r.id === tsm)?.name ?? '—';

  // The review is scoped to one fiscal year (Apr→Mar). It defaults to the
  // current one, to date; the FY selector picks an earlier one, which is shown
  // whole. There is no month picker. Every value in selMonths is YYYY-MM so it
  // is safe to inline in SQL.
  //
  // Built by fyWindows, the same function the drill-downs call, and handed the
  // same `now` and the same selected year. The page used to re-implement this
  // inline, which is how a figure and the list behind it come to disagree.
  const now = new Date();
  const selFy = parseFy(sp.fy, now);
  const w = fyWindows(now, selFy);
  const { fy, selMonths, d, w5from, w5to, inMonths } = w;

  // Turnover always compares each whole fiscal year (Apr–Mar, to-date), so the
  // current FY shows its turnover so far — no month scoping, no toggle.
  const turnMonthFilter = '';

  // Scope every clients-keyed query to the SELECTED TSM's tours INTERSECTED with
  // the viewer's own visibility. The intersection matters: getReviewableRepIds
  // only needs ONE shared tour to make a rep reviewable, and that rep may work
  // other tours the viewer has no access to — without visAnd a manager would
  // read those tours here while seeing nothing of them anywhere else in the app
  // (the Client 360 drill-through links below intersect correctly, so the counts
  // would also disagree). No-op for admins (visAnd = '') and for a rep viewing
  // themselves (their tours are already a subset of their own visibility).
  // Which of this TSM's clients the review counts.
  //
  // Default is owned AND covered, the same set the Opportunities board counts.
  // It used to be owned-only, and the two pages then opened on different
  // numbers with nothing wrong in the data: Akshay Awasthi's quoted pipe read
  // 2.74 Cr over 71 opportunities here and 4.72 Cr over 75 on the board, the
  // four extra being three TKIL Industries quotes and one Racon — accounts he
  // covers for Sudhir Vichare and Aviral Shukla. Every other reading of the
  // same figure agreed exactly, so the gap was the default and nothing else.
  //
  // Counting a covered account here is not the same as crediting the TSM with
  // it. Attribution is the client's owner and does not move (see
  // lib/risansi-attribution.ts); this control is about scope — whose screen
  // the work appears on — and a covering rep works that account. Book &
  // Coverage is where the page shows the two sides apart, which is why it is
  // the panel to read beside any figure on a combined view.
  //
  // "Accounts they own" is still offered, because "what is actually mine" is
  // a fair question for a manager to ask. It is just not the question the
  // page should open on.
  //
  // Either way the result is still intersected with the VIEWER's own visibility
  // (visAnd): widening which of the subject's accounts to count must never
  // widen what the person looking is allowed to see.
  const accountScope: AccountScope = sp.scope === 'own' ? 'own' : 'all';
  const projMode: 'monthly' | 'quarterly' = sp.proj === 'monthly' ? 'monthly' : 'quarterly';
  const tsmId = Number(tsm);
  // execScopeSql rather than a hand-rolled predicate, so the page and every
  // drill-down under it are scoped by one piece of SQL.
  const tourF = tsm ? execScopeSql(tsmId, accountScope, visAnd) : 'FALSE';
  // The same book split in two, for the Book & Coverage panel: what they own,
  // and what they cover for somebody else.
  const ownF = tsm ? execScopeSql(tsmId, 'own', visAnd) : 'FALSE';
  const coveredF = tsm ? execScopeSql(tsmId, 'covered', visAnd) : 'FALSE';
  const bothF = tsm ? execScopeSql(tsmId, 'all', visAnd) : 'FALSE';

  // Attendance counts visits by rep and never touches `clients`, so tourF can't
  // scope it — restrict it by the viewer's client scope on the visit's client.
  // Exempt viewing yourself: your own attendance is your own activity record, and
  // scoping it would silently drop past visits to clients that have since moved
  // off your tour.
  // Is the person being reviewed a manager? Asked through getManagerAssignableReps
  // so the manager_reps hierarchy stays the single answer to that question — it
  // returns the reps beneath them plus themselves, so a team is anything longer
  // than one. Managers get the Book & Coverage split whether or not they happen
  // to cover an account today, because covering for their team is the job.
  const isManagerTsm = tsmId > 0 && (await getManagerAssignableReps(tsmId)).length > 1;

  const isSelfReview  = me.id != null && String(me.id) === String(tsm);
  const visitScope    = isSelfReview ? null : clientScopeSql(me, 'v.client_id', OWN_OPEN.visit('v'));
  const visitScopeAnd = visitScope ? ` AND (${visitScope})` : '';

  // Rep-wise expected closures, for the projection section below the review.
  // Never throws the page away: a broken forecast should not take the whole
  // Executive Review with it.
  const projFilters = parseProjectionFilters(sp);
  const [projection, projOptions] = await Promise.all([
    tab === 'projection' ? q(() => loadProjection(risansiPool, fy, allowedRepIds, projFilters), null) : Promise.resolve(null),
    tab === 'projection' ? q(() => loadProjectionOptions(risansiPool, allowedRepIds), null) : Promise.resolve(null),
  ]);

  const [clients, turnover, quotation, offers, attendance, kpiRow, convStages, targetCr, outside, bookSplit, repTargetCr] = await Promise.all([
    // 1. Clients Summary
    // Every live client by type, split by where it stands. The two prospective
    // statuses are counted apart rather than together: a Prospective-Client has
    // an ERP code and an enquiry behind it, a Prospective-Lead is a name somebody
    // wrote down, and a single column of 240 said nothing about which.
    // Duplicates are not clients.
    q(async () => (await risansiPool.query<{ cat: string; active: string; prospective_client: string; prospective_lead: string; inactive: string }>(
      `SELECT ${CANON} cat,
              count(*) FILTER (WHERE c.status = 'ACTIVE')::text AS active,
              count(*) FILTER (WHERE c.status = 'PROSPECTIVE_CLIENT')::text AS prospective_client,
              count(*) FILTER (WHERE c.status = 'PROSPECTIVE_LEAD')::text AS prospective_lead,
              count(*) FILTER (WHERE c.status IN ('INACTIVE','CLOSED'))::text AS inactive
         FROM clients c
        WHERE ${tourF} AND c.deleted_at IS NULL AND c.status <> 'DUPLICATE' GROUP BY 1`)).rows, []),

    // 2. Turnover Summary — classify each ACTIVE client, aggregate per FY
    q(async () => (await risansiPool.query<{ bucket: string; clients: string; fyc: string; f1: string; f2: string; f3: string }>(
      `WITH rev AS (
         SELECT c.id, c.is_end_client,
           COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w5from}' AND r.month < '${w5to}'),0) rev5,
           COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w5to}'),0) rev_cur,
           COALESCE(sum(r.total_value) FILTER (WHERE r.month <  '${w5from}'),0) rev_before,
           min(r.month) FILTER (WHERE r.total_value > 0) first_rev,
           COALESCE(sum(r.total_value) FILTER (WHERE ${turnMonthFilter}r.month >= '${d(fy)}'     AND r.month < '${d(fy + 1)}'),0) fyc,
           COALESCE(sum(r.total_value) FILTER (WHERE ${turnMonthFilter}r.month >= '${d(fy - 1)}' AND r.month < '${d(fy)}'),0)     f1,
           COALESCE(sum(r.total_value) FILTER (WHERE ${turnMonthFilter}r.month >= '${d(fy - 2)}' AND r.month < '${d(fy - 1)}'),0) f2,
           COALESCE(sum(r.total_value) FILTER (WHERE ${turnMonthFilter}r.month >= '${d(fy - 3)}' AND r.month < '${d(fy - 2)}'),0) f3
         FROM clients c LEFT JOIN client_revenue_monthly r ON r.client_id = c.id
        WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL GROUP BY c.id, c.is_end_client),
       band AS (SELECT *, CASE
         WHEN is_end_client THEN 'End Client'
         WHEN rev_cur>0 AND rev5=0 AND rev_before>0 THEN 'Business Regained'
         WHEN first_rev IS NOT NULL AND first_rev >= '${d(fy)}' THEN 'New Business'
         WHEN rev5=0 AND rev_cur=0 THEN 'No Business'
         WHEN rev5/5.0 >= 1500000 THEN '15 Lac & above (Super Critical)'
         WHEN rev5/5.0 >= 500000  THEN '5-15 Lacs p.a.'
         WHEN rev5/5.0 >= 300000  THEN '3-5 Lacs p.a.'
         WHEN rev5/5.0 >= 100000  THEN '1-3 Lacs p.a.'
         ELSE 'Less than 1 Lac p.a.' END bucket FROM rev)
       SELECT bucket, count(*)::text clients, round(sum(fyc))::text fyc, round(sum(f1))::text f1, round(sum(f2))::text f2, round(sum(f3))::text f3
       FROM band GROUP BY bucket`)).rows, []),

    // 3. Quotation Summary — channel x Active/Won
    q(async () => (await risansiPool.query<{ channel: string; active: string; won: string }>(
      `SELECT ${CANON} channel,
              round(sum(COALESCE(o.offer_value_inr,0)) FILTER (WHERE o.stage IN ('Quoted','Negotiating')))::text active,
              round(sum(COALESCE(o.offer_value_inr,0)) FILTER (WHERE o.stage='Won'))::text won
         FROM opportunities o JOIN clients c ON c.id=o.client_id
        WHERE ${tourF} AND ${inMonths(OPP_WINDOW_DATE)} GROUP BY 1`)).rows, []),

    // 4. Offer Status — mapped from stage. Every stage, including Prospect and
    //    Suspect: STAGE_TO_OFFER has wording for them now, so their value lands
    //    in a row instead of nowhere.
    q(async () => (await risansiPool.query<{ stage: string; val: string }>(
      `SELECT o.stage, round(sum(COALESCE(o.offer_value_inr,0)))::text val
         FROM opportunities o JOIN clients c ON c.id=o.client_id
        WHERE ${tourF} AND ${inMonths(OPP_WINDOW_DATE)} GROUP BY 1`)).rows, []),

    // 5. Attendance — the rep's field visits, per selected month
    q(async () => (await risansiPool.query<{ mon: string; days: string; clients: string }>(
      `SELECT to_char(v.visit_date,'YYYY-MM') mon, count(distinct v.visit_date)::text days, count(distinct v.client_id)::text clients
         FROM visits v WHERE v.rep_id = ${Number(tsm) || 0} AND ${inMonths('v.visit_date')}${visitScopeAnd}
        GROUP BY 1 ORDER BY 1`)).rows, []),

    // 6. KPIs — value metrics scope to the selected month(s); the client-count
    //    metrics are current-portfolio snapshots (they don't move with the
    //    month). "Visited" everywhere below means last_visit_date within the
    //    last 90 days — the same convention as the Field page/dashboard —
    //    rather than the FY-to-date window the value metrics use. Active-client
    //    visited/overdue/never are mutually exclusive (sum to active_clients);
    //    "overdue" here excludes never-visited, unlike the Field page's own
    //    "Overdue" tab which folds them together.
    q(async () => (await risansiPool.query<{
      total_business: string; revenue: string; active_clients: string;
      active_visited: string; active_overdue: string; active_never: string;
      prospective: string; prospective_visited: string;
      prospective_lead: string; prospective_client: string;
    }>(
      `SELECT
         (SELECT COALESCE(round(sum(GREATEST(
                   COALESCE(o.final_value_cr*10000000, o.value_cr*10000000, 0)
                   - COALESCE((SELECT sum(so.so_value_cr)*10000000 FROM opportunity_sales_orders so WHERE so.opportunity_id=o.id), 0)
                 , 0))),0) FROM opportunities o JOIN clients c ON c.id=o.client_id
           WHERE ${tourF} AND o.stage='Won' AND ${inMonths(OPP_WINDOW_DATE)})::text AS total_business,
         -- Every status, not just ACTIVE. Money invoiced in a year is a fact
         -- about that year, and filtering on the status a client holds TODAY
         -- made it move: a client who bought for a decade and has since gone
         -- quiet took their whole history out of the table with them, which is
         -- why FY21-22 was reading ₹2.15 Cr light across 47 such accounts.
         -- The Turnover Summary below still shows the ACTIVE book only, because
         -- banding accounts by size is a question about the live portfolio, so
         -- the two no longer have to agree and the headings say which is which.
         (SELECT COALESCE(round(sum(r.total_value)),0) FROM client_revenue_monthly r JOIN clients c ON c.id = r.client_id
           WHERE ${tourF} AND ${inMonths('r.month')})::text AS revenue,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL)::text AS active_clients,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL
            AND c.last_visit_date >= CURRENT_DATE - INTERVAL '90 days')::text AS active_visited,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL
            AND c.last_visit_date IS NOT NULL AND c.last_visit_date < CURRENT_DATE - INTERVAL '90 days')::text AS active_overdue,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='ACTIVE' AND c.deleted_at IS NULL
            AND c.last_visit_date IS NULL)::text AS active_never,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status IN ('PROSPECTIVE_LEAD','PROSPECTIVE_CLIENT') AND c.deleted_at IS NULL)::text AS prospective,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status IN ('PROSPECTIVE_LEAD','PROSPECTIVE_CLIENT') AND c.deleted_at IS NULL
            AND c.last_visit_date >= CURRENT_DATE - INTERVAL '90 days')::text AS prospective_visited,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='PROSPECTIVE_LEAD' AND c.deleted_at IS NULL)::text AS prospective_lead,
         (SELECT count(*) FROM clients c WHERE ${tourF} AND c.status='PROSPECTIVE_CLIENT' AND c.deleted_at IS NULL)::text AS prospective_client`)).rows[0], null),

    // 7. Target & Conversion — the quoted pipeline, stage by stage.
    //    Same scope and same FY window as everything else on the tab. The stage
    //    list and the budgetary exclusion come from the lib so the drill-down
    //    behind each figure selects the identical set; see conversionWhereSql.
    q(async () => (await risansiPool.query<{ stage: string; opps: string; val: string }>(
      `SELECT o.stage, count(*)::text AS opps, round(sum(COALESCE(o.offer_value_inr,0)))::text AS val
         FROM opportunities o JOIN clients c ON c.id=o.client_id
        WHERE ${tourF} AND ${conversionWhereSql()}
          AND ${inMonths(OPP_WINDOW_DATE)}
        GROUP BY 1`)).rows, []),

    // 8. The COMPANY annual target, in Crores. One source for the whole portal:
    //    app_settings.annual_target_cr, the same row the Opportunities dashboard
    //    and the Settings page read, with the same 32 Cr fallback. Per-rep
    //    targets now exist too (users.target_cr, migration 0099, edited on the
    //    same Settings page) and are read separately below — the two numbers are
    //    deliberately independent, so the company figure is NOT the sum of them.
    q<number>(async () => {
      const { rows } = await risansiPool.query<{ value: string }>(
        `SELECT value FROM app_settings WHERE key = 'annual_target_cr' LIMIT 1`);
      const v = parseFloat(rows[0]?.value ?? '');
      return Number.isFinite(v) && v > 0 ? v : 32;
    }, 32),

    // 9. Everything on this book that the FY window leaves out.
    //    Every stage, not just the quoted ones, because the window governs the
    //    Quotation Summary and Offer Status too. A quotation dated in February
    //    and entered in September sits outside the current FY on a date nobody
    //    typed, and was on the Opportunities board and on no view of this page.
    //    Now it has a row of its own, counted apart and never in a total.
    q(async () => (await risansiPool.query<{
      opps: string; val: string; open_opps: string; open_val: string; oldest: string | null; newest: string | null;
    }>(
      `SELECT count(*)::text AS opps,
              COALESCE(round(sum(COALESCE(o.offer_value_inr,0))),0)::text AS val,
              count(*) FILTER (WHERE o.stage IN (${OPEN_STAGES.map(s => `'${s}'`).join(',')}))::text AS open_opps,
              COALESCE(round(sum(COALESCE(o.offer_value_inr,0))
                FILTER (WHERE o.stage IN (${OPEN_STAGES.map(s => `'${s}'`).join(',')}))),0)::text AS open_val,
              min(${OPP_WINDOW_DATE})::text AS oldest,
              max(${OPP_WINDOW_DATE})::text AS newest
         FROM opportunities o JOIN clients c ON c.id=o.client_id
        WHERE ${tourF} AND ${w.outsideMonths(OPP_WINDOW_DATE)}`)).rows[0], null),

    // 10. Book & Coverage — the same figures over the accounts this TSM OWNS and
    //     over the ones they merely COVER for a colleague, side by side.
    //     Computed in one pass over the combined book and split on ownership, so
    //     the two columns cannot be built from different windows. The review
    //     counts owned accounts by default and the Opportunities board counts
    //     both, which is why the same person reads several times apart on the
    //     two pages; this panel is where that gap is stated rather than hidden.
    q(async () => (await risansiPool.query<{
      own_clients: string; cov_clients: string; own_quoted: string; cov_quoted: string;
      own_won: string; cov_won: string; own_rev: string; cov_rev: string;
    }>(
      // IS NOT DISTINCT FROM, not =: an account somebody covers that nobody
      // owns has a null primary_rep_id, so plain equality makes the owns flag
      // null and FILTER drops the row from BOTH columns. One such client exists
      // today, and it was enough to stop a manager's two columns adding up.
      `WITH opp AS (
         SELECT (c.primary_rep_id IS NOT DISTINCT FROM ${tsmId}) AS owns, o.stage, COALESCE(o.offer_value_inr,0) AS v
           FROM opportunities o JOIN clients c ON c.id=o.client_id
          WHERE ${bothF} AND ${conversionWhereSql()} AND ${inMonths(OPP_WINDOW_DATE)}),
       cl AS (
         SELECT (c.primary_rep_id IS NOT DISTINCT FROM ${tsmId}) AS owns
           FROM clients c WHERE ${bothF} AND c.status <> 'DUPLICATE'),
       rev AS (
         SELECT (c.primary_rep_id IS NOT DISTINCT FROM ${tsmId}) AS owns, r.total_value AS v
           FROM client_revenue_monthly r JOIN clients c ON c.id=r.client_id
          WHERE ${bothF} AND ${inMonths('r.month')})
       SELECT
         (SELECT count(*) FILTER (WHERE owns) FROM cl)::text        AS own_clients,
         (SELECT count(*) FILTER (WHERE NOT owns) FROM cl)::text    AS cov_clients,
         (SELECT COALESCE(round(sum(v) FILTER (WHERE owns)),0) FROM opp)::text     AS own_quoted,
         (SELECT COALESCE(round(sum(v) FILTER (WHERE NOT owns)),0) FROM opp)::text AS cov_quoted,
         (SELECT COALESCE(round(sum(v) FILTER (WHERE owns AND stage='Won')),0) FROM opp)::text     AS own_won,
         (SELECT COALESCE(round(sum(v) FILTER (WHERE NOT owns AND stage='Won')),0) FROM opp)::text AS cov_won,
         (SELECT COALESCE(round(sum(v) FILTER (WHERE owns)),0) FROM rev)::text     AS own_rev,
         (SELECT COALESCE(round(sum(v) FILTER (WHERE NOT owns)),0) FROM rev)::text AS cov_rev`)).rows[0], null),

    // 11. The REVIEWED person's own annual target, in Crores — users.target_cr,
    //     the exact column setRepTargets writes from Admin → Settings. numeric,
    //     so it is cast to text in SQL and parsed here rather than arriving as
    //     pg's string.
    //
    //     "Their own" means their own row and nothing else. The Settings list
    //     gives reps AND managers one row each and holds the sum of all of them
    //     against the company figure, so a manager's row sits beside their team
    //     members' rows in that sum — adding a team up here would double-count
    //     the team inside a total the Settings page already reconciles.
    //
    //     null when nobody has set one. Zero is treated the same way on purpose:
    //     the column permits 0, and a target of nothing is not a bar anybody can
    //     clear — it is a denominator that makes every percentage infinite.
    q<number | null>(async () => {
      if (!tsmId) return null;
      const { rows } = await risansiPool.query<{ target_cr: string | null }>(
        `SELECT u.target_cr::text AS target_cr FROM users u WHERE u.id = $1 LIMIT 1`, [tsmId]);
      const raw = rows[0]?.target_cr;
      if (raw == null) return null;
      const v = Number(raw);
      return Number.isFinite(v) && v > 0 ? v : null;
    }, null),
  ]);

  // ── shape into ExecData ──
  const cmMap = Object.fromEntries(clients.map(r => [r.cat, r]));
  const CLIENT_COLS = ['active', 'prospective_client', 'prospective_lead', 'inactive'] as const;
  // Every bucket CANON can produce gets a row, including the catch-all, and the
  // catch-all is defined as "whatever CATS did not claim" rather than as the
  // literal string 'Other'. Both halves matter: the Grand Total sums the query,
  // so a bucket with no row was counted in the total and shown nowhere — which
  // is what put 174 invisible clients into one rep's total of 271.
  const sumCol = (rows: typeof clients, k: typeof CLIENT_COLS[number]) =>
    rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const rowFor = (label: string, key: string, src: typeof clients): Row => {
    const v = CLIENT_COLS.map(k => sumCol(src, k));
    return {
      label, vals: [...v, v.reduce((a, b) => a + b, 0)],
      drill: [...CLIENT_COLS, 'total' as const].map(col => ({ kind: 'clients_by_type' as const, tsm, key, col })),
    };
  };
  const allClientRows: Row[] = CATS.map(cat => rowFor(cat, cat, cmMap[cat] ? [cmMap[cat]] : []));
  const otherSrc = clients.filter(r => !CATS.includes(r.cat));
  allClientRows.push(rowFor(CAT_OTHER_LABEL, CAT_OTHER, otherSrc));
  // A category this book has nobody in says nothing, so it is left out rather
  // than printed as a row of zeroes. The Grand Total below still sums every
  // category, so a hidden row — being zero — cannot change it. If a book turns
  // out to be empty altogether, show the categories rather than an empty table.
  const nonEmpty = allClientRows.filter(r => (r.vals[r.vals.length - 1] ?? 0) > 0);
  const clientRows: Row[] = nonEmpty.length ? nonEmpty : allClientRows;
  const cmTot = CLIENT_COLS.map(k => sumCol(clients, k));
  clientRows.push({ label: 'Grand Total', vals: [...cmTot, cmTot.reduce((a, b) => a + b, 0)], strong: true });

  const tMap = Object.fromEntries(turnover.map(r => [r.bucket, r]));
  const turnRows: Row[] = TURN_ORDER.filter(b => tMap[b]).map(b => {
    const r = tMap[b];
    return {
      label: b,
      vals: [Number(r.clients), n(r.fyc), n(r.f1), n(r.f2), n(r.f3)],
      drill: (['clients', 'fyc', 'f1', 'f2', 'f3'] as const).map(col => ({
        kind: 'turnover' as const, tsm, key: b, col,
      })),
    };
  });
  const tt = turnover.reduce((a, r) => { a.c += +r.clients; a.fyc += n(r.fyc); a.f1 += n(r.f1); a.f2 += n(r.f2); a.f3 += n(r.f3); return a; }, { c: 0, fyc: 0, f1: 0, f2: 0, f3: 0 });
  turnRows.push({ label: 'Grand Total', vals: [tt.c, tt.fyc, tt.f1, tt.f2, tt.f3], strong: true });

  const qMap = Object.fromEntries(quotation.map(r => [r.channel, r]));
  // Same reconciliation as the Clients Summary above: the Grand Total reduces
  // over every channel the query returned, so a channel with no row (the CANON
  // catch-all) was money in the total and in none of the rows.
  const quoteRow = (label: string, key: string, src: typeof quotation): Row => {
    const a = src.reduce((s, r) => s + n(r.active), 0);
    const w = src.reduce((s, r) => s + n(r.won), 0);
    return {
      label, vals: [a, w, a + w],
      drill: (['active', 'won', 'total'] as const).map(col => ({ kind: 'quotation' as const, tsm, key, col })),
    };
  };
  const quoteRows: Row[] = CATS.filter(cat => qMap[cat]).map(cat => quoteRow(cat, cat, [qMap[cat]]));
  const qOther = quotation.filter(r => !CATS.includes(r.channel));
  if (qOther.some(r => n(r.active) || n(r.won))) quoteRows.push(quoteRow(CAT_OTHER_LABEL, CAT_OTHER, qOther));
  const qt = quotation.reduce((a, r) => { a.a += n(r.active); a.w += n(r.won); return a; }, { a: 0, w: 0 });
  quoteRows.push({ label: 'Grand Total', vals: [qt.a, qt.w, qt.a + qt.w], strong: true });

  // Offer Status (stage → Mona's labels). The map and the row order are imported
  // rather than written out here: the page used to keep its own copy, and a
  // stage missing from it was value in no row and in no total.
  const offerAgg: Record<string, number> = Object.fromEntries(OFFER_STATUS_ORDER.map(l => [l, 0]));
  // A stage with no wording would be dropped, so count it rather than lose it.
  let offerUnmapped = 0;
  for (const r of offers) {
    const lbl = STAGE_TO_OFFER[r.stage];
    if (lbl) offerAgg[lbl] += n(r.val); else offerUnmapped += n(r.val);
  }
  const offerRows: Row[] = OFFER_STATUS_ORDER
    .map(l => ({ label: l, vals: [offerAgg[l]], drill: [{ kind: 'offer_status' as const, tsm, key: l }] }));
  if (offerUnmapped) offerRows.push({ label: 'Other stage', vals: [offerUnmapped] });
  offerRows.push({ label: 'Grand Total', vals: [Object.values(offerAgg).reduce((a, b) => a + b, 0) + offerUnmapped], strong: true });

  const MON = (m: string) => new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  // Visit days and Clients are different sets: one lists the visits, the other
  // the clients they were made to, and a month with two calls on one client has
  // a different count in each column.
  const attRows: Row[] = attendance.map(r => ({
    label: MON(r.mon),
    vals: [Number(r.days), Number(r.clients)],
    drill: [
      { kind: 'attendance_visits' as const, tsm, key: r.mon },
      { kind: 'attendance_clients' as const, tsm, key: r.mon },
    ],
  }));
  const at = attendance.reduce((a, r) => { a.d += +r.days; return a; }, { d: 0 });
  attRows.push({ label: 'Total', vals: [at.d, null], strong: true });

  // ── Target & Conversion ──
  // Order received over total quoted, on the quoted pipeline only. The stage
  // rows are listed in CONVERSION_STAGES order (open first, then the two
  // outcomes) so the eye reaches Won last, next to the total it divides into.
  const convMap = Object.fromEntries(convStages.map(r => [r.stage, r]));
  const CONV_LABEL: Record<string, string> = {
    Quoted: 'Quoted · awaiting', Negotiating: 'Negotiating', Lost: 'Lost', Won: 'Won · order received',
  };
  const convRows: Row[] = CONVERSION_STAGES.map(s => ({
    label: CONV_LABEL[s] ?? s,
    vals: [Number(convMap[s]?.opps ?? 0), n(convMap[s]?.val)],
    drill: [null, { kind: 'conversion' as const, tsm, key: s }],
  }));
  const quotedInr = convStages.reduce((s, r) => s + n(r.val), 0);
  const quotedOpps = convStages.reduce((s, r) => s + Number(r.opps), 0);
  const orderReceivedInr = CONVERSION_WON_STAGES.reduce((s, st) => s + n(convMap[st]?.val), 0);
  convRows.push({
    label: 'Total quoted', vals: [quotedOpps, quotedInr], strong: true,
    drill: [null, { kind: 'conversion' as const, tsm, key: 'total' }],
  });
  // The escape row, under the total and deliberately not in it. Whatever the FY
  // window leaves out is on this line, at every stage, with the still-open share
  // called out — so an opportunity can no longer be absent from the whole page
  // without saying so. Change the FY above to go and look at it.
  const outsideOpps = Number(outside?.opps ?? 0);
  const outsideVal = n(outside?.val);
  const outsideOpen = Number(outside?.open_opps ?? 0);
  const outsideOpenVal = n(outside?.open_val);
  if (outsideOpps > 0) {
    convRows.push({
      label: `Outside FY ${yy(fy)} — not counted above`,
      vals: [outsideOpps, outsideVal],
      drill: [null, { kind: 'outside_window' as const, tsm, key: String(fy) }],
    });
  }
  // ── Whose target is the headline ────────────────────────────────
  // The company figure is what this panel has always shown, and against one
  // rep's order received it is noise: it describes the whole sales team's year,
  // so a single rep read a percent or two of it however their own year was
  // going (Amit Srivastava's ₹0.34 Cr was "0.7% of the company target"; against
  // his own ₹2.5 Cr it is 13.4%, which is the sentence he needs).
  //
  // Only reps and managers carry a quota — exactly the set Settings offers a
  // target to (is_active AND role IN ('rep','manager')); admin, sysadmin and
  // staff are back-office accounts with target_cr NULL by design. So the
  // headline goes personal for those two roles and stays company-wide for
  // everyone else, which is what was asked for.
  const viewerCarriesQuota = me.role === 'rep' || me.role === 'manager';

  // THE TSM SELECTOR. When the headline is personal it follows the person the
  // review is ABOUT (the selected TSM), not the person looking.
  //
  // The argument for following the viewer is that the card is meant to answer
  // "how am I doing". The argument for following the subject — which won — is
  // that every other figure in this panel is already the selected TSM's, so a
  // percentage built from the viewer's target over the subject's order received
  // would divide two different people's numbers and print the result as one
  // person's attainment. A rep can only ever select themselves, so this is
  // invisible to them; a manager sees their own target on their own review and
  // the team member's target, named, when they open that team member's review.
  //
  // An admin keeps the company figure as the headline whichever TSM is
  // selected. Same trade-off, decided the other way: an admin sweeps the whole
  // roster in a sitting and the company year is the one constant they are
  // measuring everybody against, so a denominator that changes identity under
  // them on every click would make two reviews incomparable, and the per-rep
  // split is a click away on the Settings page they came from. If that turns
  // out to be the wrong default, `viewerCarriesQuota` on the next line is the
  // one thing to widen: the sub-line already knows how to carry the company
  // figure underneath a personal headline.
  const companyTargetInr = targetCr * 10_000_000;
  const ownTargetInr = repTargetCr != null ? repTargetCr * 10_000_000 : null;
  const targetIsPersonal = viewerCarriesQuota && ownTargetInr != null;
  const targetInr = targetIsPersonal ? ownTargetInr! : companyTargetInr;

  // Wording. Second person when the viewer is reading their own review, the
  // TSM's name when a manager is reading a team member's, so no figure on the
  // card is ambiguous about whose it is.
  const companySub = `₹${targetCr} Cr, set in Settings`;
  const targetLabel = targetIsPersonal ? (isSelfReview ? 'My Annual Target' : 'Annual Target') : 'Annual Target';
  const targetNote = targetIsPersonal
    ? `${isSelfReview ? 'your own target' : `${tsmName}'s target`} · set in Settings`
    : `company-wide · ${companySub}`;
  // The sub-line inside the same card. Three cases, and the third is the one
  // that must not read as a target of zero: a rep or manager whose target
  // nobody has filled in gets the company figure as the headline (so the card
  // still shows a real number) and a sub-line that says in words that their own
  // is not set, rather than ₹0 dressed up as a quota.
  const targetSub = targetIsPersonal
    ? { label: 'Company-wide target', valueInr: companyTargetInr, note: companySub }
    : viewerCarriesQuota
      ? { label: isSelfReview ? 'My annual target' : `${tsmName}'s annual target`, valueInr: null,
          note: 'no individual target on record · ask a system admin to set one in Settings' }
      : null;
  const achievedLabel = targetIsPersonal
    ? (isSelfReview ? 'of your annual target' : `of ${tsmName}'s annual target`)
    : 'of the company target';
  const panelNote = targetIsPersonal
    ? `₹ against ${isSelfReview ? 'your' : `${tsmName}'s`} annual target`
    : '₹ against the company target';

  // ── Book & Coverage ──
  // Shown when covering is part of this person's job: a manager (they carry a
  // team under manager_reps) or anybody who covers at least one account. For a
  // rep who covers nothing the second column is all zeroes, so they are spared it.
  const coveredClients = Number(bookSplit?.cov_clients ?? 0);
  const showBookSplit = coveredClients > 0 || isManagerTsm;
  const bookCr = (own: string | undefined, cov: string | undefined) => {
    const o = n(own), c = n(cov);
    return [o, c, o + c];
  };
  // Money only, so the ₹ prefix on every cell is honest; the client counts go in
  // the panel's note rather than into a rupee column.
  const bookRows: Row[] = showBookSplit ? [
    { label: 'Total quoted',     vals: bookCr(bookSplit?.own_quoted, bookSplit?.cov_quoted) },
    { label: 'Order received',   vals: bookCr(bookSplit?.own_won, bookSplit?.cov_won) },
    { label: 'Revenue invoiced', vals: bookCr(bookSplit?.own_rev, bookSplit?.cov_rev) },
  ] : [];
  const ownClients = Number(bookSplit?.own_clients ?? 0);

  const data: ExecData = {
    clientsSummary:  {
      headers: ['Client type', 'Active', 'Prosp. client', 'Prosp. lead', 'Inactive', 'Total'], rows: clientRows, moneyFrom: 99,
      // Green / amber / violet / red. The two prospective columns borrow the
      // portal's own status colours rather than two shades of amber, so the
      // table reads the same way as the Prospective card above it and as every
      // status dot elsewhere.
      colors: ['var(--pos)', CLIENT_STATUS_COLORS.PROSPECTIVE_CLIENT[0], CLIENT_STATUS_COLORS.PROSPECTIVE_LEAD[0], 'var(--neg)', undefined],
      notes: ['status Active', 'has an ERP code and an enquiry behind it', 'a name written down, no code yet', 'Inactive + Closed', 'every live client of this type'],
    },
    turnoverSummary: { headers: ['Turnover band', 'Clients', `TO ${yy(fy)}`, `TO ${yy(fy - 1)}`, `TO ${yy(fy - 2)}`, `TO ${yy(fy - 3)}`], rows: turnRows, moneyFrom: 1 },
    quotationSummary:{ headers: ['Channel', 'Active', 'Order Received', 'Total'], rows: quoteRows, moneyFrom: 0 },
    offerStatus:     { headers: ['Offer status', 'Total Offer Value (INR)'], rows: offerRows, moneyFrom: 0 },
    attendance:      { headers: ['Month', 'Visit days', 'Clients'], rows: attRows, moneyFrom: 99 },
    conversion: {
      targetInr, quotedInr, orderReceivedInr,
      pct: quotedInr > 0 ? (orderReceivedInr / quotedInr) * 100 : null,
      // Against the HEADLINE target, so the percentage and the figure above it
      // are about the same person.
      achievedPct: targetInr > 0 ? (orderReceivedInr / targetInr) * 100 : null,
      includes: CONVERSION_INCLUDES, excludes: CONVERSION_EXCLUDES,
      targetLabel, targetNote, targetIsPersonal, targetSub, achievedLabel, panelNote,
      table: {
        headers: ['Stage', 'Opportunities', `Offer value (INR)`], rows: convRows, moneyFrom: 1,
        notes: [`on the quoted pipeline, FY ${yy(fy)}${w.toDate ? ' to date' : ''}`, 'sum of offer_value_inr'],
      },
      outside: outsideOpps > 0
        ? { opps: outsideOpps, value: outsideVal, openOpps: outsideOpen, openValue: outsideOpenVal,
            oldest: outside?.oldest ?? null, newest: outside?.newest ?? null,
            drill: { kind: 'outside_window' as const, tsm, key: String(fy) } }
        : null,
    },
    bookSplit: showBookSplit ? {
      ownLabel: `${tsmName}'s own book`,
      coveredLabel: 'Covers for others',
      note: `${ownClients.toLocaleString('en-IN')} owned · ${coveredClients.toLocaleString('en-IN')} covered`,
      isManager: isManagerTsm,
      scope: accountScope,
      table: {
        headers: ['Measure', 'Own book', 'Covers for others', 'Combined'], rows: bookRows, moneyFrom: 0,
        colors: ['var(--accent)', 'var(--warn)', undefined],
        notes: [
          'accounts where they are the primary rep',
          'accounts they are a secondary rep on and do not own',
          'what this page and the Opportunities board both count by default',
        ],
      },
    } : null,
    kpis: [
      { label: 'Order in Hand', value: fmtMoney(n(kpiRow?.total_business)), sub: 'won · not yet in a sales order', accent: true,
        drill: { kind: 'order_in_hand', tsm } },
      { label: 'Revenue', value: fmtMoney(n(kpiRow?.revenue)), sub: `invoiced · FY ${yy(fy)}${w.toDate ? ' to date' : ''}`,
        drill: { kind: 'revenue', tsm } },
      {
        label: 'Active Clients',
        value: (kpiRow ? Number(kpiRow.active_clients) : 0).toLocaleString('en-IN'),
        drill: { kind: 'active_clients', tsm },
        lines: [
          { label: 'Visited (≤90d)', value: (kpiRow ? Number(kpiRow.active_visited) : 0).toLocaleString('en-IN'),
            color: 'var(--pos)', drill: { kind: 'active_visited', tsm } },
          { label: 'Overdue (90d+)', value: (kpiRow ? Number(kpiRow.active_overdue) : 0).toLocaleString('en-IN'),
            color: 'var(--warn)', drill: { kind: 'active_overdue', tsm } },
          { label: 'Never Visited', value: (kpiRow ? Number(kpiRow.active_never) : 0).toLocaleString('en-IN'),
            color: 'var(--neg)', drill: { kind: 'active_never', tsm } },
        ],
      },
      {
        label: 'Prospective',
        value: (kpiRow ? Number(kpiRow.prospective) : 0).toLocaleString('en-IN'),
        drill: { kind: 'prospective', tsm },
        lines: [
          { label: 'Visited (≤90d)', value: (kpiRow ? Number(kpiRow.prospective_visited) : 0).toLocaleString('en-IN'),
            color: 'var(--pos)', drill: { kind: 'prospective_visited', tsm } },
          { label: 'Prospective-Lead', value: (kpiRow ? Number(kpiRow.prospective_lead) : 0).toLocaleString('en-IN'),
            color: CLIENT_STATUS_COLORS.PROSPECTIVE_LEAD[0], drill: { kind: 'prospective_lead', tsm } },
          { label: 'Prospective-Client', value: (kpiRow ? Number(kpiRow.prospective_client) : 0).toLocaleString('en-IN'),
            color: CLIENT_STATUS_COLORS.PROSPECTIVE_CLIENT[0], drill: { kind: 'prospective_client', tsm } },
        ],
      },
    ],
  };

  // Reached when the signed-in user has no linked rep profile at all (a manager
  // or rep with no tours still gets their own, empty, review). Say so rather
  // than render an unexplained page of zeros.
  if (reps.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10 }}><Topbar crumbs={['Risansi', 'Executive Review']} /></div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)', margin: 0 }}>Executive Review</h1>
          <p style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 10, maxWidth: 560, lineHeight: 1.6 }}>
            Your account isn&apos;t linked to a rep profile, so there is no review to show.
            Ask a system admin to link it under Users &amp; Access.
          </p>
        </div>
      </div>
    );
  }

  const periodText  = `FY ${yy(fy)}${w.toDate ? ' to date' : ''}`;
  // Says which accounts the figures below cover, in the same words the
  // Accounts control uses, so the reader never has to open a dropdown to find
  // out what they are looking at.
  const scopeLabel  = accountScope === 'all' ? 'owned + covered accounts' : 'accounts they own';
  const periodLabel = `${tsmName} · ${periodText} · ${scopeLabel}`;

  // The fiscal years the selector offers, newest first and built on the server
  // so the client component cannot offer a year parseFy would then reject.
  const fyOpts = fyChoices(now).map(y => ({ value: String(y), label: `FY ${yy(y)}` }));

  const note = `Live data for ${tsmName}, fiscal year ${yy(fy)} (Apr–Mar)${w.toDate ? ' to date' : ', complete'}. An opportunity belongs to the year its quotation is dated in, or failing that the day its record was made; anything the year does not reach is counted on its own line in Target & Conversion rather than quietly left out. "Order in Hand" is the value of Won opportunities not yet turned into a Sales Order; "Order Received" is the value of Won opportunities dated in the FY. "Revenue" is everything invoiced in the year, whatever status the client holds now — money booked in a year stays booked for it. The Turnover table below counts the ACTIVE book only, because it bands accounts by size, so its total is the smaller of the two by design rather than by accident. "Conversion" divides order received by the quoted pipeline, and that panel says in full what it counts and what it leaves out. ${targetIsPersonal
    ? `The annual target shown there is ${isSelfReview ? 'your own' : `${tsmName}'s own`}, set per rep in Settings, and the attainment percentage and the tick on the Order received bar are both measured against it; the company-wide figure is on the smaller line beneath it.`
    : viewerCarriesQuota
      ? `No individual annual target is on record for ${isSelfReview ? 'you' : tsmName}, so that panel measures against the company-wide figure and says so; a sysadmin can set a per-rep target in Settings.`
      : 'The annual target shown there is the company-wide figure, and the attainment percentage is measured against it; per-rep targets are set in Settings and appear on a rep’s or manager’s own review.'} Every figure counts the ${accountScope === 'all' ? 'accounts this person owns AND the ones they cover for a colleague, which is what the Opportunities board counts too' : 'accounts this person owns, and leaves out the ones they cover for a colleague'}, which the Accounts control changes${data.bookSplit ? ' — Book & Coverage splits the two, and the value on a covered account still belongs to its owner' : ''}. Turnover columns show each whole fiscal year to date. Clients, Prospective and Active Clients are current-portfolio counts; "Prosp. client" has an ERP code and an enquiry behind it while "Prosp. lead" is only a name so far, and "Unclassified / other" is every client whose type was never set — it is there so the Grand Total is a real total; "Visited" on those two cards means a visit logged within the last 90 days, and every number is clickable through to a filtered client list.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}><Topbar crumbs={['Risansi', 'Executive Review']} /></div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        {tab === 'projection' ? (
          <>
            <div style={{ marginBottom: 4 }}>
              <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)', margin: 0 }}>Executive Review</h1>
              <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>Sales projection · {periodText}</div>
            </div>
            {tabs}
            {/* Rep-wise expected closures. Scoped by allowedRepIds — the same
                list the TSM picker is built from — so this tab can never show a
                rep the viewer is not allowed to see; the Rep filter narrows
                within that. */}
            {projection && (
              <SalesProjection
                d={projection}
                mode={projMode}
                embedded
                subtitle={`Expected closures · FY ${yy(fy)} · open pipeline only${Object.values(projFilters).some(v => Array.isArray(v) ? v.length : v != null) ? ' · filtered' : ''}`}
                filters={projOptions ? <ProjectionFilters options={projOptions} value={{
                  prep: typeof sp.prep === 'string' ? sp.prep : undefined, pptype: typeof sp.pptype === 'string' ? sp.pptype : undefined,
                  pind: typeof sp.pind === 'string' ? sp.pind : undefined, pctype: typeof sp.pctype === 'string' ? sp.pctype : undefined,
                  pstage: typeof sp.pstage === 'string' ? sp.pstage : undefined, pprob: typeof sp.pprob === 'string' ? sp.pprob : undefined,
                  pmarket: typeof sp.pmarket === 'string' ? sp.pmarket : undefined, pmin: typeof sp.pmin === 'string' ? sp.pmin : undefined,
                }} /> : null}
                hrefFor={(m) => {
                  const q = new URLSearchParams();
                  for (const [k, v] of Object.entries(sp)) {
                    if (typeof v === 'string' && v !== '' && k !== 'proj') q.set(k, v);
                  }
                  q.set('proj', m);
                  return `/risansi/executive-review?${q.toString()}`;
                }}
              />
            )}
          </>
        ) : (
          <ExecDrilldownProvider tsm={tsm} scope={accountScope === 'all' ? 'all' : 'own'} fy={String(fy)}>
          <ExecutiveViews
            data={data}
            periodLabel={periodLabel}
            note={note}
            tabs={tabs}
            selector={<ExecutiveSelector reps={reps} tsm={tsm} scope={accountScope === 'all' ? 'all' : 'own'} fys={fyOpts} fy={String(fy)} />}
          />
          </ExecDrilldownProvider>
        )}
      </div>
    </div>
  );
}
