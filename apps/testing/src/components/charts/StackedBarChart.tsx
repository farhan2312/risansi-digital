"use client";

import { useState } from "react";
import { monthLabel, monthLong, niceTicks, useElementWidth } from "./chartUtils";

export interface BarSeries {
  key: string;
  label: string;
  /** A CSS color -- normally a `var(--series-N)` slot or a status token. */
  color: string;
  /** One value per column, aligned to `keys`. */
  values: number[];
}

interface StackedBarChartProps {
  /** Column keys -- days ("2026-03-14") or months ("2026-03"). */
  keys: string[];
  /** First series is the bottom of each stack. One series = a plain bar chart. */
  series: BarSeries[];
  height?: number;
  /** Formats tick labels and tooltip values (default: the plain number). */
  format?: (n: number) => string;
}

const M = { top: 12, right: 12, bottom: 28, left: 40 };
const GAP = 2; // surface gap between stacked segments
const MAX_BAR = 24;

/** Path for a bar segment with the top two corners rounded (the data end)
 * and the bottom square (the baseline / the segment below). */
const topRounded = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.max(0, Math.min(r, h, w / 2));
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
};

const StackedBarChart = ({ keys, series, height = 260, format = (n) => String(n) }: StackedBarChartProps) => {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const n = keys.length;
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const slot = n > 0 ? plotW / n : 0;
  const barW = Math.max(3, Math.min(MAX_BAR, slot * 0.62));

  const totals = keys.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const ticks = niceTicks(Math.max(1, ...totals));
  const top = ticks[ticks.length - 1];
  const y = (v: number) => M.top + plotH - (v / top) * plotH;

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 44))));

  const indexFromPointer = (clientX: number, rect: DOMRect) =>
    Math.min(n - 1, Math.max(0, Math.floor((clientX - rect.left - M.left) / slot)));

  const activeX = active === null ? 0 : M.left + slot * (active + 0.5);
  const flip = activeX > width - 190;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && n > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Bar chart over ${n} ${keys[0]?.length === 10 ? "days" : "months"}: ${series.map((s) => s.label).join(", ")}`}
          tabIndex={0}
          className="viz-focusable block"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
            if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
            if (e.key === "Escape") setActive(null);
          }}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {format(t)}
              </text>
            </g>
          ))}

          {active !== null && (
            <rect x={M.left + slot * active} y={M.top} width={slot} height={plotH} fill="var(--bg-sunk)" opacity={0.7} />
          )}

          {keys.map((key, i) => {
            const cx = M.left + slot * (i + 0.5);
            let base = y(0);
            const visible = series.filter((s) => (s.values[i] ?? 0) > 0);
            return (
              <g key={key}>
                {visible.map((s, idx) => {
                  const h = Math.max(2, ((s.values[i] ?? 0) / top) * plotH - (idx < visible.length - 1 ? GAP : 0));
                  const segY = base - h;
                  base = segY - GAP;
                  const isTop = idx === visible.length - 1;
                  return isTop ? (
                    <path key={s.key} d={topRounded(cx - barW / 2, segY, barW, h, 4)} fill={s.color} />
                  ) : (
                    <rect key={s.key} x={cx - barW / 2} y={segY} width={barW} height={h} fill={s.color} />
                  );
                })}
              </g>
            );
          })}

          {keys.map((key, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={key} x={M.left + slot * (i + 0.5)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
                {monthLabel(key, i === 0 || key.endsWith("-01"))}
              </text>
            ) : null
          )}

          {/* Hit layer -- the whole column, not just the (thin) bar */}
          <rect
            x={M.left}
            y={M.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={(e) => setActive(indexFromPointer(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()))}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}

      {active !== null && keys[active] && (
        <div
          className="viz-tooltip"
          style={{ top: M.top, left: flip ? activeX - slot / 2 - 8 : activeX + slot / 2 + 8, transform: flip ? "translateX(-100%)" : undefined }}
        >
          <div className="mb-1.5 text-[11px] font-semibold text-text-muted">{monthLong(keys[active])}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 py-0.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              <span className="font-semibold text-text-h" style={{ fontVariantNumeric: "tabular-nums" }}>
                {format(s.values[active] ?? 0)}
              </span>
              <span className="text-text-muted">{s.label}</span>
            </div>
          ))}
          {series.length > 1 && (
            <div className="mt-1 flex items-center gap-2 border-t border-border pt-1">
              <span className="font-semibold text-text-h" style={{ fontVariantNumeric: "tabular-nums" }}>
                {format(totals[active])}
              </span>
              <span className="text-text-muted">Total</span>
            </div>
          )}
        </div>
      )}

      {n === 0 && <p className="py-10 text-center text-sm text-text-muted">No days in this range.</p>}
    </div>
  );
};

export default StackedBarChart;
