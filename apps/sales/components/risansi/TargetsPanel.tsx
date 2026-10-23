import type { CSSProperties } from 'react';
import { METRIC_DEFS, type TargetMetric, type TargetSet } from '@/lib/risansi-target-metrics';

// Target vs Achieved, as a table.
//
// It was three stacked metric blocks per person, which for sixteen people was
// a page of its own standing between the reader and the dashboard. One row
// each now - at ~28px a person the whole thing is short enough to stay open,
// so there is no disclosure to operate and no state to hold. The header keeps
// the leading figure beside the title as a summary, not as a substitute.
//
// The faint notch on each bar is where the YEAR is; the fill is where the
// person is. A dashboard showing "28% achieved" against a bar ending at 100%
// tells somebody they are failing when they are exactly on pace.
//
// A blank target shows the count and no bar. A target of nothing is not a bar
// anybody can clear, and 0% against it reads as failure rather than as a
// target nobody set.

export interface TargetEntry {
  label: string;
  sub?: string | null;
  target: TargetSet;
  achieved: Record<TargetMetric, number>;
}

const RS = '₹';
const fmtCr = (n: number) => RS + n.toFixed(2);
const fmtVal = (m: TargetMetric, n: number) =>
  m === 'revenue_cr' ? fmtCr(n) : n.toLocaleString('en-IN');

function verdict(pct: number, elapsed: number): { text: string; color: string } {
  if (elapsed <= 0) return { text: 'not started', color: 'var(--fg-3)' };
  if (pct >= 100) return { text: 'met', color: 'var(--pos)' };
  if (pct >= elapsed * 0.9) return { text: 'on track', color: 'var(--pos)' };
  return { text: 'behind', color: 'var(--warn-strong)' };
}

/** One metric in one row: figure, target, share, and a 3px bar. */
function Cell({ metric, target, achieved, elapsedPct }: {
  metric: TargetMetric;
  target: number | null;
  achieved: number;
  elapsedPct: number;
}) {
  const pct = target && target > 0 ? (achieved / target) * 100 : null;
  const v = pct === null ? null : verdict(pct, elapsedPct);
  return (
    <td style={CELL}>
      <div style={ROW_INNER}>
        <span style={FIG}>{fmtVal(metric, achieved)}</span>
        {target !== null && <span style={OF}>/ {fmtVal(metric, target)}</span>}
        <span style={{ ...PCTS, color: v ? v.color : 'var(--fg-4)' }}>
          {pct === null || !v ? 'no target' : pct.toFixed(0) + '% ' + v.text}
        </span>
      </div>
      {pct !== null && v && (
        <div style={BAR}>
          <div style={{ ...BAR_FILL, width: Math.min(pct, 100) + '%', background: v.color }} />
          <div style={{ ...BAR_MARK, left: Math.min(elapsedPct, 100) + '%' }} />
        </div>
      )}
    </td>
  );
}

export function TargetsPanel({ fyLabel, elapsedPct, entries }: {
  fyLabel: string;
  elapsedPct: number;
  entries: TargetEntry[];
}) {
  if (entries.length === 0) return null;

  const head = entries[0];
  const hTarget = head.target.revenue_cr;
  const headPct = hTarget && hTarget > 0 ? (head.achieved.revenue_cr / hTarget) * 100 : null;
  const hv = headPct === null ? null : verdict(headPct, elapsedPct);

  return (
    <div style={PANEL}>
      <div style={HEAD}>
        <span>Targets &middot; {fyLabel}</span>
        {/* The leading row's figure, said once on the header: "how are we
            doing" before the table answers "who is doing it". */}
        {headPct !== null && hTarget !== null && hv && (
          <span style={SUMMARY}>
            {head.label} {fmtCr(head.achieved.revenue_cr)} / {fmtCr(hTarget)} Cr
            <span style={{ color: hv.color, marginLeft: 6 }}>
              {headPct.toFixed(0)}% {hv.text}
            </span>
          </span>
        )}
        <span style={YEAR}>{elapsedPct.toFixed(0)}% of the year gone</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: 'left' }}>Person</th>
              {METRIC_DEFS.map(d => (
                <th key={d.key} style={TH} title={d.hint}>{d.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const isTotal = i === 0 && entries.length > 1;
              return (
                <tr key={e.label} style={isTotal ? TOTAL_ROW : undefined}>
                  <td style={{ ...CELL, whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 12, fontWeight: isTotal ? 700 : 500, color: 'var(--fg)' }}>
                      {e.label}
                    </span>
                    {e.sub && <span style={SUB}>{e.sub}</span>}
                  </td>
                  {METRIC_DEFS.map(d => (
                    <Cell
                      key={d.key}
                      metric={d.key}
                      target={e.target[d.key]}
                      achieved={e.achieved[d.key] ?? 0}
                      elapsedPct={elapsedPct}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  marginBottom: 14,
  overflow: 'hidden',
};
const HEAD: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  padding: '7px 14px', background: 'var(--bg-elev)',
  borderBottom: '1px solid var(--line)',
  fontSize: 11, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const SUMMARY: CSSProperties = {
  fontSize: 11, fontWeight: 500, textTransform: 'none', letterSpacing: 0,
  color: 'var(--fg-2)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
};
const YEAR: CSSProperties = {
  marginLeft: 'auto', fontSize: 10, fontWeight: 500, textTransform: 'none',
  letterSpacing: 0, color: 'var(--fg-3)', whiteSpace: 'nowrap',
};
const TH: CSSProperties = {
  fontSize: 9, fontWeight: 700, color: 'var(--fg-3)', textAlign: 'left',
  textTransform: 'uppercase', letterSpacing: '0.04em',
  padding: '5px 14px 3px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
};
const CELL: CSSProperties = {
  padding: '4px 14px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle',
};
const TOTAL_ROW: CSSProperties = { background: 'var(--bg-sunk)' };
const ROW_INNER: CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap',
};
const SUB: CSSProperties = { fontSize: 10, color: 'var(--fg-3)', marginLeft: 6 };
const FIG: CSSProperties = {
  fontSize: 12, fontWeight: 700, color: 'var(--fg)',
  fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
};
const OF: CSSProperties = { fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' };
const PCTS: CSSProperties = { fontSize: 10, fontFamily: 'var(--font-mono)', marginLeft: 'auto' };
const BAR: CSSProperties = {
  position: 'relative', marginTop: 2, height: 3,
  background: 'var(--bg-sunk)', borderRadius: 2, overflow: 'hidden', minWidth: 96,
};
const BAR_FILL: CSSProperties = { height: '100%', borderRadius: 2 };
const BAR_MARK: CSSProperties = {
  position: 'absolute', top: 0, bottom: 0, width: 1.5,
  background: 'var(--fg-3)', opacity: 0.6,
};
