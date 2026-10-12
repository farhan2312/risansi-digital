"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import "./EditPasswordModal.css"; // .modal-overlay
import "../../screens/dashboard/DashboardPage.css"; // .status-pill / .status-* colors
import { listReportsFlat, listRequisitions, type RequisitionFilters } from "@/services/testingService";
import { formatDate } from "@/lib/formUtils";
import CompletedDrillDown from "@/components/ui/CompletedDrillDown";
import { ImprovementModelRows, useImprovementModels } from "@/components/ui/ImprovementModels";
import type { ArchiveReportSummary, RequisitionStatus, TestRequisition } from "@/types/testing";

interface DrillDownModalProps {
  /** The same "/dashboard?..." or "/reports?..." link the Overview card used to navigate to. */
  href: string;
  onClose: () => void;
}

/** Links for this category open the improvement models (the VE & ME Performance list) instead of requisitions. */
const IMPROVEMENT_CATEGORY = "Against Improvement Project";

const STATUSES: RequisitionStatus[] = ["Pending", "In Testing", "Retest Needed", "Closed"];
const SCOPE_LABELS: Record<string, string> = { open: "Open", overdue: "Overdue", due_soon: "Due soon" };

/** The card's filters, in words: "Pending · Overdue · Category: X". */
const describe = (params: URLSearchParams, kind: "requisitions" | "reports"): string => {
  const parts: string[] = [];
  const status = params.get("status");
  if (params.get("view") === "completed") parts.push("Closed requisitions + filed reports");
  else if (status) parts.push(status);
  const scope = params.get("scope");
  if (scope) parts.push(SCOPE_LABELS[scope] ?? scope);
  const result = params.get("report_result");
  if (result) parts.push(result === "green" ? "Met rated target" : "Missed rated target");
  for (const [key, label] of [
    ["category", "Category"],
    ["source_team", "Source team"],
    ["responsible_person", "Responsible"],
    ["raised_by", "Raised by"],
    ["model", "Model"],
    ["ec", "EC / Quotation"],
  ] as const) {
    const v = params.get(key);
    if (v) parts.push(`${label}: ${v}`);
  }
  const from = params.get("from");
  const to = params.get("to");
  if (from || to) parts.push(`${from ? formatDate(from) : "…"} – ${to ? formatDate(to) : "…"}`);
  else parts.push("All time");
  return parts.join(" · ") || (kind === "reports" ? "All reports" : "All requisitions");
};

const DrillDownModal = ({ href, onClose }: DrillDownModalProps) => {
  const { kind, params } = useMemo(() => {
    const url = new URL(href, "http://x");
    return { kind: url.pathname.startsWith("/reports") ? ("reports" as const) : ("requisitions" as const), params: url.searchParams };
  }, [href]);

  const improvementView = params.get("category") === IMPROVEMENT_CATEGORY;
  const improvement = useImprovementModels(improvementView);
  // "Completed" on the category table = closed requisitions + filed reports; that view lists both.
  const completedView = !improvementView && params.get("view") === "completed";
  const [completedTotal, setCompletedTotal] = useState(0);

  const [reqs, setReqs] = useState<TestRequisition[]>([]);
  const [reports, setReports] = useState<ArchiveReportSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(!improvementView && !completedView);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // The improvement view reads its own list (useImprovementModels), not requisitions or reports.
    // The completed view has its own two lists (CompletedDrillDown).
    if (improvementView || completedView) return;
    let cancelled = false;
    setIsLoading(true);
    setError("");
    const done = () => {
      if (!cancelled) setIsLoading(false);
    };
    const failed = () => {
      if (!cancelled) setError("Could not load the list. Please try again.");
    };

    if (kind === "reports") {
      const result = params.get("report_result");
      listReportsFlat(page, {
        from: params.get("from") || undefined,
        to: params.get("to") || undefined,
        category: params.get("category") || undefined,
        report_result: result === "green" || result === "red" ? result : undefined,
        model: params.get("model") || undefined,
        status: params.get("status") || undefined,
      })
        .then((r) => {
          if (cancelled) return;
          setReports((prev) => (page === 1 ? r.entries : [...prev, ...r.entries]));
          setTotal(r.total);
        })
        .catch(failed)
        .finally(done);
    } else {
      const status = params.get("status");
      const filters: RequisitionFilters = {
        model: params.get("model") || undefined,
        ec_quotation_no: params.get("ec") || undefined,
        scope: (params.get("scope") as RequisitionFilters["scope"]) || undefined,
        category: params.get("category") || undefined,
        source_team: params.get("source_team") || undefined,
        raised_by: (params.get("raised_by") as RequisitionFilters["raised_by"]) || undefined,
        responsible_person: params.get("responsible_person") || undefined,
        date_from: params.get("from") || undefined,
        date_to: params.get("to") || undefined,
        report_result: (params.get("report_result") as RequisitionFilters["report_result"]) || undefined,
      };
      listRequisitions(STATUSES.includes(status as RequisitionStatus) ? (status as RequisitionStatus) : undefined, page, filters)
        .then((r) => {
          if (cancelled) return;
          setReqs((prev) => (page === 1 ? r.entries : [...prev, ...r.entries]));
          setTotal(r.total);
        })
        .catch(failed)
        .finally(done);
    }
    return () => {
      cancelled = true;
    };
  }, [kind, params, page, improvementView, completedView]);

  const q = search.trim().toLowerCase();
  const shownReqs = q
    ? reqs.filter((r) => [r.requisition_no, r.model, r.ec_quotation_no, r.responsible_person, r.submitted_by, r.category].some((v) => v?.toLowerCase().includes(q)))
    : reqs;
  const shownReports = q ? reports.filter((r) => [r.report_no, r.model, r.tested_by].some((v) => v?.toLowerCase().includes(q))) : reports;
  const shownModels = useMemo(
    () => (improvement.data?.models ?? []).filter((m) => !q || m.model.toLowerCase().includes(q)),
    [improvement.data, q]
  );

  const loaded = kind === "reports" ? reports.length : reqs.length;
  const shownCount = improvementView ? shownModels.length : kind === "reports" ? shownReports.length : shownReqs.length;
  const listLoading = improvementView ? improvement.isLoading : isLoading;
  const listError = improvementView ? improvement.error : error;
  const headerCount = improvementView ? (improvement.data?.models.length ?? 0) : completedView ? completedTotal : total;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ alignItems: "flex-start", paddingTop: "8vh" }}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[720px] max-w-[94vw] flex-col overflow-hidden rounded-2xl bg-surface text-text shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-lg font-bold text-text-h">
              {improvementView ? "Improvement models" : completedView ? "Completed" : kind === "reports" ? "Reports" : "Requisitions"}
              <span className="rounded-full bg-bg-sunk px-2 py-0.5 text-xs font-semibold text-text-muted">{headerCount.toLocaleString()}</span>
            </h3>
            <p className="truncate text-xs text-text-muted">
              {improvementView ? "Models with reports below VE / ME acceptance · none of their reports meets both yet" : describe(params, kind)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href={improvementView ? "/performance" : href} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-hover">
              {improvementView ? "Open VE & ME Performance" : "Open full page"}
            </Link>
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-hover">
              Close
            </button>
          </div>
        </div>

        <div className="border-y border-border px-5 py-3">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              improvementView ? "Search model..." : kind === "reports" ? "Search report no., model, tested by..." : "Search requisition no., model, EC / quotation, responsible..."
            }
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
          />
        </div>

        <div className="min-h-[120px] flex-1 overflow-y-auto">
          {completedView && <CompletedDrillDown params={params} query={q} onTotal={setCompletedTotal} />}

          {!completedView && listError && <p className="p-5 text-sm font-medium text-neg">{listError}</p>}
          {!completedView && !listError && listLoading && (improvementView ? !improvement.data : loaded === 0) && <p className="p-5 text-sm text-text-muted">Loading…</p>}
          {!completedView && !listError && !listLoading && shownCount === 0 && <p className="p-5 text-center text-sm text-text-muted">Nothing to show.</p>}

          {improvementView && shownModels.length > 0 && <ImprovementModelRows models={shownModels} />}
          {improvementView && improvement.data && improvement.data.not_listed.length > 0 && (
            <p className="m-0 border-t border-border px-5 py-3 text-xs text-text-muted">
              <span className="font-semibold text-text">Not listed ({improvement.data.not_listed.length}):</span> {improvement.data.not_listed.join(", ")} — each has at least one
              report that meets both VE and ME acceptance.
            </p>
          )}

          {!improvementView &&
            !completedView &&
            kind === "requisitions" &&
            shownReqs.map((r) => (
              <Link
                key={r.id}
                href={`/requisitions/${r.requisition_no ?? r.id}`}
                className="flex items-start justify-between gap-4 border-b border-border px-5 py-3 last:border-b-0 hover:bg-surface-hover"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-accent">{r.requisition_no ?? "—"}</span>
                    <span className={`status-pill status-${r.status.replace(/\s+/g, "-").toLowerCase()}`}>{r.status}</span>
                  </div>
                  <div className="truncate text-sm text-text">{r.model}</div>
                  {r.ec_quotation_no && <div className="truncate text-[11px] text-text-faint">{r.ec_quotation_no}</div>}
                </div>
                <div className="shrink-0 text-right text-[11px] text-text-muted">
                  <div>{r.responsible_person ?? "Unassigned"}</div>
                  <div>{r.target_date ? `Target ${formatDate(r.target_date)}` : formatDate(r.date_of_requisition ?? r.created_at)}</div>
                </div>
              </Link>
            ))}

          {!improvementView &&
            !completedView &&
            kind === "reports" &&
            shownReports.map((r) => (
              <Link
                key={r.id}
                href={`/reports/${r.report_no ?? r.id}`}
                className="flex items-start justify-between gap-4 border-b border-border px-5 py-3 last:border-b-0 hover:bg-surface-hover"
              >
                <div className="min-w-0">
                  <span className="font-mono text-sm font-bold text-accent">{r.report_no ?? "—"}</span>
                  <div className="truncate text-sm text-text">{r.model}</div>
                </div>
                <div className="shrink-0 text-right text-[11px] text-text-muted">
                  <div>{r.tested_by ?? "—"}</div>
                  <div>{formatDate(r.test_date ?? r.created_at)}</div>
                </div>
              </Link>
            ))}

          {!improvementView && !completedView && loaded < total && !error && (
            <div className="p-3 text-center">
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-border px-4 py-1.5 text-xs font-semibold text-text hover:bg-surface-hover disabled:opacity-60"
              >
                {isLoading ? "Loading…" : `Load more (${(total - loaded).toLocaleString()} left)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DrillDownModal;
