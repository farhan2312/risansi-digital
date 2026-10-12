"use client";

import { useState } from "react";
import { monthLabel, monthLong, niceTicks, useElementWidth } from "./chartUtils";

export interface LineSeries {
  key: string;
  label: string;
  /** A CSS color -- normally a `var(--series-N)` slot. */
  color: string;
  values: number[];
}

interface LineChartProps {
  months: string[];
  series: LineSeries[];
  height?: number;
  /** Fill a 10% wash under the first series (the headline one). */
  areaFirst?: boolean;
}

const M = { top: 12, right: 40, bottom: 28, left: 36 };

const LineChart = ({ months, series, height = 260, areaFirst = true }: LineChartProps) => {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const n = months.length;
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];

  const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => M.top + plotH - (v / top) * plotH;

  const linePath = (values: number[]) => values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const areaPath = (values: number[]) =>
    `${linePath(values)} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`;

  // Show at most one x label per ~52px, always keeping the last month.
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 52))));

  // Direct end labels -- only where they don't collide with one already placed.
  const placedEnds: { key: string; y: number; value: number }[] = [];
  if (n > 0) {
    for (const s of series) {
      const endY = y(s.values[n - 1] ?? 0);
      if (placedEnds.every((p) => Math.abs(p.y - endY) >= 12)) {
        placedEnds.push({ key: s.key, y: endY, value: s.values[n - 1] ?? 0 });
      }
    }
  }

  const indexFromPointer = (clientX: number, rect: DOMRect) => {
    if (n <= 1) return 0;
    const rel = clientX - rect.left - M.left;
    return Math.min(n - 1, Math.max(0, Math.round((rel / plotW) * (n - 1))));
  };

  const tooltipLeft = active === null ? 0 : x(active);
  const flip = tooltipLeft > width - 170;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Trend over ${n} ${months[0]?.length === 10 ? "days" : "months"}: ${series.map((s) => s.label).join(", ")}`}
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
          {/* Gridlines + y ticks -- solid hairlines, recessive */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {t}
              </text>
            </g>
          ))}

          {/* X labels */}
          {months.map((m, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={m} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
                {monthLabel(m, i === 0 || m.endsWith("-01"))}
              </text>
            ) : null
          )}

          {areaFirst && series[0] && n > 1 && <path d={areaPath(series[0].values)} fill="var(--series-1-wash)" />}

          {series.map((s) => (
            <path key={s.key} d={linePath(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {/* End dots (with a surface ring) + selective end labels */}
          {n > 0 &&
            series.map((s) => (
              <circle key={s.key} cx={x(n - 1)} cy={y(s.values[n - 1] ?? 0)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          {placedEnds.map((p) => (
            <text key={p.key} x={x(n - 1) + 9} y={p.y} dy="0.32em" fontSize={11} fontWeight={600} fill="var(--text)">
              {p.value}
            </text>
          ))}

          {/* Crosshair */}
          {active !== null && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
              {series.map((s) => (
                <circle key={s.key} cx={x(active)} cy={y(s.values[active] ?? 0)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}

          {/* Hit layer -- the whole plot, so the pointer finds the X, not the line */}
          <rect
            x={M.left - 12}
            y={M.top}
            width={plotW + 24}
            height={plotH}
            fill="transparent"
            onPointerMove={(e) => setActive(indexFromPointer(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()))}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}

      {active !== null && months[active] && (
        <div
          className="viz-tooltip"
          style={{ top: M.top, left: flip ? tooltipLeft - 12 : tooltipLeft + 12, transform: flip ? "translateX(-100%)" : undefined }}
        >
          <div className="mb-1.5 text-[11px] font-semibold text-text-muted">{monthLong(months[active])}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 py-0.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
              <span className="font-semibold text-text-h" style={{ fontVariantNumeric: "tabular-nums" }}>
                {s.values[active] ?? 0}
              </span>
              <span className="text-text-muted">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LineChart;
