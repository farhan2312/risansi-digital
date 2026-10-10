import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { quartersOf, type Projection } from '@/lib/risansi-sales-projection';
import { GroupedBars, HBars, fmtCr } from './ExecCharts';
import { SalesProjectionGrid, type ProjCol, type ProjRow } from './SalesProjectionGrid';

// Expected closures by rep, across the fiscal year.
//
// The coverage band above the table is not a caveat tucked at the bottom. On
// this data only a small share of open pipeline value carries an expected-close
// month, so the periods add up to a fraction of what is actually in play. A
// reader who takes the quarter totals as the forecast would be wrong by the
// inverse of that share, and the number that tells them so has to arrive first.

const cr = (n: number) => (n / 1e7).toFixed(2);

const MONTH_LABEL = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short' })
    + (m === 4 ? ` ${String(y).slice(2)}` : '');
};

export function SalesProjection({ d, mode, hrefFor, filters, subtitle, embedded }: {
  d: Projection;
  mode: 'monthly' | 'quarterly';
  /** Builds the link that switches mode, preserving the page's other params. */
  hrefFor: (mode: 'monthly' | 'quarterly') => string;
  /** The filter bar, rendered under the heading when the section is a tab of its own. */
  filters?: ReactNode;
  subtitle?: string;
  /** On its own tab: no top margin, the heading is the tab's. */
  embedded?: boolean;
}) {
  const quarters = quartersOf(d.months);
  const periods = mode === 'monthly'
    ? d.months.map(m => ({ key: m, label: MONTH_LABEL(m), months: [m] }))
    : quarters.map(q => ({ key: q.label, label: q.label, months: q.months }));

  // Every column the table carries, in order. The three at the end are not
  // periods and are deliberately not summed into the fiscal-year column.
  const TAIL = [
    { key: 'overdue', label: 'Overdue', hint: 'expected month already past' },
    { key: 'later', label: 'Beyond FY', hint: 'expected after March' },
    { key: 'none', label: 'No date', hint: 'no expected month recorded' },
  ];

  const cellOf = (rep: Projection['reps'][number], keys: string[]) =>
    rep.cells.filter(c => keys.includes(c.bucket))
      .reduce((s, c) => ({ gross: s.gross + c.gross, count: s.count + c.count }), { gross: 0, count: 0 });

  const colTotal = (keys: string[]) =>
    d.reps.reduce((s, r) => s + cellOf(r, keys).gross, 0);

  const fyTotal = (rep: Projection['reps'][number]) =>
    cellOf(rep, d.months).gross;

  const c = d.coverage;
  const pct = c.share == null ? 0 : Math.round(c.share * 100);
  const weighted = d.reps.reduce((s, r) => s + r.cells.reduce((a, x) => a + x.weighted, 0), 0);
  const weightedBase = d.reps.reduce((s, r) => s + r.cells.reduce((a, x) => a + x.weightedBase, 0), 0);

  // The periods as a chart: gross beside weighted, the figure over every bar,
  // then the reps ranked by what they expect to land this FY.
  const periodCats = periods.map(p => ({
    label: p.label,
    values: [
      colTotal(p.months),
      d.reps.reduce((s, r) => s + r.cells.filter(x => p.months.includes(x.bucket)).reduce((a, x) => a + x.weighted, 0), 0),
    ],
  }));
  const repBars = d.reps.map(r => ({ label: r.name, value: fyTotal(r) })).filter(r => r.value > 0).slice(0, 10);

  // ── the grid, flattened for the client component that renders it ──
  // Column keys are prefixed because a quarter is called 'Q1' and a tail column
  // 'none', and the two namespaces must not be able to collide.
  const gridCols: ProjCol[] = [
    ...periods.map(p => ({ key: `p:${p.key}`, label: p.label })),
    { key: 'fy', label: 'FY total', rule: true, strong: true },
    ...TAIL.map(t => ({
      key: `t:${t.key}`, label: t.label, hint: t.hint,
      tone: t.key === 'none' ? 'var(--warn-strong, var(--warn))' : 'var(--fg-3)',
      footTone: t.key === 'none' ? 'var(--warn-strong, var(--warn))' : 'var(--fg-2)',
    })),
    { key: 'all', label: 'All open', rule: true, strong: true },
  ];

  const gridRows: ProjRow[] = d.reps.map(rep => {
    const vals: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const p of periods) {
      const v = cellOf(rep, p.months);
      vals[`p:${p.key}`] = v.gross; counts[`p:${p.key}`] = v.count;
    }
    vals.fy = fyTotal(rep); counts.fy = 0;
    for (const t of TAIL) {
      const v = cellOf(rep, [t.key]);
      vals[`t:${t.key}`] = v.gross; counts[`t:${t.key}`] = v.count;
    }
    vals.all = rep.totalGross; counts.all = 0;
    // A rep whose whole book is undated contributes nothing to any period; the
    // row would otherwise read as "no pipeline".
    const undated = cellOf(rep, ['none']).gross;
    return {
      id: String(rep.repId), name: rep.name, vals, counts,
      note: rep.totalGross > 0 && undated === rep.totalGross ? 'nothing dated' : undefined,
    };
  });

  const gridTotals: Record<string, number> = { fy: colTotal(d.months), all: d.reps.reduce((s, r) => s + r.totalGross, 0) };
  for (const p of periods) gridTotals[`p:${p.key}`] = colTotal(p.months);
  for (const t of TAIL) gridTotals[`t:${t.key}`] = colTotal([t.key]);

  return (
    <section style={{ marginTop: embedded ? 0 : 26 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--fg)', margin: 0 }}>Sales Projection</h2>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 2 }}>
            {subtitle ?? `Expected closures by rep · FY ${String(d.fyStart).slice(2)}-${String(d.fyStart + 1).slice(2)} · open pipeline only`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 2, border: '1px solid var(--line-strong)', borderRadius: 7, overflow: 'hidden' }}>
          {(['quarterly', 'monthly'] as const).map(m => (
            <Link
              key={m} href={hrefFor(m)} aria-current={mode === m}
              style={{
                padding: '6px 14px', fontSize: 12.5, textDecoration: 'none',
                fontWeight: mode === m ? 600 : 400,
                background: mode === m ? 'var(--accent)' : 'var(--bg-paper)',
                color: mode === m ? '#fff' : 'var(--fg-2)',
              }}
            >{m === 'quarterly' ? 'Quarterly' : 'Monthly'}</Link>
          ))}
        </div>
      </div>

      {/* ── how much of the pipeline this table can actually place ── */}
      <div style={{
        display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center',
        padding: '11px 14px', marginBottom: 10,
        background: pct >= 60 ? 'var(--bg-elev)' : 'var(--warn-soft)',
        border: `1px solid ${pct >= 60 ? 'var(--line)' : 'var(--warn)'}`,
        borderRadius: 'var(--radius)',
      }}>
        <div>
          <div style={LBL}>Open pipeline</div>
          <div style={BIG}>₹{cr(c.openGross)} Cr</div>
          <div style={SUB}>{c.openCount.toLocaleString('en-IN')} opportunities</div>
        </div>
        <div>
          <div style={LBL}>Has an expected month</div>
          <div style={{ ...BIG, color: pct >= 60 ? 'var(--fg)' : 'var(--warn-strong, var(--warn))' }}>
            ₹{cr(c.datedGross)} Cr
          </div>
          <div style={SUB}>{pct}% of value · {c.datedCount} of {c.openCount} opportunities</div>
        </div>
        <div>
          <div style={LBL}>Weighted by probability</div>
          <div style={BIG}>₹{cr(weighted)} Cr</div>
          <div style={SUB}>
            {c.openGross > 0 ? Math.round((weightedBase / c.openGross) * 100) : 0}% of open value carries a probability
          </div>
        </div>
        {pct < 60 && (
          <div style={{ flex: '1 1 250px', minWidth: 220, fontSize: 11.5, color: 'var(--warn-strong, var(--warn))', lineHeight: 1.5 }}>
            <strong>The periods below are not the pipeline.</strong> {100 - pct}% of open value has no
            expected-close month, so it sits in <em>No date</em> and is projected into no quarter at all.
            Fill Expected Close on the opportunities to move it into the forecast.
          </div>
        )}
      </div>

      {filters}

      {/* The picture of the forecast, before the grid. */}
      {d.reps.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 12, marginBottom: 12 }}>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--bg-paper)', padding: '12px 14px' }}>
            <div style={CH_T}>Expected to close, by {mode === 'monthly' ? 'month' : 'quarter'}</div>
            <GroupedBars cats={periodCats} series={['Gross', 'Weighted by probability']} colors={['var(--accent)', 'var(--pos)']} fmt={fmtCr} height={120} />
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--bg-paper)', padding: '12px 14px' }}>
            <div style={CH_T}>By rep · dated within the FY</div>
            {repBars.length ? <HBars rows={repBars} fmt={fmtCr} highlightMax /> : <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Nothing dated within the FY.</div>}
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--bg-paper)' }}>
        {/* The grid is a client component so its headers can sort; everything
            above it stays on the server. */}
        <SalesProjectionGrid
          cols={gridCols}
          rows={gridRows}
          totals={gridTotals}
          emptyNote="No open opportunities for the reps you can see."
        />
      </div>

      <p style={{ fontSize: 11, color: 'var(--fg-3)', margin: '8px 0 0', maxWidth: 900, lineHeight: 1.55 }}>
        Figures are ₹ Crores, gross offer value, from the opportunity&apos;s Expected Close month.
        Open means every stage except Won, Lost and Dropped; a deal is credited to the rep on the
        opportunity. <strong>Overdue</strong> is an expected month that has already passed — it is still
        open, so it is still counted, just not in a future period. <strong>FY total</strong> covers April
        to March and deliberately excludes Overdue, Beyond FY and No date, which is why it is smaller
        than All open. Nothing here infers a date from anything else: an opportunity with no Expected
        Close stays in No date rather than being guessed into a quarter.
      </p>
    </section>
  );
}

const CH_T: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 };
// The grid's own TH / TD / NUM moved to SalesProjectionGrid.tsx with the markup
// they style.
const LBL: CSSProperties = { fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--fg-3)' };
const BIG: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 700, lineHeight: 1.2, marginTop: 2 };
const SUB: CSSProperties = { fontSize: 10.5, color: 'var(--fg-3)', marginTop: 1 };
