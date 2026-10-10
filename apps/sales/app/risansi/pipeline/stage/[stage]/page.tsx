import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { Topbar } from '@/components/risansi';
import { fmtCr, fmtUsdFromCr } from '@/lib/risansi-utils';
import { getUsdRate } from '@/lib/risansi-settings';
import { fmtUsdFromInr } from '@/lib/risansi-offer-revisions';
import { oppFilterQuery } from '@/lib/risansi-opp-filters';
import { quotationHref, isLegacyQuotation, quotationLinkCount } from '@/lib/risansi-quotation-link';
import { LegacyMark } from '@/components/risansi/QuotationLinkView';
import {
  stageFromSlug, STAGE_COLOR, STAGE_BLURB, STAGE_COLUMNS, summariseStage, summariseClosure,
  parseEtaMonth, selectionEntries, dimValue, DIM_LABEL,
  type SelDim, type Selection,
} from '@/lib/risansi-stage-dashboard';
import { loadStageRows, loadFyActuals, type StageDashRow, type SearchParams } from '@/lib/risansi-stage-rows';
import { SortableTH } from '@/components/risansi';
import { sortRows, type SortableColumn, type SortKind, type SortDir } from '@/lib/risansi-table-sort';
import type { StageColumn } from '@/lib/risansi-stage-dashboard';
import {
  ChartPanel, BarList, AgeingBars, StackedBar, TrendBars, OfferMovement, StageKpi,
  NoData, CHART_GRID, CHART_GRID_4, ClosureBars, CoverageList,
} from '@/components/risansi/StageCharts';

// A dashboard for one pipeline stage: what sits here, what shape it's in, and
// the full list underneath. Reached by clicking a column header on the board.
//
// Every number on the page — tiles, charts, table — is derived from ONE query
// for the stage's rows (loadStageRows, shared with the Excel export).
// Aggregating in JS rather than issuing a query per chart costs nothing at
// these volumes (907 rows in the largest stage) and buys the guarantee that a
// chart can never disagree with the table below it.
//
// Click a bar and the page narrows to it. The selection is in the URL
// (`sel=dim:value`), one per dimension; the visual it came from keeps all its
// bars with the chosen one lit, everything else — tiles, other charts, the
// table, the export — sees only the matching rows. See risansi-stage-dashboard.

export const dynamic = 'force-dynamic';

type Row = StageDashRow;

const PAGE_SIZE = 100;

// ── Column sorting ─────────────────────────────────────────────
// STAGE_COLUMNS says what each column holds well enough to sort it: `num` marks
// the money and the counts, these three keys are the dates, and the rest is
// text. Two columns are computed rather than read off the row, so they say
// where their value comes from.

const DATE_COLS = new Set(['enquiry_date', 'quote_date', 'revised_on']);

/** Won coverage, in its own order: still Open before Closed. */
const SO_STATUS_ORDER = ['Open', 'Closed'] as const;

function sortColumn(col: StageColumn): SortableColumn<Row> {
  if (col.key === 'so_status') {
    // The cell derives Open/Closed from the SO total against the final value,
    // so the sort has to derive it the same way rather than read a column.
    return {
      key: col.key, kind: 'status', order: SO_STATUS_ORDER,
      value: r => {
        const base = r.final_cr != null ? Number(r.final_cr) : r.value_cr;
        return base > 0 && r.so_sum_cr >= base ? 'Closed' : 'Open';
      },
    };
  }
  if (col.key === 'eta_text') {
    // A month as the rep typed it. Sorted as text, 'April' would land next to
    // 'August'; parseEtaMonth turns it into the month index the closure charts
    // already use, and anything unreadable comes back null and sinks.
    return { key: col.key, kind: 'number', value: r => parseEtaMonth((r.eta_text ?? '').trim()) };
  }
  if (DATE_COLS.has(col.key)) return { key: col.key, kind: 'date' };
  return { key: col.key, kind: col.num ? 'number' : 'text' };
}

export default async function StageDashboardPage({ params, searchParams }: {
  params: Promise<{ stage: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { stage: slug } = await params;
  const stage = stageFromSlug(slug);
  if (!stage) notFound();

  const sp = await searchParams;
  // The Quoted month view opens at April and shows invoiced revenue for the
  // closed months, so it needs the FY actuals under the same client filters.
  const [{ all, rows, sel, todayIdx }, usdRate, actuals] = await Promise.all([
    loadStageRows(stage, sp), getUsdRate(), stage === 'Quoted' ? loadFyActuals(sp) : Promise.resolve(null),
  ]);

  // ── Aggregates ───────────────────────────────────────────────
  // `rows` is the stage under every active selection: tiles and table use it.
  // A chart whose own dimension is selected is drawn from the rows narrowed by
  // the OTHER dimensions only, so its chosen bar stays on screen to be cleared.
  const A = summariseStage(rows);
  const {
    n, totalCr, avgCr, clients, avgAge, oldest, stale, staleCr,
    inHandCr, soCr, withSo, moved, avgMove, totalRevs, unrecorded,
  } = A;
  const selDims = Object.keys(sel) as SelDim[];
  const matches = (d: SelDim, r: Row) => dimValue(d, r, todayIdx) === sel[d];
  const forDim = (dim: SelDim) => (sel[dim] != null
    ? all.filter(r => selDims.every(d => d === dim || matches(d, r)))
    : rows);
  const P = (dim: SelDim) => (sel[dim] != null ? summariseStage(forDim(dim)) : A);
  const C = (dim: SelDim) => summariseClosure(forDim(dim), todayIdx, undefined, 4, actuals);

  // ── Sort ─────────────────────────────────────────────────────
  // The whole stage is already in hand, but the table shows one 100-row page of
  // it, so the order has to be settled before the slice is taken: sorting the
  // 100 on screen would reorder a hundredth of the stage and claim to rank all
  // of it. The column rides in the URL and the page resets, the same way the
  // paginated SQL tables work.
  const columns  = STAGE_COLUMNS[stage];
  const sortCols = columns.map(sortColumn);
  const sortKey  = typeof sp.sort === 'string' && sortCols.some(c => c.key === sp.sort) ? sp.sort : null;
  const sortDir: SortDir = sp.dir === 'asc' ? 'asc' : 'desc';
  const kindOf = (key: string): SortKind =>
    sortCols.find(c => c.key === key)?.kind ?? 'text';
  // No column chosen means sortRows hands back the very same array, so the
  // stage keeps the order loadStageRows gave it.
  const ordered = sortRows(rows, sortCols, { key: sortKey, dir: sortDir });

  // ── Links ────────────────────────────────────────────────────
  const base = () => oppFilterQuery(sp, ['stage']);
  const withSel = (s: Selection, page?: number) => {
    const q = base();
    for (const e of selectionEntries(s)) q.append('sel', e);
    // oppFilterQuery only carries the board's own filters, so the chosen column
    // has to be re-added by hand — without this, turning a page or clicking a
    // bar silently dropped the sort and the list jumped back to its default.
    if (sortKey) { q.set('sort', sortKey); q.set('dir', sortDir); }
    if (page && page > 1) q.set('page', String(page));
    const qs = q.toString();
    return qs ? `?${qs}` : '?';
  };
  const hrefFor = (dim: SelDim) => (value: string) => {
    const next: Selection = { ...sel };
    if (next[dim] === value) delete next[dim]; else next[dim] = value;
    return withSel(next);
  };
  const hrefDrop = (dim: SelDim) => { const next = { ...sel }; delete next[dim]; return withSel(next); };
  const pageHref = (p: number) => withSel(sel, p);

  const boardQuery = base();
  const backHref   = `/risansi/pipeline${boardQuery.toString() ? `?${boardQuery}` : ''}`;
  // The table export carries the filters AND the bar selection, so what comes
  // down is what is on screen. The full export is every field of the stage.
  const exportQuery = base(); exportQuery.set('stage', stage);
  for (const e of selectionEntries(sel)) exportQuery.append('sel', e);
  const fullQuery = base(); fullQuery.set('stage', stage);

  // ── Paging ───────────────────────────────────────────────────
  const page  = Math.max(1, parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const pages = Math.max(1, Math.ceil(n / PAGE_SIZE));
  const slice = ordered.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE);

  const hue = STAGE_COLOR[stage];
  const inr = (v: number | null | undefined) => (v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN'));
  const allTotal = all.reduce((s, r) => s + r.value_cr, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={[{ label: 'Opportunities', href: backHref }, stage]} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <a href={backHref} style={{ fontSize: 11.5, color: 'var(--fg-3)', textDecoration: 'none' }}>← Opportunities board</a>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: '5px 0 3px', display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: hue, display: 'inline-block' }} />
              {stage}
            </h1>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {n} opportunit{n === 1 ? 'y' : 'ies'} · {fmtCr(totalCr)} · ≈ {fmtUsdFromCr(totalCr, usdRate)}
              {selDims.length > 0 && <span> · of {all.length} · {fmtCr(allTotal)}</span>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 5, maxWidth: 640, lineHeight: 1.5 }}>{STAGE_BLURB[stage]}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <a href={`/api/risansi/opportunities/stage-export?${exportQuery}`} style={EXPORT_BTN}
              title="The table below, as shown — filters and any bar you have clicked included">
              ⤓ Export this table
            </a>
            <a href={`/api/risansi/opportunities/export?${fullQuery}`}
              style={{ fontSize: 11, color: 'var(--fg-3)', textDecoration: 'none' }}
              title="Every field of every opportunity in this stage, for ERP reconciliation">
              Full export, all fields
            </a>
          </div>
        </div>

        {/* Active bar selections */}
        {selDims.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
            <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>Filtered by</span>
            {selDims.map(d => (
              <a key={d} href={hrefDrop(d)} title="Remove this filter" style={CHIP}>
                <span style={{ color: 'var(--fg-3)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{DIM_LABEL[d]}</span>
                <span style={{ fontWeight: 600 }}>{sel[d]}</span>
                <span aria-hidden style={{ color: 'var(--fg-3)' }}>×</span>
              </a>
            ))}
            <a href={withSel({})} style={{ fontSize: 11.5, color: 'var(--accent)', textDecoration: 'none', marginLeft: 4 }}>Clear all</a>
          </div>
        )}

        {n === 0 ? (
          <div style={{ ...PANEL, padding: 40, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
            Nothing sits in {stage} right now{boardQuery.toString() ? ' with the filters carried over from the board' : ''}
            {selDims.length ? ' and the bars you have selected' : ''}.
            {selDims.length > 0 && <> <a href={withSel({})} style={{ color: 'var(--accent)' }}>Clear the selection</a>.</>}
          </div>
        ) : (
          <>
            {/* KPI tiles — the four questions this stage actually raises */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 14 }}>
              {stage === 'Won' ? (
                <>
                  <StageKpi label="Won" value={String(n)} sub={`${clients} client${clients === 1 ? '' : 's'}`} />
                  <StageKpi label="Won value" value={fmtCr(totalCr)} sub={`≈ ${fmtUsdFromCr(totalCr, usdRate)}`} color="var(--pos)" />
                  <StageKpi label="Order in hand" value={fmtCr(inHandCr)} sub="won · no SO raised yet" color="var(--warn)" alert={inHandCr > 0} />
                  <StageKpi label="SO created" value={fmtCr(soCr)} sub={`${withSo} of ${n} covered`} color="var(--pos)" />
                </>
              ) : stage === 'Negotiating' ? (
                <>
                  <StageKpi label="In negotiation" value={String(n)} sub={`${clients} client${clients === 1 ? '' : 's'}`} />
                  <StageKpi label="Value on the table" value={fmtCr(totalCr)} sub={`≈ ${fmtUsdFromCr(totalCr, usdRate)}`} color="var(--accent)" />
                  <StageKpi label="Avg move from original" value={avgMove == null ? '—' : `${avgMove > 0 ? '+' : ''}${avgMove.toFixed(1)}%`}
                    sub={moved.length ? `across ${moved.length} re-priced` : 'nothing re-priced yet'}
                    color={avgMove == null ? undefined : avgMove >= 0 ? 'var(--pos)' : 'var(--neg)'} />
                  <StageKpi label="Revisions logged" value={String(totalRevs)} sub="offer changes on record" />
                </>
              ) : stage === 'Lost' ? (
                <>
                  <StageKpi label="Lost" value={String(n)} sub={`${clients} client${clients === 1 ? '' : 's'}`} />
                  <StageKpi label="Value lost" value={fmtCr(totalCr)} sub={`≈ ${fmtUsdFromCr(totalCr, usdRate)}`} color="var(--neg)" />
                  <StageKpi label="Reason recorded" value={`${n - unrecorded(r => r.lost_reason)} of ${n}`}
                    sub="needed for win-rate analysis" alert={unrecorded(r => r.lost_reason) > 0} />
                  <StageKpi label="Competitor recorded" value={`${n - unrecorded(r => r.lost_to_competitor)} of ${n}`}
                    sub="needed for competitive analysis" alert={unrecorded(r => r.lost_to_competitor) > 0} />
                </>
              ) : stage === 'Dropped' ? (
                <>
                  <StageKpi label="Dropped" value={String(n)} sub={`${clients} client${clients === 1 ? '' : 's'}`} />
                  <StageKpi label="Value dropped" value={fmtCr(totalCr)} sub={`≈ ${fmtUsdFromCr(totalCr, usdRate)}`} color="var(--fg-2)" />
                  <StageKpi label="Reason recorded" value={`${n - unrecorded(r => r.drop_reason)} of ${n}`}
                    sub="chosen when the card is dropped" alert={unrecorded(r => r.drop_reason) > 0} />
                  <StageKpi label="Avg age at drop" value={avgAge == null ? '—' : `${avgAge}d`} sub={oldest != null ? `oldest ${oldest}d` : undefined} />
                </>
              ) : (
                <>
                  <StageKpi label={stage === 'Quoted' ? 'Quotes out' : 'Opportunities'} value={String(n)} sub={`${clients} client${clients === 1 ? '' : 's'}`} />
                  <StageKpi label={stage === 'Quoted' ? 'Quoted value' : 'Total value'} value={fmtCr(totalCr)} sub={`≈ ${fmtUsdFromCr(totalCr, usdRate)}`} color={hue} />
                  <StageKpi label="Average deal" value={fmtCr(avgCr)} sub={avgAge != null ? `avg age ${avgAge}d` : undefined} />
                  <StageKpi
                    label={stage === 'Quoted' ? 'Going stale (60d+)' : 'Sitting 60d+'}
                    value={String(stale.length)} sub={`${fmtCr(staleCr)} needs chasing`}
                    color="var(--neg)" alert={stale.length > 0}
                  />
                </>
              )}
            </div>

            {/* Charts */}
            {stage === 'Quoted' ? (() => {
              // Eight panels, two rows of four. Top row is about time — how long
              // each quote has been out, and when the rep says it lands, by month
              // and by quarter, and who is saying so at all. Bottom row is the mix.
              const Cm = C('etam'), Cq = C('etaq'), Cr = C('rep');
              const nAll = forDim('etam').length;
              return (
              <div className={CHART_GRID_4}>
                {/* The whole financial year, April to March: closed months as
                    invoiced revenue, this month onward as what the quotes say.
                    Fourteen columns, so it takes three cells of the row. */}
                <div className="stage-span-3">
                <ChartPanel
                  title={`Closing by month · FY ${String(Math.floor((todayIdx + 9) / 12)).slice(2)}-${String(Math.floor((todayIdx + 9) / 12) + 1).slice(2)}`}
                  sub={`${Cm.dated} of ${nAll} dated · ${fmtCr(Cm.datedCr)} projected${(() => { const a = Cm.months.filter(m => m.tone === 'actual').reduce((x, m) => x + m.value, 0); return a ? ` · ${fmtCr(a)} invoiced so far` : ''; })()}`}
                  note={[
                    'Closed months show invoiced revenue (Revenue upload); this month onward shows quotes by their target closure month, by value.',
                    Cm.undated
                      ? `${Cm.undated} quote${Cm.undated === 1 ? '' : 's'} (${fmtCr(Cm.undatedCr)}) carry no month and sit in No date.`
                      : 'Every quote carries one.',
                    Cm.overdue ? `${Cm.overdue} past ${Cm.overdue === 1 ? 'its' : 'their'} month and still open: re-date or decide.` : '',
                  ].filter(Boolean).join(' ')}>
                  <ClosureBars buckets={Cm.months} hrefFor={hrefFor('etam')} selected={sel.etam} />
                </ChartPanel>
                </div>
                <ChartPanel
                  title="Quote ageing"
                  sub={P('age').stale.length ? `${P('age').stale.length} over 60 days` : 'all fresh'}
                  note="Days since the quotation went out. Anything past 60 days needs a call. Click a column to filter the page to it.">
                  <AgeingBars buckets={P('age').ageBuckets} hrefFor={hrefFor('age')} selected={sel.age} />
                </ChartPanel>
                <ChartPanel
                  title="Closing by quarter"
                  sub={`this quarter ${fmtCr(Cq.quarters[1]?.value ?? 0)} · next ${fmtCr(Cq.quarters[2]?.value ?? 0)}`}
                  note="Financial year April to March. Overdue is any target month already past, the same line as the month view, so the current quarter shows only what is still ahead in it.">
                  <ClosureBars buckets={Cq.quarters} hrefFor={hrefFor('etaq')} selected={sel.etaq} />
                </ChartPanel>
                <ChartPanel
                  title="Target date set"
                  sub={`${forDim('rep').length ? Math.round((Cr.dated / forDim('rep').length) * 100) : 0}% of quotes · ${Cr.datedCr + Cr.undatedCr ? Math.round((Cr.datedCr / (Cr.datedCr + Cr.undatedCr)) * 100) : 0}% of value`}
                  note="Share of each rep's open quotes with a target month. A quote without one is invisible to the two charts on the left and to the sales projection on the Executive Review.">
                  <CoverageList rows={Cr.byRep} hrefFor={hrefFor('rep')} selected={sel.rep} />
                </ChartPanel>

                <ChartPanel title="Product mix">
                  <BarList rows={P('ptype').group(r => r.product_type)} hrefFor={hrefFor('ptype')} selected={sel.ptype} />
                </ChartPanel>
                <ChartPanel title="Domestic vs Export">
                  <StackedBar parts={marketParts(P('market').group(r => r.market))} hrefFor={hrefFor('market')} selected={sel.market} />
                </ChartPanel>
                <div className="stage-span-2">
                <ChartPanel title="By rep" sub="client owner">
                  <BarList rows={P('rep').group(r => r.rep_name, 8)} hrefFor={hrefFor('rep')} selected={sel.rep} />
                </ChartPanel>
                </div>
                <div className="stage-span-2">
                <ChartPanel title="Top clients">
                  <BarList rows={P('client').group(r => r.client_name, 8)} hrefFor={hrefFor('client')} selected={sel.client} />
                </ChartPanel>
                </div>
              </div>
              );
            })() : (
            <div style={CHART_GRID}>
              {stage === 'Won' ? (
                <>
                  <ChartPanel title="Sales-Order coverage" sub={`${withSo} of ${n} have an SO`}
                    note="Order in hand is won value with no Sales Order against it — the raise-an-SO to-do list. Click a part to filter.">
                    <StackedBar parts={[
                      { label: 'SO created', value: P('so').soCr, color: 'var(--pos)', sub: `${P('so').withSo} opps` },
                      { label: 'Awaiting SO', value: P('so').inHandCr, color: 'var(--warn)', sub: `${P('so').n - P('so').withSo} opps` },
                    ]} hrefFor={hrefFor('so')} selected={sel.so} />
                  </ChartPanel>
                  <ChartPanel title="Won by month" sub="by quote date, last 12">
                    <TrendBars points={P('qmonth').trend} hrefFor={hrefFor('qmonth')} selected={sel.qmonth} />
                  </ChartPanel>
                  <ChartPanel title="Product mix">
                    <BarList rows={P('ptype').group(r => r.product_type)} hrefFor={hrefFor('ptype')} selected={sel.ptype} />
                  </ChartPanel>
                  <ChartPanel title="Top clients" sub="by won value">
                    <BarList rows={P('client').group(r => r.client_name, 8)} hrefFor={hrefFor('client')} selected={sel.client} />
                  </ChartPanel>
                </>
              ) : stage === 'Negotiating' ? (
                <>
                  <ChartPanel title="Offer movement" sub={`${moved.length} re-priced`}
                    note="Original is the quoted offer; current is the newest revision on record.">
                    <OfferMovement rows={rows.map(r => ({
                      id: r.id, label: `${r.client_name} · ${r.quote_ref ?? r.product}`,
                      original: r.offer_inr, current: r.revised_inr, revisions: r.rev_count,
                    }))} />
                  </ChartPanel>
                  <ChartPanel title="Days since quote">
                    <AgeingBars buckets={P('age').ageBuckets} hrefFor={hrefFor('age')} selected={sel.age} />
                  </ChartPanel>
                </>
              ) : stage === 'Lost' ? (
                <>
                  <ChartPanel title="Why we lost" sub={`${unrecorded(r => r.lost_reason)} unrecorded`}
                    note={unrecorded(r => r.lost_reason) > 0 ? 'Unrecorded rows are shown as their own bar rather than dropped — an empty chart would read as "no reason", not "nobody filled it in".' : undefined}>
                    <BarList rows={P('lost_reason').group(r => r.lost_reason)} hrefFor={hrefFor('lost_reason')} selected={sel.lost_reason} />
                  </ChartPanel>
                  <ChartPanel title="Lost to" sub={`${unrecorded(r => r.lost_to_competitor)} unrecorded`}>
                    <BarList rows={P('lost_to').group(r => r.lost_to_competitor)} hrefFor={hrefFor('lost_to')} selected={sel.lost_to} />
                  </ChartPanel>
                  <ChartPanel title="Product mix">
                    <BarList rows={P('ptype').group(r => r.product_type)} hrefFor={hrefFor('ptype')} selected={sel.ptype} />
                  </ChartPanel>
                </>
              ) : stage === 'Dropped' ? (
                <>
                  <ChartPanel title="Why it was dropped" sub={`${unrecorded(r => r.drop_reason)} unrecorded`}
                    note={unrecorded(r => r.drop_reason) === n ? 'The drop-reason field is newer than these rows, so none carry one yet. It is asked for whenever a card is moved to Dropped from now on.' : undefined}>
                    <BarList rows={P('drop_reason').group(r => r.drop_reason)} hrefFor={hrefFor('drop_reason')} selected={sel.drop_reason} />
                  </ChartPanel>
                  <ChartPanel title="Product mix">
                    <BarList rows={P('ptype').group(r => r.product_type)} hrefFor={hrefFor('ptype')} selected={sel.ptype} />
                  </ChartPanel>
                </>
              ) : (
                <>
                  <ChartPanel title="Ageing" sub={stale.length ? `${stale.length} over 60 days` : 'all fresh'}>
                    <AgeingBars buckets={P('age').ageBuckets} hrefFor={hrefFor('age')} selected={sel.age} />
                  </ChartPanel>
                  <ChartPanel title="Product mix">
                    <BarList rows={P('ptype').group(r => r.product_type)} hrefFor={hrefFor('ptype')} selected={sel.ptype} />
                  </ChartPanel>
                  <ChartPanel title="By rep" sub="client owner">
                    <BarList rows={P('rep').group(r => r.rep_name, 8)} hrefFor={hrefFor('rep')} selected={sel.rep} />
                  </ChartPanel>
                  {stage === 'Prospect' && (
                    <ChartPanel title="Top clients">
                      <BarList rows={P('client').group(r => r.client_name, 8)} hrefFor={hrefFor('client')} selected={sel.client} />
                    </ChartPanel>
                  )}
                </>
              )}
            </div>
            )}

            {/* The list */}
            <div style={PANEL}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>
                  {selDims.length ? `${stage} opportunities in the selection` : `All ${stage} opportunities`}
                </span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                  {pages > 1 ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, n)} of ${n}` : `${n} rows`}
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {columns.map(col => (
                        <SortableTH
                          key={col.key}
                          col={col.key}
                          label={col.label}
                          kind={kindOf(col.key)}
                          currentSort={sortKey ?? ''}
                          currentDir={sortDir}
                          align={col.num ? 'right' : 'left'}
                          style={{ ...TH, width: col.width, minWidth: col.width }}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {slice.map((r, i) => (
                      <tr key={r.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
                        {columns.map(col => (
                          <td key={col.key} style={{
                            ...TD, textAlign: col.num ? 'right' : 'left',
                            fontFamily: col.num ? 'var(--font-mono)' : 'inherit',
                          }}>
                            {renderCell(r, col.key, usdRate, inr, todayIdx)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {slice.length === 0 && <NoData msg="No rows on this page." />}
              </div>
              {pages > 1 && (
                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {page > 1 && <a href={pageHref(page - 1)} style={PAGE_BTN}>← Prev</a>}
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>Page {Math.min(page, pages)} of {pages}</span>
                  {page < pages && <a href={pageHref(page + 1)} style={PAGE_BTN}>Next →</a>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Domestic / Export / Unrecorded parts from the market grouping, labelled the way the market dimension expects. */
function marketParts(g: { label: string; count: number; value: number }[]) {
  const pick = (l: string) => g.find(x => x.label === l);
  return [
    { label: 'Domestic',   value: pick('DOMESTIC')?.value ?? 0,   color: 'var(--title)', sub: `${pick('DOMESTIC')?.count ?? 0} opps` },
    { label: 'Export',     value: pick('EXPORT')?.value ?? 0,     color: '#c69347', sub: `${pick('EXPORT')?.count ?? 0} opps` },
    { label: 'Unrecorded', value: pick('Unrecorded')?.value ?? 0, color: 'var(--fg-3)' },
  ];
}

// ── Cell rendering ─────────────────────────────────────────────

function renderCell(r: Row, key: string, usdRate: number, inr: (v: number | null | undefined) => string, todayIdx: number) {
  switch (key) {
    case 'client_name':
      return <a href={`/risansi/clients/${r.client_id}`} style={{ color: 'var(--fg)', textDecoration: 'none', fontWeight: 500 }}>{r.client_name}</a>;
    case 'quote_ref': {
      // The quote number opens the quotation itself — the opportunity, where
      // the offer, the line items and the documents all live. It used to open
      // the attached PDF, which is one of the things on that page rather than
      // the thing itself, and there was no way from here to the record.
      //
      // The PDF keeps a door of its own: the ↗ beside the number. An attached
      // file wins over a legacy url, because syncQuotationLink will not
      // overwrite one — an opportunity that had a SharePoint link and has
      // since had its quotation uploaded still stores the SharePoint address,
      // and reading the link alone would send a rep to OneDrive past a PDF
      // sitting right here.
      const attached = r.doc_count > 0;
      const pdf = attached ? `/api/risansi/opportunities/${r.id}/quotation` : quotationHref(r.quotation_link);
      const legacy = !attached && isLegacyQuotation(r.quotation_link);
      const form = `/risansi/pipeline?client=${encodeURIComponent(r.client_code ?? '')}&opp=${r.id}`;
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <a href={form} title="Open this quotation — the offer, its line items and its documents"
            style={{ color: 'var(--brand-blue)', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {r.quote_ref ?? '—'}
          </a>
          {pdf && (
            <a href={pdf} target="_blank" rel="noreferrer"
              title={legacy ? 'The quotation file — a legacy SharePoint link' : 'The attached quotation PDF'}
              aria-label="Open the quotation file"
              style={{ color: 'var(--fg-3)', textDecoration: 'none', fontSize: 11 }}>↗</a>
          )}
          {legacy && (pdf
            ? <LegacyMark count={quotationLinkCount(r.quotation_link)} />
            : <LegacyMark noFile />)}
        </span>
      );
    }
    case 'drop_reason': {
      // The reason, and under it what was typed when it was 'Other'. The bar
      // chart above still counts Other as one thing; only the row says which
      // Other this was.
      if (!r.drop_reason) return <span style={{ color: 'var(--fg-3)' }}>—</span>;
      const words = (r.drop_reason_other ?? '').trim();
      if (!words) return r.drop_reason;
      return (
        <span title={`${r.drop_reason} — ${words}`}>
          {r.drop_reason}
          <span style={{ display: 'block', fontSize: 10.5, color: 'var(--fg-3)', lineHeight: 1.35, marginTop: 1 }}>{words}</span>
        </span>
      );
    }
    case 'eta_text': {
      // The month the rep set, as typed. Red once that month has passed, grey
      // when there is none — the same reading the closure charts give it.
      const t = (r.eta_text ?? '').trim();
      if (!t) return <span style={{ color: 'var(--fg-3)' }}>—</span>;
      const idx = parseEtaMonth(t);
      const late = idx != null && idx < todayIdx;
      return (
        <span title={late ? 'Target month has passed and this is still quoted' : idx == null ? 'Not a month I can read' : undefined}
          style={{ color: late ? 'var(--neg)' : idx == null ? 'var(--fg-3)' : 'inherit', fontWeight: late ? 600 : 400 }}>
          {late ? '⚠ ' : ''}{t}
        </span>
      );
    }
    case 'rep_name':
      // The client's owner, and the only rep the opportunity has. A second
      // line used to sit under this one saying who the opportunity itself
      // named; under one owner per client there is no second name to show.
      return <span>{r.rep_name}</span>;
    case 'value_cr':
      return fmtCr(r.value_cr);
    case 'final_cr':
      return r.final_cr == null ? '—' : fmtCr(Number(r.final_cr));
    case 'so_sum_cr':
      return r.so_sum_cr > 0 ? fmtCr(r.so_sum_cr) : '—';
    case 'so_status': {
      // Matches wonSubStatus: Open while the SOs don't yet cover the final value.
      const base = r.final_cr != null ? Number(r.final_cr) : r.value_cr;
      const covered = base > 0 && r.so_sum_cr >= base;
      return (
        <span style={{ fontSize: 10.5, fontWeight: 600, color: covered ? 'var(--pos)' : 'var(--warn)' }}>
          {covered ? 'Closed' : 'Open'}
        </span>
      );
    }
    case 'offer_inr':
      return r.offer_inr == null ? '—' : (
        <span title={`≈ ${fmtUsdFromInr(r.offer_inr, usdRate)}`}>{inr(r.offer_inr)}</span>
      );
    case 'revised_inr': {
      if (r.revised_inr == null) return <span style={{ color: 'var(--fg-3)' }}>—</span>;
      const d = r.offer_inr && r.offer_inr > 0 ? ((r.revised_inr - r.offer_inr) / r.offer_inr) * 100 : null;
      return (
        <span title={`≈ ${fmtUsdFromInr(r.revised_inr, usdRate)}${r.rev_count > 1 ? ` · ${r.rev_count} revisions` : ''}`}>
          {inr(r.revised_inr)}
          {d != null && Math.abs(d) >= 0.05 && (
            <span style={{ marginLeft: 5, fontSize: 10, color: d > 0 ? 'var(--pos)' : 'var(--neg)' }}>
              {d > 0 ? '▲' : '▼'}{Math.abs(d).toFixed(0)}%
            </span>
          )}
        </span>
      );
    }
    case 'age_days':
      if (r.age_days == null) return <span style={{ color: 'var(--fg-3)' }}>—</span>;
      return <span style={{ color: r.age_days > 90 ? 'var(--neg)' : r.age_days > 60 ? 'var(--warn)' : 'inherit' }}>{r.age_days}d</span>;
    case 'rev_count':
      return r.rev_count || '—';
    default: {
      const v = (r as unknown as Record<string, unknown>)[key];
      const s = v == null ? '' : String(v).trim();
      return s ? s : <span style={{ color: 'var(--fg-3)' }}>—</span>;
    }
  }
}

// ── Styles ─────────────────────────────────────────────────────

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const TH: CSSProperties = {
  padding: '9px 10px', fontSize: 10, fontWeight: 700, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--line)',
  whiteSpace: 'nowrap', background: 'var(--bg-sunk)',
};
const TD: CSSProperties = { padding: '8px 10px', verticalAlign: 'top', overflowWrap: 'anywhere' };
const EXPORT_BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 7,
  fontSize: 12.5, color: 'var(--fg-2)', textDecoration: 'none', flexShrink: 0,
};
const PAGE_BTN: CSSProperties = {
  padding: '4px 11px', fontSize: 11.5, border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg-2)', textDecoration: 'none',
};
const CHIP: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px 4px 10px',
  background: 'var(--accent-soft, var(--bg-elev))', border: '1px solid var(--accent)', borderRadius: 999,
  color: 'var(--fg)', textDecoration: 'none', fontSize: 12,
};
