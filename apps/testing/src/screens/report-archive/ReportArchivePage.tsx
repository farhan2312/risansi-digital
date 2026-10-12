"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import "./ReportArchivePage.css";
import { listGroupedReports, listReportsFlat } from "@/services/testingService";
import type { ArchivePumpGroup, ArchiveReportSummary } from "@/types/testing";
import { formatDate, formatNumber, motorWithKw } from "@/lib/formUtils";
import Pagination from "@/components/ui/Pagination";
import { SkeletonTableRows } from "@/components/ui/Skeleton";
import PageHeader from "@/components/ui/PageHeader";
import { isReportCategoryKey, reportCategoryLabel } from "@/lib/reportCategory";
import { veMeAcceptanceFor } from "@/lib/veMeAcceptance";

const PAGE_SIZE = 50;

const dayParam = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");

const ReportArchivePage = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Arriving from the Overview's "Reports filed" card (?from=&to=) narrows the
  // archive to reports tested inside that window, so the list matches the
  // number on the card. Cleared with the chip below (which drops the params).
  const dateFrom = dayParam(searchParams.get("from"));
  const dateTo = dayParam(searchParams.get("to"));
  // ?category= (the Overview's Reports by category card): only reports whose category matches.
  const categoryParam = searchParams.get("category");
  const category = isReportCategoryKey(categoryParam) ? categoryParam : "";
  // ?report_result= (the Overview's "Requirement results" Met/Missed links): only reports that had a
  // rated target and either met every one of it (green) or missed at least one (red).
  const reportResultParam = searchParams.get("report_result");
  const reportResult = reportResultParam === "green" || reportResultParam === "red" ? reportResultParam : "";
  const hasRange = Boolean(dateFrom || dateTo || category || reportResult);
  // Met/Missed is a straight list of individual reports (50/page), not the usual grouped-by-pump
  // view -- a single category can hold 300+ reports on one pump, which would defeat "50 at a time"
  // if it only paginated pumps. Search doesn't apply here yet (see the disabled search box below).
  const isFlatMode = Boolean(reportResult);

  const [pumpGroups, setPumpGroups] = useState<ArchivePumpGroup[]>([]);
  const [flatReports, setFlatReports] = useState<ArchiveReportSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalReports, setTotalReports] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  // Debounces the search box -- server-side now, so typing shouldn't fire a
  // request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, dateFrom, dateTo, category, reportResult]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");

    const range = {
      from: dateFrom || undefined,
      to: dateTo || undefined,
      category: category || undefined,
      report_result: reportResult || (undefined as "green" | "red" | undefined),
    };

    const load = isFlatMode
      ? listReportsFlat(page, range).then((result) => {
          if (cancelled) return;
          setFlatReports(result.entries);
          setTotal(result.total);
        })
      : listGroupedReports(page, search || undefined, range).then((result) => {
          if (cancelled) return;
          setPumpGroups(result.entries);
          setTotal(result.total);
          setTotalReports(result.total_reports);
        });

    load
      .catch(() => {
        if (!cancelled) setError("Could not load reports.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, search, dateFrom, dateTo, category, reportResult, isFlatMode]);

  // With a range or a search active the point is to see the matching reports,
  // so every pump on the page opens instead of needing a click each.
  const isSearching = search.length > 0 || hasRange;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleExpanded = (model: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  };

  return (
    <div className="archive-page">
      <PageHeader
        icon="📄"
        title="Report Archive"
        subtitle={isFlatMode ? "Every report that had a rated target to judge · 50 at a time" : "Every test report, grouped by pump · open a row to preview or download its reports."}
        actions={
          // Search isn't wired up for the flat Met/Missed view yet -- hide it rather than let it look
          // like it does something.
          !isFlatMode && (
            <input
              type="text"
              placeholder="Search by model or EC number..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="archive-search"
            />
          )
        }
      />

      {hasRange && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-accent-soft px-4 py-2.5 text-sm text-text">
          <span aria-hidden="true">📅</span>
          <span>
            {category && <strong className="mr-2 text-text-h">{reportCategoryLabel(category)} ·</strong>}
            {reportResult && (
              <strong className={`mr-2 ${reportResult === "green" ? "text-pos-strong" : "text-neg-strong"}`}>
                {reportResult === "green" ? "✓ Met their rated target ·" : "✕ Missed their rated target ·"}
              </strong>
            )}
            Reports tested {dateFrom ? formatDate(dateFrom) : "from the beginning"} – {dateTo ? formatDate(dateTo) : "today"}
            {!isLoading &&
              (isFlatMode ? (
                <strong className="ml-2 text-text-h">{total.toLocaleString()} report{total === 1 ? "" : "s"}</strong>
              ) : (
                <strong className="ml-2 text-text-h">
                  {totalReports.toLocaleString()} report{totalReports === 1 ? "" : "s"} · {total.toLocaleString()} pump{total === 1 ? "" : "s"}
                </strong>
              ))}
          </span>
          <button
            type="button"
            onClick={() => router.push("/reports")}
            className="ml-auto cursor-pointer rounded-lg border border-border bg-surface px-3 py-1 text-xs font-semibold text-text hover:bg-surface-hover"
          >
            ✕ Clear range
          </button>
        </div>
      )}

      {error && <div className="archive-error">{error}</div>}

      {isFlatMode ? (
        !isLoading && flatReports.length === 0 ? (
          <p className="archive-empty">No reports match this filter.</p>
        ) : (
          <table className="nested-report-table">
            <thead>
              <tr>
                <th>Report No.</th>
                <th>Model</th>
                <th>Category</th>
                <th>Test Date</th>
                <th>Rated Capacity</th>
                <th>Rated Head</th>
                <th>Rated RPM</th>
                <th>Rated KW</th>
                <th>Points</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <SkeletonTableRows columns={9} />}
              {!isLoading &&
                flatReports.map((r) => {
                  const unmetFields = r.requirement_unmet_fields ?? [];
                  const unmetTitle = unmetFields.length ? `Outside rated ${unmetFields.join(", ")}` : "";
                  return (
                    <tr key={r.id} className={unmetTitle ? "requirement-row-not-met" : ""} title={unmetTitle || undefined}>
                      <td>
                        <Link href={`/reports/${r.report_no ?? r.id}`}>{r.report_no ?? r.motor ?? "View report"}</Link>
                        {unmetTitle && <span className="requirement-flag">⚠</span>}
                      </td>
                      <td>
                        <Link href={`/pumps/${encodeURIComponent(r.model)}`}>{r.model}</Link>
                      </td>
                      <td title="The category this report states for itself (its remarks / EC number)">
                        {r.report_category && r.report_category !== "none" ? reportCategoryLabel(r.report_category).replace(/^Against\s+/i, "") : "-"}
                      </td>
                      <td>{formatDate(r.test_date ?? r.created_at)}</td>
                      <td>{formatNumber(r.rated_capacity)}</td>
                      <td>{formatNumber(r.rated_head)}</td>
                      <td>{formatNumber(r.rated_rpm)}</td>
                      <td>{formatNumber(r.rated_power_kw)}</td>
                      <td>{r.pointCount}</td>
                      <td>
                        <Link href={`/reports/${r.report_no ?? r.id}/curve`}>View Curve</Link>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )
      ) : !isLoading && pumpGroups.length === 0 ? (
        <p className="archive-empty">No pumps found.</p>
      ) : (
        <table className="archive-table">
          <thead>
            <tr>
              <th></th>
              <th>Pump Model</th>
              <th>Reports</th>
              <th>Formats</th>
              <th>Total Test Points</th>
              <th>Latest Test Date</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTableRows columns={6} />}
            {!isLoading && pumpGroups.map((g) => {
              const isOpen = isSearching || expanded.has(g.model);
              return (
                <Fragment key={g.model}>
                  <tr className="pump-row" onClick={() => toggleExpanded(g.model)}>
                    <td className="expand-toggle">{isOpen ? "−" : "+"}</td>
                    <td className="pump-model-cell">
                      <Link href={`/pumps/${encodeURIComponent(g.model)}`} onClick={(e) => e.stopPropagation()}>
                        {g.model}
                      </Link>
                    </td>
                    <td>{g.report_count}</td>
                    <td>
                      <span className={`format-badge ${g.has_observation ? "present" : "missing"}`}>Obs</span>
                      <span className={`format-badge ${g.has_viscosity_chart ? "present" : "missing"}`}>VC</span>
                    </td>
                    <td>{g.total_points}</td>
                    <td>{formatDate(g.latest_test_date)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="pump-detail-row">
                      <td></td>
                      <td colSpan={5}>
                        <table className="nested-report-table">
                          <thead>
                            <tr>
                              <th>Report No.</th>
                              <th>Motor</th>
                              <th>Category</th>
                              <th>Test Date</th>
                              <th>Rated Capacity</th>
                              <th>Rated Head</th>
                              <th>Rated RPM</th>
                              <th>Rated KW</th>
                              <th>Points</th>
                              <th>Max VE</th>
                              <th>Max ME</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.reports.map((r) => {
                              const unmetFields = r.requirement_unmet_fields ?? [];
                              const unmetTitle = unmetFields.length
                                ? `Outside rated ${unmetFields.join(", ")}`
                                : "";
                              return (
                                <tr key={r.id} className={unmetTitle ? "requirement-row-not-met" : ""} title={unmetTitle || undefined}>
                                  <td>
                                    <Link href={`/reports/${r.report_no ?? r.id}`}>{r.report_no ?? r.motor ?? "View report"}</Link>
                                    {unmetTitle && <span className="requirement-flag">⚠</span>}
                                  </td>
                                  <td>{motorWithKw(r.motor)}</td>
                                  <td title="The category this report states for itself (its remarks / EC number)">
                                    {r.report_category && r.report_category !== "none"
                                      ? reportCategoryLabel(r.report_category).replace(/^Against\s+/i, "")
                                      : "-"}
                                  </td>
                                  <td>{formatDate(r.test_date ?? r.created_at)}</td>
                                  <td>{formatNumber(r.rated_capacity)}</td>
                                  <td>{formatNumber(r.rated_head)}</td>
                                  <td>{formatNumber(r.rated_rpm)}</td>
                                  <td>{formatNumber(r.rated_power_kw)}</td>
                                  <td>{r.pointCount}</td>
                                  {(() => {
                                    // Below this model's own VE/ME acceptance criteria, even at its best point --
                                    // only these two cells turn red, never the whole row.
                                    const acceptance = veMeAcceptanceFor(r.model);
                                    const veLow = acceptance !== null && r.max_ve !== null && r.max_ve < acceptance.ve;
                                    const meLow = acceptance !== null && r.max_me !== null && r.max_me < acceptance.me;
                                    return (
                                      <>
                                        <td className={veLow ? "requirement-cell-not-met" : undefined} title={veLow ? `Below the ${r.model} acceptance criteria of ${acceptance!.ve}%` : undefined}>
                                          {r.max_ve !== null ? `${r.max_ve.toFixed(1)}%` : "-"}
                                        </td>
                                        <td className={meLow ? "requirement-cell-not-met" : undefined} title={meLow ? `Below the ${r.model} acceptance criteria of ${acceptance!.me}%` : undefined}>
                                          {r.max_me !== null ? `${r.max_me.toFixed(1)}%` : "-"}
                                        </td>
                                      </>
                                    );
                                  })()}
                                  <td>
                                    <Link href={`/reports/${r.report_no ?? r.id}/curve`}>View Curve</Link>
                                  </td>
                                </tr>
                              );
                            })}
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
      )}

      <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </div>
  );
};

export default ReportArchivePage;
