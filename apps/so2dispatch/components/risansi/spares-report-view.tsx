import Link from "next/link";
import { FileDown, FileText } from "lucide-react";
import {
  ASSEMBLY_ORDER,
  PLANNING_ORDER,
  countBy,
  summaryOf,
  type SpareSoRow,
  type SparesReport,
} from "@/lib/spares-report";
import {
  ACTIVITY_SERIES,
  OTHER_STATUS_COLOR,
  SPARE_DISPATCH_STATUSES,
  SPARE_STAGES,
  STATUS_COLORS,
  describeSparesReportFilter,
  shortDate,
  sparesReportQuery,
  type SpareStage,
} from "@/lib/spares-report-filter";
import { SparesReportFilters } from "./spares-report-filters";

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

type Part = { label: string; count: number; color: string };

const colorOf = (group: string, label: string) => STATUS_COLORS[`${group}:${label}`] ?? OTHER_STATUS_COLOR;

/** A ring chart, the total in the middle, the legend beside it. */
function Donut({ title, parts }: { title: string; parts: Part[] }) {
  const total = parts.reduce((n, p) => n + p.count, 0);
  const r = 40;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="rounded-xl border border-card-border bg-surface p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0" role="img" aria-label={`${title}: ${total} SOs`}>
          <circle cx="50" cy="50" r={r} fill="none" className="stroke-card-border" strokeWidth="16" />
          {total > 0 &&
            parts.map((p) => {
              const len = (p.count / total) * c;
              const el = (
                <circle
                  key={p.label}
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="16"
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 50 50)"
                />
              );
              offset += len;
              return el;
            })}
          <text x="50" y="55" textAnchor="middle" className="fill-foreground text-[15px] font-semibold">
            {total}
          </text>
        </svg>
        <ul className="min-w-0 flex-1 space-y-1 text-xs">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
              <span className="min-w-0 flex-1 truncate text-muted">{p.label}</span>
              <span className="font-semibold tabular-nums text-foreground">{p.count}</span>
              <span className="w-9 text-right tabular-nums text-muted-foreground">
                {total ? Math.round((p.count / total) * 100) : 0}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Grouped bars: each department's work, per week (or month). */
function ActivityChart({ report }: { report: SparesReport }) {
  const buckets = report.activity.buckets;
  const W = 680;
  const H = 220;
  const left = 30;
  const bottom = 24;
  const top = 10;
  const max = Math.max(1, ...buckets.flatMap((b) => ACTIVITY_SERIES.map((s) => b[s.key])));
  const step = Math.max(1, Math.ceil(max / 4 / 5) * 5);
  const yMax = step * 4;
  const groupW = (W - left) / Math.max(1, buckets.length);
  const barW = Math.min(16, (groupW * 0.8) / ACTIVITY_SERIES.length);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / yMax);
  return (
    <div className="rounded-xl border border-card-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h3 className="mr-auto text-sm font-semibold text-foreground">
          {report.activity.bucketBy === "week" ? "Week by week" : "Month by month"}
        </h3>
        {ACTIVITY_SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Work done per period">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={left} x2={W} y1={y(step * i)} y2={y(step * i)} className="stroke-card-border" strokeWidth="1" />
            <text x={left - 6} y={y(step * i) + 4} textAnchor="end" className="fill-muted text-[10px]">
              {step * i}
            </text>
          </g>
        ))}
        {buckets.map((b, gi) => {
          const gx = left + gi * groupW + (groupW - barW * ACTIVITY_SERIES.length) / 2;
          return (
            <g key={b.label}>
              {ACTIVITY_SERIES.map((s, si) => {
                const v = b[s.key];
                return (
                  <rect key={s.key} x={gx + si * barW} y={y(v)} width={barW - 1.5} height={Math.max(0, y(0) - y(v))} fill={s.color} rx="1.5">
                    <title>{`${b.label} · ${s.label}: ${v}`}</title>
                  </rect>
                );
              })}
              <text x={left + gi * groupW + groupW / 2} y={H - 6} textAnchor="middle" className="fill-muted text-[10px]">
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Metric({ label, value, by, href }: { label: string; value: number; by: string; href?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{by}</div>
    </>
  );
  return href ? (
    <a href={href} className="block rounded-xl border border-card-border bg-surface p-4 shadow-sm transition-colors hover:bg-background">
      {body}
    </a>
  ) : (
    <div className="rounded-xl border border-card-border bg-surface p-4 shadow-sm">{body}</div>
  );
}

const STAGE_SORT: Record<SpareStage, (a: SpareSoRow, b: SpareSoRow) => number> = {
  // Longest waiting first; those without a date after.
  to_pack: (a, b) => (b.waiting_days ?? -1) - (a.waiting_days ?? -1) || b.pack_overdue - a.pack_overdue,
  packed: (a, b) => (a.packed_on ?? "9").localeCompare(b.packed_on ?? "9"),
  not_ready: (a, b) => (a.readiness_date ?? "9").localeCompare(b.readiness_date ?? "9"),
  dispatched: (a, b) => (b.dispatched_on ?? "").localeCompare(a.dispatched_on ?? ""),
};

function SoTable({ rows }: { rows: SpareSoRow[] }) {
  if (rows.length === 0) return <p className="px-4 py-6 text-center text-sm text-muted">No SOs.</p>;
  const th = "px-3 py-2 whitespace-nowrap";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead>
          <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <th className={th}>Sl.</th>
            <th className={th}>SO No.</th>
            <th className={th}>SO date</th>
            <th className={th}>Client</th>
            <th className={th}>Planning</th>
            <th className={th}>Readiness</th>
            <th className={th}>Assembly</th>
            <th className={th}>Waiting to pack</th>
            <th className={th}>Packed on</th>
            <th className={th}>Dispatch</th>
            <th className={th}>Dispatched on</th>
            <th className={`${th} text-right`}>PIs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-card-border">
          {rows.map((r) => (
            <tr key={r.id} className="text-foreground hover:bg-background/60">
              <td className="px-3 py-2 tabular-nums text-muted">{r.sl_no}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Link href={`/risansi/orders/${r.id}`} className="font-medium text-primary hover:underline">
                  {r.so_no || `#${r.sl_no}`}
                </Link>
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted">{shortDate(r.so_date)}</td>
              <td className="max-w-[16rem] truncate px-3 py-2" title={r.client_name ?? ""}>
                {r.client_name || "—"}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{r.planning_status}</td>
              <td className="px-3 py-2 whitespace-nowrap text-muted">{shortDate(r.readiness_date) || "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.assembly_status}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {r.stage === "to_pack" ? (
                  r.waiting_days !== null ? (
                    <span className={r.pack_overdue > 0 ? "font-semibold text-rose-600" : ""}>
                      {r.waiting_days} d <span className="font-normal text-muted">since {shortDate(r.waiting_since, false)}</span>
                    </span>
                  ) : r.waiting_since ? (
                    <span className="text-muted">Ready {shortDate(r.waiting_since, false)}</span>
                  ) : (
                    <span className="text-muted">No ready date</span>
                  )
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted">{shortDate(r.packed_on) || "—"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.dispatch_status}</td>
              <td className="px-3 py-2 whitespace-nowrap text-muted">{shortDate(r.dispatched_on) || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.pis || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  id,
  title,
  hint,
  count,
  open,
  tone = "neutral",
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  count: number;
  open?: boolean;
  tone?: "neutral" | "warn" | "ok";
  children: React.ReactNode;
}) {
  const badge =
    tone === "warn"
      ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
      : tone === "ok"
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
        : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300";
  return (
    <details id={id} open={open} className="group scroll-mt-20 rounded-xl border border-card-border bg-surface shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${badge}`}>{count}</span>
        {hint && <span className="hidden text-xs text-muted sm:inline">{hint}</span>}
        <span className="ml-auto text-xs text-primary group-open:hidden">Show</span>
        <span className="ml-auto hidden text-xs text-primary group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-card-border">{children}</div>
    </details>
  );
}

export function SparesReportView({ report }: { report: SparesReport }) {
  const { rows, activity, filter } = report;
  const sum = summaryOf(rows);
  const qs = sparesReportQuery(filter);
  const pdf = `/risansi/reports/pdf?${qs}`;
  const total = Math.max(1, sum.pipeline[0].count);

  const planningParts = countBy(rows, "planning_status", PLANNING_ORDER).map((p) => ({ ...p, color: colorOf("planning", p.label) }));
  const assemblyParts = countBy(rows, "assembly_status", ASSEMBLY_ORDER).map((p) => ({ ...p, color: colorOf("assembly", p.label) }));
  const dispatchParts = countBy(rows, "dispatch_status", SPARE_DISPATCH_STATUSES).map((p) => ({ ...p, color: colorOf("dispatch", p.label) }));

  const ageMax = Math.max(1, ...report.ageing.map((a) => a.count));
  const toneBar: Record<string, string> = {
    ok: "bg-amber-200 text-amber-900 dark:bg-amber-500/30 dark:text-amber-100",
    warn: "bg-amber-400 text-amber-950",
    late: "bg-rose-400 text-rose-950",
    none: "bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200",
  };

  const callouts: { label: string; count: number; href: string; tone: string }[] = [
    { label: "Ready, waiting to pack", count: sum.toPack, href: "#to_pack", tone: "warn" },
    { label: "Packed, waiting to dispatch", count: sum.packedWaiting, href: "#packed", tone: "warn" },
    { label: "Overdue for packing", count: sum.packOverdue, href: "#to_pack", tone: "late" },
    { label: "Not ready yet", count: sum.notReady, href: "#not_ready", tone: "none" },
  ];
  const calloutTone: Record<string, string> = {
    warn: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
    late: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300",
    none: "border-card-border bg-background text-foreground",
  };

  return (
    <div className="space-y-6 px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Spares report</h1>
          <p className="text-sm text-muted">{describeSparesReportFilter(filter)}</p>
        </div>
        <div className="flex gap-2">
          <a
            href={pdf}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
          >
            <FileText className="h-4 w-4" />
            View PDF
          </a>
          <a
            href={`${pdf}&download=1`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            <FileDown className="h-4 w-4" />
            Download PDF
          </a>
        </div>
      </div>

      <SparesReportFilters filter={filter} options={report.options} />

      {/* 1 — what each department did in the period. */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Work done · {shortDate(filter.from)} – {shortDate(filter.to)}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="SOs created" value={activity.created.length} by="Order Making" href="#created" />
          <Metric label="PIs raised" value={activity.pis.length} by="Billing" href="#pis" />
          <Metric label="Payments confirmed" value={activity.payments.length} by="Accounts" href="#payments" />
          <Metric label="SOs made ready" value={activity.readySos} by="Planning" />
          <Metric label="SOs packed" value={activity.packedSos} by="Assembly & Packing" />
          <Metric label="SOs dispatched" value={activity.dispatchedSos} by="Dispatch" />
        </div>
      </section>

      {/* 2 — where the SOs stand today. */}
      <section className="rounded-xl border border-card-border bg-surface p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Where they stand today</h2>
        <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs">
          {sum.pipeline.map((p, i) => (
            <div key={p.label} className="contents">
              <span className="text-muted">{p.label}</span>
              <div className="h-6 rounded-md bg-background">
                <div
                  className={`flex h-6 items-center rounded-md px-2 font-semibold ${
                    i === 0 ? "bg-slate-200 text-slate-800 dark:bg-white/15 dark:text-slate-100" : "bg-emerald-500/80 text-white"
                  }`}
                  style={{ width: `${Math.max(4, (p.count / total) * 100)}%` }}
                >
                  {p.count}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {callouts.map((c) => (
            <a
              key={c.label}
              href={c.href}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${calloutTone[c.tone]}`}
            >
              <span className="text-base font-bold tabular-nums">{c.count}</span>
              {c.label}
            </a>
          ))}
          {sum.lotDispatched > 0 && (
            <span className="inline-flex items-center gap-2 rounded-lg border border-card-border bg-background px-3 py-1.5 text-xs font-medium text-foreground">
              <span className="text-base font-bold tabular-nums">{sum.lotDispatched}</span>
              Part dispatched (LOT)
            </span>
          )}
        </div>
      </section>

      {/* 3 — status split per department. */}
      <section className="grid gap-3 lg:grid-cols-3">
        <Donut title="Planning status" parts={planningParts} />
        <Donut title="Assembly & Packing status" parts={assemblyParts} />
        <Donut title="Dispatch status" parts={dispatchParts} />
      </section>

      {/* 4 — the period, bucket by bucket. 5 — how long ready SOs have waited. */}
      <section className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ActivityChart report={report} />
        <div className="rounded-xl border border-card-border bg-surface p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-semibold text-foreground">Waiting to pack</h3>
          <p className="mb-3 text-xs text-muted">{sum.toPack} SOs ready, by days since ready</p>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs">
            {report.ageing.map((a) => (
              <div key={a.label} className="contents">
                <span className="text-muted">{a.label}</span>
                <div className="h-6">
                  <div
                    className={`flex h-6 items-center rounded-md px-2 font-semibold ${toneBar[a.tone]}`}
                    style={{ width: `${Math.max(a.count ? 8 : 0, (a.count / ageMax) * 100)}%` }}
                  >
                    {a.count || ""}
                  </div>
                  {!a.count && <span className="text-muted-foreground">0</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6 — every SO behind the numbers. */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">SO lists</h2>
        {SPARE_STAGES.map((s) => {
          const list = rows.filter((r) => r.stage === s.key).sort(STAGE_SORT[s.key]);
          return (
            <Section
              key={s.key}
              id={s.key}
              title={s.label}
              hint={s.hint}
              count={list.length}
              open={s.key === "to_pack" || s.key === "packed"}
              tone={s.key === "dispatched" ? "ok" : s.key === "not_ready" ? "neutral" : "warn"}
            >
              <SoTable rows={list} />
            </Section>
          );
        })}
        <Section id="created" title="SOs created in this period" count={activity.created.length}>
          <SoTable rows={activity.created} />
        </Section>
        <Section id="pis" title="PIs raised in this period" count={activity.pis.length}>
          {activity.pis.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">No PIs.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">SO No.</th>
                    <th className="px-3 py-2">Client</th>
                    <th className="px-3 py-2">PI No.</th>
                    <th className="px-3 py-2">PI date</th>
                    <th className="px-3 py-2 text-right">PI value</th>
                    <th className="px-3 py-2">Payment term</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {activity.pis.map((p, i) => (
                    <tr key={`${p.order_id}-${i}`} className="text-foreground">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link href={`/risansi/orders/${p.order_id}`} className="font-medium text-primary hover:underline">
                          {p.so_no || "—"}
                        </Link>
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-2">{p.client_name || "—"}</td>
                      <td className="px-3 py-2">{p.pi_no || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted">{shortDate(p.pi_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {p.pi_value ? `${p.currency} ${money.format(Number(p.pi_value))}` : "—"}
                      </td>
                      <td className="px-3 py-2">{p.term || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
        <Section id="payments" title="Payments confirmed in this period" count={activity.payments.length}>
          {activity.payments.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">No payments confirmed.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">SO No.</th>
                    <th className="px-3 py-2">Client</th>
                    <th className="px-3 py-2">Payment status</th>
                    <th className="px-3 py-2">Confirmed on</th>
                    <th className="px-3 py-2 text-right">Amount received</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {activity.payments.map((p, i) => (
                    <tr key={`${p.order_id}-${i}`} className="text-foreground">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link href={`/risansi/orders/${p.order_id}`} className="font-medium text-primary hover:underline">
                          {p.so_no || "—"}
                        </Link>
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-2">{p.client_name || "—"}</td>
                      <td className="px-3 py-2">{p.payment_status || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted">{shortDate(p.confirmed_on)}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {p.amount_received ? `${p.currency} ${money.format(Number(p.amount_received))}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {p.balance ? `${p.currency} ${money.format(Number(p.balance))}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </section>
    </div>
  );
}
