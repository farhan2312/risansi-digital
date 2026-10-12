"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
  href?: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  centerLabel: string;
  size?: number;
}

const polar = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;

const arcPath = (cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number) => {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rOuter, a0);
  const [x1, y1] = polar(cx, cy, rOuter, a1);
  const [x2, y2] = polar(cx, cy, rInner, a1);
  const [x3, y3] = polar(cx, cy, rInner, a0);
  return `M${x0},${y0} A${rOuter},${rOuter} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rInner},${rInner} 0 ${large} 0 ${x3},${y3} Z`;
};

/** Part-to-whole at a glance -- fine for this chart's <= 6 segments. Every
 * value is also printed in the legend beside it, so the tooltip only
 * enhances, never gates. */
const DonutChart = ({ segments, centerLabel, size = 196 }: DonutChartProps) => {
  const router = useRouter();
  const [active, setActive] = useState<string | null>(null);

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 6;
  const rInner = rOuter - 26;
  // 2px surface gap between segments, measured at the ring's midline.
  const gap = 2 / ((rOuter + rInner) / 2);
  const visible = segments.filter((s) => s.value > 0);

  let angle = 0;
  const arcs = visible.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = angle + (visible.length > 1 ? gap / 2 : 0);
    const a1 = angle + sweep - (visible.length > 1 ? gap / 2 : 0);
    angle += sweep;
    return { ...s, a0, a1 };
  });

  const activeSeg = segments.find((s) => s.key === active);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={`${centerLabel}: ${total}`}>
          {total === 0 ? (
            <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke="var(--viz-grid)" strokeWidth={rOuter - rInner} />
          ) : (
            arcs.map((s) => {
              const lifted = active === s.key;
              return (
                <path
                  key={s.key}
                  d={
                    visible.length === 1
                      ? `${arcPath(cx, cy, rOuter, rInner, 0, Math.PI)} ${arcPath(cx, cy, rOuter, rInner, Math.PI, Math.PI * 2 - 0.0001)}`
                      : arcPath(cx, cy, lifted ? rOuter + 4 : rOuter, rInner, s.a0, s.a1)
                  }
                  fill={s.color}
                  opacity={active && !lifted ? 0.45 : 1}
                  tabIndex={s.href ? 0 : -1}
                  role={s.href ? "link" : undefined}
                  aria-label={`${s.label}: ${s.value}`}
                  className="viz-focusable cursor-pointer transition-opacity"
                  onPointerEnter={() => setActive(s.key)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(s.key)}
                  onBlur={() => setActive(null)}
                  onClick={() => s.href && router.push(s.href)}
                  onKeyDown={(e) => e.key === "Enter" && s.href && router.push(s.href)}
                />
              );
            })
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold leading-none text-text-h">{activeSeg ? activeSeg.value : total}</span>
          <span className="mt-1 max-w-[110px] text-center text-[11px] text-text-muted">{activeSeg ? activeSeg.label : centerLabel}</span>
        </div>
      </div>

      <ul className="flex min-w-[190px] flex-1 flex-col gap-1">
        {segments.map((s) => {
          const pct = total ? Math.round((s.value / total) * 100) : 0;
          const row = (
            <>
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="flex-1 truncate text-sm text-text">{s.label}</span>
              <span className="text-sm font-semibold text-text-h" style={{ fontVariantNumeric: "tabular-nums" }}>
                {s.value}
              </span>
              <span className="w-10 text-right font-mono text-xs text-text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                {pct}%
              </span>
            </>
          );
          return (
            <li key={s.key}>
              {s.href ? (
                <button
                  type="button"
                  onClick={() => router.push(s.href!)}
                  onPointerEnter={() => setActive(s.key)}
                  onPointerLeave={() => setActive(null)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover ${active === s.key ? "bg-surface-hover" : ""}`}
                >
                  {row}
                </button>
              ) : (
                <div className="flex items-center gap-2.5 px-2 py-1.5">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default DonutChart;
