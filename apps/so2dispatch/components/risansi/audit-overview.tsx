"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { ArrowDownRight, ArrowUpRight, Info, ShieldAlert } from "lucide-react";
import { ALL_ROLES, roleLabel } from "@/lib/roles";
import type { AuditOverview, OverviewKpis } from "@/lib/audit-overview";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const nf = new Intl.NumberFormat("en-IN");
const num = (n: number) => nf.format(n);

function compact(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

/** "2026-09-14" → "14 Sep". The day is already an IST calendar date. */
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function weekday(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
}

function stamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The axis top: the smallest 1 / 2 / 4 / 5 / 8 × 10ⁿ at or above `v` that
 * splits into four whole-number steps, so every tick reads as a round count.
 */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 4, 5, 8, 10]) {
    const top = m * p;
    if (top >= v && top % 4 === 0) return top;
  }
  return 20 * p;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Width of an element, kept current, so charts draw at real pixels. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

type Tip = { x: number; y: number; width: number; body: ReactNode } | null;

/**
 * Hover state for a tooltip positioned inside its chart. The chart marks its
 * box with `data-tip-root`; the pointer is measured against that box when it
 * moves, so nothing is read from the DOM while rendering.
 *
 * Tooltips add detail on hover; every value they show is also on the page in
 * a legend, label or table.
 */
function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: ReactMouseEvent, body: ReactNode) => {
    const root = (e.currentTarget as Element).closest("[data-tip-root]");
    if (!root) return;
    const r = root.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, width: r.width, body });
  };
  const hide = () => setTip(null);
  return { tip, show, hide };
}

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  // Near the right edge it opens leftward, so it never runs off the card.
  const flip = tip.x > tip.width - 180;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 min-w-36 rounded-lg border border-card-border bg-surface px-3 py-2 text-xs text-foreground shadow-lg"
      style={{
        left: flip ? undefined : tip.x + 14,
        right: flip ? tip.width - tip.x + 14 : undefined,
        top: Math.max(tip.y - 12, 0),
      }}
    >
      {tip.body}
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
  className = "",
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section
      className={`min-w-0 rounded-xl border border-card-border bg-surface p-5 shadow-sm ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

function Delta({ now, before }: { now: number; before: number | undefined }) {
  if (before === undefined) return null;
  if (before === 0) {
    return now === 0 ? null : (
      <span className="text-xs text-muted">new this period</span>
    );
  }
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <span className="text-xs text-muted">same as before</span>;
  const up = pct > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {up ? "+" : ""}
      {pct}% <span className="sr-only">compared with the previous period</span>
    </span>
  );
}

const KPI_TILES: { key: keyof OverviewKpis; label: string }[] = [
  { key: "events", label: "Total events" },
  { key: "actions", label: "Actions on orders & users" },
  { key: "activeUsers", label: "Active users" },
  { key: "logins", label: "Sign-ins" },
  { key: "failed", label: "Failed sign-ins" },
  { key: "ordersTouched", label: "Orders touched" },
];

function KpiRow({ data }: { data: AuditOverview }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {KPI_TILES.map((t) => (
        <div
          key={t.key}
          className="rounded-xl border border-card-border bg-surface p-4 shadow-sm"
        >
          <div className="text-xs text-muted">{t.label}</div>
          <div className="mt-1 font-display text-2xl font-semibold text-foreground">
            {num(data.kpis[t.key])}
          </div>
          <div className="mt-0.5 h-4">
            <Delta now={data.kpis[t.key]} before={data.previous?.[t.key]} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlights — the few facts a reader would otherwise work out from the charts
// ---------------------------------------------------------------------------

function Highlights({ data }: { data: AuditOverview }) {
  let peak = { dow: -1, hour: -1, count: 0 };
  data.heatmap.forEach((row, d) =>
    row.forEach((c, h) => {
      if (c > peak.count) peak = { dow: d, hour: h, count: c };
    })
  );
  const hourTotals = Array.from({ length: 24 }, (_, h) =>
    data.heatmap.reduce((s, row) => s + row[h], 0)
  );
  const peakHour = hourTotals.indexOf(Math.max(...hourTotals));
  const busiest = data.daily.reduce<(typeof data.daily)[number] | null>(
    (best, d) => (!best || d.events > best.events ? d : best),
    null
  );
  const failRate =
    data.kpis.logins + data.kpis.failed
      ? Math.round((data.kpis.failed / (data.kpis.logins + data.kpis.failed)) * 100)
      : 0;

  const items: { label: string; value: string }[] = [
    {
      label: "Busiest hour",
      value: hourTotals[peakHour] ? `${hourLabel(peakHour)}–${hourLabel((peakHour + 1) % 24)}` : "—",
    },
    {
      label: "Busiest slot",
      value: peak.count ? `${WEEKDAYS[peak.dow]} ${hourLabel(peak.hour)}` : "—",
    },
    {
      label: "Busiest day",
      value: busiest && busiest.events ? `${dayLabel(busiest.day)} · ${num(busiest.events)}` : "—",
    },
    { label: "Sign-in failure rate", value: data.kpis.logins + data.kpis.failed ? `${failRate}%` : "—" },
    { label: "Distinct IP addresses", value: num(data.kpis.uniqueIps) },
  ];

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-card-border bg-surface px-5 py-3 text-sm shadow-sm">
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline gap-2">
          <span className="text-xs text-muted">{i.label}</span>
          <span className="font-medium text-foreground">{i.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trend (area line with crosshair)
// ---------------------------------------------------------------------------

function TrendChart({
  days,
  values,
  color,
  unit,
  detail,
}: {
  days: string[];
  values: number[];
  color: string;
  unit: string;
  detail?: (i: number) => ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const [hover, setHover] = useState<number | null>(null);

  const H = 200;
  const pad = { l: 40, r: 14, t: 10, b: 24 };
  const W = Math.max(width, 240);
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...values));
  const n = values.length;
  const x = (i: number) => pad.l + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;

  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const area =
    n > 1 ? `${line} L${x(n - 1)},${pad.t + plotH} L${x(0)},${pad.t + plotH} Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const xTicks =
    n <= 1 ? [0] : n <= 8 ? values.map((_, i) => i) : [0, Math.round((n - 1) / 2), n - 1];
  const last = n - 1;

  function onMove(e: ReactMouseEvent<SVGRectElement>) {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = n <= 1 ? 0 : Math.round(((px - pad.l) / plotW) * (n - 1));
    const idx = Math.min(Math.max(i, 0), n - 1);
    setHover(idx);
    tip.show(
      e,
      <div>
        <div className="mb-1 font-semibold">
          {weekday(days[idx])} {dayLabel(days[idx])}
        </div>
        {detail ? (
          detail(idx)
        ) : (
          <div>
            {num(values[idx])} {unit}
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-tip-root className="relative">
      <div ref={ref} className="w-full overflow-hidden">
        {width > 0 && n > 0 && (
          <svg width={W} height={H} role="img" aria-label={`${unit} per day`}>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={pad.l}
                  x2={W - pad.r}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"}
                  strokeWidth={1}
                />
                <text
                  x={pad.l - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted text-[10px] tabular-nums"
                >
                  {compact(t)}
                </text>
              </g>
            ))}
            {xTicks.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 6}
                textAnchor={n <= 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                className="fill-muted text-[10px]"
              >
                {dayLabel(days[i])}
              </text>
            ))}
            {area && <path d={area} fill={color} opacity={0.1} />}
            {n > 1 && (
              <path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={pad.t}
                y2={pad.t + plotH}
                stroke="var(--viz-axis)"
                strokeWidth={1}
              />
            )}
            {/* The latest day is marked and labelled; the rest are on hover. */}
            {[hover ?? last].map((i) => (
              <circle
                key={`dot-${i}`}
                cx={x(i)}
                cy={y(values[i])}
                r={4}
                fill={color}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            ))}
            {hover === null && (
              <text
                x={x(last)}
                y={y(values[last]) - 10}
                textAnchor={n <= 1 ? "middle" : "end"}
                className="fill-foreground text-[11px] font-medium"
              >
                {num(values[last])}
              </text>
            )}
            <rect
              x={pad.l}
              y={pad.t}
              width={plotW}
              height={plotH}
              fill="transparent"
              onMouseMove={onMove}
              onMouseLeave={() => {
                setHover(null);
                tip.hide();
              }}
            />
          </svg>
        )}
      </div>
      <Tooltip tip={tip.tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heatmap — weekday × hour
// ---------------------------------------------------------------------------

/** 0 stays at the surface; otherwise five equal steps toward the ramp's dark end. */
function rampStep(v: number, max: number): number {
  if (!v || !max) return 0;
  return Math.max(1, Math.ceil((v / max) * 5));
}

function rampColor(step: number): string {
  if (step === 0) return "var(--viz-seq-lo)";
  const pct = [0, 22, 40, 58, 78, 100][step];
  return `color-mix(in oklab, var(--viz-seq-hi) ${pct}%, var(--viz-seq-lo))`;
}

function RampLegend({ max }: { max: number }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted">
      <span>0</span>
      {[0, 1, 2, 3, 4, 5].map((s) => (
        <span
          key={s}
          className="h-3 w-4 rounded-[3px]"
          style={{ background: rampColor(s) }}
          aria-hidden
        />
      ))}
      <span>{num(max)}</span>
    </div>
  );
}

function Heatmap({ grid }: { grid: number[][] }) {
  const tip = useTip();
  const max = Math.max(0, ...grid.flat());
  const dayTotals = grid.map((r) => r.reduce((a, b) => a + b, 0));

  return (
    <div data-tip-root className="relative">
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div
            className="grid gap-[2px]"
            style={{ gridTemplateColumns: "36px repeat(24, minmax(0, 1fr)) 44px" }}
          >
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-center text-[10px] text-muted">
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </div>
            ))}
            <div className="text-right text-[10px] text-muted">Total</div>
            {grid.map((row, d) => (
              <div key={d} className="contents">
                <div className="flex items-center text-[11px] text-muted">{WEEKDAYS[d]}</div>
                {row.map((c, h) => (
                  <div
                    key={h}
                    className="aspect-square rounded-[3px] outline-offset-1 hover:outline hover:outline-2 hover:outline-foreground/40"
                    style={{ background: rampColor(rampStep(c, max)) }}
                    onMouseMove={(e) =>
                      tip.show(
                        e,
                        <div>
                          <div className="font-semibold">
                            {WEEKDAYS[d]} · {hourLabel(h)}–{hourLabel((h + 1) % 24)}
                          </div>
                          <div>{num(c)} events</div>
                        </div>
                      )
                    }
                    onMouseLeave={tip.hide}
                    aria-label={`${WEEKDAYS[d]} ${hourLabel(h)}: ${c} events`}
                  />
                ))}
                <div className="flex items-center justify-end text-[11px] tabular-nums text-foreground">
                  {num(dayTotals[d])}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <RampLegend max={max} />
      </div>
      <Tooltip tip={tip.tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut — part-to-whole, at most five colours plus a gray "Other"
// ---------------------------------------------------------------------------

type Slice = { label: string; count: number; color: string };

const SLOT = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)"];
const OTHER = "var(--viz-other)";

/**
 * Colour follows the entity, never its rank: each known value keeps its slot
 * whatever the period's counts, and anything outside the list folds into a gray
 * Other with Unknown.
 */
function slices(
  rows: { label: string; count: number }[],
  order: string[],
  otherLabel = "Other"
): Slice[] {
  const known: Slice[] = [];
  let other = 0;
  let unknown = 0;
  for (const r of rows) {
    const slot = order.indexOf(r.label);
    if (r.label === "Unknown") unknown += r.count;
    else if (slot >= 0 && slot < SLOT.length) known.push({ ...r, color: SLOT[slot] });
    else other += r.count;
  }
  known.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  if (other) known.push({ label: otherLabel, count: other, color: OTHER });
  if (unknown) known.push({ label: "Unknown", count: unknown, color: OTHER });
  return known;
}

function Donut({ data, unit = "events" }: { data: Slice[]; unit?: string }) {
  const tip = useTip();
  const total = data.reduce((s, d) => s + d.count, 0);
  const size = 132;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // A 2px surface gap between segments — none when one segment is the whole.
  const gap = data.filter((d) => d.count > 0).length > 1 ? 2 : 0;
  let offset = 0;

  return (
    <div data-tip-root className="relative flex flex-wrap items-center justify-center gap-x-5 gap-y-4">
      <svg width={size} height={size} role="img" aria-label={`Breakdown of ${num(total)} ${unit}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--viz-grid)"
            strokeWidth={stroke}
          />
          {total > 0 &&
            data.map((d) => {
              const len = (d.count / total) * c;
              const seg = (
                <circle
                  key={d.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${Math.max(len - gap, 0.001)} ${c}`}
                  strokeDashoffset={-offset}
                  onMouseMove={(e) =>
                    tip.show(
                      e,
                      <div>
                        <div className="font-semibold">{d.label}</div>
                        <div>
                          {num(d.count)} {unit} · {Math.round((d.count / total) * 100)}%
                        </div>
                      </div>
                    )
                  }
                  onMouseLeave={tip.hide}
                />
              );
              offset += len;
              return seg;
            })}
        </g>
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          className="fill-foreground text-lg font-semibold"
        >
          {compact(total)}
        </text>
        <text x="50%" y="62%" textAnchor="middle" className="fill-muted text-[10px]">
          {unit}
        </text>
      </svg>
      {/* The legend carries every value, so nothing depends on hovering or on
          telling colours apart. */}
      {/* Wide enough to name every part in full; on a narrow card it drops
          below the ring rather than cutting the labels short. */}
      <ul className="min-w-44 flex-1 space-y-1.5 text-xs">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-foreground">{d.label}</span>
            <span className="tabular-nums text-foreground">{num(d.count)}</span>
            <span className="w-9 text-right tabular-nums text-muted">
              {total ? Math.round((d.count / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
      <Tooltip tip={tip.tip} />
    </div>
  );
}

/** Actions grouped into what they mean, so the donut stays at five parts. */
const ACTION_GROUPS: { label: string; match: (a: string) => boolean }[] = [
  { label: "Order edits", match: (a) => a === "order.update" || a === "order.target_date" },
  { label: "Sign-offs", match: (a) => a === "order.dept_complete" },
  { label: "Orders added / removed", match: (a) => /^order\.(create|delete|import)$/.test(a) },
  { label: "Sign-ins & outs", match: (a) => a === "login" || a === "logout" || a === "login_failed" },
  { label: "Users & access", match: (a) => /^(user|access|password)\./.test(a) },
];

function actionSlices(rows: { action: string; count: number }[]): Slice[] {
  const grouped = rows.map((r) => ({
    label: ACTION_GROUPS.find((g) => g.match(r.action))?.label ?? "Other",
    count: r.count,
  }));
  const merged = new Map<string, number>();
  for (const g of grouped) merged.set(g.label, (merged.get(g.label) ?? 0) + g.count);
  return slices(
    [...merged].map(([label, count]) => ({ label, count })),
    ACTION_GROUPS.map((g) => g.label)
  );
}

// ---------------------------------------------------------------------------
// Bar lists
// ---------------------------------------------------------------------------

function BarList({
  rows,
}: {
  rows: { key: string; label: ReactNode; value: number; note?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-foreground">{r.label}</span>
            <span className="shrink-0 tabular-nums text-foreground">
              {num(r.value)}
              {r.note && <span className="ml-1.5 text-muted">{r.note}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--viz-grid)]">
            <div
              className="h-2 rounded-full"
              style={{ width: `${(r.value / max) * 100}%`, background: "var(--viz-1)" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Per-user daily grid
// ---------------------------------------------------------------------------

function UserDailyGrid({ grid }: { grid: AuditOverview["userGrid"] }) {
  const max = Math.max(0, ...grid.users.flatMap((u) => u.perDay));
  if (grid.users.length === 0) return <Empty>No one was active in this period.</Empty>;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-[2px] text-xs">
          <thead>
            <tr className="text-muted">
              <th className="px-2 py-1 text-left font-medium">User</th>
              {grid.days.map((d) => (
                <th key={d} className="px-0.5 py-1 text-center font-medium">
                  <div className="text-[10px]">{weekday(d).slice(0, 2)}</div>
                  <div className="tabular-nums">{d.slice(8)}</div>
                </th>
              ))}
              <th className="px-2 py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.users.map((u) => (
              <tr key={u.email}>
                <td className="max-w-48 px-2 py-1">
                  <div className="truncate font-medium text-foreground">{u.name ?? u.email}</div>
                  <div className="truncate text-[11px] text-muted">
                    {u.role ? roleLabel(u.role) : "—"}
                  </div>
                </td>
                {u.perDay.map((v, i) => {
                  const step = rampStep(v, max);
                  return (
                    <td
                      key={grid.days[i]}
                      className="h-8 min-w-8 rounded-[3px] text-center tabular-nums"
                      style={{
                        background: rampColor(step),
                        // Ink by the fill's lightness, so the number always reads.
                        color: step >= 3 ? "var(--viz-seq-ink)" : "var(--foreground)",
                      }}
                      title={`${u.name ?? u.email} · ${dayLabel(grid.days[i])}: ${v} events`}
                    >
                      {v || ""}
                    </td>
                  );
                })}
                <td className="px-2 text-right font-semibold tabular-nums text-foreground">
                  {num(u.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex justify-end">
        <RampLegend max={max} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

/**
 * The common browser-and-system pairs, each keeping its colour whatever the
 * period's counts; any other pair folds into Other.
 */
const PLATFORM_ORDER = [
  "Chrome · Windows",
  "Edge · Windows",
  "Chrome · Android",
  "Safari · iOS",
  "Chrome · macOS",
];

/**
 * Every role, including those with no activity in the period — a department
 * missing from the list reads as an oversight, a zero reads as a fact.
 */
function RoleBars({ rows }: { rows: AuditOverview["roles"] }) {
  const byRole = new Map(rows.map((r) => [r.role ?? "", r]));
  const known = ALL_ROLES.map((role) => ({
    role: role as string,
    count: byRole.get(role)?.count ?? 0,
    users: byRole.get(role)?.users ?? 0,
  }));
  // Events from a role since renamed or removed, or with none recorded.
  const extra = rows.filter((r) => !(ALL_ROLES as string[]).includes(r.role ?? ""));
  const all = [
    ...known,
    ...extra.map((r) => ({ role: r.role ?? "", count: r.count, users: r.users })),
  ].sort((a, b) => b.count - a.count);

  return (
    <BarList
      rows={all.map((r) => ({
        key: r.role || "none",
        label: r.role ? roleLabel(r.role) : "No role recorded",
        value: r.count,
        note: r.count
          ? `${r.users} ${r.users === 1 ? "user" : "users"}`
          : "no activity",
      }))}
    />
  );
}

/**
 * The charts' colours, for light and dark: categorical slots in a fixed order
 * (validated for colour-vision deficiency against these surfaces), a gray for
 * Other/Unknown, hairline grid and axis, and the two ends of the one-hue ramp
 * the heatmaps use.
 *
 * They ship with the component rather than in globals.css, scoped to the
 * panel: nothing else uses them, and a component's own code is picked up
 * reliably on every change, where the dev server has twice kept serving a
 * stale global stylesheet — leaving these charts without colour.
 */
const VIZ_TOKENS = `
.audit-viz {
  --viz-1: #2a78d6;
  --viz-2: #eb6834;
  --viz-3: #1baf7a;
  --viz-4: #eda100;
  --viz-5: #e87ba4;
  --viz-other: #b8bec8;
  --viz-grid: #eceff3;
  --viz-axis: #d4dce6;
  --viz-seq-lo: #eef3fa;
  --viz-seq-hi: #104281;
  --viz-seq-ink: #ffffff;
}
.dark .audit-viz {
  --viz-1: #3987e5;
  --viz-2: #d95926;
  --viz-3: #199e70;
  --viz-4: #c98500;
  --viz-5: #d55181;
  --viz-other: #4b5a73;
  --viz-grid: #1a2740;
  --viz-axis: #2a3a57;
  --viz-seq-lo: #16233b;
  --viz-seq-hi: #86b6ef;
  --viz-seq-ink: #0b1220;
}`;

export function AuditOverviewPanel({ data }: { data: AuditOverview }) {
  const days = data.daily.map((d) => d.day);
  const originMissing = data.withoutOrigin > 0;
  const noOriginAtAll = data.kpis.events > 0 && data.withoutOrigin >= data.kpis.events;

  return (
    <div className="audit-viz space-y-4">
      <style>{VIZ_TOKENS}</style>
      <KpiRow data={data} />
      {data.previous && (
        <p className="-mt-1 text-xs text-muted">
          Changes compare with the period of the same length just before.
        </p>
      )}
      <Highlights data={data} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="Total activity"
          subtitle="Every recorded event per day (IST)"
          className="xl:col-span-2"
        >
          {days.length ? (
            <TrendChart
              days={days}
              values={data.daily.map((d) => d.events)}
              color="var(--viz-1)"
              unit="events"
              detail={(i) => {
                const d = data.daily[i];
                return (
                  <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
                    <dt className="text-muted">Events</dt>
                    <dd className="text-right tabular-nums">{num(d.events)}</dd>
                    <dt className="text-muted">Actions</dt>
                    <dd className="text-right tabular-nums">{num(d.actions)}</dd>
                    <dt className="text-muted">Sign-ins</dt>
                    <dd className="text-right tabular-nums">{num(d.logins)}</dd>
                    <dt className="text-muted">Failed sign-ins</dt>
                    <dd className="text-right tabular-nums">{num(d.failed)}</dd>
                    <dt className="text-muted">Active users</dt>
                    <dd className="text-right tabular-nums">{num(d.activeUsers)}</dd>
                  </dl>
                );
              }}
            />
          ) : (
            <Empty>No activity in this period.</Empty>
          )}
        </Card>
        <Card title="Active users per day" subtitle="Distinct people who did anything">
          {days.length ? (
            <TrendChart
              days={days}
              values={data.daily.map((d) => d.activeUsers)}
              color="var(--viz-3)"
              unit="active users"
            />
          ) : (
            <Empty>No activity in this period.</Empty>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="When people work"
          subtitle="Events by weekday and hour of day (IST), failed sign-ins excluded"
          className="xl:col-span-2"
        >
          <Heatmap grid={data.heatmap} />
        </Card>
        <Card title="By role" subtitle="Events, and how many people behind them">
          <RoleBars rows={data.roles} />
        </Card>
      </div>

      {originMissing && (
        <p className="flex items-start gap-2 rounded-lg border border-card-border bg-surface px-4 py-2.5 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {noOriginAtAll
            ? `Device, browser and IP address are recorded from now on — none of the ${num(data.withoutOrigin)} events in this period carry them yet, so they read as Unknown.`
            : `${num(data.withoutOrigin)} events in this period were logged before device and IP address were recorded; they read as Unknown.`}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Actions" subtitle="What the events were">
          <Donut data={actionSlices(data.actions)} />
        </Card>
        <Card title="Devices" subtitle="Desktop, phone or tablet">
          <Donut data={slices(data.devices, ["Desktop", "Mobile", "Tablet"])} />
        </Card>
        <Card title="Browser & OS" subtitle="Which browser, on which system">
          <Donut data={slices(data.platforms, PLATFORM_ORDER)} />
        </Card>
      </div>

      <Card
        title="User activity by day"
        subtitle={`Events per person per day over the last ${data.userGrid.days.length} days of the period — the ${data.userGrid.users.length} busiest people in those days`}
      >
        <UserDailyGrid grid={data.userGrid} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Failed sign-ins by IP address"
          subtitle="Several emails tried from one address is worth a look"
          action={<ShieldAlert className="h-4 w-4 text-muted" aria-hidden />}
        >
          {data.failedByIp.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-card-border text-left text-muted">
                    <th className="py-2 pr-3 font-medium">IP address</th>
                    <th className="py-2 pr-3 text-right font-medium">Attempts</th>
                    <th className="py-2 pr-3 text-right font-medium">Emails tried</th>
                    <th className="py-2 text-right font-medium">Last attempt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {data.failedByIp.map((r) => (
                    <tr key={r.ip}>
                      <td className="py-2 pr-3 font-mono text-foreground">{r.ip}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-foreground">{num(r.attempts)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-foreground">{num(r.emails)}</td>
                      <td className="py-2 text-right text-muted">{stamp(r.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No failed sign-in with a recorded address in this period.</Empty>
          )}
        </Card>
        <Card
          title="Addresses and devices per user"
          subtitle="People seen from the most places"
        >
          {data.ipsByUser.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-card-border text-left text-muted">
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 text-right font-medium">IPs</th>
                    <th className="py-2 pr-3 text-right font-medium">Devices</th>
                    <th className="py-2 text-right font-medium">Latest IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {data.ipsByUser.map((r) => (
                    <tr key={r.email}>
                      <td className="max-w-52 truncate py-2 pr-3 text-foreground">{r.email}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-foreground">{num(r.ips)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-foreground">{num(r.devices)}</td>
                      <td className="py-2 text-right font-mono text-muted">{r.lastIp ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No addresses recorded in this period yet.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
}
