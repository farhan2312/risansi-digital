import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { DrillCell } from './ExecDrilldown';
import { ExecMiniTable } from './ExecMiniTable';
import { StackedHBars, GroupedBars, Donut, HBars, fmtCr } from './ExecCharts';
import type { DrillParams } from '@/app/actions/risansi-exec-drilldown';

// ────────────────────────────────────────────────────────────────
// Executive Review — the monthly per-TSM review dashboards, now driven by live
// data. The page (app/risansi/executive-review) computes the ExecData for the
// selected TSM + month and renders it here.
// ────────────────────────────────────────────────────────────────

// `drill` runs parallel to `vals`: one entry per column, null where that cell
// has nothing to itemise (a grand total, a zero). Every figure on this page is a
// sum or a count over a set of clients, and the set was the one thing the reader
// could not see.
export type Row = {
  label: string; vals: (number | null)[]; strong?: boolean;
  drill?: (DrillParams | null)[];
};
export interface ExecTable {
  headers: string[]; rows: Row[]; moneyFrom: number;
  /** Per value column: a colour for the header and the figures (undefined = plain). */
  colors?: (string | undefined)[];
  /** Per value column: what the column counts, as the header's tooltip. */
  notes?: (string | undefined)[];
}
// A breakdown row inside a KPI card (e.g. "Visited (≤90d) · 42").
export interface ExecKpiLine { label: string; value: string; color?: string; drill?: DrillParams }
export interface ExecKpi {
  label: string; value: string; sub?: string; accent?: boolean;
  drill?: DrillParams;    // breakdown for the main number
  lines?: ExecKpiLine[];
}
/**
 * Target against what was quoted and what came back as an order.
 *
 * Kept apart from the ExecTables because the three figures are not three rows
 * of one column: two are rupees, one is a ratio, and the ratio is the point.
 * `table` is the stage-by-stage breakdown the denominator is built from, so a
 * reader can see which stages were counted rather than take the word for it.
 */
export interface ExecConversion {
  /**
   * The headline target — the one every percentage on this panel divides into.
   *
   * It is the reviewed person's own annual target for a rep or a manager, and
   * the company-wide figure for everybody else. The page decides which (it
   * knows who is looking); this component only renders what it is handed, and
   * `targetIsPersonal` says which it got so the wording can follow.
   */
  targetInr: number;
  /** Label over the headline figure. */
  targetLabel: string;
  /** Where the headline target comes from, under the figure. */
  targetNote: string;
  /** True when the headline target belongs to a person rather than the company. */
  targetIsPersonal: boolean;
  /**
   * The second, smaller line inside the same card: the company-wide figure
   * when the headline is personal, or "not set" when the reviewed person
   * carries a quota that nobody has filled in. Null when there is nothing to
   * add — an admin's headline already IS the company figure.
   *
   * `valueInr` is rupees so it is formatted by the same fmtCr as the headline
   * right above it; null renders as "Not set", which is the whole point of the
   * line in the no-target case and must never come through as ₹0.
   */
  targetSub: { label: string; valueInr: number | null; note?: string } | null;
  quotedInr: number;
  orderReceivedInr: number;
  /** Order received ÷ total quoted, as a percentage. Null when nothing was quoted. */
  pct: number | null;
  /** Order received ÷ the HEADLINE target, as a percentage. Null when no target is set. */
  achievedPct: number | null;
  /** Names that denominator out loud, e.g. 'of your annual target'. */
  achievedLabel: string;
  /** The panel header's note, which also says which target is in play. */
  panelNote: string;
  table: ExecTable;
  includes: string;
  excludes: string;
  /** What the fiscal-year window leaves out. Null when it leaves out nothing. */
  outside: ExecOutside | null;
}

/**
 * Everything on the book that the selected fiscal year does not reach.
 *
 * It has a type of its own because it is the opposite of a figure: its job is to
 * be the thing no total contains, stated out loud. A quotation dated in one FY
 * and entered in the next used to be on the Opportunities board and on no view
 * of this page at all.
 */
export interface ExecOutside {
  opps: number;
  value: number;
  /** How much of it is still live rather than closed history. */
  openOpps: number;
  openValue: number;
  oldest: string | null;
  newest: string | null;
  drill: DrillParams;
}

/**
 * A TSM's own accounts beside the ones they cover for somebody else.
 *
 * The review counts owned accounts and the Opportunities board counts both, so
 * the same manager reads several times apart on the two pages. Rather than pick
 * one and hope, this panel prints both columns and says which is which.
 */
export interface ExecBookSplit {
  ownLabel: string;
  coveredLabel: string;
  note: string;
  isManager: boolean;
  /** Which column the rest of the page is currently built from. */
  scope: 'own' | 'all' | 'covered';
  table: ExecTable;
}

export interface ExecData {
  clientsSummary:  ExecTable;
  turnoverSummary: ExecTable;
  quotationSummary: ExecTable;
  offerStatus:     ExecTable;
  attendance:      ExecTable;
  conversion:      ExecConversion;
  /** Null for a rep who neither manages nor covers — the split would be all zeroes. */
  bookSplit:       ExecBookSplit | null;
  kpis:            ExecKpi[];
}

export function MiniTable({ title, note, table, full, chart, footer }: { title: string; note?: string; table: ExecTable; full?: boolean; chart?: ReactNode; footer?: ReactNode }) {
  return (
    <div style={{ ...PANEL, ...(full ? { gridColumn: '1 / -1' } : {}) }}>
      <div style={PANEL_H}>
        <span style={PANEL_TITLE}>{title}</span>
        {note && <span style={META}>{note}</span>}
      </div>
      {/* The picture first, the figures under it: the chart says the shape,
          the table keeps the exact numbers and the drill-through on each. */}
      {chart && <div style={{ padding: '14px 14px 6px' }}>{chart}</div>}
      {/* The grid itself is a client component so its headers can sort; the
          panel, the chart and the footnote stay on the server. */}
      <div style={{ overflowX: 'auto' }}>
        <ExecMiniTable table={table} />
      </div>
      {footer && <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>{footer}</div>}
    </div>
  );
}

// ── Target & Conversion ────────────────────────────────────────
// Four figures that only mean anything together: what we set out to sell, what
// we priced, what came back as an order, and the ratio of the last two.
function Figure({ label, value, sub, color, big }: { label: string; value: string; sub?: string; color?: string; big?: boolean }) {
  return (
    <div>
      <div style={METRIC_LABEL}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: big ? 28 : 22, fontWeight: 700, letterSpacing: '-0.01em',
                    color: color ?? 'var(--fg)', lineHeight: 1.15, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function ConversionFigures({ c }: { c: ExecConversion }) {
  const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);
  // Both bars are drawn against the larger of target and quoted, so the two
  // lengths stay comparable when the pipeline has already outrun the target.
  // `targetInr` is the headline target, so a rep's bars are now scaled to a
  // number they can actually reach rather than to the company's whole year.
  const span = Math.max(c.targetInr, c.quotedInr, 1);
  // `markerAt` draws the target as a tick across the bar, so "measured against"
  // is something the reader can see and not only read in the caption. It sits
  // at the right-hand edge when the target is the longest thing on the chart.
  const bar = (v: number, color: string, markerAt?: number) => (
    <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--bg-elev)', overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, (v / span) * 100)}%`, height: '100%', background: color }} />
      {markerAt != null && markerAt > 0 && (
        <div aria-hidden style={{
          position: 'absolute', top: 0, bottom: 0, left: `${Math.min(100, (markerAt / span) * 100)}%`,
          width: 2, marginLeft: -2, background: 'var(--fg-2)',
        }} />
      )}
    </div>
  );
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, alignItems: 'start' }}>
        {/* The target card carries two figures when the viewer has one of their
            own: theirs large, the company's underneath. The company figure is
            kept in view because it is the number the year is held to — it is
            just not the bar an individual clears. */}
        <div>
          <Figure label={c.targetLabel} value={fmtCr(c.targetInr)} sub={c.targetNote} big={c.targetIsPersonal} />
          {c.targetSub && (
            <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--line)' }}>
              <div style={METRIC_LABEL}>{c.targetSub.label}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600,
                            color: c.targetSub.valueInr == null ? 'var(--fg-3)' : 'var(--fg-2)',
                            lineHeight: 1.2, marginTop: 3 }}>
                {c.targetSub.valueInr == null ? 'Not set' : fmtCr(c.targetSub.valueInr)}
              </div>
              {c.targetSub.note && <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 2 }}>{c.targetSub.note}</div>}
            </div>
          )}
        </div>
        {/* All of it, won and lost included — which is why this is larger than
            the board's Quoted tile, and why Order Received matches its Won. */}
        <Figure label="Total Quoted" value={fmtCr(c.quotedInr)} sub="everything quoted this FY, won and lost included" color="var(--accent)" />
        <Figure label="Order Received" value={fmtCr(c.orderReceivedInr)} sub="won, of that pipeline" color="var(--pos)" />
        <Figure label="Conversion" value={pct(c.pct)} sub="order received ÷ total quoted" big
          color={c.pct == null ? 'var(--fg-3)' : c.pct >= 50 ? 'var(--pos)' : c.pct >= 25 ? 'var(--warn)' : 'var(--neg)'} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        <div>
          <div style={BAR_LABEL}><span>Quoted</span><span>{fmtCr(c.quotedInr)}</span></div>
          {bar(c.quotedInr, 'var(--accent)')}
        </div>
        <div>
          <div style={BAR_LABEL}>
            <span>Order received</span>
            <span>{fmtCr(c.orderReceivedInr)}{c.achievedPct == null ? '' : ` · ${c.achievedPct.toFixed(1)}% ${c.achievedLabel}`}</span>
          </div>
          {bar(c.orderReceivedInr, 'var(--pos)', c.targetInr)}
          <div style={{ ...BAR_LABEL, marginBottom: 0, marginTop: 4 }}>
            <span />
            <span>│ marks {fmtCr(c.targetInr)} — {c.achievedLabel.replace(/^of /, '')}</span>
          </div>
        </div>
      </div>
      {c.outside && <OutsideWindow o={c.outside} />}
    </div>
  );
}

// What the fiscal year does not reach, said in the panel rather than nowhere.
// Amber rather than red: it is not an error, it is work sitting in a year you
// are not looking at, and the FY selector above is how you go and look.
function OutsideWindow({ o }: { o: ExecOutside }) {
  const span = o.oldest && o.newest
    ? (o.oldest === o.newest ? day(o.oldest) : `${day(o.oldest)} to ${day(o.newest)}`)
    : 'no date recorded';
  return (
    <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 6, border: '1px solid var(--warn)',
                  background: 'color-mix(in oklab, var(--warn) 8%, transparent)', fontSize: 11.5, lineHeight: 1.55 }}>
      <DrillCell params={o.drill} style={{ textDecoration: 'none', display: 'block' }}>
        <strong style={{ color: 'var(--warn)' }}>
          {o.opps} {o.opps === 1 ? 'opportunity' : 'opportunities'} worth {fmtCr(o.value)} fall outside this fiscal year
        </strong>
        <span style={{ color: 'var(--fg-3)' }}>
          {' '}and are in no figure on this page{o.openOpps > 0
            ? ` — ${o.openOpps} of them still open, worth ${fmtCr(o.openValue)}`
            : ''}. Dated {span}; change the fiscal year above to see them.
        </span>
      </DrillCell>
    </div>
  );
}

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`)
  .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

// ── Tabs ───────────────────────────────────────────────────────
// Three views of the same review: the person, the account, the forecast.
// Plain links, so a tab is a URL somebody can be sent.
export type ExecTab = 'tsm' | 'account' | 'projection';
export const EXEC_TABS: { key: ExecTab; label: string; hint: string }[] = [
  { key: 'tsm',        label: 'TSM Review',       hint: 'One rep or manager: their book, quotes, turnover, visits' },
  { key: 'account',    label: 'Account Review',   hint: 'A group of mills or a single OEM across the years' },
  { key: 'projection', label: 'Sales Projection', hint: 'Expected closures by rep, month and quarter' },
];
export function ExecTabs({ active, hrefFor }: { active: ExecTab; hrefFor: (t: ExecTab) => string }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)', marginBottom: 16, overflowX: 'auto' }}>
      {EXEC_TABS.map(t => {
        const on = t.key === active;
        return (
          <Link key={t.key} href={hrefFor(t.key)} title={t.hint} style={{
            padding: '10px 16px', fontSize: 13, fontWeight: on ? 600 : 500, textDecoration: 'none', whiteSpace: 'nowrap',
            color: on ? 'var(--accent)' : 'var(--fg-3)', borderBottom: on ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1,
          }}>{t.label}</Link>
        );
      })}
    </div>
  );
}

export function ExecutiveViews({ data, selector, periodLabel, note, tabs }: {
  data: ExecData; selector: ReactNode; periodLabel: string; note?: string; tabs?: ReactNode;
}) {
  // The pictures over the tables. Each is built from the same rows the table
  // shows, so the two cannot disagree; Grand Total rows are left out.
  const body = (t: ExecTable) => t.rows.filter(r => !r.strong);
  // Four parts now, not three: the prospective column is split into the two
  // statuses it always was, and the bar has to agree with the table under it.
  const clientRows = body(data.clientsSummary).map(r => ({ label: r.label, parts: [r.vals[0] ?? 0, r.vals[1] ?? 0, r.vals[2] ?? 0, r.vals[3] ?? 0] }));
  const clientSeries = data.clientsSummary.headers.slice(1, 5);
  const clientColors = (data.clientsSummary.colors ?? []).slice(0, 4).map(c => c ?? 'var(--fg-3)');
  const quoteCats = body(data.quotationSummary).map(r => ({ label: r.label, values: [r.vals[0] ?? 0, r.vals[1] ?? 0] }));
  const turnCats = body(data.turnoverSummary).map(r => ({ label: r.label, values: [r.vals[1] ?? 0, r.vals[2] ?? 0] }));
  const turnClients = body(data.turnoverSummary).map(r => ({ label: r.label, value: r.vals[0] ?? 0 }));
  const offerSlices = body(data.offerStatus).map(r => ({ label: r.label, value: r.vals[0] ?? 0 }));
  const attCats = body(data.attendance).map(r => ({ label: r.label, values: [r.vals[0] ?? 0, r.vals[1] ?? 0] }));
  const [h1, h2] = [data.turnoverSummary.headers[2] ?? 'This FY', data.turnoverSummary.headers[3] ?? 'Last FY'];
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)', margin: 0 }}>Executive Review</h1>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>{periodLabel}</div>
        </div>
        {selector}
      </div>
      {tabs}
      {note && <p style={{ fontSize: 11.5, color: 'var(--fg-3)', margin: '8px 0 0', maxWidth: 900, lineHeight: 1.5 }}>{note}</p>}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.kpis.length}, 1fr)`, gap: 12, margin: '16px 0', alignItems: 'start' }}>
        {data.kpis.map(k => (
          <div key={k.label} style={{ ...PANEL, padding: '13px 15px', ...(k.accent ? { borderLeft: '4px solid var(--title)' } : {}) }}>
            <div style={METRIC_LABEL}>{k.label}</div>
            {k.drill ? (
              <div style={{ marginTop: 4 }}>
                <DrillCell params={k.drill}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--fg)', lineHeight: 1.1 }}>
                  {k.value}
                </DrillCell>
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--fg)', lineHeight: 1.1, marginTop: 4 }}>{k.value}</div>
            )}
            {k.sub && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{k.sub}</div>}
            {k.lines && k.lines.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {k.lines.map(l => {
                  const row = (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 11.5 }}>
                      <span style={{ color: l.color ?? 'var(--fg-3)' }}>{l.label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: l.color ?? 'var(--fg)' }}>{l.value}</span>
                    </div>
                  );
                  return l.drill
                    ? <DrillCell key={l.label} params={l.drill} style={{ display: 'block', width: '100%', textDecoration: 'none' }}>{row}</DrillCell>
                    : <div key={l.label}>{row}</div>;
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {/* First of the tables, because it is the question the review is held to
            answer: against the target, how much did we price and how much of it
            came back. */}
        <MiniTable title="Target & Conversion" note={data.conversion.panelNote} table={data.conversion.table} full
          chart={<ConversionFigures c={data.conversion} />}
          footer={
            <p style={{ fontSize: 11, color: 'var(--fg-3)', margin: 0, lineHeight: 1.55, maxWidth: 900 }}>
              <strong style={{ color: 'var(--fg-2)' }}>Counts:</strong> {data.conversion.includes}{' '}
              <strong style={{ color: 'var(--fg-2)' }}>Leaves out:</strong> {data.conversion.excludes}
            </p>
          } />
        {/* Own book beside covered book, for anyone who manages or covers.
            Shown before the rest because it explains why the rest reads the way
            it does: every other panel on this tab counts the column named in
            the footer, and the Opportunities board counts Combined. */}
        {data.bookSplit && (
          <MiniTable title="Book & Coverage" note={data.bookSplit.note} table={data.bookSplit.table} full
            footer={
              <p style={{ fontSize: 11, color: 'var(--fg-3)', margin: 0, lineHeight: 1.55, maxWidth: 900 }}>
                {data.bookSplit.isManager
                  ? 'A manager carries their own accounts and covers for their team, so both are shown rather than merged. '
                  : 'This person covers accounts they do not own, so both are shown rather than merged. '}
                Every other panel on this tab counts{' '}
                <strong style={{ color: 'var(--fg-2)' }}>
                  {data.bookSplit.scope === 'all' ? 'Combined' : data.bookSplit.scope === 'covered' ? data.bookSplit.coveredLabel : 'Own book'}
                </strong>
                , which the Accounts control above changes. The Opportunities board always counts <strong style={{ color: 'var(--fg-2)' }}>Combined</strong>,
                and so does this tab unless the control is narrowed, so the two agree by default.
                Covering an account is not owning it: the value in &ldquo;Covers for others&rdquo; is counted
                here because this person works those accounts, and credited to the rep who owns them.
              </p>
            } />
        )}
        <MiniTable title="Clients Summary" note="clients by type and status" table={data.clientsSummary}
          chart={<StackedHBars rows={clientRows} series={clientSeries} colors={clientColors} />} />
        <MiniTable title="Quotation Summary" note="₹ by channel" table={data.quotationSummary}
          chart={<GroupedBars cats={quoteCats} series={['Active quotes', 'Order received']} colors={['var(--accent)', 'var(--pos)']} fmt={fmtCr} />} />
        <MiniTable title="Turnover Summary" note="active book only · rows: 5-yr band · cols: whole fiscal years" table={data.turnoverSummary} full
          chart={
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 20 }}>
              <div><div style={CHART_T}>Turnover by band, {h1} vs {h2}</div><GroupedBars cats={turnCats} series={[h1, h2]} colors={['var(--accent)', 'var(--fg-3)']} fmt={fmtCr} height={110} /></div>
              <div><div style={CHART_T}>Clients in each band</div><HBars rows={turnClients} color="var(--pos)" highlightMax /></div>
            </div>
          } />
        {/* Seven slices, not five: Prospect and Suspect have wording now, so the
            donut and the table below it cover every offer rather than the six
            stages that happened to be mapped. */}
        <MiniTable title="Offer Status" note="₹ by opportunity status" table={data.offerStatus}
          chart={<Donut slices={offerSlices} colors={OFFER_COLORS} fmt={fmtCr} />} />
        <MiniTable title="Attendance" note="field visits" table={data.attendance}
          chart={<GroupedBars cats={attCats} series={['Visit days', 'Clients']} colors={['var(--accent)', 'var(--pos)']} height={100} />} />
      </div>
    </section>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--title)' };
const META: CSSProperties = { fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' };
const CHART_T: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 };
const METRIC_LABEL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', fontWeight: 600 };
// One colour per row of OFFER_STATUS_ORDER: not-yet-quoted and parked in the
// cool/neutral end, live work in the accent, the three endings in won/lost/grey.
const OFFER_COLORS = ['#0891B2', '#7C3AED', 'var(--accent)', 'var(--warn)', 'var(--pos)', 'var(--neg)', 'var(--fg-3)'];
const BAR_LABEL: CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-3)', marginBottom: 4, fontFamily: 'var(--font-mono)' };
// The table's own TH / TD moved to ExecMiniTable.tsx with the markup they style.
