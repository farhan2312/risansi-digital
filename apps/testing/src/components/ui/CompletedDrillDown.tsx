"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { listReportsFlat, listRequisitions, type RequisitionFilters } from "@/services/testingService";
import { formatDate } from "@/lib/formUtils";
import type { ArchiveReportSummary, TestRequisition } from "@/types/testing";

/** A server-paginated list that grows with "Load more". */
const usePagedList = <T,>(load: (page: number) => Promise<{ entries: T[]; total: number }>) => {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    load(page)
      .then((r) => {
        if (cancelled) return;
        setItems((prev) => (page === 1 ? r.entries : [...prev, ...r.entries]));
        setTotal(r.total);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the list. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `load` is built once from the (fixed) link, so only the page number drives a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return { items, total, loading, error, loadMore: () => setPage((p) => p + 1) };
};

const SectionHeader = ({ title, count }: { title: string; count: number }) => (
  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg-sunk px-5 py-2 text-xs font-bold uppercase tracking-wide text-text-muted">
    {title}
    <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-text">{count.toLocaleString()}</span>
  </div>
);

const LoadMore = ({ loaded, total, loading, onClick }: { loaded: number; total: number; loading: boolean; onClick: () => void }) =>
  loaded < total ? (
    <div className="p-3 text-center">
      <button
        type="button"
        disabled={loading}
        onClick={onClick}
        className="rounded-lg border border-border px-4 py-1.5 text-xs font-semibold text-text hover:bg-surface-hover disabled:opacity-60"
      >
        {loading ? "Loading…" : `Load more (${(total - loaded).toLocaleString()} left)`}
      </button>
    </div>
  ) : null;

/**
 * "Completed" on the Requisitions-by-category table counts the closed requisitions PLUS every filed report
 * (a filed report is finished testing). So clicking it lists both, and the two section counts add up to the
 * number that was clicked.
 */
const CompletedDrillDown = ({
  params,
  query,
  onTotal,
}: {
  params: URLSearchParams;
  /** The modal's search box (already lower-cased). */
  query: string;
  /** Reports the combined count (closed requisitions + reports) up to the modal header. */
  onTotal: (n: number) => void;
}) => {
  const requisitions = usePagedList<TestRequisition>((page) => {
    const filters: RequisitionFilters = {
      model: params.get("model") || undefined,
      category: params.get("category") || undefined,
      source_team: params.get("source_team") || undefined,
      responsible_person: params.get("responsible_person") || undefined,
      date_from: params.get("from") || undefined,
      date_to: params.get("to") || undefined,
    };
    return listRequisitions("Closed", page, filters);
  });
  const reports = usePagedList<ArchiveReportSummary>((page) =>
    listReportsFlat(page, {
      from: params.get("from") || undefined,
      to: params.get("to") || undefined,
      category: params.get("category") || undefined,
      model: params.get("model") || undefined,
    })
  );

  useEffect(() => {
    onTotal(requisitions.total + reports.total);
  }, [requisitions.total, reports.total, onTotal]);

  const shownReqs = query
    ? requisitions.items.filter((r) => [r.requisition_no, r.model, r.ec_quotation_no, r.responsible_person, r.submitted_by].some((v) => v?.toLowerCase().includes(query)))
    : requisitions.items;
  const shownReports = query ? reports.items.filter((r) => [r.report_no, r.model, r.tested_by].some((v) => v?.toLowerCase().includes(query))) : reports.items;

  const error = requisitions.error || reports.error;
  if (error) return <p className="p-5 text-sm font-medium text-neg">{error}</p>;
  if (requisitions.loading && reports.loading && requisitions.items.length + reports.items.length === 0) {
    return <p className="p-5 text-sm text-text-muted">Loading…</p>;
  }

  return (
    <>
      <SectionHeader title="Closed requisitions" count={requisitions.total} />
      {shownReqs.length === 0 && !requisitions.loading && <p className="px-5 py-4 text-sm text-text-muted">None.</p>}
      {shownReqs.map((r) => (
        <Link
          key={r.id}
          href={`/requisitions/${r.requisition_no ?? r.id}`}
          className="flex items-start justify-between gap-4 border-b border-border px-5 py-3 hover:bg-surface-hover"
        >
          <div className="min-w-0">
            <span className="font-mono text-sm font-bold text-accent">{r.requisition_no ?? "—"}</span>
            <div className="truncate text-sm text-text">{r.model}</div>
            {r.ec_quotation_no && <div className="truncate text-[11px] text-text-faint">{r.ec_quotation_no}</div>}
          </div>
          <div className="shrink-0 text-right text-[11px] text-text-muted">
            <div>{r.responsible_person ?? "Unassigned"}</div>
            <div>{formatDate(r.date_of_requisition ?? r.created_at)}</div>
          </div>
        </Link>
      ))}
      <LoadMore loaded={requisitions.items.length} total={requisitions.total} loading={requisitions.loading} onClick={requisitions.loadMore} />

      <SectionHeader title="Reports filed" count={reports.total} />
      {shownReports.length === 0 && !reports.loading && <p className="px-5 py-4 text-sm text-text-muted">None.</p>}
      {shownReports.map((r) => (
        <Link
          key={r.id}
          href={`/reports/${r.report_no ?? r.id}`}
          className="flex items-start justify-between gap-4 border-b border-border px-5 py-3 hover:bg-surface-hover"
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
      <LoadMore loaded={reports.items.length} total={reports.total} loading={reports.loading} onClick={reports.loadMore} />
    </>
  );
};

export default CompletedDrillDown;
