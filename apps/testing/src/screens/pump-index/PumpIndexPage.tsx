"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import "../dashboard/DashboardPage.css";
import "../report-archive/ReportArchivePage.css"; // reuses .pump-row/.expand-toggle/.nested-report-table
import "./PumpIndexPage.css";
import { listGroupedPumps } from "@/services/testingService";
import { useAuth } from "@/contexts/AuthContext";
import { buildUnmetRows } from "@/lib/requirementCheck";
import { reportMatchesStat, type PumpStatFilter } from "@/lib/reportVerdict";
import { hasActiveRequisitionFilters, requisitionMatchesFilters, type RequisitionFilterValues } from "@/lib/requisitionFilters";
import AssignRetestModal from "@/components/ui/AssignRetestModal";
import Pagination from "@/components/ui/Pagination";
import { SkeletonStatTiles, SkeletonTableRows } from "@/components/ui/Skeleton";
import PageHeader from "@/components/ui/PageHeader";
import {
  REQUISITION_CATEGORIES,
  RESPONSIBLE_PERSONS,
  SOURCE_TEAMS,
  type ArchiveReportSummary,
  type PortalReportRef,
  type PumpIndexGroup,
  type PumpIndexSummary,
} from "@/types/testing";
import { formatDate, formatNumber } from "@/lib/formUtils";

const PAGE_SIZE = 50;

/** Highest non-null value in a measured-points column, same "what the
 * report was actually judged against" figure the requirement check itself
 * maxes over -- shared by the rated/measured display and the Assign Retest
 * modal's snapshot. */
const maxOfColumn = (values: (number | null)[]): number | null => {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length ? Math.max(...nums) : null;
};

/** Rated target + every measured point for one field (Head/Capacity/Power),
 * as a small two-line list rather than a single "rated / measured" string.
 * When the report failed this field, the one measured value that actually
 * decided that -- the max, since that's what a floor (Head/Capacity) or
 * ceiling (Power) check compares against the rating -- is highlighted red,
 * same as the rated figure it's being judged against. */
const RatedVsMeasured = ({
  rated,
  values,
  failed,
}: {
  rated: number | string | null | undefined;
  values: (number | null)[];
  failed: boolean;
}) => {
  const maxVal = maxOfColumn(values);

  return (
    <div className="pump-index-rated-vs-measured">
      <div>
        Rated:{" "}
        <span className={failed ? "pump-index-match-neg" : undefined}>{formatNumber(rated)}</span>
      </div>
      <div>
        Measured:{" "}
        {values.length === 0
          ? "-"
          : values.map((v, i) => (
              <span key={i}>
                <span className={failed && v !== null && v === maxVal ? "pump-index-match-neg" : undefined}>
                  {formatNumber(v)}
                </span>
                {i < values.length - 1 ? ", " : ""}
              </span>
            ))}
      </div>
    </div>
  );
};

const ALL = "All";

/** Which stat tile is currently narrowing the pump list ("all" = no tile selected). The rule for what
 * counts as met / did not meet / not judged is shared with the server (lib/reportVerdict.ts), so the
 * tile numbers and this list always agree. */
type StatFilter = PumpStatFilter;

/** A pump's own reports that actually satisfy the active filter -- a pump
 * can have reports on both sides (some met, some didn't), so "matches the
 * filter" alone doesn't tell you that split. Backs both the count column
 * and the expanded "View Report" list below each row. Purely a display
 * concern now (which of THIS pump's already-fetched reports to show in its
 * expand row) -- the server already decided which pumps qualify overall. */
const matchingReports = (reports: ArchiveReportSummary[], filter: StatFilter): ArchiveReportSummary[] =>
  filter === "all" ? reports : reports.filter((r) => reportMatchesStat(r, filter));

const EMPTY_SUMMARY: PumpIndexSummary = {
  total_reports: 0,
  historical: 0,
  portal: 0,
  met: 0,
  unmet: 0,
  not_judged: 0,
  pump_count: 0,
  pumps_with_reports: 0,
};

const PumpIndexPage = () => {
  const [pumps, setPumps] = useState<PumpIndexGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<PumpIndexSummary>(EMPTY_SUMMARY);
  const [portalReports, setPortalReports] = useState<PortalReportRef[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [submittedByOptions, setSubmittedByOptions] = useState<string[]>([]);
  const [monthOptions, setMonthOptions] = useState<string[]>([]);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statFilter, setStatFilter] = useState<StatFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Assign Retest (Admin / Central Admin only) -- see ReportDetailPage's
  // identical feature. Per-report state since this list can hold many
  // reports at once: which one has its modal open, and which have already
  // gotten a new requisition this session (report id -> its id).
  const { canAssignRetest } = useAuth();
  const [assignRetestTarget, setAssignRetestTarget] = useState<ArchiveReportSummary | null>(null);
  const [assignedRetestByReport, setAssignedRetestByReport] = useState<Record<string, string>>({});

  // Same requisition-level filters as the Testing Summary page, applied here
  // so a pump only shows up if it has a requisition matching every active
  // one -- lets you narrow the Pump Dashboard the same way, e.g. "which
  // pumps has Research raised in August".
  const [modelFilter, setModelFilter] = useState(ALL);
  const [ecInput, setEcInput] = useState("");
  const [ecFilter, setEcFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [sourceTeamFilter, setSourceTeamFilter] = useState(ALL);
  const [responsiblePersonFilter, setResponsiblePersonFilter] = useState(ALL);
  const [submittedByFilter, setSubmittedByFilter] = useState(ALL);
  const [retestFilter, setRetestFilter] = useState(ALL);
  const [monthFilter, setMonthFilter] = useState(ALL);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const toggleExpanded = (model: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  // Debounce the two free-text fields -- everything else (dropdowns, dates,
  // stat tiles) applies immediately, same as before.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => {
    const t = setTimeout(() => setEcFilter(ecInput.trim()), 300);
    return () => clearTimeout(t);
  }, [ecInput]);

  const reqFilterValues: RequisitionFilterValues = useMemo(
    () => ({
      ecQuotationNo: ecFilter || undefined,
      category: categoryFilter === ALL ? undefined : categoryFilter,
      sourceTeam: sourceTeamFilter === ALL ? undefined : sourceTeamFilter,
      responsiblePerson: responsiblePersonFilter === ALL ? undefined : responsiblePersonFilter,
      submittedBy: submittedByFilter === ALL ? undefined : submittedByFilter,
      retestNeeded: retestFilter === ALL ? undefined : (retestFilter as "Yes" | "No"),
      month: monthFilter === ALL ? undefined : monthFilter,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [ecFilter, categoryFilter, sourceTeamFilter, responsiblePersonFilter, submittedByFilter, retestFilter, monthFilter, dateFrom, dateTo]
  );
  const hasActiveReqFilters = hasActiveRequisitionFilters(reqFilterValues);
  const hasAnyFilterActive = hasActiveReqFilters || modelFilter !== ALL;

  const clearReqFilters = () => {
    setModelFilter(ALL);
    setEcInput("");
    setEcFilter("");
    setCategoryFilter(ALL);
    setSourceTeamFilter(ALL);
    setResponsiblePersonFilter(ALL);
    setSubmittedByFilter(ALL);
    setRetestFilter(ALL);
    setMonthFilter(ALL);
    setDateFrom("");
    setDateTo("");
  };

  useEffect(() => {
    setPage(1);
  }, [statFilter, modelFilter, search, ecFilter, categoryFilter, sourceTeamFilter, responsiblePersonFilter, submittedByFilter, retestFilter, monthFilter, dateFrom, dateTo]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");

    listGroupedPumps(page, {
      model: modelFilter === ALL ? undefined : modelFilter,
      ec_quotation_no: ecFilter || undefined,
      category: categoryFilter === ALL ? undefined : categoryFilter,
      source_team: sourceTeamFilter === ALL ? undefined : sourceTeamFilter,
      responsible_person: responsiblePersonFilter === ALL ? undefined : responsiblePersonFilter,
      submitted_by: submittedByFilter === ALL ? undefined : submittedByFilter,
      retest_needed: retestFilter === ALL ? undefined : (retestFilter as "Yes" | "No"),
      month: monthFilter === ALL ? undefined : monthFilter,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      stat_filter: statFilter === "all" ? undefined : statFilter,
      search: search || undefined,
    })
      .then((result) => {
        if (cancelled) return;
        setPumps(result.entries);
        setTotal(result.total);
        setSummary(result.summary);
        setPortalReports(result.portal_reports ?? []);
        setModelOptions(result.filter_options.models);
        setSubmittedByOptions(result.filter_options.submitted_by);
        setMonthOptions(result.filter_options.months);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load pumps.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, statFilter, modelFilter, search, ecFilter, categoryFilter, sourceTeamFilter, responsiblePersonFilter, submittedByFilter, retestFilter, monthFilter, dateFrom, dateTo]);

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-");
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
      new Date(Number(y), Number(m) - 1, 1)
    );
  };

  const STAT_LABELS: Record<Exclude<StatFilter, "all">, string> = {
    reports: "Reports Submitted",
    historical: "Historical Reports",
    portal: "Filed in Portal",
    met: "Met Requirement",
    unmet: "Did Not Meet Requirement",
    not_judged: "Not Judged",
  };

  // What the pump list is narrowed to, in plain words (shown under the tiles when one is selected).
  const STAT_NOTES: Record<Exclude<StatFilter, "all">, string> = {
    reports: "has at least one test report",
    historical: "has at least one historical (imported) report",
    portal: "has at least one report filed through the portal",
    met: "has at least one report that met its rated requirement",
    unmet: "has at least one report that did not meet its rated requirement",
    not_judged: "has at least one report that can't be judged (no rated target, or nothing measured to compare)",
  };

  // Hover details for each tile -- what it counts, and how it relates to the others. All numbers are
  // the portal-wide totals shown on the tiles (they don't change with the filters below).
  const tip = {
    models: `${summary.pump_count} pump models in total (the same pump written with different spaces or dashes counts once). ${summary.pumps_with_reports} have at least one test report; ${summary.pump_count - summary.pumps_with_reports} have only requisitions so far. Click to show every pump.`,
    reports: `Every test report in the portal: ${summary.historical} historical imports + ${summary.portal} filed through the portal = ${summary.total_reports}. Click to show the pumps that have at least one report.`,
    historical: `Old reports imported from Excel/PDF files (prepared by "Legacy Import"). They are already counted inside Reports Submitted (${summary.total_reports} − ${summary.historical} = ${summary.portal} filed through the portal). Click to list the pumps that have one.`,
    portal: `Reports the testing team filled in through the portal, not imported history: ${summary.portal} of the ${summary.total_reports}${portalReports.length ? " — " + portalReports.map((r) => `${r.report_no ?? "?"} (${r.model})`).join(", ") : ""}. Click to list the pumps that have one.`,
    met: `Reports where every rated target that could be checked was reached: highest Head and Capacity at or above the rating, highest Power at or below it. Counted across all ${summary.total_reports} reports, historical included. Click to list the pumps.`,
    unmet: `Reports where a rated Head or Capacity was never reached, or Power went above its rating. Counted across all ${summary.total_reports} reports, historical included. Click to list the pumps.`,
    notJudged: `Reports that can't be judged: they have no rated Head, Capacity or Power, or nothing measured to compare it with. This is why Met + Did Not Meet is not always the total: ${summary.met} + ${summary.unmet} + ${summary.not_judged} = ${summary.met + summary.unmet + summary.not_judged} (Reports Submitted ${summary.total_reports}). Click to list the pumps.`,
  };

  // Seven tiles, every one clickable. Historical + Filed in Portal = Reports Submitted; Met + Did Not Meet + Not Judged = Reports Submitted.
  const statTiles: { filter: StatFilter; label: string; value: number; tip: string; tone?: string }[] = [
    { filter: "all", label: "Pump Models", value: summary.pump_count, tip: tip.models },
    { filter: "reports", label: "Reports Submitted", value: summary.total_reports, tip: tip.reports },
    { filter: "historical", label: "Historical Reports", value: summary.historical, tip: tip.historical },
    { filter: "portal", label: "Filed in Portal", value: summary.portal, tip: tip.portal },
    { filter: "met", label: "Met Requirement", value: summary.met, tip: tip.met, tone: "stat-value-pos" },
    { filter: "unmet", label: "Did Not Meet Requirement", value: summary.unmet, tip: tip.unmet, tone: "stat-value-neg" },
    { filter: "not_judged", label: "Not Judged", value: summary.not_judged, tip: tip.notJudged, tone: "stat-value-muted" },
  ];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="pump-index-page">
      <PageHeader
        icon="📊"
        title="Report Compilation"
        actions={
          <input
            type="text"
            placeholder="Search by model..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pump-index-search"
          />
        }
      />

      {isLoading && !error && <SkeletonStatTiles count={7} />}

      {!isLoading && !error && (
        <div className="pump-index-stats">
          {statTiles.map((t, i) => (
            <button
              key={t.filter + t.label}
              type="button"
              className={`pump-index-stat pump-index-stat-btn ${t.filter !== "all" && statFilter === t.filter ? "active" : ""}`}
              // Clicking the selected tile again clears it; "Pump Models" always means "show every pump".
              onClick={() => setStatFilter((f) => (t.filter === "all" || f === t.filter ? "all" : t.filter))}
              aria-describedby={`pump-stat-tip-${i}`}
            >
              <span className={`stat-value ${t.tone ?? ""}`}>{t.value}</span>
              <span className="stat-label">{t.label}</span>
              <span
                id={`pump-stat-tip-${i}`}
                role="tooltip"
                className={`pump-index-stat-tip${i >= statTiles.length - 2 ? " pump-index-stat-tip--end" : ""}`}
              >
                {t.tip}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="filter-bar">
        <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
          <option value={ALL}>All Models</option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter by EC/Quotation No..."
          value={ecInput}
          onChange={(e) => setEcInput(e.target.value)}
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value={ALL}>All Categories</option>
          {REQUISITION_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={sourceTeamFilter} onChange={(e) => setSourceTeamFilter(e.target.value)}>
          <option value={ALL}>All Source Teams</option>
          {SOURCE_TEAMS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={responsiblePersonFilter} onChange={(e) => setResponsiblePersonFilter(e.target.value)}>
          <option value={ALL}>All Responsible Persons</option>
          {RESPONSIBLE_PERSONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={submittedByFilter} onChange={(e) => setSubmittedByFilter(e.target.value)}>
          <option value={ALL}>All Submitted By</option>
          {submittedByOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={retestFilter} onChange={(e) => setRetestFilter(e.target.value)}>
          <option value={ALL}>Retest Needed: All</option>
          <option value="Yes">Retest Needed: Yes</option>
          <option value="No">Retest Needed: No</option>
        </select>
        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
          <option value={ALL}>All Months</option>
          {monthOptions.map((ym) => (
            <option key={ym} value={ym}>
              {monthLabel(ym)}
            </option>
          ))}
        </select>
        <label className="filter-date-field">
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="filter-date-field">
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        {hasAnyFilterActive && (
          <button type="button" className="clear-filters-btn" onClick={clearReqFilters}>
            ✕ Clear Filters
          </button>
        )}
      </div>

      {statFilter !== "all" && (
        <p className="pump-index-filter-note">
          Showing pumps that {STAT_NOTES[statFilter]} ({STAT_LABELS[statFilter]}).{" "}
          <button type="button" className="pump-index-filter-clear" onClick={() => setStatFilter("all")}>
            Clear filter
          </button>
        </p>
      )}

      {error && <div className="dashboard-error">{error}</div>}

      {!isLoading && pumps.length === 0 ? (
        <p className="dashboard-empty">No pumps found.</p>
      ) : (
        <table className="requisition-table">
          <thead>
            <tr>
              <th></th>
              <th>Pump Model</th>
              <th>Requisitions</th>
              <th>Test Reports</th>
              {statFilter !== "all" && <th>{STAT_LABELS[statFilter]}</th>}
              <th>Latest Activity</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTableRows columns={statFilter !== "all" ? 6 : 5} />}
            {!isLoading && pumps.map((p) => {
              const isOpen = expanded.has(p.model);
              // With a KPI filter active, expanding shows just the reports
              // that satisfy it (the whole point of "how many were met") --
              // with no filter, every report for the pump.
              const rowsToShow = [...matchingReports(p.reports, statFilter)].sort((a, b) =>
                (b.test_date ?? b.created_at).localeCompare(a.test_date ?? a.created_at)
              );
              const matchingRequisitionCount = hasActiveReqFilters
                ? p.requisitions.filter((r) => requisitionMatchesFilters(r, reqFilterValues)).length
                : p.requisition_count;
              return (
                <Fragment key={p.model}>
                  <tr className="pump-row" onClick={() => toggleExpanded(p.model)}>
                    <td className="expand-toggle">{isOpen ? "−" : "+"}</td>
                    <td className="pump-model-cell">
                      <Link href={`/pumps/${encodeURIComponent(p.model)}`} onClick={(e) => e.stopPropagation()}>
                        {p.model}
                      </Link>
                    </td>
                    <td
                      title={
                        hasActiveReqFilters && p.requisition_count > 0
                          ? `${matchingRequisitionCount} of ${p.requisition_count} match the filters`
                          : undefined
                      }
                    >
                      {hasActiveReqFilters && p.requisition_count > 0
                        ? `${matchingRequisitionCount} of ${p.requisition_count}`
                        : p.requisition_count}
                    </td>
                    <td>{p.report_count}</td>
                    {statFilter !== "all" && (
                      <td
                        className={
                          statFilter === "met"
                            ? "pump-index-match-pos"
                            : statFilter === "unmet"
                              ? "pump-index-match-neg"
                              : ""
                        }
                      >
                        {rowsToShow.length} of {p.report_count}
                      </td>
                    )}
                    <td>{formatDate(p.latest_date)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="pump-detail-row">
                      <td></td>
                      <td colSpan={statFilter !== "all" ? 5 : 4}>
                        {rowsToShow.length === 0 ? (
                          <p className="dashboard-empty">
                            {statFilter === "all"
                              ? `No test reports have been filled for ${p.model} yet.`
                              : `No reports match this filter for ${p.model}.`}
                          </p>
                        ) : (
                          <table className="nested-report-table">
                            <thead>
                              <tr>
                                <th>Report No.</th>
                                <th>Test Date</th>
                                <th>Points</th>
                                <th>Rated / Measured Head (KG/CM2)</th>
                                <th>Rated / Measured Capacity (M3/Hr)</th>
                                <th>Rated / Measured Power (KW)</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {rowsToShow.map((r) => {
                                const unmetFields = r.requirement_unmet_fields ?? [];
                                const unmetTitle = unmetFields.length
                                  ? `Outside rated ${unmetFields.join(", ")}`
                                  : "";
                                return (
                                  <tr key={r.id}>
                                    <td>{r.report_no ?? r.motor ?? "-"}</td>
                                    <td>{formatDate(r.test_date ?? r.created_at)}</td>
                                    <td>{r.pointCount}</td>
                                    <td>
                                      <RatedVsMeasured
                                        rated={r.rated_head}
                                        values={r.points_head_kgcm2}
                                        failed={unmetFields.includes("Head")}
                                      />
                                    </td>
                                    <td>
                                      <RatedVsMeasured
                                        rated={r.rated_capacity}
                                        values={r.points_capacity_m3hr}
                                        failed={unmetFields.includes("Capacity")}
                                      />
                                    </td>
                                    <td>
                                      <RatedVsMeasured
                                        rated={r.rated_power_kw}
                                        values={r.points_power_kw}
                                        failed={unmetFields.includes("Power")}
                                      />
                                    </td>
                                    <td>
                                      <span className="status-actions">
                                        <Link
                                          href={`/reports/${r.report_no ?? r.id}`}
                                          className={`status-pill ${unmetTitle ? "status-view-report-unmet" : "status-view-report"}`}
                                          title={unmetTitle || undefined}
                                        >
                                          View Report{unmetTitle && " ⚠"}
                                        </Link>
                                        <Link href={`/reports/${r.report_no ?? r.id}/curve`} className="status-pill status-view-curve">
                                          View Curve
                                        </Link>
                                        {canAssignRetest && unmetTitle && (
                                          assignedRetestByReport[r.id] ? (
                                            <Link
                                              href={`/requisitions/${assignedRetestByReport[r.id]}`}
                                              className="status-pill status-view-report"
                                            >
                                              Retest Assigned
                                            </Link>
                                          ) : (
                                            <button
                                              type="button"
                                              className="status-pill assign-retest-pill"
                                              onClick={() => setAssignRetestTarget(r)}
                                            >
                                              Assign Retest
                                            </button>
                                          )
                                        )}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {assignRetestTarget && (
        <AssignRetestModal
          reportId={assignRetestTarget.id}
          model={assignRetestTarget.model}
          reportNo={assignRetestTarget.report_no}
          unmetRows={buildUnmetRows(
            assignRetestTarget,
            {
              head: maxOfColumn(assignRetestTarget.points_head_kgcm2),
              capacity: maxOfColumn(assignRetestTarget.points_capacity_m3hr),
              power: maxOfColumn(assignRetestTarget.points_power_kw),
            },
            assignRetestTarget.requirement_unmet_fields
          )}
          onClose={() => setAssignRetestTarget(null)}
          onAssigned={(result) => {
            setAssignedRetestByReport((prev) => ({
              ...prev,
              [assignRetestTarget.id]: result.requisition.requisition_no ?? result.requisition.id,
            }));
            setAssignRetestTarget(null);
          }}
        />
      )}
    </div>
  );
};

export default PumpIndexPage;
