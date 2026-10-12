"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getPerformance } from "@/services/testingService";
import PageHeader from "@/components/ui/PageHeader";
import { SkeletonPage } from "@/components/ui/Skeleton";
import KpiGroupCard from "@/components/charts/KpiGroupCard";
import ChartCard from "@/components/charts/ChartCard";
import { formatDate, formatNumber } from "@/lib/formUtils";
import { reportCategoryLabel } from "@/lib/reportCategory";
import { ME_SUSPECT_ABOVE, VE_SUSPECT_ABOVE } from "@/lib/veMeAcceptance";
import type { PerformanceHistoryEntry, PerformanceImprovement, PerformanceModel, PerformanceResult } from "@/types/testing";

const SERIES = ["All", "H", "2H", "L", "L6", "Other"] as const;
type Series = (typeof SERIES)[number];
const SERIES_LABEL: Record<Series, string> = { All: "All", H: "H-series", "2H": "2H-series", L: "L-series", L6: "L6-series", Other: "Other" };

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const tabular = { fontVariantNumeric: "tabular-nums" } as const;

/** Red when below this model's acceptance figure -- only the value itself, never the row. */
const valueClass = (meets: boolean | null) =>
  meets === false ? "rounded-md bg-neg-soft px-1.5 py-0.5 font-semibold text-neg-strong" : "text-text";

const Delta = ({ value }: { value: number | null }) => {
  if (value === null) return <span className="text-text-faint">—</span>;
  if (value === 0) return <span className="text-text-muted">± 0</span>;
  return value > 0 ? (
    <span className="font-semibold text-pos-strong">▲ +{value}</span>
  ) : (
    <span className="font-semibold text-neg-strong">▼ {value}</span>
  );
};

const delta = (now: number | null, before: number | null) => (now === null || before === null ? null : Math.round((now - before) * 10) / 10);

/** How an Improvement Project test compares with the model's previous test. */
const verdictOf = (i: { ve: number | null; me: number | null; prev_ve: number | null; prev_me: number | null }) => {
  const changes = [delta(i.ve, i.prev_ve), delta(i.me, i.prev_me)].filter((d): d is number => d !== null);
  if (!changes.length) return { label: "No earlier test to compare", tone: "muted" as const };
  if (changes.every((d) => d >= 0) && changes.some((d) => d > 0)) return { label: "Improved", tone: "good" as const };
  if (changes.every((d) => d <= 0) && changes.some((d) => d < 0)) return { label: "Declined", tone: "bad" as const };
  if (changes.every((d) => d === 0)) return { label: "No change", tone: "muted" as const };
  return { label: "Mixed", tone: "warn" as const };
};

const VERDICT_CLASS = {
  good: "bg-pos-soft text-pos-strong",
  bad: "bg-neg-soft text-neg-strong",
  warn: "bg-warn-soft text-warn",
  muted: "bg-bg-sunk text-text-muted",
};

/** VE (blue) and ME (orange) across the model's tests, with the acceptance lines dashed. */
const Trend = ({ history, acceptance }: { history: { ve: number | null; me: number | null }[]; acceptance: PerformanceModel["acceptance"] }) => {
  const points = history.filter((h) => h.ve !== null || h.me !== null);
  if (points.length < 2) return <span className="text-[11px] text-text-faint">{points.length ? "1 test" : "—"}</span>;
  const w = 96;
  const h = 28;
  const all = points.flatMap((p) => [p.ve, p.me]).filter((v): v is number => v !== null);
  const top = Math.max(100, ...all, acceptance?.ve ?? 0);
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - 2 - (v / top) * (h - 4);
  const line = (field: "ve" | "me") =>
    points
      .map((p, i) => (p[field] === null ? null : `${x(i).toFixed(1)},${y(p[field]!).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible" role="img" aria-label={`VE and ME across ${points.length} tests`}>
      {acceptance && <line x1={0} x2={w} y1={y(acceptance.ve)} y2={y(acceptance.ve)} stroke="var(--series-1)" strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />}
      {acceptance && <line x1={0} x2={w} y1={y(acceptance.me)} y2={y(acceptance.me)} stroke="var(--series-2)" strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />}
      <polyline points={line("ve")} fill="none" stroke="var(--series-1)" strokeWidth={1.75} strokeLinejoin="round" />
      <polyline points={line("me")} fill="none" stroke="var(--series-2)" strokeWidth={1.75} strokeLinejoin="round" />
    </svg>
  );
};

/** "12.3 / 12.0" -- best measured point over the rated value, red when it didn't meet it. "—" when
 * there's no rated value on this report to judge against. */
const MeasuredVsRated = ({ measured, rated, meets }: { measured: number | null; rated: number | null; meets: boolean | null }) => {
  if (rated === null) return <span className="text-text-faint">—</span>;
  return (
    <span title={`Rated ${formatNumber(rated)}`}>
      <span className={valueClass(meets)}>{measured === null ? "—" : formatNumber(measured)}</span>
      <span className="text-text-faint"> / {formatNumber(rated)}</span>
    </span>
  );
};

const SuspectNote = ({ entry }: { entry: PerformanceHistoryEntry }) => {
  const parts = [...entry.suspect_ve.map((v) => `VE ${v}%`), ...entry.suspect_me.map((v) => `ME ${v}%`)];
  if (!parts.length) return null;
  return (
    <span
      className="ml-2 rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn"
      title="Physically impossible -- almost always a unit or typing slip in the readings (e.g. LPH typed as m3/hr). Not counted anywhere on this page until the report is corrected."
    >
      ⚠ Check readings: {parts.slice(0, 3).join(", ")}
      {parts.length > 3 ? ` +${parts.length - 3} more` : ""}
    </span>
  );
};

const PerformancePage = () => {
  const [data, setData] = useState<PerformanceResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getPerformance()
      .then(setData)
      .catch(() => setError("Could not load VE & ME performance."));
  }, []);

  if (error) return <div className="form-error-banner">{error}</div>;
  if (!data) return <SkeletonPage cards={3} />;
  return <PerformanceView data={data} />;
};

/** The page body, given the loaded data. */
export const PerformanceView = ({ data }: { data: PerformanceResult }) => {
  const [series, setSeries] = useState<Series>("All");
  const [search, setSearch] = useState("");
  const [belowOnly, setBelowOnly] = useState(false);
  const [suspectOnly, setSuspectOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const belowAtLatest = (m: PerformanceModel) => !!m.acceptance && !!m.latest && (m.latest.ve_meets === false || m.latest.me_meets === false);
  const meetsAtLatest = (m: PerformanceModel) => !!m.acceptance && !!m.latest && m.latest.ve_meets === true && m.latest.me_meets === true;

  const visible = useMemo(() => {
    const q = search.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return data.models.filter(
      (m) =>
        (series === "All" || m.series === series) &&
        (!q || m.model.toUpperCase().replace(/[^A-Z0-9]/g, "").includes(q)) &&
        (!belowOnly || belowAtLatest(m)) &&
        (!suspectOnly || m.suspect_count > 0)
    );
  }, [data, series, search, belowOnly, suspectOnly]);

  const onSheet = data.models.filter((m) => m.acceptance);
  const noData = data.models.filter((m) => m.reports_with_data === 0);
  const suspectReadings = data.models.reduce((n, m) => n + m.suspect_count, 0);
  // Improvement models: reports below acceptance (or filed as an Improvement Project) on a model with no
  // report that meets both VE and ME. One such report clears the whole model off the list.
  const improvementModelCount = new Set(data.improvements.map((i) => i.model)).size;
  const clearedModels = data.models.filter((m) => m.improvement_cleared).map((m) => m.model);

  const toggle = (model: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });

  return (
    <div className="tw-reset mx-auto flex max-w-[1400px] flex-col gap-4 p-2">
      <PageHeader
        icon="📈"
        title="VE & ME Performance"
        subtitle="Every model's best Volumetric and Mechanical Efficiency, judged against its acceptance criteria, test by test."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiGroupCard
          title="Acceptance · latest test"
          icon="check"
          tint="var(--series-3)"
          tiles={[
            { label: "Meeting VE & ME", value: onSheet.filter(meetsAtLatest).length, sub: `of ${onSheet.length} models on the sheet` },
            {
              label: "Below acceptance",
              value: onSheet.filter(belowAtLatest).length,
              sub: "VE or ME short",
              tone: onSheet.some(belowAtLatest) ? "critical" : undefined,
            },
          ]}
        />
        <KpiGroupCard
          title="Coverage"
          icon="folder"
          tint="var(--series-1)"
          tiles={[
            { label: "Models with data", value: data.models.length - noData.length, sub: `of ${data.models.length} models` },
            { label: "No VE/ME yet", value: noData.length, sub: noData.length ? noData.map((m) => m.model).join(", ") : "every model covered" },
          ]}
        />
        <KpiGroupCard
          title="Tracking"
          icon="activity"
          tint="var(--series-2)"
          tiles={[
            { label: "Improvement tests", value: data.improvements.length, sub: `in ${improvementModelCount} model${improvementModelCount === 1 ? "" : "s"}, none yet meeting both` },
            {
              label: "Readings to check",
              value: suspectReadings,
              sub: `VE > ${VE_SUSPECT_ABOVE}% or ME > ${ME_SUSPECT_ABOVE}%`,
              tone: suspectReadings ? "critical" : undefined,
            },
          ]}
        />
      </div>

      <ImprovementTracker improvements={data.improvements} clearedModels={clearedModels} />

      <ChartCard
        title="By model"
        subtitle="Each report counts its best point · red = below that model's acceptance · open a row for every test in date order"
        legend={[
          { label: "VE", color: "var(--series-1)", shape: "line" },
          { label: "ME", color: "var(--series-2)", shape: "line" },
        ]}
        table={{
          columns: ["Model", "Series", "VE acceptance", "ME acceptance", "Reports", "Latest VE", "Latest ME", "Best VE", "Best ME", "VE change", "ME change"],
          rows: visible.map((m) => [
            m.model,
            SERIES_LABEL[m.series],
            m.acceptance ? `${m.acceptance.ve}%` : "—",
            m.acceptance ? `${m.acceptance.me}%` : "—",
            m.report_count,
            pct(m.latest?.ve ?? null),
            pct(m.latest?.me ?? null),
            pct(m.best_ve),
            pct(m.best_me),
            m.ve_change ?? "—",
            m.me_change ?? "—",
          ]),
        }}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="range-group" role="group" aria-label="Series">
            {SERIES.map((s) => (
              <button key={s} type="button" className="range-pill" aria-pressed={series === s} onClick={() => setSeries(s)}>
                {SERIES_LABEL[s]}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text">
            <input type="checkbox" checked={belowOnly} onChange={(e) => setBelowOnly(e.target.checked)} />
            Below acceptance
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text">
            <input type="checkbox" checked={suspectOnly} onChange={(e) => setSuspectOnly(e.target.checked)} />
            Readings to check
          </label>
          <input
            id="performance-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search model…"
            className="ml-auto w-44 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted">
                <th className="w-6 pb-2" />
                <th className="pb-2 font-semibold">Model</th>
                <th className="pb-2 text-right font-semibold">Acceptance VE / ME</th>
                <th className="pb-2 text-right font-semibold">Reports</th>
                <th className="pb-2 text-right font-semibold">Latest VE</th>
                <th className="pb-2 text-right font-semibold">Latest ME</th>
                <th className="pb-2 text-right font-semibold">Best VE / ME</th>
                <th className="pb-2 text-right font-semibold">Change, first → latest</th>
                <th className="pb-2 pl-4 font-semibold">Trend</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-sm text-text-muted">
                    No models match these filters.
                  </td>
                </tr>
              )}
              {visible.map((m) => {
                const open = expanded.has(m.model);
                return (
                  <Fragment key={m.model}>
                    <tr className="cursor-pointer border-t border-border transition-colors hover:bg-surface-hover" onClick={() => toggle(m.model)}>
                      <td className="py-2.5 text-text-muted">{m.history.length ? (open ? "−" : "+") : ""}</td>
                      <td className="py-2.5 pr-3">
                        {m.report_count ? (
                          <Link href={`/pumps/${encodeURIComponent(m.model)}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-accent hover:underline">
                            {m.model}
                          </Link>
                        ) : (
                          <span className="font-semibold text-text">{m.model}</span>
                        )}
                        <span className="ml-2 text-[11px] text-text-faint">{SERIES_LABEL[m.series]}</span>
                        {m.improvement_count > 0 && (
                          <span className="ml-2 rounded-md bg-info-soft px-1.5 py-0.5 text-[11px] font-semibold text-info">
                            {m.improvement_count} improvement test{m.improvement_count === 1 ? "" : "s"}
                          </span>
                        )}
                        {m.suspect_count > 0 && (
                          <span className="ml-2 rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn" title="Readings that can't be real -- open the row to see which reports">
                            ⚠ {m.suspect_count} to check
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-text-muted" style={tabular}>
                        {m.acceptance ? `${m.acceptance.ve}% / ${m.acceptance.me}%` : <span title="Not on the acceptance sheet">—</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-text" style={tabular}>
                        {m.report_count === 0 ? (
                          <span className="text-text-faint">Not tested yet</span>
                        ) : m.reports_with_data < m.report_count ? (
                          <span title={`${m.report_count - m.reports_with_data} without VE/ME`}>
                            {m.reports_with_data} of {m.report_count}
                          </span>
                        ) : (
                          m.report_count
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right" style={tabular}>
                        <span className={valueClass(m.latest?.ve_meets ?? null)}>{pct(m.latest?.ve ?? null)}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-right" style={tabular}>
                        <span className={valueClass(m.latest?.me_meets ?? null)}>{pct(m.latest?.me ?? null)}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-right text-text-muted" style={tabular}>
                        {pct(m.best_ve)} / {pct(m.best_me)}
                      </td>
                      <td className="py-2.5 pr-3 text-right" style={tabular}>
                        VE <Delta value={m.ve_change} /> · ME <Delta value={m.me_change} />
                      </td>
                      <td className="py-2.5 pl-4">
                        <Trend history={m.history} acceptance={m.acceptance} />
                      </td>
                    </tr>
                    {open && m.history.length > 0 && (
                      <tr>
                        <td />
                        <td colSpan={8} className="pb-3">
                          <table className="w-full border-collapse rounded-lg bg-bg-sunk text-[13px]">
                            <thead>
                              <tr className="text-left text-[10px] uppercase tracking-wide text-text-muted">
                                <th className="px-3 py-2 font-semibold">Test date</th>
                                <th className="px-3 py-2 font-semibold">Report</th>
                                <th className="px-3 py-2 font-semibold">Category</th>
                                <th className="px-3 py-2 text-right font-semibold">Capacity, m³/hr</th>
                                <th className="px-3 py-2 text-right font-semibold">Head, kg/cm²</th>
                                <th className="px-3 py-2 text-right font-semibold">Power, kW</th>
                                <th className="px-3 py-2 text-right font-semibold">VE</th>
                                <th className="px-3 py-2 text-right font-semibold">vs previous</th>
                                <th className="px-3 py-2 text-right font-semibold">ME</th>
                                <th className="px-3 py-2 text-right font-semibold">vs previous</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...m.history].reverse().map((h) => (
                                <tr key={h.id} className={`border-t border-border-soft ${h.is_improvement ? "bg-info-soft" : ""}`}>
                                  <td className="px-3 py-1.5 text-text-muted" style={tabular}>
                                    {formatDate(h.date)}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <Link href={`/reports/${h.report_no ?? h.id}`} className="font-semibold text-accent hover:underline">
                                      {h.report_no ?? "View"}
                                    </Link>
                                    <SuspectNote entry={h} />
                                  </td>
                                  <td className="px-3 py-1.5 text-text-muted">
                                    {h.is_improvement ? (
                                      <span className="rounded-md bg-info px-1.5 py-0.5 text-[11px] font-semibold text-white">Improvement Project</span>
                                    ) : h.category !== "none" ? (
                                      reportCategoryLabel(h.category).replace(/^Against\s+/i, "")
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-right" style={tabular}>
                                    <MeasuredVsRated measured={h.max_capacity} rated={h.rated_capacity} meets={h.capacity_meets} />
                                  </td>
                                  <td className="px-3 py-1.5 text-right" style={tabular}>
                                    <MeasuredVsRated measured={h.max_head} rated={h.rated_head} meets={h.head_meets} />
                                  </td>
                                  <td className="px-3 py-1.5 text-right" style={tabular}>
                                    <MeasuredVsRated measured={h.max_power} rated={h.rated_power_kw} meets={h.power_meets} />
                                  </td>
                                  <td className="px-3 py-1.5 text-right" style={tabular}>
                                    <span className={valueClass(h.ve_meets)}>{pct(h.ve)}</span>
                                  </td>
                                  <td className="px-3 py-1.5 text-right" style={tabular}>
                                    <Delta value={delta(h.ve, h.prev_ve)} />
                                  </td>
                                  <td className="px-3 py-1.5 text-right" style={tabular}>
                                    <span className={valueClass(h.me_meets)}>{pct(h.me)}</span>
                                  </td>
                                  <td className="px-3 py-1.5 text-right" style={tabular}>
                                    <Delta value={delta(h.me, h.prev_me)} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
};

/** True when a report has an earlier test to be compared with (the first test of a model does not). */
const hasEarlierTest = (i: PerformanceImprovement) => i.prev_ve !== null || i.prev_me !== null;

const signed = (v: number | null) => (v === null ? "—" : v > 0 ? `+${v}` : String(v));

/** Left edge of each row: green when it improved on the test before, red when it declined, amber when mixed. */
const ROW_EDGE = { good: "border-l-pos-strong", bad: "border-l-neg-strong", warn: "border-l-warn", muted: "border-l-border" } as const;

/** Which of VE / ME is still under the model's required value on this report. */
const belowNote = (i: PerformanceImprovement) => {
  if (!i.acceptance) return null;
  const below = [i.ve_meets === false ? "VE" : null, i.me_meets === false ? "ME" : null].filter(Boolean);
  return below.length ? `${below.join(" & ")} below required` : null;
};

/** The model at a glance: what is required, where it started, where it is now, and the overall move. */
const ModelSummary = ({ items }: { items: PerformanceImprovement[] }) => {
  const first = items[0];
  const last = items[items.length - 1];
  const acc = first.acceptance;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-bg-sunk px-3 py-2 text-xs text-text-muted">
      {acc && (
        <span>
          Required: <strong className="text-text">VE ≥ {acc.ve}% · ME ≥ {acc.me}%</strong>
        </span>
      )}
      {items.length > 1 ? (
        <>
          <span>
            First {first.report_no ?? "test"} ({formatDate(first.date)}): <strong className="text-text">VE {pct(first.ve)} · ME {pct(first.me)}</strong>
          </span>
          <span>
            Latest {last.report_no ?? "test"} ({formatDate(last.date)}): <strong className="text-text">VE {pct(last.ve)} · ME {pct(last.me)}</strong>
          </span>
          <span style={tabular}>
            Overall: VE <Delta value={delta(last.ve, first.ve)} /> · ME <Delta value={delta(last.me, first.me)} />
          </span>
        </>
      ) : (
        <span>Only one test so far, so there is nothing earlier to compare with.</span>
      )}
      <span className="basis-full text-[11px] text-text-faint">
        Oldest → newest · ▲ better / ▼ worse than the test before it · red = below the required value · tests on the same date are in report-number order
      </span>
    </div>
  );
};

/** Improvement Projects grouped by model: click a model to open its reports, oldest first, so reading down the list
 * reads forward in time and each change is the step from the test before it. */
const ImprovementTracker = ({ improvements, clearedModels }: { improvements: PerformanceImprovement[]; clearedModels: string[] }) => {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (model: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(model)) next.add(model);
      return next;
    });

  // Oldest -> newest inside each model (ties on the date fall back to the report number); the models themselves
  // stay ordered by their most recent test.
  const groups = useMemo(() => {
    const byModel = new Map<string, PerformanceImprovement[]>();
    for (const i of improvements) byModel.set(i.model, [...(byModel.get(i.model) ?? []), i]);
    return [...byModel.entries()]
      .map(([model, items]) => ({
        model,
        items: [...items].sort((a, b) => a.date.localeCompare(b.date) || (a.report_no ?? "").localeCompare(b.report_no ?? "")),
      }))
      .sort(
        (a, b) =>
          b.items[b.items.length - 1].date.localeCompare(a.items[a.items.length - 1].date) || a.model.localeCompare(b.model, undefined, { numeric: true })
      );
  }, [improvements]);

  const tableRows = groups.flatMap(({ model, items }) =>
    items.map((i, n) => [
      model,
      n + 1,
      i.report_no ?? "",
      i.date,
      pct(i.prev_ve),
      pct(i.ve),
      signed(delta(i.ve, i.prev_ve)),
      pct(i.prev_me),
      pct(i.me),
      signed(delta(i.me, i.prev_me)),
      hasEarlierTest(i) ? verdictOf(i).label : "First test",
      i.prev_report_no ?? "",
    ])
  );

  return (
    <ChartCard
      title="Improvement Projects"
      subtitle="Reports below VE or ME acceptance, plus Improvement Project tests · each model runs oldest → newest so you can follow it up or down · a model leaves this list once any one of its reports meets both"
      table={{
        columns: ["Model", "Test #", "Report", "Date", "VE before", "VE after", "VE change", "ME before", "ME after", "ME change", "Verdict", "Compared with"],
        rows: tableRows,
      }}
    >
      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-text-muted">
          <p className="m-0 font-semibold text-text">No model needs improvement right now.</p>
          <p className="m-0 mt-1">
            To track one, raise a requisition with the category <strong>Against Improvement Project</strong>. When its report is filed, it shows up here
            next to that model&apos;s previous test, with VE and ME before and after, and whether it now meets the acceptance criteria.
          </p>
          <Link href="/requisitions/new" className="mt-3 inline-block font-semibold text-accent hover:underline">
            Raise an Improvement Project requisition →
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col">
          {groups.map(({ model, items }) => {
            const isOpen = open.has(model);
            const last = items[items.length - 1];
            // A test can be compared with one that is not in this list (it meets the required values, or has no VE / ME).
            const listed = new Set(items.map((x) => x.report_no));
            const latest = hasEarlierTest(last) ? verdictOf(last) : { label: "Only test so far", tone: "muted" as const };
            return (
              <li key={model} className="border-t border-border first:border-t-0">
                <button
                  type="button"
                  onClick={() => toggle(model)}
                  aria-expanded={isOpen}
                  className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-hover"
                >
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className={`inline-block text-xs text-text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                      <span className="text-sm font-semibold text-text">{model}</span>
                      <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-xs font-semibold text-text-muted">
                        {items.length} report{items.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <Trend history={items} acceptance={items[0].acceptance} />
                  </span>
                  <span className="flex items-center gap-2" title="The newest test compared with the one before it">
                    <span className="text-[11px] text-text-muted">Latest test</span>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${VERDICT_CLASS[latest.tone]}`}>{latest.label}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="pb-3 pl-6">
                    <ModelSummary items={items} />
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted">
                            <th className="pb-2 pl-2 font-semibold">#</th>
                            <th className="pb-2 font-semibold">Report</th>
                            <th className="pb-2 font-semibold">Date</th>
                            <th className="pb-2 text-right font-semibold">VE (change)</th>
                            <th className="pb-2 text-right font-semibold">ME (change)</th>
                            <th className="pb-2 pl-4 font-semibold">Verdict vs previous test</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((i, n) => {
                            const earlier = hasEarlierTest(i);
                            const verdict = earlier ? verdictOf(i) : { label: "First test", tone: "muted" as const };
                            const note = belowNote(i);
                            const against = earlier ? `Previous test${i.prev_report_no ? ` ${i.prev_report_no}` : ""}` : "First test in this list";
                            return (
                              <tr key={i.id} className="border-t border-border">
                                <td className={`border-l-4 py-2 pl-2 pr-3 text-text-muted ${ROW_EDGE[verdict.tone]}`} style={tabular}>
                                  {n + 1}
                                </td>
                                <td className="py-2 pr-3">
                                  <Link href={`/reports/${i.report_no ?? i.id}`} className="font-semibold text-accent hover:underline">
                                    {i.report_no ?? "View"} ↗
                                  </Link>
                                </td>
                                <td className="py-2 pr-3 text-text-muted" style={tabular}>
                                  {formatDate(i.date)}
                                </td>
                                <td className="py-2 pr-3 text-right" style={tabular} title={`${against}: VE ${pct(i.prev_ve)}`}>
                                  <span className={valueClass(i.ve_meets)}>{pct(i.ve)}</span> <Delta value={delta(i.ve, i.prev_ve)} />
                                  {i.prev_ve !== null && <div className="text-[11px] text-text-faint">from {pct(i.prev_ve)}</div>}
                                </td>
                                <td className="py-2 pr-3 text-right" style={tabular} title={`${against}: ME ${pct(i.prev_me)}`}>
                                  <span className={valueClass(i.me_meets)}>{pct(i.me)}</span> <Delta value={delta(i.me, i.prev_me)} />
                                  {i.prev_me !== null && <div className="text-[11px] text-text-faint">from {pct(i.prev_me)}</div>}
                                </td>
                                <td className="py-2 pl-4">
                                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${VERDICT_CLASS[verdict.tone]}`}>{verdict.label}</span>
                                  {earlier && i.prev_report_no && (
                                    <div className="mt-0.5 text-[11px] text-text-faint">
                                      vs {i.prev_report_no}
                                      {!listed.has(i.prev_report_no) && (
                                        <span title="That test is not in this list: it meets the required values or has no VE / ME readings"> (not listed here)</span>
                                      )}
                                    </div>
                                  )}
                                  {note && <div className="mt-0.5 text-[11px] text-text-muted">{note}</div>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {clearedModels.length > 0 && (
        <p className="m-0 mt-3 border-t border-border pt-3 text-xs text-text-muted">
          <span className="font-semibold text-text">Not listed ({clearedModels.length}):</span> {clearedModels.join(", ")} — each has at least one report that meets both VE and ME
          acceptance. All of their tests are still in the By model table below.
        </p>
      )}
    </ChartCard>
  );
};

export default PerformancePage;
