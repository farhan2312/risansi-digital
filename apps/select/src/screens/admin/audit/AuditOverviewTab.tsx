"use client";

import { useMemo, useState, type ReactNode } from "react";

import type { AuditOverview } from "../../../lib/audit-overview-shared";
import { WEEKDAYS } from "../../../lib/audit-overview-shared";
import { formatDuration } from "../../../lib/duration";
import {
  DonutChart,
  fmtDay,
  fmtNum,
  Sparkline,
  TrendChart,
  UserDayHeatmap,
  WeekHourHeatmap,
  type TrendSeries,
} from "../../../components/charts/charts";
import {
  Avatar,
  Card,
  fmtAgo,
  Icons,
  IpChip,
  prettyRole,
  Segmented,
  TrendDelta,
} from "./auditUi";

type TrendMetric = "events" | "users" | "time" | "created";
type UserMetric = "time" | "actions";
type CreatedMetric = "both" | "enquiries" | "tags";

/** Minutes, for chart axes: "95m" reads better than "1h 35m" on a tick. */
const fmtMinutes = (secs: number) => {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
};

/** Cell-sized: "45m", "2.1h". */
const fmtMinutesShort = (secs: number) => {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${(m / 60).toFixed(1)}h` : `${m}m`;
};

function Kpi({
  label,
  value,
  icon,
  tone = "accent",
  foot,
  spark,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: "accent" | "cyan" | "pos" | "warn" | "neg" | "purple";
  foot?: ReactNode;
  spark?: number[];
}) {
  const tones: Record<string, [string, string]> = {
    accent: ["bg-accent-soft text-accent", "var(--brand-blue)"],
    cyan: ["bg-[color-mix(in_srgb,var(--brand-cyan)_15%,transparent)] text-[var(--brand-cyan)]", "var(--brand-cyan)"],
    pos: ["bg-[var(--pos-soft)] text-pos", "var(--pos)"],
    warn: ["bg-[var(--warn-soft)] text-warn", "var(--warn)"],
    neg: ["bg-[var(--neg-soft)] text-neg", "var(--neg)"],
    purple: ["bg-[color-mix(in_srgb,var(--purple)_14%,transparent)] text-[var(--purple)]", "var(--purple)"],
  };
  const [chip, color] = tones[tone]!;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-paper p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">{label}</div>
          <div className="mt-1.5 font-mono text-[24px] font-bold leading-none tracking-tight text-fg tabular-nums">{value}</div>
        </div>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${chip}`}>{icon}</span>
      </div>
      <div className="mt-3 flex min-h-[30px] items-end justify-between gap-2">
        <div className="min-w-0 text-[11.5px] leading-snug text-fg-3">{foot}</div>
        {spark && <Sparkline values={spark} color={color} />}
      </div>
    </div>
  );
}

function Insight({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand-blue)] to-[var(--brand-cyan)] text-white">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3">{label}</div>
        <div className="truncate text-[13.5px] font-semibold text-fg">{value}</div>
        {sub && <div className="truncate text-[11.5px] text-fg-3">{sub}</div>}
      </div>
    </div>
  );
}

export default function AuditOverviewTab({ data, windowLabel }: { data: AuditOverview; windowLabel: string }) {
  const [trend, setTrend] = useState<TrendMetric>("events");
  const [userMetric, setUserMetric] = useState<UserMetric>("time");
  const [created, setCreated] = useState<CreatedMetric>("both");
  const [platformView, setPlatformView] = useState<"browsers" | "os">("browsers");

  const { kpis, previous, daily, days } = data;
  const prev = previous;

  const insights = useMemo(() => {
    const busiest = [...daily].sort((a, b) => b.actions + b.logins - (a.actions + a.logins))[0];
    let peak = { d: 0, h: 0, v: 0 };
    data.heatmap.forEach((row, d) => row.forEach((v, h) => { if (v > peak.v) peak = { d, h, v }; }));
    const hourTotals = Array.from({ length: 24 }, (_, h) => data.heatmap.reduce((s, row) => s + (row[h] ?? 0), 0));
    const peakHour = hourTotals.indexOf(Math.max(...hourTotals));
    const topUser = data.users[0];
    return { busiest, peak, peakHour, hourTotal: hourTotals[peakHour] ?? 0, topUser };
  }, [daily, data.heatmap, data.users]);

  const trendSeries: TrendSeries[] = useMemo(() => {
    const pick = (k: keyof (typeof daily)[number]) => daily.map((d) => Number(d[k]) || 0);
    if (trend === "users") return [{ key: "users", label: "Active users", color: "var(--purple)", values: pick("users") }];
    if (trend === "time") return [{ key: "time", label: "Active time", color: "var(--pos)", values: pick("activeSeconds") }];
    if (trend === "created")
      return [
        { key: "enq", label: "Enquiries", color: "var(--brand-blue)", values: pick("enquiries") },
        { key: "tags", label: "Tags", color: "var(--brand-cyan)", values: pick("tags") },
      ];
    return [
      { key: "actions", label: "Actions", color: "var(--brand-blue)", values: pick("actions") },
      { key: "logins", label: "Sign-ins", color: "var(--brand-cyan)", values: pick("logins") },
      { key: "failed", label: "Failed sign-ins", color: "var(--neg)", values: pick("failed") },
    ];
  }, [daily, trend]);


  const userRows = data.users.map((u) => ({
    key: u.email,
    label: (
      <span className="inline-flex items-center gap-2">
        <Avatar email={u.email} size={20} />
        <span className="truncate">{u.email}</span>
      </span>
    ),
    sub: (
      <span className="pl-7">
        {prettyRole(u.role)} · {u.activeDays} day{u.activeDays === 1 ? "" : "s"}
      </span>
    ),
    values: Object.fromEntries(
      Object.values(u.days).map((c) => [c.day, userMetric === "time" ? c.activeSeconds : c.actions]),
    ),
    detail: (day: string) => {
      const c = u.days[day];
      return (
        <div className="space-y-0.5">
          <div className="flex justify-between gap-4"><span className="text-fg-2">Active time</span><b className="font-mono">{formatDuration(c?.activeSeconds ?? 0)}</b></div>
          <div className="flex justify-between gap-4"><span className="text-fg-2">Actions</span><b className="font-mono">{c?.actions ?? 0}</b></div>
          <div className="flex justify-between gap-4"><span className="text-fg-2">Enquiries / Tags</span><b className="font-mono">{c?.enquiries ?? 0} / {c?.tags ?? 0}</b></div>
        </div>
      );
    },
  }));

  const creatorRows = data.users
    .filter((u) => u.enquiries + u.tags > 0)
    .sort((a, b) => b.enquiries + b.tags - (a.enquiries + a.tags))
    .map((u) => ({
      key: u.email,
      label: (
        <span className="inline-flex items-center gap-2">
          <Avatar email={u.email} size={20} />
          <span className="truncate">{u.email}</span>
        </span>
      ),
      sub: (
        <span className="pl-7">
          {u.enquiries} enquir{u.enquiries === 1 ? "y" : "ies"} · {u.tags} tag{u.tags === 1 ? "" : "s"}
        </span>
      ),
      values: Object.fromEntries(
        Object.values(u.days).map((c) => [
          c.day,
          created === "enquiries" ? c.enquiries : created === "tags" ? c.tags : c.enquiries + c.tags,
        ]),
      ),
      detail: (day: string) => {
        const c = u.days[day];
        return (
          <div className="space-y-0.5">
            <div className="flex justify-between gap-4"><span className="text-fg-2">Enquiries created</span><b className="font-mono">{c?.enquiries ?? 0}</b></div>
            <div className="flex justify-between gap-4"><span className="text-fg-2">Tags created</span><b className="font-mono">{c?.tags ?? 0}</b></div>
          </div>
        );
      },
    }));

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Enquiries created"
          value={fmtNum(kpis.enquiries)}
          icon={Icons.folder}
          tone="accent"
          spark={daily.map((d) => d.enquiries)}
          foot={<><TrendDelta current={kpis.enquiries} previous={prev?.enquiries} /> {prev && <span>vs previous period</span>}</>}
        />
        <Kpi
          label="Tags created"
          value={fmtNum(kpis.tags)}
          icon={Icons.tag}
          tone="cyan"
          spark={daily.map((d) => d.tags)}
          foot={<><TrendDelta current={kpis.tags} previous={prev?.tags} /> <span>incl. each enquiry&apos;s Default tag</span></>}
        />
        <Kpi
          label="Reports & approvals"
          value={fmtNum(kpis.reports)}
          icon={Icons.file}
          tone="pos"
          foot={<span>reports generated · {fmtNum(kpis.approvalsSent)} approval request{kpis.approvalsSent === 1 ? "" : "s"} sent</span>}
        />
        <Kpi
          label="IP addresses"
          value={fmtNum(kpis.uniqueIps)}
          icon={Icons.globe}
          tone="warn"
          foot={<span>distinct addresses seen · {windowLabel}</span>}
        />
      </div>

      {/* Insights */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Insight
          icon={Icons.calendar}
          label="Busiest day"
          value={insights.busiest && insights.busiest.actions + insights.busiest.logins > 0 ? fmtDay(insights.busiest.day, true) : "—"}
          sub={insights.busiest ? `${fmtNum(insights.busiest.actions)} actions · ${insights.busiest.users} users` : undefined}
        />
        <Insight
          icon={Icons.flame}
          label="Peak hour (IST)"
          value={insights.hourTotal ? `${String(insights.peakHour).padStart(2, "0")}:00 – ${String((insights.peakHour + 1) % 24).padStart(2, "0")}:00` : "—"}
          sub={insights.peak.v ? `Hottest slot: ${WEEKDAYS[insights.peak.d]} ${String(insights.peak.h).padStart(2, "0")}:00 (${insights.peak.v})` : undefined}
        />
        <Insight
          icon={Icons.users}
          label="Most active user"
          value={insights.topUser?.email ?? "—"}
          sub={insights.topUser ? `${formatDuration(insights.topUser.activeSeconds)} active · ${fmtNum(insights.topUser.actions)} actions` : undefined}
        />
      </div>

      {/* Trend + event types */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          icon={Icons.activity}
          title="Activity trend"
          subtitle={`Per IST day · ${windowLabel}${data.daysCapped ? " (last 92 days)" : ""}`}
          action={
            <Segmented<TrendMetric>
              value={trend}
              onChange={setTrend}
              options={[
                { key: "events", label: "Events" },
                { key: "users", label: "Users" },
                { key: "time", label: "Active time" },
                { key: "created", label: "Enquiries & tags" },
              ]}
            />
          }
        >
          {days.length === 0 ? (
            <p className="py-16 text-center text-[12.5px] text-fg-3">Nothing recorded in this period</p>
          ) : (
            <>
              <TrendChart
                days={days}
                series={trendSeries}
                mode={trend === "users" || trend === "time" ? "line" : "bars"}
                format={trend === "time" ? fmtMinutes : fmtNum}
              />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-11">
                {trendSeries.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-2">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card icon={Icons.shield} title="Event types" subtitle="Sign-ins, failures and actions">
          <DonutChart
            items={data.eventTypes}
            centerLabel="events"
            colors={{
              Actions: "var(--brand-blue)",
              "Sign-ins": "var(--brand-cyan)",
              "Failed sign-ins": "var(--neg)",
              "Sign-outs": "#64748b",
            }}
          />
        </Card>
      </div>

      {/* Heatmap + actions */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          icon={Icons.flame}
          title="When people work"
          subtitle="Events by weekday and hour, IST · failed sign-ins excluded"
        >
          <WeekHourHeatmap data={data.heatmap} />
        </Card>
        <Card icon={Icons.overview} title="Action breakdown" subtitle="What was done">
          <DonutChart items={data.actionBreakdown} centerLabel="actions" maxSlices={7} />
        </Card>
      </div>

      {/* Daily user activity */}
      <Card
        icon={Icons.users}
        title="Daily user activity"
        subtitle="Each user's activity per IST day — hover a cell for details"
        action={
          <Segmented<UserMetric>
            value={userMetric}
            onChange={setUserMetric}
            options={[
              { key: "time", label: "Active time" },
              { key: "actions", label: "Actions" },
            ]}
          />
        }
      >
        <UserDayHeatmap
          days={days}
          rows={userRows}
          format={userMetric === "time" ? fmtMinutes : fmtNum}
          cellFormat={userMetric === "time" ? fmtMinutesShort : fmtNum}
          color={userMetric === "time" ? "var(--pos)" : "var(--brand-blue)"}
        />
      </Card>

      {/* Enquiries & tags per user per day */}
      <Card
        icon={Icons.tag}
        title="Enquiries & tags created"
        subtitle="Who created what, per IST day"
        action={
          <Segmented<CreatedMetric>
            value={created}
            onChange={setCreated}
            options={[
              { key: "both", label: "Both" },
              { key: "enquiries", label: "Enquiries" },
              { key: "tags", label: "Tags" },
            ]}
          />
        }
      >
        <UserDayHeatmap days={days} rows={creatorRows} color="var(--brand-cyan)" />
      </Card>

      {/* Devices + IP addresses */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card icon={Icons.monitor} title="Devices" subtitle="Desktop, mobile or tablet · share of events">
          <DonutChart
            items={data.devices}
            centerLabel="events"
            colors={{ Desktop: "var(--brand-blue)", Mobile: "var(--brand-cyan)", Tablet: "var(--purple)", Unknown: "#64748b" }}
          />
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3">
            {data.devices.slice(0, 4).map((d) => (
              <div key={d.label} className="rounded-lg bg-elev px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3">{d.label}</div>
                <div className="mt-0.5 text-[12.5px] text-fg-2">
                  <b className="font-mono text-fg">{d.users}</b> user{d.users === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          icon={Icons.globe}
          title={platformView === "os" ? "Operating systems" : "Browsers"}
          subtitle="Share of events"
          action={
            <Segmented
              value={platformView}
              onChange={setPlatformView}
              options={[
                { key: "browsers", label: "Browser" },
                { key: "os", label: "OS" },
              ]}
            />
          }
        >
          <DonutChart items={platformView === "os" ? data.os : data.browsers} centerLabel="events" />
          <ul className="mt-4 space-y-1 border-t border-line pt-3 text-[12px] text-fg-3">
            {(platformView === "os" ? data.os : data.browsers).slice(0, 4).map((d) => (
              <li key={d.label} className="flex justify-between gap-3">
                <span>{d.label}</span>
                <span><b className="font-mono text-fg">{d.users}</b> user{d.users === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* Scrolls inside the card so it stays as tall as the two pie charts. */}
        <Card
          className="flex flex-col lg:col-span-2 xl:col-span-1"
          icon={Icons.globe}
          title="IP addresses"
          subtitle={`Where activity came from · top ${data.ips.length}`}
          bodyClassName="relative min-h-[240px] flex-1"
        >
          {data.ips.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-fg-3">Nothing recorded</p>
          ) : (
            <ul className="max-h-[360px] divide-y divide-line overflow-y-auto xl:absolute xl:inset-0 xl:max-h-none">
              {data.ips.map((ip) => (
                <li key={ip.ip} className="flex items-center gap-3 px-4 py-2.5 hover:bg-elev">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <IpChip ip={ip.ip} />
                      {ip.failed > 0 && (
                        <span className="rounded-full bg-[var(--neg-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold text-neg">
                          {ip.failed} failed
                        </span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-[11.5px] text-fg-3" title={ip.emails.join(", ")}>
                      {ip.emails.slice(0, 2).join(", ")}
                      {ip.emails.length > 2 ? ` +${ip.emails.length - 2} more` : ""}
                    </div>
                  </div>
                  <div className="text-right text-[11.5px] text-fg-3">
                    <div><b className="font-mono text-fg">{fmtNum(ip.events)}</b> events</div>
                    <div>{ip.users} user{ip.users === 1 ? "" : "s"} · {fmtAgo(ip.lastAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
