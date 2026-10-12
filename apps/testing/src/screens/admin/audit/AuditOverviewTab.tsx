"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getAuditOverview } from "@/services/adminService";
import { SkeletonPage } from "@/components/ui/Skeleton";
import ChartCard from "@/components/charts/ChartCard";
import StackedBarChart, { type BarSeries } from "@/components/charts/StackedBarChart";
import DonutChart from "@/components/charts/DonutChart";
import BarList from "@/components/charts/BarList";
import Heatmap from "@/components/charts/Heatmap";
import Segmented from "./Segmented";
import { auditIcons } from "./auditIcons";
import Leaderboard from "./Leaderboard";
import UserDayMatrix, { type MatrixRow } from "./UserDayMatrix";
import {
  assignColors,
  dayShort,
  formatDuration,
  formatDurationShort,
  hourSlot,
  ROLE_LABELS,
  timeAgo,
  WEEKDAYS,
} from "./auditFormat";
import type { AuditCount, AuditOverview, AuditRange } from "@/types/testing";

type TrendMetric = "events" | "users" | "active" | "created";
type UserMatrixMode = "active" | "actions";
type CreatedMode = "both" | "requisitions" | "reports";
type SystemMode = "browser" | "os";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

const DEVICE_COLORS = { Desktop: "var(--series-1)", Mobile: "var(--series-2)", Tablet: "var(--series-3)" };
const BROWSER_COLORS = { Chrome: "var(--series-1)", Edge: "var(--series-2)", Firefox: "var(--series-3)", Safari: "var(--series-4)" };
const OS_COLORS = { Windows: "var(--series-1)", macOS: "var(--series-2)", Android: "var(--series-3)", iOS: "var(--series-4)" };

const ADOPTION_TONES = {
  default: "text-text-h",
  accent: "text-accent",
  pos: "text-pos-strong",
  warn: "text-warn",
  neg: "text-neg-strong",
} as const;

/** One cell of the Adoption strip: small uppercase label, big monospace figure, one muted line. */
const AdoptionTile = ({ label, value, sub, tone = "default" }: { label: string; value: string; sub: string; tone?: keyof typeof ADOPTION_TONES }) => (
  <div className="flex flex-col gap-1.5 px-5 py-4">
    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">{label}</div>
    <div className={`font-mono text-[30px] font-medium leading-none tabular-nums ${ADOPTION_TONES[tone]}`}>{value}</div>
    <div className="text-xs leading-snug text-text-muted">{sub}</div>
  </div>
);

/** "30 days · 2026-09-02 to 2026-10-01" style caption for a panel header. */
const rangeLabel = (days: string[]) =>
  days.length ? `${days.length} day${days.length === 1 ? "" : "s"} · ${days[0]} to ${days[days.length - 1]}` : "no days in range";

/** A small "icon chip + label + headline + detail" card for the insight strip. */
const InsightCard = ({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) => (
  <div className="flex items-center gap-3.5 rounded-xl border border-border bg-surface px-4 py-3.5 shadow-sm">
    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent text-white" aria-hidden="true">
      {icon}
    </span>
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <div className="truncate text-[15px] font-semibold text-text-h" title={value}>
        {value}
      </div>
      <div className="truncate text-xs text-text-muted">{detail}</div>
    </div>
  </div>
);

/** Donut + legend for one categorical breakdown of sign-ins. */
const ShareDonut = ({ items, colors, centerLabel }: { items: AuditCount[]; colors: Record<string, string>; centerLabel: string }) => (
  <DonutChart
    centerLabel={centerLabel}
    size={168}
    segments={items.map((i) => ({ key: i.label, label: i.label, value: i.count, color: colors[i.label] }))}
  />
);

const AuditOverviewTab = ({ range }: { range: AuditRange }) => {
  const [data, setData] = useState<AuditOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [trendMetric, setTrendMetric] = useState<TrendMetric>("events");
  const [userMatrixMode, setUserMatrixMode] = useState<UserMatrixMode>("active");
  const [createdMode, setCreatedMode] = useState<CreatedMode>("both");
  const [systemMode, setSystemMode] = useState<SystemMode>("browser");

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    getAuditOverview(range)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the audit overview. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const trend = useMemo(() => {
    if (!data) return null;
    const col = (pick: (d: AuditOverview["daily"][number]) => number) => data.daily.map(pick);
    const table = (series: BarSeries[], format: (n: number) => string) => ({
      columns: ["Day", ...series.map((s) => s.label)],
      rows: data.days.map((day, i) => [dayShort(day), ...series.map((s) => format(s.values[i] ?? 0))]),
    });
    const plain = (n: number) => String(n);

    const defs: Record<TrendMetric, { series: BarSeries[]; format: (n: number) => string; subtitle: string }> = {
      events: {
        series: [
          { key: "actions", label: "Actions", color: "var(--series-1)", values: col((d) => d.actions) },
          { key: "sign_ins", label: "Sign-ins", color: "var(--series-3)", values: col((d) => d.sign_ins) },
          { key: "sign_outs", label: "Sign-outs", color: "var(--text-faint)", values: col((d) => d.sign_outs) },
          { key: "failed", label: "Failed sign-ins", color: "var(--status-critical)", values: col((d) => d.failed) },
        ],
        format: plain,
        subtitle: "Everything that happened, per IST day",
      },
      users: {
        series: [{ key: "users", label: "Active users", color: "var(--series-1)", values: col((d) => d.users) }],
        format: plain,
        subtitle: "Distinct people with any activity, per IST day",
      },
      active: {
        series: [
          { key: "hours", label: "Active time (hours)", color: "var(--series-1)", values: col((d) => Math.round((d.active_seconds / 3600) * 10) / 10) },
        ],
        format: (n) => `${n}h`,
        subtitle: "Session time, per IST day of sign-in",
      },
      created: {
        series: [
          { key: "requisitions", label: "Requisitions", color: "var(--series-1)", values: col((d) => d.requisitions) },
          { key: "reports", label: "Reports", color: "var(--series-2)", values: col((d) => d.reports) },
        ],
        format: plain,
        subtitle: "Requisitions raised and reports filed, per IST day",
      },
    };
    const def = defs[trendMetric];
    return { ...def, table: table(def.series, def.format) };
  }, [data, trendMetric]);

  if (isLoading && !data) return <SkeletonPage cards={3} />;
  if (!data) return <p className="text-sm font-medium text-neg">{error || "Nothing to show."}</p>;

  const { kpis, insights, event_types: ev, adoption } = data;
  const totalEvents = ev.actions + ev.sign_ins + ev.failed_sign_ins + ev.sign_outs;
  const clipped = data.days.length > data.matrix_days.length;

  // ---- Event types ----
  const eventSegments = [
    { key: "actions", label: "Actions", value: ev.actions, color: "var(--series-1)" },
    { key: "sign_ins", label: "Sign-ins", value: ev.sign_ins, color: "var(--series-3)" },
    { key: "failed", label: "Failed sign-ins", value: ev.failed_sign_ins, color: "var(--status-critical)" },
    { key: "sign_outs", label: "Sign-outs", value: ev.sign_outs, color: "var(--text-faint)" },
  ];

  // ---- Action breakdown: top 7, the rest folded into "Other" ----
  const actionTotal = sum(data.action_breakdown.map((a) => a.count));
  const actionItems =
    data.action_breakdown.length > 8
      ? [...data.action_breakdown.slice(0, 7), { label: "Other", count: sum(data.action_breakdown.slice(7).map((a) => a.count)) }]
      : data.action_breakdown;

  // ---- Per-user grids ----
  const mostActive = insights.top_user;
  const daysActive = (cells: number[]) => cells.filter((c) => c > 0).length;
  const roleOf = (role: string | null) => (role ? (ROLE_LABELS[role] ?? role) : "Removed user");

  const userRows: MatrixRow[] = data.user_days.map((u) => {
    const cells = userMatrixMode === "active" ? u.active_seconds : u.actions;
    return {
      key: u.user_id,
      email: u.email,
      name: u.name,
      sub: `${roleOf(u.role)} · ${daysActive(cells)} day${daysActive(cells) === 1 ? "" : "s"}`,
      cells,
      total: sum(cells),
    };
  });
  if (userMatrixMode === "actions") userRows.sort((a, b) => b.total - a.total);

  const createdCells = (u: AuditOverview["user_days"][number]) =>
    createdMode === "requisitions" ? u.requisitions : createdMode === "reports" ? u.reports : u.requisitions.map((r, i) => r + u.reports[i]);
  const createdRows: MatrixRow[] = data.user_days
    .map((u) => {
      const cells = createdCells(u);
      return {
        key: u.user_id,
        email: u.email,
        name: u.name,
        sub: `${sum(u.requisitions)} requisition${sum(u.requisitions) === 1 ? "" : "s"} · ${sum(u.reports)} report${sum(u.reports) === 1 ? "" : "s"}`,
        cells,
        total: sum(cells),
      } satisfies MatrixRow;
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  const createdFooter = {
    label: "All users",
    cells: data.matrix_days.map((_, i) => sum(createdRows.map((r) => r.cells[i]))),
    total: sum(createdRows.map((r) => r.total)),
  };

  // ---- Devices / browsers / OS ----
  const deviceColors = assignColors(data.devices.map((d) => d.label), DEVICE_COLORS);
  const systemItems = systemMode === "browser" ? data.browsers : data.operating_systems;
  const systemColors = assignColors(systemItems.map((d) => d.label), systemMode === "browser" ? BROWSER_COLORS : OS_COLORS);
  const hasUnknown = data.devices.some((d) => d.label === "Unknown");
  const hasClientData = data.devices.some((d) => d.label !== "Unknown");

  return (
    <div className={`flex flex-col gap-5 transition-opacity ${isLoading ? "pointer-events-none opacity-60" : ""}`}>
      {error && <p className="text-sm font-medium text-neg">{error}</p>}

      {/* ---- Adoption: who actually uses the portal ---- */}
      <section className="viz-root overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border px-5 py-3.5">
          <h2 className="m-0 font-mono text-xs font-bold uppercase tracking-[0.14em] text-accent">Adoption</h2>
          <p className="m-0 text-xs text-text-muted">{rangeLabel(data.days)}</p>
        </div>
        <div className="grid grid-cols-2 divide-border md:grid-cols-4 xl:grid-cols-7 xl:divide-x [&>*]:border-b [&>*]:border-border xl:[&>*]:border-b-0">
          <AdoptionTile
            label="Active users"
            value={adoption.active_users.toLocaleString()}
            tone="pos"
            sub={`of ${adoption.accounts} accounts · ${pct(adoption.active_users, adoption.accounts)}%`}
          />
          <AdoptionTile label="Never signed in" value={adoption.never_signed_in.toLocaleString()} tone={adoption.never_signed_in > 0 ? "neg" : "default"} sub="accounts with no login ever" />
          <AdoptionTile
            label="Dormant"
            value={adoption.dormant.toLocaleString()}
            tone={adoption.dormant > 0 ? "warn" : "default"}
            sub={`signed in once, nothing in ${adoption.window_days ? `${adoption.window_days} days` : "this range"}`}
          />
          <AdoptionTile
            label="Sessions"
            value={adoption.sessions.toLocaleString()}
            sub={adoption.sessions ? `avg ${Math.max(1, Math.round(adoption.avg_session_seconds / 60))} min each` : "no sessions"}
          />
          <AdoptionTile
            label="Active hours"
            value={(Math.round((adoption.active_seconds / 3600) * 10) / 10).toLocaleString()}
            sub={`${adoption.page_views.toLocaleString()} page views`}
          />
          <AdoptionTile label="Records touched" value={ev.actions.toLocaleString()} tone="accent" sub="things created, edited or deleted" />
          <AdoptionTile label="Sign-ins" value={kpis.sign_ins.toLocaleString()} sub={`${kpis.failed_sign_ins.toLocaleString()} failed`} />
        </div>
      </section>

      {/* ---- Insights ---- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <InsightCard
          icon={auditIcons.calendar()}
          label="Busiest day"
          value={insights.busiest_day ? dayShort(insights.busiest_day.day) : "—"}
          detail={insights.busiest_day ? `${insights.busiest_day.events.toLocaleString()} events · ${insights.busiest_day.users} user${insights.busiest_day.users === 1 ? "" : "s"}` : "No activity in this range"}
        />
        <InsightCard
          icon={auditIcons.flame()}
          label="Peak hour (IST)"
          value={insights.peak_hour ? hourSlot(insights.peak_hour.hour) : "—"}
          detail={
            insights.peak_hour?.hottest
              ? `Hottest slot: ${WEEKDAYS[insights.peak_hour.hottest.dow]} ${String(insights.peak_hour.hottest.hour).padStart(2, "0")}:00 (${insights.peak_hour.hottest.events})`
              : "No activity in this range"
          }
        />
        <InsightCard
          icon={auditIcons.users()}
          label="Most active user"
          value={mostActive ? (mostActive.email ?? mostActive.name ?? "Unknown user") : "—"}
          detail={mostActive ? `${formatDuration(mostActive.active_seconds)} active · ${mostActive.actions.toLocaleString()} actions` : "No activity in this range"}
        />
      </div>

      {/* ---- Podium ---- */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Leaderboard
          title="Top 3 · Active time"
          subtitle="Most signed-in session time in this range"
          leaders={data.leaderboards.by_time}
          formatValue={formatDuration}
          shareOf="of all session time"
          valueLabel="Active time"
          emptyText="No sessions in this range."
        />
        <Leaderboard
          title="Top 3 · Actions"
          subtitle="Most creates, updates and deletes in this range"
          leaders={data.leaderboards.by_actions}
          formatValue={(n) => n.toLocaleString()}
          shareOf="of all actions"
          valueLabel="Actions"
          emptyText="No actions in this range."
        />
      </div>

      {/* ---- Trend + event types ---- */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <ChartCard
          variant="panel"
          className="xl:col-span-2"
          title="Activity trend"
          icon={auditIcons.pulse()}
          subtitle={`Per IST day · ${data.days.length} day${data.days.length === 1 ? "" : "s"}${data.daily_capped ? " (latest)" : ""}`}
          legend={trend!.series.map((s) => ({ label: s.label, color: s.color, shape: "rect" as const }))}
          table={trend!.table}
          actions={
            <Segmented<TrendMetric>
              ariaLabel="Trend metric"
              value={trendMetric}
              onChange={setTrendMetric}
              options={[
                { value: "events", label: "Events" },
                { value: "users", label: "Users" },
                { value: "active", label: "Active time" },
                { value: "created", label: "Created" },
              ]}
            />
          }
        >
          <StackedBarChart keys={data.days} series={trend!.series} format={trend!.format} />
        </ChartCard>

        <ChartCard
          variant="panel"
          title="Event types"
          icon={auditIcons.shield()}
          subtitle="Sign-ins, failures and actions"
          table={{
            columns: ["Type", "Events", "Share"],
            rows: eventSegments.map((s) => [s.label, s.value, `${pct(s.value, totalEvents)}%`]),
          }}
        >
          <DonutChart centerLabel="events" segments={eventSegments} />
        </ChartCard>
      </div>

      {/* ---- When people work + action breakdown ---- */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <ChartCard
          variant="panel"
          className="xl:col-span-2"
          title="When people work"
          icon={auditIcons.flame()}
          subtitle="Events by weekday and hour, IST · failed sign-ins excluded"
          table={{
            columns: ["Hour (IST)", ...WEEKDAYS],
            rows: Array.from({ length: 24 }, (_, h) => [hourSlot(h), ...WEEKDAYS.map((_, dow) => data.heatmap[dow][h])]),
          }}
        >
          <Heatmap
            months={Array.from({ length: 24 }, (_, h) => String(h))}
            rows={WEEKDAYS.map((label, dow) => ({ label, counts: data.heatmap[dow] }))}
            formatColumn={(key, i) => (i % 3 === 0 ? key.padStart(2, "0") : "")}
            formatColumnLong={(key) => hourSlot(Number(key))}
            unit="event"
            labelWidth={36}
            minColumnWidth={18}
          />
        </ChartCard>

        <ChartCard
          variant="panel"
          title="Action breakdown"
          icon={auditIcons.grid()}
          subtitle="What was done"
          table={{
            columns: ["Action", "Count", "Share"],
            rows: data.action_breakdown.map((a) => [a.label, a.count, `${pct(a.count, actionTotal)}%`]),
          }}
        >
          <BarList
            emptyText="No actions in this range."
            items={actionItems.map((a) => ({
              key: a.label,
              label: a.label,
              value: a.count,
              detail: `${pct(a.count, actionTotal)}% of ${actionTotal.toLocaleString()} actions`,
            }))}
          />
        </ChartCard>
      </div>

      {/* ---- Daily user activity ---- */}
      <ChartCard
        variant="panel"
        title="Daily user activity"
        icon={auditIcons.users()}
        subtitle={`Each user's ${userMatrixMode === "active" ? "session time" : "actions"} per IST day — hover a cell for details${clipped ? ` · latest ${data.matrix_days.length} days` : ""}`}
        table={{
          columns: ["User", ...data.matrix_days.map(dayShort), "Total"],
          rows: userRows.map((r) => [
            r.email ?? r.name ?? "Unknown",
            ...r.cells.map((c) => (userMatrixMode === "active" ? (c ? formatDuration(c) : "—") : c || "—")),
            userMatrixMode === "active" ? formatDuration(r.total) : r.total,
          ]),
        }}
        actions={
          <Segmented<UserMatrixMode>
            ariaLabel="Grid metric"
            value={userMatrixMode}
            onChange={setUserMatrixMode}
            options={[
              { value: "active", label: "Active time" },
              { value: "actions", label: "Actions" },
            ]}
          />
        }
      >
        <UserDayMatrix
          days={data.matrix_days}
          rows={userRows}
          formatCell={userMatrixMode === "active" ? formatDurationShort : String}
          formatTotal={userMatrixMode === "active" ? formatDuration : String}
        />
      </ChartCard>

      {/* ---- Created per user ---- */}
      <ChartCard
        variant="panel"
        title="Requisitions & reports created"
        icon={auditIcons.tag()}
        subtitle={`Who created what, per IST day${clipped ? ` · latest ${data.matrix_days.length} days` : ""}`}
        table={{
          columns: ["User", ...data.matrix_days.map(dayShort), "Total"],
          rows: createdRows.map((r) => [r.email ?? r.name ?? "Unknown", ...r.cells.map((c) => c || "—"), r.total]),
        }}
        actions={
          <Segmented<CreatedMode>
            ariaLabel="Created type"
            value={createdMode}
            onChange={setCreatedMode}
            options={[
              { value: "both", label: "Both" },
              { value: "requisitions", label: "Requisitions" },
              { value: "reports", label: "Reports" },
            ]}
          />
        }
      >
        <UserDayMatrix
          days={data.matrix_days}
          rows={createdRows}
          formatCell={String}
          formatTotal={String}
          footer={createdFooter}
          emptyText="Nothing was created in this range."
        />
      </ChartCard>

      {/* ---- Where people sign in from ---- */}
      <div className={hasClientData ? "grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3" : undefined}>
        {/* Hidden until at least one sign-in has a recorded browser -- an all-"Unknown" donut says nothing. */}
        {hasClientData && (
          <>
            <ChartCard
              variant="panel"
              title="Devices"
              icon={auditIcons.monitor()}
              subtitle="Desktop, mobile or tablet · share of sign-ins"
              table={{ columns: ["Device", "Sign-ins"], rows: data.devices.map((d) => [d.label, d.count]) }}
            >
              {data.devices.length === 0 ? (
                <p className="py-6 text-center text-sm text-text-muted">No sign-ins in this range.</p>
              ) : (
                <ShareDonut items={data.devices} colors={deviceColors} centerLabel="sign-ins" />
              )}
              {hasUnknown && (
                <p className="mt-3 text-[11px] text-text-muted">Unknown = sign-ins from before browser details were recorded.</p>
              )}
            </ChartCard>

            <ChartCard
              variant="panel"
              title={systemMode === "browser" ? "Browsers" : "Operating systems"}
              icon={auditIcons.monitor()}
              subtitle="Share of sign-ins"
              table={{ columns: [systemMode === "browser" ? "Browser" : "OS", "Sign-ins"], rows: systemItems.map((d) => [d.label, d.count]) }}
              actions={
                <Segmented<SystemMode>
                  ariaLabel="Browser or OS"
                  value={systemMode}
                  onChange={setSystemMode}
                  options={[
                    { value: "browser", label: "Browser" },
                    { value: "os", label: "OS" },
                  ]}
                />
              }
            >
              {systemItems.length === 0 ? (
                <p className="py-6 text-center text-sm text-text-muted">No sign-ins in this range.</p>
              ) : (
                <ShareDonut items={systemItems} colors={systemColors} centerLabel="sign-ins" />
              )}
            </ChartCard>
          </>
        )}

        <ChartCard
          variant="panel"
          title="IP addresses"
          icon={auditIcons.globe()}
          subtitle="Where activity came from · top 10"
          table={{
            columns: ["IP address", "Events", "Users", "Failed", "Last seen"],
            rows: data.ips.map((i) => [i.ip, i.events, i.users, i.failed, timeAgo(i.last_at)]),
          }}
        >
          {data.ips.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">No IP addresses recorded in this range.</p>
          ) : (
            <ul className="-mx-1 flex max-h-[340px] flex-col overflow-y-auto">
              {data.ips.map((i) => (
                <li key={i.ip} className="flex items-start justify-between gap-3 border-t border-border px-1 py-2.5 first:border-t-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <code className="rounded-md bg-bg-sunk px-2 py-0.5 text-xs text-text-h">{i.ip}</code>
                      {i.failed > 0 && (
                        <span className="rounded-full bg-neg-soft px-2 py-0.5 text-[11px] font-semibold text-neg-strong">✕ {i.failed} failed</span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-[11px] text-text-muted" title={i.emails.join(", ")}>
                      {i.emails.slice(0, 2).join(", ")}
                      {i.emails.length > 2 && ` +${i.emails.length - 2} more`}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-[13px] font-semibold text-text-h" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {i.events.toLocaleString()} <span className="font-normal text-text-muted">events</span>
                    </div>
                    <div className="text-[11px] text-text-muted">
                      {i.users} user{i.users === 1 ? "" : "s"} · {timeAgo(i.last_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
    </div>
  );
};

export default AuditOverviewTab;
