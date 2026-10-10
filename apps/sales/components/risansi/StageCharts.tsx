// Chart primitives for the per-stage dashboards.
//
// Hand-rolled SVG/CSS, matching the rest of the app (Donut, ForecastBar,
// MiniBars) rather than pulling in a charting library for four shapes. All of
// them are server-renderable — no hooks, no client boundary — so a stage page
// stays one round trip.
//
// Every one of them takes a `total` or renders an explicit "no data" state,
// because several of these charts sit over columns that are mostly unfilled
// (lost_reason is set on 2 of 11 Lost; drop_reason on 0 of 16). Silently drawing
// an empty chart would read as "nothing lost to competitors" rather than
// "nobody recorded it".

import type { CSSProperties, ReactNode } from 'react';
import { CHART_COLORS, type ClosureSlice, type ClosureTone, type RepCoverage } from '@/lib/risansi-stage-dashboard';

export interface Slice { label: string; count: number; value: number }

const fmtCrShort = (cr: number) => `₹${cr.toFixed(cr >= 10 ? 1 : 2)} Cr`;

// ── Click to filter ────────────────────────────────────────────
// Every chart takes an optional `hrefFor(label)` and `selected`. With hrefFor
// each bar is a link that toggles that bar's selection in the URL, and the page
// re-renders with the rest of the visuals and the table narrowed to it. When a
// selection is active on this chart, the chosen bar stays lit and the others
// step back — the chart itself is not filtered, so the choice can be undone.
// Plain anchors, no client state: the URL is the state, and it rides into the
// Excel export unchanged.

export interface Pickable {
  hrefFor?: (label: string) => string;
  selected?: string | null;
}

/** Opacity for a bar given the chart's selection: full when chosen or nothing is chosen, dimmed otherwise. */
const dim = (label: string, selected?: string | null) => (selected && selected !== label ? 0.38 : 1);

/** Wrap a bar in a link when the chart is pickable. */
function Pick({ href, label, selected, style, children, title }: {
  href?: string; label: string; selected?: string | null; style?: CSSProperties; children: ReactNode; title?: string;
}) {
  const chosen = selected === label;
  const base: CSSProperties = {
    ...style, opacity: dim(label, selected), transition: 'opacity 120ms',
    ...(chosen ? { outline: '2px solid var(--accent)', outlineOffset: 2, borderRadius: 6 } : {}),
  };
  if (!href) return <div style={base} title={title}>{children}</div>;
  return (
    <a href={href} title={title ?? (chosen ? 'Click to clear this filter' : 'Click to filter the page to this')}
      style={{ ...base, color: 'inherit', textDecoration: 'none', cursor: 'pointer' }}>
      {children}
    </a>
  );
}

// ── Panel wrapper ──────────────────────────────────────────────

export function ChartPanel({ title, sub, children, note, action }: {
  title: string; sub?: string; children: ReactNode; note?: string;
  /** A control in the panel header — a zoom switch, say. Sits after `sub`. */
  action?: ReactNode;
}) {
  return (
    <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column' }}>
      {/* wrap + rowGap: with an `action` in it, the header is title + count +
          a control, which does not fit one line in a one-column phone panel. */}
      <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', rowGap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500 }}>{title}</span>
        {sub && <span style={{ fontSize: 10.5, color: 'var(--fg-3)', marginLeft: 'auto' }}>{sub}</span>}
        {action && <span style={{ marginLeft: sub ? 0 : 'auto' }}>{action}</span>}
      </div>
      <div style={{ padding: 14, flex: 1 }}>{children}</div>
      {note && (
        <div style={{ padding: '0 14px 11px', fontSize: 10.5, color: 'var(--fg-3)', fontStyle: 'italic' }}>{note}</div>
      )}
    </div>
  );
}

export function NoData({ msg }: { msg: string }) {
  return (
    <div style={{
      padding: '22px 12px', textAlign: 'center', fontSize: 11.5, color: 'var(--fg-3)',
      background: 'var(--bg-sunk)', border: '1px dashed var(--line-strong)', borderRadius: 7,
    }}>
      {msg}
    </div>
  );
}

// ── Horizontal bar list ────────────────────────────────────────
// The workhorse: product mix, market split, top reps, top clients, lost reasons.
// Bars are scaled by VALUE but every row shows its count too, because "3 deals
// worth ₹18 Cr" and "180 deals worth ₹18 Cr" are different situations and a bar
// alone can't tell them apart.

export function BarList({ rows, metric = 'value', max: maxIn, emptyMsg, hrefFor, selected }: {
  rows: Slice[];
  /** Which number sets the bar length. Counts suit "how many", value suits "how much". */
  metric?: 'value' | 'count';
  max?: number;
  emptyMsg?: string;
} & Pickable) {
  if (!rows.length) return <NoData msg={emptyMsg ?? 'Nothing to show for this stage yet.'} />;
  const pick = (r: Slice) => (metric === 'count' ? r.count : r.value);
  const max = maxIn ?? Math.max(...rows.map(pick), 0.0001);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map((r, i) => {
        const pct = Math.max((pick(r) / max) * 100, 1.5);
        const hue = CHART_COLORS[i % CHART_COLORS.length];
        return (
          <Pick key={r.label} href={hrefFor?.(r.label)} label={r.label} selected={selected}
            style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{
              width: 118, flexShrink: 0, fontSize: 11, color: 'var(--fg-2)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={r.label}>{r.label}</span>
            <div style={{ flex: 1, height: 16, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden', minWidth: 40 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: `${hue}2E`, borderLeft: `3px solid ${hue}` }} />
            </div>
            <span style={{ width: 42, flexShrink: 0, textAlign: 'right', fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {r.count}
            </span>
            <span style={{ width: 74, flexShrink: 0, textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>
              {fmtCrShort(r.value)}
            </span>
          </Pick>
        );
      })}
    </div>
  );
}

// ── Ageing columns ─────────────────────────────────────────────
// Vertical bars, because ageing is ordered and the eye should read left-to-right
// as "getting worse". The 90d+ column is tinted red on stages where age is a
// problem rather than a fact.

// Labels: the rupee value sits on top of the column and the count under the
// label. Money is what the eye should land on first; how many quotes make it up
// is the qualifier. (It was the other way round, and read as a count chart.)
export function AgeingBars({ buckets, warnFrom = 2, height = 130, hrefFor, selected }: {
  buckets: Slice[];
  /** Index from which a bucket is coloured as a warning. */
  warnFrom?: number;
  height?: number;
} & Pickable) {
  const max = Math.max(...buckets.map(b => b.count), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: height + 44 }}>
      {buckets.map((b, i) => {
        const h   = Math.max((b.count / max) * height, b.count > 0 ? 3 : 0);
        const hue = b.label === 'No date' ? 'var(--fg-3)' : i >= warnFrom ? 'var(--neg)' : 'var(--accent)';
        return (
          <Pick key={b.label} href={hrefFor?.(b.label)} label={b.label} selected={selected}
            title={`${b.label} — ${b.count} · ${fmtCrShort(b.value)}`}
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)', whiteSpace: 'nowrap' }}>{fmtCrShort(b.value)}</span>
            <div style={{
              width: '100%', height: h, background: `color-mix(in oklab, ${hue} 22%, transparent)`,
              borderTop: `3px solid ${hue}`, borderRadius: '3px 3px 0 0',
            }} />
            <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{b.label}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{b.count}</span>
          </Pick>
        );
      })}
    </div>
  );
}

// ── Target-closure columns ─────────────────────────────────────
// The forward-looking twin of AgeingBars. Sized by VALUE, not count, because
// "when does the money land" is the question; the count sits on top so a month
// made of one big quote and a month made of forty small ones read differently.
// Each column carries its own tone — late, this month, ahead, later, undated —
// so the chart needs no legend.

const TONE: Record<ClosureTone, string> = {
  overdue: 'var(--neg)',
  actual:  'var(--pos)',
  missing: 'var(--fg-4)',
  now:     'var(--accent)',
  ahead:   'var(--accent)',
  later:   'color-mix(in oklab, var(--accent) 55%, var(--fg-3))',
  none:    'var(--fg-3)',
};
const isActualTone = (t: ClosureTone) => t === 'actual' || t === 'missing';
const fmtCrTight = (cr: number) => `₹${cr.toFixed(cr >= 10 ? 0 : 1)}Cr`;

export function ClosureBars({ buckets, height = 110, hrefFor, selected }: { buckets: ClosureSlice[]; height?: number } & Pickable) {
  // The undated pile is drawn as a strip underneath, not as a column: at 588 of
  // 704 quotes it is four times the biggest month, and as a column it flattened
  // every month into a sliver. The strip keeps it visible and keeps the months
  // legible; the two together still account for every row.
  // Closed months of the FY (tone actual / missing) are drawn on the same
  // scale but are revenue, not quotes: they are left out of the dated totals
  // and are not pickable, since no quote row belongs to them.
  const drawn   = buckets.filter(b => b.tone !== 'none');
  const dated   = drawn.filter(b => !isActualTone(b.tone));
  const hasActuals = drawn.some(b => isActualTone(b.tone));
  const undated = buckets.find(b => b.tone === 'none');
  const datedCr = dated.reduce((s, b) => s + b.value, 0);
  const datedN  = dated.reduce((s, b) => s + b.count, 0);
  const max = Math.max(...drawn.map(b => b.value), 0.0001);
  const tight = drawn.length > 9;
  const fmt = tight ? fmtCrTight : fmtCrShort;
  return (
    <div>
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: tight ? 5 : 8, height: height + 44 }}>
      {drawn.map(b => {
        const h   = Math.max((b.value / max) * height, b.count > 0 ? 3 : 0);
        const hue = TONE[b.tone];
        const strong = b.tone === 'now' || b.tone === 'overdue';
        const actual = isActualTone(b.tone);
        const title = b.tone === 'actual' ? `${b.label} — invoiced ${fmtCrShort(b.value)} across ${b.count} client${b.count === 1 ? '' : 's'}`
          : b.tone === 'missing' ? `${b.label} — revenue not uploaded yet`
          : `${b.label} — ${b.count} quote${b.count === 1 ? '' : 's'} · ${fmtCrShort(b.value)}`;
        return (
          <Pick key={b.label} href={actual ? undefined : hrefFor?.(b.label)} label={b.label} selected={selected} title={title}
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
            <span style={{ fontSize: tight ? 9.5 : 10.5, fontWeight: 600, fontFamily: 'var(--font-mono)', color: b.count ? (b.tone === 'actual' ? 'var(--pos)' : 'var(--fg)') : 'var(--fg-4)', whiteSpace: 'nowrap' }}>
              {b.count ? fmt(b.value) : b.tone === 'missing' ? '…' : '—'}
            </span>
            <div style={{
              width: '100%', height: h,
              background: `color-mix(in oklab, ${hue} ${strong ? 30 : 20}%, transparent)`,
              borderTop: `3px solid ${hue}`, borderRadius: '3px 3px 0 0',
            }} />
            <span style={{ fontSize: tight ? 9.5 : 10, color: strong ? 'var(--fg-2)' : 'var(--fg-3)', fontWeight: strong ? 600 : 400, whiteSpace: 'nowrap' }}>{tight ? b.label.replace(/ \d\d$/, '') : b.label}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{b.count}</span>
          </Pick>
        );
      })}
    </div>
    {hasActuals && (
      <div style={{ display: 'flex', gap: 12, fontSize: 9.5, color: 'var(--fg-3)', marginTop: 6 }}>
        <span><Sw c="var(--pos)" /> invoiced (closed months)</span>
        <span><Sw c="var(--accent)" /> projected from quotes</span>
        <span><Sw c="var(--neg)" /> overdue</span>
        <span><Sw c="var(--fg-4)" /> … not uploaded</span>
      </div>
    )}
    {undated && (undated.count > 0 || datedN > 0) && (
      <Pick href={hrefFor?.('No date')} label="No date" selected={selected} style={{ marginTop: 12, display: 'block' }}
        title={`No date — ${undated.count} quote${undated.count === 1 ? '' : 's'} · ${fmtCrShort(undated.value)}`}>
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-sunk)' }}>
          <div style={{ width: `${(datedCr / Math.max(datedCr + undated.value, 0.0001)) * 100}%`, background: 'var(--accent)' }} />
          <div style={{ flex: 1, background: 'color-mix(in oklab, var(--fg-3) 45%, transparent)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
          <span><span style={{ color: 'var(--fg-2)', fontWeight: 600 }}>{datedN}</span> dated · {fmtCrShort(datedCr)}</span>
          <span><span style={{ color: 'var(--fg-2)', fontWeight: 600 }}>{undated.count}</span> no date · {fmtCrShort(undated.value)}</span>
        </div>
      </Pick>
    )}
    </div>
  );
}

const Sw = ({ c }: { c: string }) => <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c, marginRight: 3, verticalAlign: 'middle' }} />;

// ── Coverage list ──────────────────────────────────────────────
// How much of each person's book carries a target month. A filled fraction of
// a bar rather than a bar length, because the question is "what share", and
// the absolute numbers ride alongside so 3 of 3 and 26 of 85 are not confused.

export function CoverageList({ rows, limit = 8, hrefFor, selected }: { rows: RepCoverage[]; limit?: number } & Pickable) {
  if (!rows.length) return <NoData msg="Nothing to show for this stage yet." />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.slice(0, limit).map(r => {
        const pct = r.total ? (r.dated / r.total) * 100 : 0;
        const hue = pct >= 60 ? 'var(--pos)' : pct >= 25 ? 'var(--accent)' : 'var(--neg)';
        return (
          <Pick key={r.label} href={hrefFor?.(r.label)} label={r.label} selected={selected}
            style={{ display: 'flex', alignItems: 'center', gap: 9 }}
            title={`${r.label}: ${r.dated} of ${r.total} quotes have a target month · ${fmtCrShort(r.datedCr)} of ${fmtCrShort(r.totalCr)}`}>
            <span style={{ width: 118, flexShrink: 0, fontSize: 11, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            <div style={{ flex: 1, height: 16, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden', minWidth: 40, position: 'relative' }}>
              <div style={{ height: '100%', width: `${Math.max(pct, r.dated ? 1.5 : 0)}%`, background: `color-mix(in oklab, ${hue} 24%, transparent)`, borderLeft: r.dated ? `3px solid ${hue}` : 'none' }} />
            </div>
            <span style={{ width: 54, flexShrink: 0, textAlign: 'right', fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {r.dated}/{r.total}
            </span>
            <span style={{ width: 74, flexShrink: 0, textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>
              {r.dated ? fmtCrShort(r.datedCr) : '—'}
            </span>
          </Pick>
        );
      })}
    </div>
  );
}

// ── Single stacked bar ─────────────────────────────────────────
// For a two-or-three-part split of one total: SO covered vs awaiting,
// domestic vs export.

export function StackedBar({ parts, total, hrefFor, selected }: {
  parts: { label: string; value: number; color: string; sub?: string }[];
  total?: number;
} & Pickable) {
  const sum = total ?? parts.reduce((s, p) => s + p.value, 0);
  if (sum <= 0) return <NoData msg="No value recorded for this split yet." />;
  return (
    <div>
      <div style={{ display: 'flex', height: 26, borderRadius: 5, overflow: 'hidden', background: 'var(--bg-sunk)' }}>
        {parts.map(p => p.value > 0 && (
          <Pick key={p.label} href={hrefFor?.(p.label)} label={p.label} selected={selected}
            title={`${p.label} — ${fmtCrShort(p.value)}`}
            style={{ width: `${(p.value / sum) * 100}%`, background: p.color, display: 'block', borderRadius: 0 }}>
            <span style={{ display: 'block', height: 26 }} />
          </Pick>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 11 }}>
        {parts.map(p => (
          <Pick key={p.label} href={hrefFor?.(p.label)} label={p.label} selected={selected}
            style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>{p.label}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{fmtCrShort(p.value)}</span>
            <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
              {Math.round((p.value / sum) * 100)}%{p.sub ? ` · ${p.sub}` : ''}
            </span>
          </Pick>
        ))}
      </div>
    </div>
  );
}

// ── Monthly trend ──────────────────────────────────────────────

export function TrendBars({ points, height = 120, hrefFor, selected }: {
  /** `key` is what a click selects (YYYY-MM); `label` is what is printed. */
  points: { key?: string; label: string; count: number; value: number }[];
  height?: number;
} & Pickable) {
  if (!points.length) return <NoData msg="No dated activity to trend yet." />;
  const max = Math.max(...points.map(p => p.value), 0.0001);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: height + 40 }}>
      {points.map(p => {
        const h = Math.max((p.value / max) * height, p.value > 0 ? 3 : 0);
        const k = p.key ?? p.label;
        return (
          <Pick key={k} href={hrefFor?.(k)} label={k} selected={selected}
            title={`${p.label} — ${p.count} · ${fmtCrShort(p.value)}`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 3, minWidth: 0 }}>
            <span style={{ fontSize: 9.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{p.count}</span>
            <div style={{
              width: '100%', height: h, background: 'color-mix(in oklab, var(--pos) 22%, transparent)',
              borderTop: '3px solid var(--pos)', borderRadius: '3px 3px 0 0',
            }} />
            <span style={{ fontSize: 9.5, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>{p.label}</span>
          </Pick>
        );
      })}
    </div>
  );
}

// ── Offer movement ─────────────────────────────────────────────
// One row per deal: where the offer started, where it is now, and how far it
// moved. A paired bar rather than two separate charts, because the only
// interesting quantity is the gap between them.

export interface OfferMove {
  id: string; label: string; original: number | null; current: number | null; revisions: number;
}

export function OfferMovement({ rows }: { rows: OfferMove[] }) {
  const usable = rows.filter(r => r.original != null && r.current != null && r.original > 0);
  if (!usable.length) {
    return <NoData msg="No re-priced quotes in this stage yet. Add a revised offer on a quotation and the movement shows here." />;
  }
  const max = Math.max(...usable.flatMap(r => [r.original ?? 0, r.current ?? 0]), 1);
  const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {usable.map(r => {
        const o = r.original as number, c = r.current as number;
        const delta = ((c - o) / o) * 100;
        const up = delta > 0;
        return (
          <div key={r.id}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              <span style={{ fontSize: 10, color: 'var(--fg-3)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                {r.revisions} revision{r.revisions === 1 ? '' : 's'}
              </span>
              {Math.abs(delta) >= 0.05 && (
                <span style={{ fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--font-mono)', color: up ? 'var(--pos)' : 'var(--neg)' }}>
                  {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                </span>
              )}
            </div>
            {([['Original', o, 'var(--fg-3)'], ['Current', c, up ? 'var(--pos)' : 'var(--neg)']] as const).map(([lbl, v, hue]) => (
              <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ width: 54, flexShrink: 0, fontSize: 10, color: 'var(--fg-3)' }}>{lbl}</span>
                <div style={{ flex: 1, height: 13, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max((v / max) * 100, 1)}%`, background: `color-mix(in oklab, ${hue} 30%, transparent)`, borderLeft: `2px solid ${hue}` }} />
                </div>
                <span style={{ width: 96, flexShrink: 0, textAlign: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{inr(v)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── KPI tile ───────────────────────────────────────────────────

export function StageKpi({ label, value, sub, color, alert }: {
  label: string; value: string; sub?: string; color?: string;
  /** Draws attention: the tile is a to-do, not a fact. */
  alert?: boolean;
}) {
  return (
    <div style={{
      padding: '11px 13px', borderRadius: 8,
      background: alert ? 'var(--warn-soft, #FEF3C7)' : 'var(--bg-paper)',
      border: `1px solid ${alert ? 'var(--warn, #F59E0B)' : 'var(--line)'}`,
    }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 21, marginTop: 3, lineHeight: 1.1, color: color ?? 'var(--fg)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export const CHART_GRID: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12, marginBottom: 14,
};

// Two rows of four, for the Quoted page, which has eight panels: the top row
// about time (how old, when it lands), the bottom about mix (what, where, who).
// A class rather than inline style because it collapses to two columns and
// then one as the window narrows, and inline styles cannot carry a media query.
export const CHART_GRID_4 = 'stage-grid-4';
