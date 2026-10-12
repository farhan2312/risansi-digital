"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import "../dashboard/DashboardPage.css"; // reuses .status-pill / .status-* colors
import { getOverview, listPumpModels } from "@/services/testingService";
import { useAuth } from "@/contexts/AuthContext";
import { SkeletonPage } from "@/components/ui/Skeleton";
import HeroHeader from "@/components/ui/HeroHeader";
import { formatDate } from "@/lib/formUtils";
import ChartCard from "@/components/charts/ChartCard";
import KpiGroupCard from "@/components/charts/KpiGroupCard";
import LineChart from "@/components/charts/LineChart";
import BarList from "@/components/charts/BarList";
import Heatmap, { monthRange } from "@/components/charts/Heatmap";
import { monthLong } from "@/components/charts/chartUtils";
import DrillDownModal from "@/components/ui/DrillDownModal";
import ImprovementModelsPanel from "@/components/ui/ImprovementModels";
import DateRangeFilter from "@/components/ui/DateRangeFilter";
import { presetValue, type DateRangeValue, type PresetKey } from "@/lib/dateRangePresets";
import { RAISED_BY_LABELS } from "@/lib/raisedBy";
import { REQUISITION_CATEGORIES, type PortalOverview, type RequisitionStatus } from "@/types/testing";

const STATUS_OPTIONS: RequisitionStatus[] = ["Pending", "In Testing", "Retest Needed", "Closed"];

const OVERVIEW_PRESETS: Exclude<PresetKey, "custom">[] = ["today", "week", "month", "7d", "30d", "90d", "all"];

/** Picking this category swaps the dashboard's figures for the list of improvement models (VE & ME Performance). */
const IMPROVEMENT_CATEGORY = "Against Improvement Project";

const FORMAT_LABELS: Record<string, string> = {
  observation: "Observation Sheet",
  "viscosity-chart": "Viscosity Chart",
};

const timeOfDayGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
};

const TODAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(new Date());

const pctChange = (now: number, before: number | undefined) =>
  before === undefined ? null : before === 0 ? (now === 0 ? 0 : null) : ((now - before) / before) * 100;

const DeadlineBadge = ({ daysLeft }: { daysLeft: number }) => {
  if (daysLeft < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-neg-soft px-2 py-0.5 text-xs font-semibold text-neg-strong">
        ⚠ {Math.abs(daysLeft)}d overdue
      </span>
    );
  }
  if (daysLeft <= 5) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">
        ⏰ {daysLeft === 0 ? "due today" : `in ${daysLeft}d`}
      </span>
    );
  }
  return <span className="text-xs text-text-muted">in {daysLeft}d</span>;
};

const ResultBadge = ({ unmet, hasTarget }: { unmet: string[]; hasTarget: boolean }) => {
  if (!hasTarget) return <span className="text-xs text-text-faint">No target</span>;
  if (unmet.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-pos-soft px-2 py-0.5 text-xs font-semibold text-pos-strong">
        ✓ Met
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-neg-soft px-2 py-0.5 text-xs font-semibold text-neg-strong"
      title={`Outside rated ${unmet.join(", ")}`}
    >
      ✕ Missed {unmet.join(", ")}
    </span>
  );
};

const OverviewPage = () => {
  const { user } = useAuth();
  const [data, setData] = useState<PortalOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [range, setRange] = useState<DateRangeValue>(() => presetValue("all"));
  const [mine, setMine] = useState(false);
  const preset = range.preset;
  // Category / model / status narrow every card, chart and list below; "" = no filter.
  const [category, setCategory] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const filtersActive = !!(category || model || status);
  const improvementMode = category === IMPROVEMENT_CATEGORY;
  useEffect(() => {
    listPumpModels()
      .then(setModelOptions)
      .catch(() => setModelOptions([]));
  }, []);
  // Clicking any card / bar / cell whose link is a filtered list opens that list here instead of leaving the dashboard.
  const [drillHref, setDrillHref] = useState<string | null>(null);
  const openDrillDown = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = (e.target as HTMLElement).closest("a")?.getAttribute("href");
    if (!target || !/^\/(dashboard|reports)\?/.test(target)) return;
    // Runs in the capture phase (see onClickCapture below): next/link's own click handler would otherwise
    // fire first and navigate away, so this has to stop the click before it reaches the link.
    e.preventDefault();
    e.stopPropagation();
    setDrillHref(target);
  };

  useEffect(() => {
    let cancelled = false;
    // The improvement view does not use these figures at all, so there is nothing to fetch for it.
    if (improvementMode) {
      setIsLoading(false);
      setLoadError("");
      return;
    }
    setIsLoading(true);
    setLoadError("");
    getOverview({
      from: range.from || undefined,
      to: range.to || undefined,
      mine,
      category: category || undefined,
      model: model || undefined,
      status: status || undefined,
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load the dashboard. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, mine, category, model, status, improvementMode]);

  // Every drill-down carries the dashboard's current window with it.
  const summaryHref = useMemo(
    () => (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams();
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      if (category) params.set("category", category);
      if (model) params.set("model", model);
      if (status) params.set("status", status);
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
      const qs = params.toString();
      return `/dashboard${qs ? `?${qs}` : ""}`;
    },
    [range.from, range.to, category, model, status]
  );

  // Report Archive, narrowed to reports tested inside the same window.
  const reportsHref = useMemo(
    () => (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams();
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      if (category) params.set("category", category);
      if (model) params.set("model", model);
      if (status) params.set("status", status);
      for (const [k, v] of Object.entries(extra)) params.set(k, v);
      const qs = params.toString();
      return `/reports${qs ? `?${qs}` : ""}`;
    },
    [range.from, range.to, category, model, status]
  );

  if (isLoading && !data) return <SkeletonPage cards={3} />;
  if (!data) return <p className="detail-empty">{loadError || "Nothing to show."}</p>;

  const byStatus = data.requisitions_by_status;
  const openCount = data.open_statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);
  const judged = data.requirement_met + data.requirement_unmet;
  const metPct = judged ? Math.round((data.requirement_met / judged) * 100) : null;
  const prev = data.previous_period ?? undefined;
  const months = data.monthly_trend.map((m) => m.month);
  const daily = data.trend_granularity === "day";
  const bucket = daily ? "Day" : "Month";
  const per = daily ? "day" : "month";

  const rawFirstName = (user?.name ?? user?.email ?? "there").trim().split(" ")[0];
  const firstName = rawFirstName.charAt(0).toUpperCase() + rawFirstName.slice(1);

  const pctOfAll = (n: number) => (data.total_requisitions ? `${Math.round((n / data.total_requisitions) * 100)}% of all` : "—");

  // Footer row for the "Requisitions by category" table -- same total/completed/pending identity as each row.
  const categoryTotals = data.requisitions_by_category_status.reduce(
    (sum, c) => ({
      requisitions: sum.requisitions + c.requisitions,
      reports: sum.reports + c.reports,
      total: sum.total + c.total,
      completed: sum.completed + c.completed,
      pending: sum.pending + c.pending,
    }),
    { requisitions: 0, reports: 0, total: 0, completed: 0, pending: 0 }
  );

  return (
    <div className="tw-reset mx-auto flex max-w-[1400px] flex-col gap-4 p-2" onClickCapture={openDrillDown}>
      {drillHref && <DrillDownModal href={drillHref} onClose={() => setDrillHref(null)} />}
      {/* Compact greeting + action; the scope toggle and date filters that drive every widget sit in the band under it. */}
      <HeroHeader
        dense
        title={`${timeOfDayGreeting()}, ${firstName}`}
        subtitle={`${TODAY_LABEL} · requisitions, reports and deadlines at a glance`}
        actions={
          <Link href="/dashboard" className="hero-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
            Go to Testing Summary
          </Link>
        }
      >
        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <div className="range-group" role="group" aria-label="Which requisitions">
            <button type="button" className="range-pill" aria-pressed={!mine} onClick={() => setMine(false)}>
              All requisitions
            </button>
            <button type="button" className="range-pill" aria-pressed={mine} onClick={() => setMine(true)}>
              Created by me
            </button>
          </div>
          <DateRangeFilter presets={OVERVIEW_PRESETS} value={range} onChange={setRange} />
          {isLoading && <span className="ml-auto text-xs text-text-muted">updating…</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-3">
          <select className="dash-filter-select" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {REQUISITION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="none">Uncategorised</option>
          </select>
          <select className="dash-filter-select" aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">All models</option>
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select className="dash-filter-select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button
              type="button"
              className="text-xs font-semibold text-accent hover:underline"
              onClick={() => {
                setCategory("");
                setModel("");
                setStatus("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </HeroHeader>

      {loadError && <p className="text-sm font-medium text-neg">{loadError}</p>}

      {/* Refetch keeps the frame: the previous render dims rather than flashing a skeleton. */}
      {improvementMode ? (
        <ImprovementModelsPanel modelFilter={model} />
      ) : (
      <div className={`flex flex-col gap-5 transition-opacity ${isLoading ? "pointer-events-none opacity-60" : ""}`}>
        {/* ---- KPI cards: compact, each a header over a pair of figure tiles ---- */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KpiGroupCard
            hideSub
            title="Totals"
            icon="folder"
            tint="var(--series-1)"
            tiles={[
              {
                // Everything on record: requisitions raised plus test reports filed.
                label: "Total reports",
                value: (data.total_requisitions + data.total_reports).toLocaleString(),
                sub: `${data.total_requisitions.toLocaleString()} requisitions + ${data.total_reports.toLocaleString()} reports`,
                href: reportsHref({ view: "all" }),
                hint: [
                  "Everything on record in this view: requisitions raised plus test reports filed.",
                  `${data.total_requisitions.toLocaleString()} requisitions + ${data.total_reports.toLocaleString()} reports = ${(data.total_requisitions + data.total_reports).toLocaleString()}`,
                  "Click to open the reports.",
                ],
              },
              {
                // Requisitions still waiting to start (status Pending) -- not In Testing or Retest. "Open now" (below) is
                // the wider count: everything not Closed yet.
                label: "Waiting to start",
                value: (byStatus.Pending ?? 0).toLocaleString(),
                sub: "requisitions pending",
                href: summaryHref({ status: "Pending" }),
                hint: [
                  "Requisitions that have not started testing yet: status Pending.",
                  "In Testing and Retest Needed are not counted here (see Open now for everything not closed).",
                  "Click to open them.",
                ],
              },
            ]}
          />
          <KpiGroupCard
            hideSub
            title="Pending"
            icon="clock"
            tint="var(--series-4)"
            tiles={[
              {
                label: "Requisitions",
                value: (byStatus.Pending ?? 0).toLocaleString(),
                sub: pctOfAll(byStatus.Pending ?? 0),
                href: summaryHref({ status: "Pending" }),
                hint: [
                  `${(byStatus.Pending ?? 0).toLocaleString()} requisitions with status Pending (${pctOfAll(byStatus.Pending ?? 0)}).`,
                  "Raised, but testing has not started yet.",
                  "Click to open them.",
                ],
              },
              {
                label: "Overdue",
                value: data.overdue_count.toLocaleString(),
                sub: `${data.due_soon_count} due in 5 days`,
                tone: data.overdue_count > 0 ? "critical" : undefined,
                href: summaryHref({ scope: "overdue" }),
                hint: [
                  `${data.overdue_count.toLocaleString()} open requisitions are past their target date.`,
                  "Open = Pending, In Testing or Retest Needed. Target date is the date set, or date of requisition + 7 days.",
                  `Another ${data.due_soon_count.toLocaleString()} fall due within the next 5 days.`,
                ],
              },
            ]}
          />
          <KpiGroupCard
            hideSub
            title="In progress"
            icon="activity"
            tint="var(--series-2)"
            tiles={[
              {
                label: "In testing",
                value: (byStatus["In Testing"] ?? 0).toLocaleString(),
                sub: pctOfAll(byStatus["In Testing"] ?? 0),
                href: summaryHref({ status: "In Testing" }),
                hint: [
                  `${(byStatus["In Testing"] ?? 0).toLocaleString()} requisitions currently being tested (${pctOfAll(byStatus["In Testing"] ?? 0)}).`,
                  "Testing has started and the test report is not filed yet.",
                  "Click to open them.",
                ],
              },
              {
                label: "Retest needed",
                value: (byStatus["Retest Needed"] ?? 0).toLocaleString(),
                sub: pctOfAll(byStatus["Retest Needed"] ?? 0),
                href: summaryHref({ status: "Retest Needed" }),
                hint: [
                  `${(byStatus["Retest Needed"] ?? 0).toLocaleString()} requisitions that must be tested again (${pctOfAll(byStatus["Retest Needed"] ?? 0)}).`,
                  "Marked Retest Needed by the testing team, or raised through Assign Retest.",
                  "Click to open them.",
                ],
              },
            ]}
          />
          <KpiGroupCard
            hideSub
            title="Completed"
            icon="check"
            tint="var(--series-3)"
            tiles={[
              {
                // Closed requisitions + every report -- a filed report is finished testing on its own,
                // same "completed" rule as the Requisitions by category table below.
                label: "Completed",
                value: ((byStatus.Closed ?? 0) + data.total_reports).toLocaleString(),
                sub: `${(byStatus.Closed ?? 0).toLocaleString()} requisitions + ${data.total_reports.toLocaleString()} reports`,
                href: summaryHref({ status: "Closed", view: "completed" }),
                hint: [
                  "Finished work: Closed requisitions plus every filed report. A filed report counts as finished testing.",
                  `${(byStatus.Closed ?? 0).toLocaleString()} closed requisitions + ${data.total_reports.toLocaleString()} reports = ${((byStatus.Closed ?? 0) + data.total_reports).toLocaleString()}`,
                  "Click to list the closed requisitions and the reports.",
                ],
              },
              {
                label: "Pass rate",
                value: metPct === null ? "—" : `${metPct}%`,
                sub: judged ? `${data.requirement_met} of ${judged} judged reports met` : "No judged reports",
                href: reportsHref({ view: "all" }),
                hint: [
                  judged ? `${data.requirement_met} of ${judged} reports met their rated target (${metPct}%). ${data.requirement_unmet} missed.` : "No report in this view has a rated target to judge.",
                  "Met = highest Head and Capacity reached the rated values and highest Power stayed within the rated power.",
                  `Missed by parameter: Head ${data.unmet_by_parameter.head}, Capacity ${data.unmet_by_parameter.capacity}, Power ${data.unmet_by_parameter.power}.`,
                ],
              },
            ]}
          />
          <KpiGroupCard
            hideSub
            title="Open & turnaround"
            icon="timer"
            tint="var(--accent)"
            tiles={[
              {
                label: "Open now",
                value: openCount.toLocaleString(),
                sub: "pending · testing · retest",
                href: summaryHref({ scope: "open" }),
                hint: [
                  "Everything not Closed yet.",
                  `Pending ${(byStatus.Pending ?? 0).toLocaleString()} + In Testing ${(byStatus["In Testing"] ?? 0).toLocaleString()} + Retest Needed ${(byStatus["Retest Needed"] ?? 0).toLocaleString()} = ${openCount.toLocaleString()}`,
                  "Click to open them.",
                ],
              },
              {
                label: "Avg turnaround",
                value: data.avg_turnaround_days === null ? "—" : `${data.avg_turnaround_days.toFixed(1)}d`,
                sub: "raised → closed",
                href: summaryHref({ status: "Closed" }),
                hint: [
                  data.avg_turnaround_days === null ? "No closed requisitions in this view yet." : `On average ${data.avg_turnaround_days.toFixed(1)} days from a requisition being raised to it being Closed.`,
                  "Calculated over the Closed requisitions in this view.",
                  "Click to open them.",
                ],
              },
            ]}
          />
        </div>

        <ChartCard
          title="Requisitions by category"
          subtitle="Requisitions raised + reports filed, vs. how much of that is done"
          table={{
            columns: ["Category", "Requisitions", "Reports", "Total", "Completed", "Pending"],
            rows: [
              ...data.requisitions_by_category_status.map((c) => [c.label, c.requisitions, c.reports, c.total, c.completed, c.pending]),
              [
                "Total",
                categoryTotals.requisitions,
                categoryTotals.reports,
                categoryTotals.total,
                categoryTotals.completed,
                categoryTotals.pending,
              ],
            ],
          }}
        >
          {data.requisitions_by_category_status.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">No requisitions or reports in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="pb-2 font-semibold">Category</th>
                    <th className="pb-2 text-right font-semibold">Total</th>
                    <th className="pb-2 text-right font-semibold">Completed</th>
                    <th className="pb-2 text-right font-semibold">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {data.requisitions_by_category_status.map((c) => (
                    <tr key={c.label} className="border-t border-border transition-colors hover:bg-surface-hover">
                      <td className="py-2.5 pr-3 font-medium text-text">{c.label}</td>
                      <td className="py-2.5 pr-3 text-right text-text" style={{ fontVariantNumeric: "tabular-nums" }}>
                        <Link
                          href={summaryHref({ category: c.label === "Uncategorised" ? "none" : c.label })}
                          className="font-semibold text-text hover:text-accent hover:underline"
                          title={`${c.requisitions} requisition${c.requisitions === 1 ? "" : "s"} + ${c.reports} report${c.reports === 1 ? "" : "s"}. Click to open this category's requisitions.`}
                        >
                          {c.total}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                        <Link
                          href={summaryHref({ category: c.label === "Uncategorised" ? "none" : c.label, status: "Closed", view: "completed" })}
                          className="inline-flex rounded-md bg-pos-soft px-2 py-0.5 font-semibold text-pos-strong hover:underline"
                          title={`Closed requisitions + every report (a filed report is finished testing): ${c.completed - c.reports} closed requisition${c.completed - c.reports === 1 ? "" : "s"} + ${c.reports} report${c.reports === 1 ? "" : "s"}. Click to list them.`}
                        >
                          {c.completed}
                        </Link>
                      </td>
                      <td className="py-2.5 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                        <Link
                          href={summaryHref({ category: c.label === "Uncategorised" ? "none" : c.label, scope: "open" })}
                          className={`inline-flex rounded-md px-2 py-0.5 font-semibold hover:underline ${c.pending > 0 ? "bg-neg-soft text-neg-strong" : "bg-bg-sunk text-text-muted"}`}
                          title="Open requisitions in this category (Pending + In Testing + Retest Needed): everything raised here that is not Closed yet"
                        >
                          {c.pending}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border-strong font-semibold">
                    <td className="py-2.5 pr-3 text-text-h">Total</td>
                    <td className="py-2.5 pr-3 text-right text-text-h" style={{ fontVariantNumeric: "tabular-nums" }}>
                      <Link
                        href={summaryHref({ view: "all" })}
                        className="hover:text-accent hover:underline"
                        title={`${categoryTotals.requisitions} requisitions + ${categoryTotals.reports} reports. Click to open all requisitions.`}
                      >
                        {categoryTotals.total}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                      <Link
                        href={summaryHref({ status: "Closed", view: "completed" })}
                        className="inline-flex rounded-md bg-pos-soft px-2 py-0.5 text-pos-strong hover:underline"
                        title={`Closed requisitions + every report: ${categoryTotals.completed - categoryTotals.reports} closed requisitions + ${categoryTotals.reports} reports. Click to list them.`}
                      >
                        {categoryTotals.completed}
                      </Link>
                    </td>
                    <td className="py-2.5 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                      <Link
                        href={summaryHref({ scope: "open" })}
                        className={`inline-flex rounded-md px-2 py-0.5 hover:underline ${categoryTotals.pending > 0 ? "bg-neg-soft text-neg-strong" : "bg-bg-sunk text-text-muted"}`}
                        title="Open requisitions in every category. Click to open them."
                      >
                        {categoryTotals.pending}
                      </Link>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </ChartCard>

        {/* ---- Everything else flows into independent columns: each card is only as tall as its
             content and the ones below move up, so there is no blank area inside or between cards. ---- */}
        <div className="-mb-5 columns-1 gap-5 lg:columns-2 xl:columns-3 *:mb-5 *:break-inside-avoid">
          <ChartCard
            title="Requirement results"
            subtitle="Every report with a rated target to check against"
            href={reportsHref()}
            hrefLabel="Archive"
            table={{
              columns: ["Result", "Reports"],
              rows: [
                ["Met rated target", data.requirement_met],
                ["Missed rated target", data.requirement_unmet],
                ["Missed Head", data.unmet_by_parameter.head],
                ["Missed Capacity", data.unmet_by_parameter.capacity],
                ["Missed Power", data.unmet_by_parameter.power],
              ],
            }}
          >
            {judged === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">No judged reports in this range.</p>
            ) : (
              <div className="viz-root flex flex-col gap-4">
                <div>
                  <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
                    <div style={{ width: `${metPct}%`, background: "var(--status-good)" }} />
                    <div style={{ width: `${100 - (metPct ?? 0)}%`, background: "var(--status-critical)" }} />
                  </div>
                  <div className="mt-2 flex justify-between text-xs">
                    <Link
                      href={reportsHref({ report_result: "green" })}
                      className="font-semibold text-pos-strong hover:underline"
                      title="Open the reports that met their rated target"
                    >
                      ✓ Met {data.requirement_met}
                    </Link>
                    <Link
                      href={reportsHref({ report_result: "red" })}
                      className="font-semibold text-neg-strong hover:underline"
                      title="Open the reports that missed their rated target"
                    >
                      ✕ Missed {data.requirement_unmet}
                    </Link>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Where reports miss</p>
                  <BarList
                    items={[
                      { key: "head", label: "Head", value: data.unmet_by_parameter.head },
                      { key: "capacity", label: "Capacity", value: data.unmet_by_parameter.capacity },
                      { key: "power", label: "Power", value: data.unmet_by_parameter.power },
                    ]}
                  />
                </div>
              </div>
            )}
          </ChartCard>

          <ChartCard
            title="Workload"
            subtitle="Open requisitions per responsible person"
            table={{
              columns: ["Person", "Pending", "In Testing", "Retest Needed", "Total"],
              rows: data.workload.map((w) => [w.person, w.pending, w.in_testing, w.retest_needed, w.total]),
            }}
          >
            <BarList
              emptyText="No open requisitions in this range."
              items={data.workload.map((w) => ({
                key: w.person,
                label: w.person,
                value: w.total,
                detail: `${w.pending} pending · ${w.in_testing} in testing · ${w.retest_needed} retest needed`,
                href: summaryHref({ responsible_person: w.person === "Unassigned" ? "none" : w.person, scope: "open" }),
              }))}
            />
          </ChartCard>

          <ChartCard
            title="Raised by"
            subtitle="Who put the requisition in · by account type"
            table={{ columns: ["Raised by", "Requisitions"], rows: data.by_raiser.map((g) => [RAISED_BY_LABELS[g.group], g.count]) }}
          >
            <BarList
              items={data.by_raiser.map((g) => ({
                key: g.group,
                label: RAISED_BY_LABELS[g.group],
                value: g.count,
                href: summaryHref({ raised_by: g.group }),
              }))}
            />
          </ChartCard>

          <ChartCard
            title="By source team"
            subtitle="The Source Team field on each requisition"
            table={{ columns: ["Source team", "Requisitions"], rows: data.by_source_team.map((t) => [t.label, t.count]) }}
          >
            <BarList
              items={data.by_source_team.map((t) => ({
                key: t.label,
                label: t.label,
                value: t.count,
                href: summaryHref({ source_team: t.label === "Unspecified" ? "none" : t.label }),
              }))}
            />
          </ChartCard>

          <ChartCard title="Recent reports" subtitle="Latest filed test reports" href={reportsHref()} hrefLabel="Archive">
            {data.recent_reports.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">No reports in this range.</p>
            ) : (
              <ul className="flex flex-col">
                {data.recent_reports.map((r) => (
                  <li key={r.id} className="border-t border-border first:border-t-0">
                    <Link
                      href={`/reports/${r.report_no ?? r.id}`}
                      className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-hover"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-text-h">{r.model}</div>
                        <div className="truncate text-[11px] text-text-muted">
                          {r.report_no ?? "—"} · {FORMAT_LABELS[r.report_format ?? "observation"]} · {formatDate(r.date)}
                        </div>
                      </div>
                      <ResultBadge unmet={r.unmet_fields} hasTarget={r.has_target} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>

        <ChartCard
          title={daily ? "Daily activity" : "Monthly activity"}
          subtitle={`Requisitions raised, reports filed and requisitions closed per ${per}${daily ? " · last 7 days at least" : ""}`}
          legend={[
            { label: "Raised", color: "var(--series-1)", shape: "line" },
            { label: "Reports filed", color: "var(--series-2)", shape: "line" },
            { label: "Closed", color: "var(--series-3)", shape: "line" },
          ]}
          table={{
            columns: [bucket, "Raised", "Reports filed", "Closed"],
            rows: data.monthly_trend.map((m) => [monthLong(m.month), m.raised, m.reports, m.closed]),
          }}
        >
          <LineChart
            months={months}
            series={[
              { key: "raised", label: "Raised", color: "var(--series-1)", values: data.monthly_trend.map((m) => m.raised) },
              { key: "reports", label: "Reports filed", color: "var(--series-2)", values: data.monthly_trend.map((m) => m.reports) },
              { key: "closed", label: "Closed", color: "var(--series-3)", values: data.monthly_trend.map((m) => m.closed) },
            ]}
          />
        </ChartCard>

        {/* ---- Wide cards run the full width ---- */}
        <ChartCard
          title={`Category × ${per}`}
          subtitle="Where requisitions came from over time · click a cell to open it"
          table={{
            columns: ["Category", ...data.category_matrix.months.map(monthLong)],
            rows: data.category_matrix.rows.map((r) => [r.category, ...r.counts]),
          }}
        >
          <Heatmap
            months={data.category_matrix.months}
            rows={data.category_matrix.rows.map((r) => ({ label: r.category, counts: r.counts }))}
            cellHref={(category, month) => {
              if (category === "Uncategorised") return null;
              const { from, to } = monthRange(month);
              const params = new URLSearchParams({ category, from, to });
              return `/dashboard?${params.toString()}`;
            }}
          />
        </ChartCard>

        <ChartCard
          title="Upcoming deadlines"
          subtitle="Open requisitions nearest their target date"
          href={summaryHref({ scope: "open" })}
          hrefLabel="All open"
        >
          {data.upcoming_deadlines.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">Nothing open in this range. 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="pb-2 font-semibold">Model</th>
                    <th className="pb-2 font-semibold">EC / Quotation No.</th>
                    <th className="pb-2 font-semibold">Responsible</th>
                    <th className="pb-2 font-semibold">Status</th>
                    <th className="pb-2 font-semibold">Target</th>
                    <th className="pb-2 text-right font-semibold">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcoming_deadlines.map((d) => (
                    <tr key={d.id} className="border-t border-border transition-colors hover:bg-surface-hover">
                      <td className="py-2.5 pr-3">
                        <Link href={`/requisitions/${d.requisition_no ?? d.id}`} className="font-semibold text-accent hover:underline">
                          {d.model}
                        </Link>
                        {d.requisition_no && <div className="text-[11px] text-text-faint">{d.requisition_no}</div>}
                      </td>
                      <td className="py-2.5 pr-3">
                        {d.ec_quotation_no ? (
                          <Link
                            href={`/dashboard?${new URLSearchParams({ ec: d.ec_quotation_no }).toString()}`}
                            className="text-[13px] text-text hover:text-accent hover:underline"
                            title="Show every requisition with this EC / Quotation No."
                          >
                            {d.ec_quotation_no}
                          </Link>
                        ) : (
                          <span className="text-text-faint">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-text">{d.responsible_person ?? "—"}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`status-pill status-${d.status.replace(/\s+/g, "-").toLowerCase()}`}>{d.status}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatDate(d.target_date)}
                      </td>
                      <td className="py-2.5 text-right">
                        <DeadlineBadge daysLeft={d.days_left} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
      )}
    </div>
  );
};

export default OverviewPage;
