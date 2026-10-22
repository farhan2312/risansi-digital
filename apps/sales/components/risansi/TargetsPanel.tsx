import type { CSSProperties } from 'react';
import { METRIC_DEFS, type TargetMetric, type TargetSet } from '@/lib/risansi-rep-targets';

// Target vs Achieved, for the three things a rep is measured on.
//
// ── Why the year's progress is on it ────────────────────────────
//
// A target dashboard opened in July that shows "28% achieved" against a bar
// ending at 100% is telling somebody they are failing when they are exactly
// on pace. Every figure here is held against how much of the financial year
// has actually gone, and the verdict says on track or behind rather than
// leaving the reader to do the arithmetic. The faint marker on each bar is
// where the year is; the fill is where the person is.
//
// ── What a blank target means ───────────────────────────────────
//
// Nothing, deliberately. No bar, no percentage, no "0%" — a target of nothing
// is not a bar anybody can clear, and showing 0% against it reads as failure
// rather than as a target that was never set. The count is still shown,
// because what somebody has done is true whether or not anyone set a number.

export interface TargetEntry {
  label: string;
  /** Shown under the label — "5 reps", "your own accounts". */
  sub?: string | null;
  target: TargetSet;
  achieved: Record<TargetMetric, number>;
}

const fmtCr = (n: number) => `₹${n.toFixed(2)} Cr`;
const fmtCount = (n: number) => n.toLocaleString('en-IN');
const fmt = (metric: TargetMetric, n: number) => (metric === 'revenue_cr' ? fmtCr(n) : fmtCount(n));

/** Behind by more than a tenth of the year's pace is "behind". The slack stops
 *  a dashboard flipping between verdicts on a single visit being logged. */
function verdict(pct: number, elapsedPct: number): { text: string; color: string } {
  if (elapsedPct <= 0) return { text: 'year not started', color: 'var(--fg-3)' };
  if (pct >= 100) return { text: 'target met', color: 'var(--pos)' };
  if (pct >= elapsedPct * 0.9) return { text: 'on track', color: 'var(--pos)' };
  return { text: 'behind pace', color: 'var(--warn-strong)' };
}

function Metric({ metric, target, achieved, elapsedPct }: {
  metric: TargetMetric; target: number | null; achieved: number; elapsedPct: number;
}) {
  const def = METRIC_DEFS.find(d => d.key === metric)!;
  const pct = target && target > 0 ? (achieved / target) * 100 : null;
  const v = pct == null ? null : verdict(pct, elapsedPct);

  return (
    <div style={CELL} title={def.hint}>
      <div style={LABEL}>{def.label}</div>
      <div style={VALUE}>
        {fmt(metric, achieved)}
        {target != null && <span style={OF}> / {fmt(metric, target)}</span>}
      </div>

      {pct == null ? (
        <div style={{ ...NOTE, color: 'var(--fg-3)' }}>no target set</div>
      ) : (
        <>
          <div style={BAR}>
            <div style={{ ...BAR_FILL, width: `${Math.min(pct, 100)}%`, background: v!.color }} />
            {/* Where the year is. Sits on top of the fill so "ahead of pace"
                is visible as fill past the marker rather than inferred. */}
            <div style={{ ...BAR_MARK, left: `${Math.min(elapsedPct, 100)}%` }} />
          </div>
          <div style={{ ...NOTE, color: v!.color }}>
            {pct.toFixed(0)}% · {v!.text}
          </div>
        </>
      )}
    </div>
  );
}

export function TargetsPanel({ fyLabel, elapsedPct, entries }: {
  fyLabel: string;
  /** 0..100, how much of the financial year has gone. */
  elapsedPct: number;
  entries: TargetEntry[];
}) {
  if (entries.length === 0) return null;
  return (
    <div style={PANEL}>
      <div style={HEAD}>
        <span>Targets · {fyLabel}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--fg-3)' }}>
          {elapsedPct.toFixed(0)}% of the year gone
        </span>
      </div>
      <div style={{ padding: '4px 0' }}>
        {entries.map((e, i) => (
          <div key={e.label} style={{ padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{e.label}</span>
              {e.sub && <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 8 }}>{e.sub}</span>}
            </div>
            <div className="tgt-grid" style={GRID}>
              {METRIC_DEFS.map(d => (
                <Metric
                  key={d.key} metric={d.key}
                  target={e.target[d.key]} achieved={e.achieved[d.key] ?? 0}
                  elapsedPct={elapsedPct}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)', marginBottom: 14, overflow: 'hidden',
};
const HEAD: CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '10px 16px',
  background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)',
  fontSize: 12, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const GRID: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 18,
};
const CELL: CSSProperties = { minWidth: 0 };
const LABEL: CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
};
const VALUE: CSSProperties = {
  fontSize: 17, fontWeight: 700, color: 'var(--fg)',
  fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
};
const OF: CSSProperties = { fontSize: 12, fontWeight: 500, color: 'var(--fg-3)' };
const BAR: CSSProperties = {
  position: 'relative', marginTop: 7, height: 6,
  background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden',
};
const BAR_FILL: CSSProperties = { height: '100%', borderRadius: 3 };
const BAR_MARK: CSSProperties = {
  position: 'absolute', top: -1, bottom: -1, width: 2,
  background: 'var(--fg-3)', opacity: 0.55,
};
const NOTE: CSSProperties = {
  fontSize: 11, marginTop: 5, fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
};
