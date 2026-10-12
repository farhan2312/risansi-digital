"use client";

/**
 * Small, dependency-free SVG/CSS charts for the Audit Log Overview. Colours
 * come from the theme variables, so they follow light/dark mode.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { WEEKDAYS } from "../../lib/audit-overview-shared";

// Series colours. The first few are theme tokens; the rest are fixed hues
// that read on both light and dark surfaces.
export const PALETTE = [
  "var(--brand-blue)",
  "var(--brand-cyan)",
  "var(--pos)",
  "var(--warn)",
  "var(--purple)",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#64748b",
  "var(--neg)",
];

export const fmtNum = (n: number) => n.toLocaleString("en-IN");

/** "2026-09-17" -> "17 Sep" */
export const fmtDay = (ymd: string, withWeekday = false) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    ...(withWeekday ? { weekday: "short" } : {}),
    timeZone: "UTC",
  });
};

export const heatColor = (ratio: number, color = "var(--brand-blue)") =>
  ratio <= 0
    ? "var(--bg-sunk)"
    : `color-mix(in srgb, ${color} ${Math.round(14 + ratio * 86)}%, transparent)`;

// --- Tooltip -----------------------------------------------------------------

type Tip = { x: number; y: number; content: ReactNode } | null;

/** A tooltip positioned inside a `relative` wrapper. */
function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: React.MouseEvent, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
  };
  const hide = () => setTip(null);
  const width = ref.current?.clientWidth ?? 0;
  const node = tip ? (
    <div
      className="pointer-events-none absolute z-20 min-w-[140px] rounded-md border border-line-strong bg-paper px-3 py-2 text-[12px] leading-[1.45] text-fg shadow-[0_8px_24px_rgba(10,22,40,0.18)]"
      style={{
        left: Math.min(tip.x + 14, Math.max(0, width - 200)),
        top: Math.max(0, tip.y - 12),
        transform: "translateY(-100%)",
      }}
    >
      {tip.content}
    </div>
  ) : null;
  return { ref, show, hide, node };
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

const niceMax = (v: number) => {
  if (v <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
};

const TipRow = ({ color, label, value }: { color: string; label: string; value: string }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="flex items-center gap-1.5 text-fg-2">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
    <span className="font-mono font-semibold tabular-nums">{value}</span>
  </div>
);

// --- Trend chart ---------------------------------------------------------------

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

/** Stacked daily bars, or lines, over the IST day axis. */
export function TrendChart({
  days,
  series,
  mode = "bars",
  format = fmtNum,
  height = 230,
}: {
  days: string[];
  series: TrendSeries[];
  mode?: "bars" | "line";
  format?: (n: number) => string;
  height?: number;
}) {
  const { ref: wrapRef, width } = useWidth<HTMLDivElement>();
  const tip = useTooltip();
  const [hover, setHover] = useState<number | null>(null);

  const pad = { top: 12, right: 12, bottom: 26, left: 44 };
  const w = Math.max(width, 280);
  const innerW = w - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const totals = days.map((_, i) =>
    mode === "bars"
      ? series.reduce((s, x) => s + (x.values[i] ?? 0), 0)
      : Math.max(0, ...series.map((x) => x.values[i] ?? 0)),
  );
  const max = niceMax(Math.max(0, ...totals));
  const slot = days.length ? innerW / days.length : innerW;
  const barW = Math.max(2, Math.min(28, slot * 0.64));
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(innerW / 64))));

  return (
    <div ref={tip.ref} className="relative">
      <div ref={wrapRef} className="w-full">
        {width > 0 && (
          <svg width={w} height={height} className="block" onMouseLeave={() => { setHover(null); tip.hide(); }}>
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line
                  x1={pad.left}
                  x2={w - pad.right}
                  y1={y(max * f)}
                  y2={y(max * f)}
                  stroke="var(--line)"
                  strokeDasharray={f === 0 ? undefined : "3 4"}
                />
                <text x={pad.left - 8} y={y(max * f) + 4} textAnchor="end" fontSize="10.5" fill="var(--fg-3)">
                  {format(Math.round(max * f * 100) / 100)}
                </text>
              </g>
            ))}

            {hover !== null && (
              <rect
                x={pad.left + hover * slot}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="var(--accent-soft)"
                rx={3}
              />
            )}

            {mode === "bars" &&
              days.map((day, i) => {
                let acc = 0;
                return (
                  <g key={day}>
                    {series.map((s) => {
                      const v = s.values[i] ?? 0;
                      if (!v) return null;
                      const y0 = y(acc);
                      acc += v;
                      const y1 = y(acc);
                      return (
                        <rect
                          key={s.key}
                          x={pad.left + i * slot + (slot - barW) / 2}
                          y={y1}
                          width={barW}
                          height={Math.max(1, y0 - y1)}
                          fill={s.color}
                          rx={Math.min(3, barW / 3)}
                        />
                      );
                    })}
                  </g>
                );
              })}

            {mode === "line" &&
              series.map((s) => {
                const pts = s.values.map((v, i) => `${pad.left + i * slot + slot / 2},${y(v)}`);
                const area = `M${pad.left + slot / 2},${y(0)} L${pts.join(" L")} L${pad.left + (days.length - 0.5) * slot},${y(0)} Z`;
                return (
                  <g key={s.key}>
                    {series.length === 1 && <path d={area} fill={s.color} opacity={0.12} />}
                    <polyline points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                    {days.length <= 45 &&
                      s.values.map((v, i) => (
                        <circle
                          key={i}
                          cx={pad.left + i * slot + slot / 2}
                          cy={y(v)}
                          r={hover === i ? 4 : 2.5}
                          fill="var(--bg-paper)"
                          stroke={s.color}
                          strokeWidth={2}
                        />
                      ))}
                  </g>
                );
              })}

            {days.map((day, i) =>
              i % labelEvery === 0 ? (
                <text
                  key={day}
                  x={pad.left + i * slot + slot / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="10.5"
                  fill="var(--fg-3)"
                >
                  {fmtDay(day)}
                </text>
              ) : null,
            )}

            {/* Hit areas, one per day */}
            {days.map((day, i) => (
              <rect
                key={`hit-${day}`}
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="transparent"
                onMouseMove={(e) => {
                  setHover(i);
                  tip.show(
                    e,
                    <>
                      <div className="mb-1 font-semibold">{fmtDay(day, true)}</div>
                      {series.map((s) => (
                        <TipRow key={s.key} color={s.color} label={s.label} value={format(s.values[i] ?? 0)} />
                      ))}
                    </>,
                  );
                }}
              />
            ))}
          </svg>
        )}
      </div>
      {tip.node}
    </div>
  );
}

// --- Donut -----------------------------------------------------------------------

export interface DonutItem {
  label: string;
  count: number;
  users?: number;
}

export function DonutChart({
  items,
  centerLabel,
  size = 150,
  maxSlices = 6,
  colors,
}: {
  items: DonutItem[];
  centerLabel: string;
  size?: number;
  maxSlices?: number;
  /** Fixed colours for known labels (e.g. failures in red). */
  colors?: Record<string, string>;
}) {
  const [active, setActive] = useState<number | null>(null);

  // Fold the long tail into "Other" so the ring stays readable.
  const slices = useMemo(() => {
    if (items.length <= maxSlices) return items;
    const head = items.slice(0, maxSlices - 1);
    const tail = items.slice(maxSlices - 1);
    return [...head, { label: "Other", count: tail.reduce((s, x) => s + x.count, 0) }];
  }, [items, maxSlices]);

  const total = slices.reduce((s, x) => s + x.count, 0);
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const shown = active !== null ? slices[active] : null;
  const colorOf = (label: string, i: number) => colors?.[label] ?? PALETTE[i % PALETTE.length];

  if (total === 0) {
    return <p className="py-10 text-center text-[12.5px] text-fg-3">Nothing recorded</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-sunk)" strokeWidth={18} />
          {slices.map((s, i) => {
            const len = (s.count / total) * c;
            const seg = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={colorOf(s.label, i)}
                strokeWidth={active === i ? 22 : 18}
                strokeDasharray={`${Math.max(0, len - (slices.length > 1 ? 1.5 : 0))} ${c}`}
                strokeDashoffset={-offset}
                className="cursor-pointer transition-[stroke-width] duration-150"
                opacity={active === null || active === i ? 1 : 0.35}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            );
            offset += len;
            return seg;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-mono text-[20px] font-bold leading-none text-fg tabular-nums">
            {shown ? `${Math.round((shown.count / total) * 100)}%` : fmtNum(total)}
          </span>
          <span className="mt-1 max-w-[90px] truncate text-[10.5px] uppercase tracking-[0.08em] text-fg-3">
            {shown ? shown.label : centerLabel}
          </span>
        </div>
      </div>

      <ul className="min-w-[160px] flex-1 space-y-1.5">
        {slices.map((s, i) => (
          <li
            key={s.label}
            className={`flex items-center gap-2 rounded px-1.5 py-1 text-[12.5px] transition-colors ${
              active === i ? "bg-elev" : ""
            }`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(s.label, i) }} />
            <span className="min-w-0 flex-1 truncate text-fg-2">{s.label}</span>
            <span className="font-mono font-semibold tabular-nums text-fg">{fmtNum(s.count)}</span>
            <span className="w-10 text-right font-mono text-[11px] tabular-nums text-fg-3">
              {Math.round((s.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Weekday x hour heatmap ------------------------------------------------------------

export function WeekHourHeatmap({ data }: { data: number[][] }) {
  const tip = useTooltip();
  const max = Math.max(0, ...data.flat());
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div ref={tip.ref} className="relative overflow-x-auto" onMouseLeave={tip.hide}>
      <div className="min-w-[620px]">
        <div className="grid grid-cols-[38px_repeat(24,minmax(0,1fr))] gap-[3px]">
          <span />
          {hours.map((h) => (
            <span key={h} className="text-center text-[10px] text-fg-3">
              {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
            </span>
          ))}
          {WEEKDAYS.map((wd, d) => (
            <FragmentRow key={wd}>
              <span className="self-center pr-1 text-[11px] font-medium text-fg-3">{wd}</span>
              {hours.map((h) => {
                const v = data[d]?.[h] ?? 0;
                return (
                  <span
                    key={h}
                    className="h-[22px] rounded-[3px] transition-transform hover:scale-125 hover:ring-1 hover:ring-accent"
                    style={{ background: heatColor(max ? v / max : 0) }}
                    onMouseMove={(e) =>
                      tip.show(
                        e,
                        <>
                          <div className="font-semibold">
                            {wd} · {String(h).padStart(2, "0")}:00–{String(h).padStart(2, "0")}:59
                          </div>
                          <div className="text-fg-2">
                            <span className="font-mono font-semibold text-fg">{fmtNum(v)}</span> events
                          </div>
                        </>,
                      )
                    }
                  />
                );
              })}
            </FragmentRow>
          ))}
        </div>
        <HeatLegend max={max} />
      </div>
      {tip.node}
    </div>
  );
}

const FragmentRow = ({ children }: { children: ReactNode }) => <>{children}</>;

export function HeatLegend({ max, format = fmtNum, color }: { max: number; format?: (n: number) => string; color?: string }) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-[10.5px] text-fg-3">
      <span>Less</span>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <span key={f} className="h-3 w-3 rounded-[3px]" style={{ background: heatColor(f, color) }} />
      ))}
      <span>More{max > 0 ? ` (${format(max)})` : ""}</span>
    </div>
  );
}

// --- User x day heatmap ------------------------------------------------------------------

export interface UserDayRow {
  key: string;
  label: ReactNode;
  sub?: ReactNode;
  values: Record<string, number>;
  /** Extra lines for a cell's tooltip. */
  detail?: (day: string) => ReactNode;
}

export function UserDayHeatmap({
  days,
  rows,
  format = fmtNum,
  cellFormat,
  color = "var(--brand-blue)",
  showValues = true,
  totalLabel = "Total",
}: {
  days: string[];
  rows: UserDayRow[];
  format?: (n: number) => string;
  /** A shorter form for inside the cells; defaults to `format`. */
  cellFormat?: (n: number) => string;
  color?: string;
  showValues?: boolean;
  totalLabel?: string;
}) {
  const tip = useTooltip();
  const scroller = useRef<HTMLDivElement>(null);
  const max = Math.max(0, ...rows.flatMap((r) => days.map((d) => r.values[d] ?? 0)));
  const colTotals = days.map((d) => rows.reduce((s, r) => s + (r.values[d] ?? 0), 0));

  // Start scrolled to the most recent days.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [days.length, rows.length]);

  if (rows.length === 0 || days.length === 0) {
    return <p className="py-8 text-center text-[12.5px] text-fg-3">Nothing recorded</p>;
  }

  return (
    <div ref={tip.ref} className="relative" onMouseLeave={tip.hide}>
      <div ref={scroller} className="overflow-x-auto pb-1">
        <table className="border-separate border-spacing-[3px] text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[190px] bg-paper pr-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                User
              </th>
              {days.map((d) => {
                const dt = new Date(`${d}T00:00:00Z`);
                const weekend = dt.getUTCDay() === 0;
                return (
                  <th key={d} className={`min-w-[36px] px-0 text-center font-medium ${weekend ? "text-neg/70" : "text-fg-3"}`}>
                    <div className="text-[10px] leading-tight">{dt.toLocaleDateString("en-IN", { weekday: "narrow", timeZone: "UTC" })}</div>
                    <div className="font-mono text-[10.5px] leading-tight">{dt.getUTCDate()}</div>
                  </th>
                );
              })}
              <th className="sticky right-0 z-10 min-w-[64px] bg-paper pl-2 text-right text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                {totalLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const total = days.reduce((s, d) => s + (r.values[d] ?? 0), 0);
              return (
                <tr key={r.key}>
                  <td className="sticky left-0 z-10 max-w-[220px] bg-paper py-0.5 pr-3">
                    <div className="truncate text-[12px] font-medium text-fg">{r.label}</div>
                    {r.sub && <div className="truncate text-[10.5px] text-fg-3">{r.sub}</div>}
                  </td>
                  {days.map((d) => {
                    const v = r.values[d] ?? 0;
                    const ratio = max ? v / max : 0;
                    return (
                      <td
                        key={d}
                        className="h-[30px] min-w-[36px] rounded-[4px] p-0 text-center font-mono text-[10px] font-semibold tabular-nums transition-shadow hover:ring-2 hover:ring-accent"
                        style={{
                          background: heatColor(ratio, color),
                          color: ratio > 0.55 ? "#fff" : "var(--fg-2)",
                        }}
                        onMouseMove={(e) =>
                          tip.show(
                            e,
                            <>
                              <div className="mb-1 font-semibold">{fmtDay(d, true)}</div>
                              <div className="mb-1 truncate text-fg-3">{r.label}</div>
                              {r.detail ? r.detail(d) : <div className="font-mono font-semibold">{format(v)}</div>}
                            </>,
                          )
                        }
                      >
                        {showValues && v > 0 ? (cellFormat ?? format)(v) : ""}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 bg-paper pl-2 text-right font-mono text-[12px] font-semibold tabular-nums text-fg">
                    {total ? format(total) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 z-10 bg-paper pr-3 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                All users
              </td>
              {colTotals.map((t, i) => (
                <td key={days[i]} className="pt-1 text-center font-mono text-[10px] font-semibold tabular-nums text-fg-2">
                  {t ? format(t) : ""}
                </td>
              ))}
              <td className="sticky right-0 z-10 bg-paper pl-2 pt-1 text-right font-mono text-[12px] font-bold tabular-nums text-accent">
                {format(colTotals.reduce((s, t) => s + t, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <HeatLegend max={max} format={format} color={color} />
      {tip.node}
    </div>
  );
}

// --- Sparkline ------------------------------------------------------------------------------

export function Sparkline({ values, color = "var(--brand-blue)", width = 96, height = 30 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  return (
    <svg width={width} height={height} className="block overflow-visible">
      <path d={`M0,${height} L${pts.join(" L")} L${width},${height} Z`} fill={color} opacity={0.12} />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
