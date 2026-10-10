import type { CSSProperties } from 'react';

// Visuals for the Executive Review, drawn in CSS and SVG with the number on
// every mark — a bar without its figure sends the reader back to the table.
// Server-rendered; no state, no library. Colours come from the tokens so
// they hold in dark mode.

const inr = (n: number) => n.toLocaleString('en-IN');
export const fmtCr = (rupees: number) => (rupees >= 1e7 ? `₹${(rupees / 1e7).toFixed(rupees >= 1e8 ? 1 : 2)} Cr` : rupees >= 1e5 ? `₹${(rupees / 1e5).toFixed(1)} L` : `₹${inr(Math.round(rupees))}`);

export const SERIES = ['var(--accent)', 'var(--pos)', 'var(--warn)', 'var(--neg)', '#7C3AED', '#0891B2', '#DB2777', 'var(--fg-3)'];

// ── Stacked horizontal bars ────────────────────────────────────
// One row per category, segments side by side, each segment labelled with its
// number when it is wide enough to hold one; the row total at the end.

export interface StackRow { label: string; parts: number[] }
export function StackedHBars({ rows, series, colors = SERIES, fmt = inr }: {
  rows: StackRow[]; series: string[]; colors?: string[]; fmt?: (n: number) => string;
}) {
  const totals = rows.map(r => r.parts.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r, i) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={LBL}>{r.label}</span>
          <div style={{ flex: 1, height: 20, display: 'flex', borderRadius: 4, overflow: 'hidden', background: 'var(--bg-sunk)' }}>
            {r.parts.map((p, j) => {
              const w = (p / max) * 100;
              return p > 0 ? (
                <div key={j} title={`${series[j]}: ${fmt(p)}`} style={{ width: `${w}%`, background: colors[j % colors.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--font-mono)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {w >= 7 ? fmt(p) : ''}
                </div>
              ) : null;
            })}
          </div>
          <span style={{ ...NUM, width: 56 }}>{fmt(totals[i])}</span>
        </div>
      ))}
      <Legend items={series.map((s, j) => [s, colors[j % colors.length]])} />
    </div>
  );
}

// ── Grouped vertical bars ──────────────────────────────────────
// Categories along the bottom, one bar per series in each, the figure above
// every bar. For "quoted vs won by channel", "visits and clients by month".

export interface GroupCat { label: string; values: number[] }
export function GroupedBars({ cats, series, colors = SERIES, fmt = inr, height = 120 }: {
  cats: GroupCat[]; series: string[]; colors?: string[]; fmt?: (n: number) => string; height?: number;
}) {
  const max = Math.max(...cats.flatMap(c => c.values), 1);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: cats.length > 8 ? 4 : 10, height: height + 34 }}>
        {cats.map(c => (
          <div key={c.label} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
            <div style={{ display: 'flex', gap: 2, width: '100%', alignItems: 'flex-end', height }}>
              {c.values.map((v, j) => (
                <div key={j} title={`${c.label} · ${series[j]}: ${fmt(v)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 600, fontFamily: 'var(--font-mono)', color: v ? 'var(--fg)' : 'var(--fg-4)', whiteSpace: 'nowrap' }}>{v ? fmt(v) : '—'}</span>
                  <div style={{ width: '100%', height: Math.max((v / max) * (height - 16), v ? 3 : 0), background: `color-mix(in oklab, ${colors[j % colors.length]} 28%, transparent)`, borderTop: `3px solid ${colors[j % colors.length]}`, borderRadius: '3px 3px 0 0' }} />
                </div>
              ))}
            </div>
            <span style={{ fontSize: 10, color: 'var(--fg-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{c.label}</span>
          </div>
        ))}
      </div>
      <Legend items={series.map((s, j) => [s, colors[j % colors.length]])} />
    </div>
  );
}

// ── Donut ──────────────────────────────────────────────────────
// Share of a whole, the total in the middle, every slice named with its value
// and share in the list beside it — the list is the data label, since text on
// a thin slice is unreadable.

export interface Slice { label: string; value: number }
export function Donut({ slices, colors = SERIES, fmt = inr, size = 150 }: { slices: Slice[]; colors?: string[]; fmt?: (n: number) => string; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 44, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="share of total">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-sunk)" strokeWidth={12} />
        {total > 0 && slices.map((s, i) => {
          const frac = s.value / total, dash = frac * circ, off = -acc * circ;
          acc += frac;
          return s.value > 0 ? (
            <circle key={s.label} cx={cx} cy={cy} r={r} fill="none" stroke={colors[i % colors.length]} strokeWidth={12}
              strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={off} transform={`rotate(-90 ${cx} ${cy})`}>
              <title>{`${s.label}: ${fmt(s.value)} · ${Math.round(frac * 100)}%`}</title>
            </circle>
          ) : null;
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" style={{ fontSize: 9, fontWeight: 700, fill: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{total ? fmt(total) : '—'}</text>
        <text x={cx} y={cy + 9} textAnchor="middle" style={{ fontSize: 5.5, fill: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>total</text>
      </svg>
      <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {slices.map((s, i) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: colors[i % colors.length], flexShrink: 0 }} />
            <span style={{ flex: 1, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
            <span style={{ ...NUM, width: 'auto' }}>{s.value ? fmt(s.value) : '—'}</span>
            <span style={{ width: 34, textAlign: 'right', fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{total && s.value ? `${Math.round((s.value / total) * 100)}%` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Simple horizontal bars ─────────────────────────────────────

export function HBars({ rows, color = 'var(--accent)', fmt = inr, highlightMax }: { rows: Slice[]; color?: string; fmt?: (n: number) => string; highlightMax?: boolean }) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={LBL}>{r.label}</span>
          <div style={{ flex: 1, height: 16, borderRadius: 4, background: 'var(--bg-sunk)', overflow: 'hidden' }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: highlightMax && r.value === max ? color : `color-mix(in oklab, ${color} 65%, transparent)` }} />
          </div>
          <span style={{ ...NUM, width: 72 }}>{r.value ? fmt(r.value) : '—'}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10, color: 'var(--fg-3)', marginTop: 8 }}>
      {items.map(([l, c]) => <span key={l}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c, marginRight: 4, verticalAlign: 'middle' }} />{l}</span>)}
    </div>
  );
}

const LBL: CSSProperties = { width: 110, flexShrink: 0, fontSize: 11.5, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const NUM: CSSProperties = { flexShrink: 0, textAlign: 'right', fontSize: 11.5, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--fg)' };
