"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlarmClock,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  FileText,
  IndianRupee,
  PauseCircle,
  ShieldAlert,
} from "lucide-react";
import type { Bucket, DashboardData, DeptBar, MonthPoint, Share, Tone } from "@/lib/dashboard";
import { EcKindToggle } from "./planning-pump-table";
import { useUrlTable } from "./url-table";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const intFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** ₹ in Crore / Lakh, the way the business reads money. */
function inr(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return `₹${intFmt.format(Math.round(v))}`;
}
/** Short axis money: 12 L, 1.2 Cr. */
function inrShort(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)} Cr`;
  if (v >= 1e5) return `${Math.round(v / 1e5)} L`;
  if (v === 0) return "0";
  return `${Math.round(v / 1e3)} k`;
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
}
function shortDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" });
}
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

const TONE_VAR: Record<Tone, string> = {
  done: "var(--viz-done)",
  progress: "var(--viz-progress)",
  pending: "var(--viz-pending)",
  critical: "var(--viz-critical)",
  na: "var(--viz-na)",
};
const TONE_LABEL: Record<Tone, string> = {
  done: "Done",
  progress: "In progress",
  pending: "Pending",
  critical: "On hold",
  na: "Not applicable",
};

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Card({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-card-border bg-surface p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  note,
  accent,
  href,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  note?: ReactNode;
  accent: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-medium leading-tight text-muted">{label}</span>
      </div>
      <p className="mt-3 whitespace-nowrap text-2xl font-bold leading-none text-foreground">{value}</p>
      {note && <p className="mt-1.5 text-xs text-muted">{note}</p>}
    </>
  );
  const cls = "block rounded-2xl border border-card-border bg-surface p-4 shadow-sm transition-colors";
  return href ? (
    <Link href={href} className={`${cls} hover:border-primary/40`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function LegendDot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden />;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/**
 * Value booked and value dispatched, month by month: grouped columns on one
 * ₹ axis, a hairline grid, the month under each pair, and a tooltip per month.
 */
function MonthlyColumns({ months }: { months: MonthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...months.flatMap((m) => [m.intake, m.dispatched]));
  // A round top for the axis: 1, 2 or 5 × a power of ten.
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const top = [1, 2, 5, 10].map((k) => k * mag).find((t) => t >= max) ?? max;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const h = 190;
  const empty = months.every((m) => m.intake === 0 && m.dispatched === 0);
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <LegendDot color="var(--viz-series-1)" /> Booked (SO value)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <LegendDot color="var(--viz-series-2)" /> Dispatched (invoiced)
        </span>
      </div>
      {empty ? (
        <p className="py-16 text-center text-sm text-muted">Nothing booked or dispatched in the last 12 months.</p>
      ) : (
        <div className="flex gap-2 pt-2">
          {/* y axis */}
          <div className="relative w-10 shrink-0 text-right text-[10px] tabular-nums text-muted" style={{ height: h }}>
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>
                {inrShort(t)}
              </span>
            ))}
          </div>
          <div className="relative flex-1">
            {/* grid */}
            <div className="absolute inset-x-0 top-0" style={{ height: h }}>
              {ticks.map((t) => (
                <div key={t} className="absolute inset-x-0 h-px bg-card-border" style={{ bottom: `${(t / top) * 100}%` }} />
              ))}
            </div>
            <div className="relative flex items-end gap-1" style={{ height: h }}>
              {months.map((m, i) => (
                <div
                  key={m.month}
                  className="relative flex h-full flex-1 cursor-default items-end justify-center gap-[2px] rounded-md"
                  style={{ background: hover === i ? "color-mix(in srgb, var(--foreground) 5%, transparent)" : undefined }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div className="w-[38%] max-w-4 rounded-t" style={{ height: `${(m.intake / top) * 100}%`, background: "var(--viz-series-1)", minHeight: m.intake > 0 ? 2 : 0 }} />
                  <div className="w-[38%] max-w-4 rounded-t" style={{ height: `${(m.dispatched / top) * 100}%`, background: "var(--viz-series-2)", minHeight: m.dispatched > 0 ? 2 : 0 }} />
                  {hover === i && (
                    <div
                      role="tooltip"
                      className={`pointer-events-none absolute bottom-full z-20 mb-2 w-44 rounded-lg border border-card-border bg-surface p-2.5 text-xs shadow-lg ${
                        i > months.length - 4 ? "right-0" : i < 3 ? "left-0" : "left-1/2 -translate-x-1/2"
                      }`}
                    >
                      <p className="mb-1.5 font-semibold text-foreground">
                        {monthLabel(m.month)} {m.month.slice(0, 4)}
                      </p>
                      <p className="flex items-center justify-between gap-2 text-muted">
                        <span className="inline-flex items-center gap-1.5"><LegendDot color="var(--viz-series-1)" /> Booked</span>
                        <span className="font-semibold text-foreground">{inr(m.intake)}</span>
                      </p>
                      <p className="mb-1 pl-4 text-[11px] text-muted">{m.sos} SO{m.sos === 1 ? "" : "s"}</p>
                      <p className="flex items-center justify-between gap-2 text-muted">
                        <span className="inline-flex items-center gap-1.5"><LegendDot color="var(--viz-series-2)" /> Dispatched</span>
                        <span className="font-semibold text-foreground">{inr(m.dispatched)}</span>
                      </p>
                      <p className="pl-4 text-[11px] text-muted">{m.dispatches} dispatch{m.dispatches === 1 ? "" : "es"}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* x axis */}
            <div className="mt-1.5 flex gap-1 text-[10px] text-muted">
              {months.map((m) => (
                <span key={m.month} className="flex-1 text-center">{monthLabel(m.month)}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Part of the whole, as a donut with its total in the middle and a legend beside it. */
function Donut({ buckets, unit }: { buckets: Bucket[]; unit: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = buckets.filter((b) => b.count > 0);
  const total = shown.reduce((n, b) => n + b.count, 0);
  const size = 168;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = shown.length > 1 ? 2 : 0;
  // Where each arc starts along the ring.
  const starts = shown.map((_, i) => shown.slice(0, i).reduce((n, x) => n + (x.count / Math.max(1, total)) * c, 0));
  const focus = hover ? buckets.find((b) => b.label === hover) : null;
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--card-border)" strokeWidth={stroke} />
          {total > 0 &&
            shown.map((b, i) => {
              const len = (b.count / total) * c;
              const dash = Math.max(0, len - gap);
              const el = (
                <circle
                  key={b.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={TONE_VAR[b.tone]}
                  strokeWidth={hover === b.label ? stroke + 4 : stroke}
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-starts[i]}
                  onMouseEnter={() => setHover(b.label)}
                  onMouseLeave={() => setHover(null)}
                  className="cursor-default transition-[stroke-width]"
                >
                  <title>{`${b.label}: ${b.count} (${pct(b.count, total)}%)`}</title>
                </circle>
              );
              return el;
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold text-foreground">{intFmt.format(focus ? focus.count : total)}</span>
          <span className="max-w-[6.5rem] text-[11px] leading-tight text-muted">{focus ? `${focus.label} · ${pct(focus.count, total)}%` : unit}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5">
        {buckets.map((b) => (
          <li
            key={b.label}
            onMouseEnter={() => setHover(b.label)}
            onMouseLeave={() => setHover(null)}
            className={`flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm ${hover === b.label ? "bg-background" : ""}`}
          >
            <span className="inline-flex min-w-0 items-center gap-2 text-foreground">
              <LegendDot color={TONE_VAR[b.tone]} />
              <span className="truncate">{b.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              <span className="font-semibold text-foreground">{intFmt.format(b.count)}</span> · {pct(b.count, total)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Each department's progress as a 100% bar of its own statuses, coloured by
 * what they mean (done, in progress, pending, not applicable), with the share
 * done beside it and every status in the tooltip.
 */
function DeptProgress({ depts }: { depts: DeptBar[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const tonesUsed = (["done", "progress", "pending", "critical", "na"] as Tone[]).filter((t) =>
    depts.some((d) => d.buckets.some((b) => b.tone === t && b.count > 0))
  );
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted">
        {tonesUsed.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <LegendDot color={TONE_VAR[t]} /> {TONE_LABEL[t]}
          </span>
        ))}
      </div>
      <div className="space-y-3.5">
        {depts.map((d) => {
          const total = d.buckets.reduce((n, b) => n + b.count, 0);
          const applies = total - d.buckets.filter((b) => b.tone === "na").reduce((n, b) => n + b.count, 0);
          const done = d.buckets.filter((b) => b.tone === "done").reduce((n, b) => n + b.count, 0);
          // Done first, then in progress, pending, held, not applicable: every bar reads the same way.
          const order: Tone[] = ["done", "progress", "pending", "critical", "na"];
          const segs = d.buckets.filter((b) => b.count > 0).sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone));
          return (
            <div key={d.key} className="relative" onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <Link href={d.href} className="font-medium text-foreground hover:text-primary hover:underline">
                  {d.label}
                </Link>
                <span className="tabular-nums text-muted">
                  <span className="font-semibold text-foreground">{pct(done, applies)}%</span> done · {intFmt.format(done)}/{intFmt.format(applies)} {d.unit}
                </span>
              </div>
              <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-card-border">
                {total > 0 &&
                  segs.map((b, i) => (
                    <div
                      key={b.label}
                      className={`h-full ${i === 0 ? "rounded-l-full" : ""} ${i === segs.length - 1 ? "rounded-r-full" : ""}`}
                      style={{ width: `${(b.count / total) * 100}%`, background: TONE_VAR[b.tone], minWidth: 3 }}
                    />
                  ))}
              </div>
              {hover === d.key && total > 0 && (
                <div role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 w-60 rounded-lg border border-card-border bg-surface p-2.5 text-xs shadow-lg">
                  <p className="mb-1.5 font-semibold text-foreground">
                    {d.label} · {intFmt.format(total)} {d.unit}
                  </p>
                  {d.buckets.map((b) => (
                    <p key={b.label} className="flex items-center justify-between gap-2 py-0.5 text-muted">
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <LegendDot color={TONE_VAR[b.tone]} />
                        <span className="truncate">{b.label}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        <span className="font-semibold text-foreground">{b.count}</span> · {pct(b.count, total)}%
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A ranked list of horizontal bars, one hue: the order book by zone or client. */
function ShareBars({ items, empty }: { items: Share[]; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="py-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label} title={`${i.label}: ${inr(i.value)} · ${i.count} SO${i.count === 1 ? "" : "s"}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-medium text-foreground">{i.label}</span>
            <span className="shrink-0 tabular-nums text-muted">
              <span className="font-semibold text-foreground">{inr(i.value)}</span> · {i.count} SO{i.count === 1 ? "" : "s"}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-card-border">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (i.value / max) * 100)}%`, background: "var(--viz-series-1)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The dashboard
// ---------------------------------------------------------------------------

export function CentralOverview({ data }: { data: DashboardData }) {
  const { setParams } = useUrlTable();
  const k = data.kpis;
  const pump = data.kind === "pump";
  const kindParam = pump ? "Pump%2CROLB" : "Spare";
  const dispatchedPct = pct(k.fullyDispatched, k.activeSos);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Central Dashboard</h1>
          <p className="text-sm text-muted">
            {pump ? "Pump" : "Spare"} orders at a glance — open SOs only, cancelled and diverted left out.
          </p>
        </div>
        <EcKindToggle value={data.kind} onChange={(v) => setParams({ type: v === "pump" ? "Pump,ROLB" : null })} />
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={FileText} label="Open SOs" value={intFmt.format(k.activeSos)} note={`${k.closedSos} cancelled / diverted`} accent="bg-primary/10 text-primary" href={`/risansi/orders?type=${kindParam}`} />
        <Kpi icon={Boxes} label="ECs" value={intFmt.format(k.ecs)} note={`${intFmt.format(k.qty)} ${pump ? "pumps" : "units"} in all`} accent="bg-indigo-500/10 text-indigo-500" />
        <Kpi icon={IndianRupee} label="Order book" value={inr(k.orderValue)} note="value of open SOs" accent="bg-emerald-500/10 text-emerald-600" />
        <Kpi icon={CheckCircle2} label="Fully dispatched" value={intFmt.format(k.fullyDispatched)} note={`${dispatchedPct}% of open SOs`} accent="bg-emerald-500/10 text-emerald-600" />
        <Kpi icon={AlertTriangle} label="Late for dispatch" value={intFmt.format(k.overdueDispatch)} note="past the dispatch date" accent="bg-rose-500/10 text-rose-600" />
        <Kpi icon={CalendarClock} label="Due in 7 days" value={intFmt.format(k.dueThisWeek)} note="to dispatch this week" accent="bg-amber-500/10 text-amber-600" />
        <Kpi icon={PauseCircle} label="Payment holds" value={intFmt.format(k.paymentHolds)} note="outstanding hold" accent="bg-amber-500/10 text-amber-600" />
        <Kpi icon={ShieldAlert} label="Not released" value={intFmt.format(k.notReleased)} note="held or awaiting clearance" accent="bg-slate-500/10 text-slate-500" />
      </div>

      {/* Trend and dispatch */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Booked vs dispatched" subtitle="Value per month, last 12 months (₹)" className="xl:col-span-2">
          <MonthlyColumns months={data.months} />
        </Card>
        <Card title="Dispatch status" subtitle="Open SOs">
          <Donut buckets={data.dispatch} unit="open SOs" />
        </Card>
      </div>

      {/* Departments */}
      <Card
        title="Department progress"
        subtitle={pump ? "Per EC from Drawing to Packing; per SO for PI, Accounts and Dispatch" : "Per EC for Planning and Assembly & Packing; per SO for PI, Accounts and Dispatch"}
      >
        <DeptProgress depts={data.depts} />
      </Card>

      {/* Money and the order book */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Payment status" subtitle="Open SOs, as Accounts records them">
          <Donut buckets={data.payment} unit="open SOs" />
        </Card>
        <Card title="Pending order book by zone" subtitle="Open SOs not fully dispatched (₹)">
          <ShareBars items={data.zones} empty="Nothing pending." />
        </Card>
        <Card title="Top clients" subtitle="By pending order value (₹)">
          <ShareBars items={data.clients} empty="Nothing pending." />
        </Card>
      </div>

      {/* Late */}
      <Card
        title="Late for dispatch"
        subtitle="Longest overdue first"
        action={
          <Link href={`/risansi/departments/dispatch`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            Dispatch <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        {data.late.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nothing is late. </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">SO No.</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Dispatch date</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 text-right">Late by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {data.late.map((l) => (
                  <tr key={l.order_id} className="hover:bg-background/60">
                    <td className="py-2 pr-3 font-semibold">
                      <Link href={`/risansi/orders/${l.order_id}`} className="text-primary hover:underline">
                        {l.so_no ?? "—"}
                      </Link>
                    </td>
                    <td className="max-w-[18rem] truncate py-2 pr-3 text-muted">{l.client_name ?? "—"}</td>
                    <td className="py-2 pr-3 tabular-nums text-muted">{shortDate(l.target)}</td>
                    <td className="py-2 pr-3">{l.status}</td>
                    <td className="py-2 text-right">
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-600">
                        <AlarmClock className="h-3 w-3" />
                        {l.days_late}d
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
