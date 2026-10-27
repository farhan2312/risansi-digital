"use client";

// The dashboard's charts, drawn as plain SVG: a donut, columns, a histogram
// and horizontal bars. Colours are roles (--viz-*), stepped for light and
// dark; every chart has a legend or direct labels and a hover tooltip, so
// colour never carries meaning alone.

import { useState, type ReactNode } from "react";

/** The palette's roles (the dataviz reference instance), light and dark. */
export function VizStyles() {
  return (
    <style>{`
      .viz {
        --viz-blue: #2a78d6; --viz-orange: #eb6834; --viz-aqua: #1baf7a; --viz-yellow: #eda100;
        --viz-violet: #6250d6; --viz-red: #e34948; --viz-green: #008300; --viz-gray: #b4b9c2;
        --viz-seq-1: #b7d3f6; --viz-seq-2: #86b6ef; --viz-seq-3: #5598e7; --viz-seq-4: #2a78d6;
        --viz-seq-5: #1c5cab; --viz-seq-6: #104281;
        --viz-grid: #e6e8ec; --viz-axis: #c9cdd4; --viz-text: #52514e; --viz-ink: #0b0b0b; --viz-surface: #ffffff;
      }
      .dark .viz {
        --viz-blue: #3987e5; --viz-orange: #d95926; --viz-aqua: #199e70; --viz-yellow: #c98500;
        --viz-violet: #9085e9; --viz-red: #e66767; --viz-green: #2f9e2f; --viz-gray: #5b6170;
        --viz-seq-1: #184f95; --viz-seq-2: #1c5cab; --viz-seq-3: #256abf; --viz-seq-4: #3987e5;
        --viz-seq-5: #6da7ec; --viz-seq-6: #9ec5f4;
        --viz-grid: #2c2f36; --viz-axis: #3d414a; --viz-text: #c3c2b7; --viz-ink: #f0efec; --viz-surface: #1a1d23;
      }
    `}</style>
  );
}

export type Datum = { label: string; count: number; value?: number; color: string };

/** A small card a chart sits in: a title, a line saying what it shows, the chart. */
export function ChartCard({
  title,
  sub,
  children,
  className = "",
  right,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-card-border bg-surface p-4 shadow-sm sm:p-5 ${className}`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

/** A tooltip over the hovered mark, placed in % of the chart box. */
function Tip({ left, top, children }: { left: string; top: string; children: ReactNode }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-card-border bg-surface px-2.5 py-1.5 text-xs text-foreground shadow-lg"
      style={{ left, top, marginTop: -8 }}
    >
      {children}
    </div>
  );
}

const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");

/** A donut with its total in the middle and a legend beside it, each row with its count and share. */
export function Donut({ data, centerLabel, format = String }: { data: Datum[]; centerLabel: string; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((a, d) => a + d.count, 0);
  const R = 62;
  const r = 40;
  const C = 2 * Math.PI;
  let start = -Math.PI / 2;
  const arcs = data.map((d) => {
    const angle = total ? (d.count / total) * C : 0;
    const a0 = start;
    const a1 = start + angle;
    start = a1;
    return { d, a0, a1 };
  });
  const point = (rad: number, a: number) => [80 + rad * Math.cos(a), 80 + rad * Math.sin(a)];
  // A small surface gap between segments (2px), drawn as each arc's stroke.
  const path = (a0: number, a1: number) => {
    if (a1 - a0 >= C - 1e-6) a1 = a0 + C - 1e-4;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = point(R, a0);
    const [x1, y1] = point(R, a1);
    const [x2, y2] = point(r, a1);
    const [x3, y3] = point(r, a0);
    return `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${large} 0 ${x3},${y3} Z`;
  };
  const shown = hover !== null ? data[hover] : null;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 160 160" className="h-40 w-40 shrink-0" role="img" aria-label={`${centerLabel}: ${data.map((d) => `${d.label} ${d.count}`).join(", ")}`}>
        {total === 0 ? (
          <circle cx="80" cy="80" r={(R + r) / 2} fill="none" stroke="var(--viz-grid)" strokeWidth={R - r} />
        ) : (
          arcs.map(({ d, a0, a1 }, i) =>
            a1 > a0 ? (
              <path
                key={d.label}
                d={path(a0, a1)}
                fill={d.color}
                stroke="var(--viz-surface)"
                strokeWidth={2}
                opacity={hover === null || hover === i ? 1 : 0.35}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className="cursor-default transition-opacity"
              />
            ) : null
          )
        )}
        <text x="80" y="77" textAnchor="middle" className="fill-[var(--viz-ink)] text-[22px] font-bold">
          {shown ? format(shown.count) : format(total)}
        </text>
        <text x="80" y="95" textAnchor="middle" className="fill-[var(--viz-text)] text-[9.5px]">
          {shown ? shown.label : centerLabel}
        </text>
      </svg>
      <ul className="min-w-[10rem] flex-1 space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li
            key={d.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-2 rounded-md px-1.5 py-0.5 transition-colors ${hover === i ? "bg-background" : ""}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
            <span className="flex-1 text-foreground">{d.label}</span>
            <span className="font-semibold tabular-nums text-foreground">{format(d.count)}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted">{pct(d.count, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Columns on a shared baseline, with a few gridlines and a tooltip. Labels
 * sit on top of each column only when there are few (a histogram); the
 * tallest is labelled otherwise.
 */
export function Columns({
  data,
  color = "var(--viz-blue)",
  height = 180,
  unit = "SOs",
  tooltip,
  xTitle,
  width = 520,
}: {
  /** The drawing's width: about the card's, so text stays near its own size. */
  width?: number;
  data: { label: string; count: number; value?: number; color?: string }[];
  color?: string;
  height?: number;
  unit?: string;
  tooltip?: (d: { label: string; count: number; value?: number }) => ReactNode;
  xTitle?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = width;
  const H = height;
  const pad = { l: 30, r: 6, t: 18, b: 26 };
  const max = Math.max(1, ...data.map((d) => d.count));
  const step = max <= 5 ? 1 : max <= 20 ? 5 : max <= 50 ? 10 : max <= 100 ? 25 : max <= 250 ? 50 : 100;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step).filter((_, i, a) => a.length <= 5 || i % 2 === 0 || i === a.length - 1);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / data.length;
  const barW = Math.max(4, Math.min(38, bw * 0.62));
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const labelAll = data.length <= 8;
  const tallest = data.reduce((m, d, i) => (d.count > data[m].count ? i : m), 0);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={data.map((d) => `${d.label}: ${d.count} ${unit}`).join(", ")}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" className="fill-[var(--viz-text)] text-[10px] tabular-nums">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + bw * i + bw / 2;
          const h = Math.max(0, y(0) - y(d.count));
          const x = cx - barW / 2;
          const yy = y(d.count);
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* The hit area: the whole slot, taller than the bar. */}
              <rect x={pad.l + bw * i} y={pad.t} width={bw} height={ih} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${y(0)} Z`}
                  fill={d.color ?? color}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                  className="transition-opacity"
                />
              )}
              {(labelAll || i === tallest) && d.count > 0 && (
                <text x={cx} y={yy - 5} textAnchor="middle" className="fill-[var(--viz-ink)] text-[10.5px] font-semibold tabular-nums">
                  {d.count}
                </text>
              )}
              <text x={cx} y={H - 9} textAnchor="middle" className="fill-[var(--viz-text)] text-[10px]">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {xTitle && <p className="-mt-1 text-center text-[11px] text-muted">{xTitle}</p>}
      {hover !== null && (
        <Tip left={`${((pad.l + bw * hover + bw / 2) / W) * 100}%`} top={`${(y(data[hover].count) / H) * 100}%`}>
          {tooltip ? (
            tooltip(data[hover])
          ) : (
            <>
              <span className="font-semibold">{data[hover].label}</span> · {data[hover].count} {unit}
            </>
          )}
        </Tip>
      )}
    </div>
  );
}

/** Horizontal bars, one per row: the label, a bar on its track, the count (and value). */
export function HBars({
  data,
  format,
  max: maxOverride,
}: {
  data: Datum[];
  /** The text after the bar; the count by default. */
  format?: (d: Datum) => ReactNode;
  max?: number;
}) {
  const max = maxOverride ?? Math.max(1, ...data.map((d) => d.count));
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.label} className="group grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 text-sm" title={`${d.label}: ${d.count}`}>
          <span className="truncate text-foreground">{d.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-[var(--viz-grid)]">
            <span
              className="block h-full rounded-full transition-[width] duration-500 group-hover:brightness-110"
              style={{ width: `${(d.count / max) * 100}%`, background: d.color }}
            />
          </span>
          <span className="min-w-[3.5rem] text-right text-xs tabular-nums text-foreground">{format ? format(d) : <b>{d.count}</b>}</span>
        </li>
      ))}
    </ul>
  );
}

/** A thin 100% bar of parts — the Rep table's pipeline at a glance. */
export function StackBar({
  parts,
  title,
  fmt = String,
}: {
  parts: { label: string; count: number; color: string }[];
  title: string;
  /** How a part's figure reads in the tooltip (a count, or an amount). */
  fmt?: (n: number) => string;
}) {
  const total = parts.reduce((a, p) => a + p.count, 0);
  if (!total) return <span className="text-xs text-muted">—</span>;
  return (
    <span
      className="flex h-2.5 w-full min-w-[7rem] overflow-hidden rounded-full bg-[var(--viz-grid)]"
      role="img"
      aria-label={`${title}: ${parts.filter((p) => p.count).map((p) => `${p.label} ${fmt(p.count)}`).join(", ")}`}
      title={parts.filter((p) => p.count).map((p) => `${p.label}: ${fmt(p.count)}`).join("\n")}
    >
      {parts.map((p) =>
        p.count ? (
          <span key={p.label} className="h-full border-r-2 border-[var(--viz-surface)] last:border-r-0" style={{ width: `${(p.count / total) * 100}%`, background: p.color }} />
        ) : null
      )}
    </span>
  );
}
