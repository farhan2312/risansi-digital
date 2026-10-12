"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import "./DashboardPage.css";
import { formatDate, targetDateFor } from "@/lib/formUtils";
import { deleteRequisition, getRequisitionFilterOptions, listRequisitions, updateRequisition } from "@/services/testingService";
import { canDeleteRequisition } from "@/lib/requisitionPermissions";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { useAuth } from "@/contexts/AuthContext";
import { SkeletonTableRows } from "@/components/ui/Skeleton";
import HeroHeader from "@/components/ui/HeroHeader";
import { localIsoDay, rangeFor } from "@/lib/dateRangePresets";
import { RAISED_BY_GROUPS, RAISED_BY_LABELS, RAISED_BY_SHORT } from "@/lib/raisedBy";
import {
  REQUISITION_CATEGORIES,
  RESPONSIBLE_PERSONS,
  SOURCE_TEAMS,
  type RequisitionStatus,
  type TestRequisition,
} from "@/types/testing";

const ALL = "All";

const STATUS_TABS: { label: string; value: RequisitionStatus | "All" }[] = [
  { label: "All", value: "All" },
  { label: "Pending", value: "Pending" },
  { label: "In Testing", value: "In Testing" },
  { label: "Retest Needed", value: "Retest Needed" },
  { label: "Closed", value: "Closed" },
];

const SCOPE_OPTIONS = [
  { value: "open", label: "Open (not closed)" },
  { value: "overdue", label: "Overdue" },
  { value: "due_soon", label: "Due in 5 days" },
] as const;

const TABLE_CLASS = [
  "w-full min-w-[900px] border-collapse text-[13px]",
  "[&_th]:border-b [&_th]:border-border [&_th]:bg-bg-sunk [&_th]:px-3 [&_th]:py-3 [&_th]:text-left [&_th]:align-bottom [&_th]:text-[10.5px] [&_th]:font-bold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-[0.06em] [&_th]:text-text-muted",
  "[&_td]:border-b [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-3 [&_td]:align-middle [&_td]:text-text",
  "[&_td:nth-child(6)]:whitespace-nowrap [&_td:nth-child(7)]:whitespace-nowrap [&_td:nth-child(8)]:whitespace-nowrap [&_td:nth-child(10)]:whitespace-nowrap",
  "[&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface-hover [&_tbody_tr:hover_.sticky]:bg-surface-hover",
  "[&_tbody_tr:last-child_td]:border-b-0",
  "[&_td>a:not(.status-pill)]:font-semibold [&_td>a:not(.status-pill)]:text-accent [&_td>a:not(.status-pill):hover]:underline",
].join(" ");

/** Actions column stays pinned to the right edge while the rest of the table scrolls under it. */
const STICKY_END = "sticky right-0 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.12)]";

const DATE_INPUT =
  "h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

/** Date shortcuts next to the From / To pickers; a chip is "on" when the picked range matches it exactly. */
const DATE_PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: "Today", range: () => rangeFor(1) },
  {
    label: "Yesterday",
    range: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return { from: localIsoDay(d), to: localIsoDay(d) };
    },
  },
  { label: "Last 7 days", range: () => rangeFor(7) },
  { label: "Last 30 days", range: () => rangeFor(30) },
  { label: "This month", range: () => rangeFor(new Date().getDate()) },
  {
    label: "This year",
    range: () => ({ from: `${new Date().getFullYear()}-01-01`, to: localIsoDay(new Date()) }),
  },
];

/** A "Label: Value" pill wrapping a native <select>: the muted label sits inline, the chosen value is bold,
 * and the pill takes the accent tint once the filter is doing something. */
const FilterChip = ({ label, active, children }: { label: string; active: boolean; children: ReactNode }) => (
  <label
    className={`relative inline-flex h-10 max-w-full items-center gap-1.5 rounded-xl border pl-3.5 pr-8 text-sm transition focus-within:ring-2 focus-within:ring-accent/20 hover:border-border-strong ${
      active ? "border-accent bg-accent-soft" : "border-border bg-surface"
    }`}
  >
    <span className="whitespace-nowrap text-text-muted">{label}:</span>
    <span className="min-w-0 [&_select]:max-w-[170px] [&_select]:cursor-pointer [&_select]:appearance-none [&_select]:truncate [&_select:not([hidden])]:border-0! [&_select:not([hidden])]:bg-transparent! [&_select]:pr-1 [&_select]:font-semibold [&_select:not([hidden])]:text-text-h! [&_select]:outline-none [&_option]:bg-surface [&_option]:text-text">
      {children}
    </span>
    <svg className="pointer-events-none absolute right-3 text-text-muted" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </label>
);

const fromQuery = (value: string | null, allowed: readonly string[]) =>
  value && allowed.includes(value) ? value : ALL;

const isoDateParam = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");

const DashboardPage = () => {
  const searchParams = useSearchParams();
  const [requisitions, setRequisitions] = useState<TestRequisition[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [reportResultCounts, setReportResultCounts] = useState({ green: 0, red: 0 });
  // Lets a link like /dashboard?status=Pending (the Overview page's
  // Requisitions by Status card) land here pre-filtered, instead of always
  // opening on "All" and making the user click the tab themselves.
  const [activeStatus, setActiveStatus] = useState<RequisitionStatus | "All">(() => {
    const fromQuery = searchParams.get("status");
    return STATUS_TABS.some((t) => t.value === fromQuery) ? (fromQuery as RequisitionStatus) : "All";
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const { user: loggedInUser } = useAuth();
  const canReassign = loggedInUser?.role === "testing";
  const canDelete = canDeleteRequisition(loggedInUser?.role);
  // Admin-only delete: the row awaiting confirmation.
  const [deleteTarget, setDeleteTarget] = useState<TestRequisition | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [modelFilter, setModelFilter] = useState(ALL);
  // ecInput is the live textbox value; ecFilter is the debounced value that
  // actually drives the server fetch, so typing doesn't fire a request per
  // keystroke.
  const [ecInput, setEcInput] = useState(() => searchParams.get("ec") ?? "");
  const [ecFilter, setEcFilter] = useState(() => (searchParams.get("ec") ?? "").trim());
  // "Open" / "Overdue" / "Due in 5 days" -- Overview KPI drill-downs.
  const [scopeFilter, setScopeFilter] = useState(() => fromQuery(searchParams.get("scope"), SCOPE_OPTIONS.map((o) => o.value)));
  // Overview drill-downs (/dashboard?category=...&from=...&to=...) land here
  // pre-filtered. Only values the dropdowns actually offer are accepted, so a
  // stale or hand-edited link can never leave a select showing a blank value.
  const [categoryFilter, setCategoryFilter] = useState(() => fromQuery(searchParams.get("category"), [...REQUISITION_CATEGORIES, "none"]));
  const [sourceTeamFilter, setSourceTeamFilter] = useState(() => fromQuery(searchParams.get("source_team"), [...SOURCE_TEAMS, "none"]));
  // Who raised it: a Source Team account, a Testing Team account, or anyone else.
  const [raisedByFilter, setRaisedByFilter] = useState(() => fromQuery(searchParams.get("raised_by"), RAISED_BY_GROUPS));
  const [responsiblePersonFilter, setResponsiblePersonFilter] = useState(() =>
    fromQuery(searchParams.get("responsible_person"), [...RESPONSIBLE_PERSONS, "none"])
  );
  const [submittedByFilter, setSubmittedByFilter] = useState(ALL);
  const [retestFilter, setRetestFilter] = useState(ALL);
  // Quick "Month" pick (e.g. "2026-08") -- a shortcut for the common case of
  // "show me last month's requisitions" without having to work out exact
  // From/To dates. Combines (AND) with the From/To range below when both
  // are set, same as every other filter here.
  const [monthFilter, setMonthFilter] = useState(ALL);
  const [dateFrom, setDateFrom] = useState(() => isoDateParam(searchParams.get("from")));
  const [dateTo, setDateTo] = useState(() => isoDateParam(searchParams.get("to")));
  // Only meaningful once a single Category is selected -- a second-level
  // filter for how many of that category's filled reports met their rated
  // requirements vs didn't ("Red").
  // Also seeded from ?report_result= (the Overview's Met / Missed links).
  const [reportResultFilter, setReportResultFilter] = useState<"All" | "Green" | "Red">(() => {
    const fromQuery = searchParams.get("report_result");
    return fromQuery === "green" ? "Green" : fromQuery === "red" ? "Red" : "All";
  });

  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [submittedByOptions, setSubmittedByOptions] = useState<string[]>([]);
  const [monthOptions, setMonthOptions] = useState<string[]>([]);

  const hasActiveFilters =
    modelFilter !== ALL ||
    ecFilter.trim() !== "" ||
    scopeFilter !== ALL ||
    categoryFilter !== ALL ||
    sourceTeamFilter !== ALL ||
    raisedByFilter !== ALL ||
    responsiblePersonFilter !== ALL ||
    submittedByFilter !== ALL ||
    retestFilter !== ALL ||
    monthFilter !== ALL ||
    dateFrom !== "" ||
    dateTo !== "" ||
    reportResultFilter !== "All";

  const clearFilters = () => {
    setModelFilter(ALL);
    setEcInput("");
    setEcFilter("");
    setScopeFilter(ALL);
    setCategoryFilter(ALL);
    setSourceTeamFilter(ALL);
    setRaisedByFilter(ALL);
    setResponsiblePersonFilter(ALL);
    setSubmittedByFilter(ALL);
    setRetestFilter(ALL);
    setMonthFilter(ALL);
    setDateFrom("");
    setDateTo("");
    setReportResultFilter("All");
  };

  const handleCategoryChange = (value: string) => {
    setCategoryFilter(value);
    setReportResultFilter("All");
  };

  const handleReassign = async (id: string, responsiblePerson: string) => {
    try {
      const updated = await updateRequisition(id, { responsible_person: responsiblePerson });
      setRequisitions((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch {
      setError("Could not update responsible person. Please try again.");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteRequisition(deleteTarget.id);
      // Scroll pagination has no "page" to step back to -- just drop the row from what's
      // already loaded and adjust the running total, instead of re-fetching everything.
      setRequisitions((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setTotal((prev) => Math.max(0, prev - 1));
      setDeleteTarget(null);
    } catch (e) {
      const message = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setDeleteTarget(null);
      setError(message ?? "Could not delete the requisition. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Debounces the free-text EC/Quotation No. field -- everything else
  // (dropdowns, dates) applies immediately on change, same as before.
  useEffect(() => {
    const t = setTimeout(() => setEcFilter(ecInput.trim()), 300);
    return () => clearTimeout(t);
  }, [ecInput]);

  // Any filter (or the status tab) changing invalidates whatever page we
  // were on -- always land back on page 1 rather than a now-meaningless
  // page number against the new, narrower result set.
  useEffect(() => {
    setPage(1);
  }, [
    activeStatus,
    modelFilter,
    ecFilter,
    scopeFilter,
    categoryFilter,
    sourceTeamFilter,
    raisedByFilter,
    responsiblePersonFilter,
    submittedByFilter,
    retestFilter,
    monthFilter,
    dateFrom,
    dateTo,
    reportResultFilter,
  ]);

  useEffect(() => {
    let cancelled = false;
    // Page 1 (a fresh load or a filter change) replaces the list and shows the skeleton; page > 1
    // (scrolling further down) appends and only shows the small "Loading more" row at the bottom,
    // so the rows already on screen don't disappear while the next batch comes in.
    if (page === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    setError("");

    listRequisitions(activeStatus === "All" ? undefined : activeStatus, page, {
      model: modelFilter === ALL ? undefined : modelFilter,
      ec_quotation_no: ecFilter || undefined,
      scope: scopeFilter === ALL ? undefined : (scopeFilter as (typeof SCOPE_OPTIONS)[number]["value"]),
      category: categoryFilter === ALL ? undefined : categoryFilter,
      source_team: sourceTeamFilter === ALL ? undefined : sourceTeamFilter,
      raised_by: raisedByFilter === ALL ? undefined : (raisedByFilter as (typeof RAISED_BY_GROUPS)[number]),
      responsible_person: responsiblePersonFilter === ALL ? undefined : responsiblePersonFilter,
      submitted_by: submittedByFilter === ALL ? undefined : submittedByFilter,
      retest_needed: retestFilter === ALL ? undefined : retestFilter === "Yes" ? "true" : "false",
      month: monthFilter === ALL ? undefined : monthFilter,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      report_result:
        reportResultFilter === "All" ? undefined : reportResultFilter === "Green" ? "green" : "red",
    })
      .then((result) => {
        if (cancelled) return;
        setRequisitions((prev) => (page === 1 ? result.entries : [...prev, ...result.entries]));
        setTotal(result.total);
        if (result.report_result_counts) setReportResultCounts(result.report_result_counts);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load testing summaries.");
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
        setIsLoadingMore(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeStatus,
    page,
    modelFilter,
    ecFilter,
    scopeFilter,
    categoryFilter,
    sourceTeamFilter,
    raisedByFilter,
    responsiblePersonFilter,
    submittedByFilter,
    retestFilter,
    monthFilter,
    dateFrom,
    dateTo,
    reportResultFilter,
  ]);

  // Filter-bar dropdown options depend only on the status tab, not the
  // other filters (matches the pre-pagination behavior) -- fetched
  // separately since the row list itself is now just one page of 25.
  useEffect(() => {
    let cancelled = false;
    getRequisitionFilterOptions(activeStatus === "All" ? undefined : activeStatus)
      .then((opts) => {
        if (cancelled) return;
        setModelOptions(opts.models);
        setSubmittedByOptions(opts.submitted_by);
        setMonthOptions(opts.months);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeStatus]);

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-");
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
      new Date(Number(y), Number(m) - 1, 1)
    );
  };

  const emptyMessage = hasActiveFilters
    ? "No testing summaries match these filters."
    : "No testing summaries in this status.";

  // Scroll pagination: load the next 25 automatically once the sentinel row at the bottom of the
  // table scrolls into view, instead of Prev/Next page buttons. Guards against firing while a page
  // is already in flight, and against firing again once every row is loaded.
  const hasMore = requisitions.length < total;
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  const loadingRef = useRef(false);
  loadingRef.current = isLoading || isLoadingMore;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  const handleIntersect = useCallback<IntersectionObserverCallback>((entries) => {
    if (entries[0]?.isIntersecting && !loadingRef.current && hasMoreRef.current) {
      setPage((p) => p + 1);
    }
  }, []);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(handleIntersect, { rootMargin: "400px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [handleIntersect, requisitions.length]);

  return (
    <div className="tw-reset mx-auto flex max-w-[1400px] flex-col gap-4 p-2">
      <HeroHeader
        dense
        title="Testing Summary"
        subtitle={isLoading && requisitions.length === 0 ? "Loading requisitions…" : `${total.toLocaleString()} requisition${total === 1 ? "" : "s"}${hasActiveFilters ? " match your filters" : " in this view"}`}
        actions={
          <Link href="/requisitions/new" className="hero-btn">
            <span aria-hidden="true" className="text-base leading-none">+</span> New Requisition
          </Link>
        }
      >
        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <div className="range-group" role="group" aria-label="Status">
            {STATUS_TABS.map((tab) => (
              <button key={tab.value} type="button" className="range-pill" aria-pressed={activeStatus === tab.value} onClick={() => setActiveStatus(tab.value)}>
                {tab.label}
              </button>
            ))}
          </div>
          {(isLoading || isLoadingMore) && requisitions.length > 0 && <span className="ml-auto text-xs text-text-muted">updating…</span>}
        </div>
      </HeroHeader>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex h-10 min-w-[240px] flex-1 items-center sm:max-w-[340px]">
            <svg className="pointer-events-none absolute left-3 text-text-faint" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="text"
              className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm text-text outline-none transition placeholder:text-text-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder="Search EC / quotation no."
              value={ecInput}
              onChange={(e) => setEcInput(e.target.value)}
            />
          </label>
          <FilterChip label="Model" active={modelFilter !== ALL}>
            <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
              <option value={ALL}>All models</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </FilterChip>
          <FilterChip label="Deadline" active={scopeFilter !== ALL}>
            <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}>
              <option value={ALL}>All deadlines</option>
              {SCOPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FilterChip>
          <FilterChip label="Category" active={categoryFilter !== ALL}>
            <select value={categoryFilter} onChange={(e) => handleCategoryChange(e.target.value)}>
              <option value={ALL}>All categories</option>
              {REQUISITION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="none">No category</option>
            </select>
          </FilterChip>
          <FilterChip label="Raised by" active={raisedByFilter !== ALL}>
            <select value={raisedByFilter} onChange={(e) => setRaisedByFilter(e.target.value)} aria-label="Raised by">
              <option value={ALL}>Anyone</option>
              {RAISED_BY_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {RAISED_BY_LABELS[g]}
                </option>
              ))}
            </select>
          </FilterChip>
          <FilterChip label="Source team" active={sourceTeamFilter !== ALL}>
            <select value={sourceTeamFilter} onChange={(e) => setSourceTeamFilter(e.target.value)}>
              <option value={ALL}>All teams</option>
              {SOURCE_TEAMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="none">Unspecified</option>
            </select>
          </FilterChip>
          <FilterChip label="Responsible" active={responsiblePersonFilter !== ALL}>
            <select value={responsiblePersonFilter} onChange={(e) => setResponsiblePersonFilter(e.target.value)}>
              <option value={ALL}>All persons</option>
              {RESPONSIBLE_PERSONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="none">Unassigned</option>
            </select>
          </FilterChip>
          <FilterChip label="Submitted by" active={submittedByFilter !== ALL}>
            <select value={submittedByFilter} onChange={(e) => setSubmittedByFilter(e.target.value)}>
              <option value={ALL}>Anyone</option>
              {submittedByOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </FilterChip>
          <FilterChip label="Retest" active={retestFilter !== ALL}>
            <select value={retestFilter} onChange={(e) => setRetestFilter(e.target.value)}>
              <option value={ALL}>Any</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </FilterChip>
          <FilterChip label="Month" active={monthFilter !== ALL}>
            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              <option value={ALL}>All months</option>
              {monthOptions.map((ym) => (
                <option key={ym} value={ym}>
                  {monthLabel(ym)}
                </option>
              ))}
            </select>
          </FilterChip>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {DATE_PRESETS.map((p) => {
            const range = p.range();
            const on = dateFrom === range.from && dateTo === range.to;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setDateFrom(range.from);
                  setDateTo(range.to);
                }}
                className={`h-9 rounded-full border px-3.5 text-xs font-semibold transition ${
                  on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text"
                }`}
              >
                {p.label}
              </button>
            );
          })}
          <label className="ml-1 flex items-center gap-1.5 text-xs text-text-muted">
            From
            <input type="date" className={DATE_INPUT} value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            To
            <input type="date" className={DATE_INPUT} value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className="ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold text-neg-strong transition hover:bg-neg-soft">
              ✕ Clear filters
            </button>
          )}
        </div>
      </section>

      {(categoryFilter !== ALL || activeStatus === "Closed" || reportResultFilter !== "All") && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
          <span className="mr-1 text-sm font-semibold text-text-h">
            Reports filled{categoryFilter !== ALL ? ` for "${categoryFilter === "none" ? "No category" : categoryFilter}"` : ""}: {reportResultCounts.green + reportResultCounts.red}
          </span>
          {(
            [
              { key: "All", label: `All (${reportResultCounts.green + reportResultCounts.red})`, on: "border-accent bg-accent-soft text-accent" },
              { key: "Green", label: `Met (${reportResultCounts.green})`, on: "border-pos-strong bg-pos-soft text-pos-strong" },
              { key: "Red", label: `Not Met (${reportResultCounts.red})`, on: "border-neg-strong bg-neg-soft text-neg-strong" },
            ] as const
          ).map((pill) => (
            <button
              key={pill.key}
              type="button"
              onClick={() => setReportResultFilter(pill.key)}
              className={`rounded-full border px-3.5 py-1 text-xs font-semibold transition ${
                reportResultFilter === pill.key ? pill.on : "border-border bg-surface text-text-muted hover:bg-surface-hover"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      )}

      {error && <div className="rounded-xl border border-neg/30 bg-neg-soft px-4 py-3 text-sm font-medium text-neg-strong">{error}</div>}

      {!isLoading && requisitions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface px-6 py-12 text-center text-sm text-text-muted">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              <th>Model</th>
              <th>Category</th>
              <th>EC/Quotation No.</th>
              <th>RES.</th>
              <th>Source Team</th>
              <th>Date of Requisition</th>
              <th>Target Date</th>
              <th>Retest Needed</th>
              <th>Submitted By</th>
              <th>Status</th>
              {canDelete && <th className={STICKY_END + " bg-bg-sunk"}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTableRows columns={canDelete ? 11 : 10} />}
            {!isLoading && requisitions.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/requisitions/${r.requisition_no ?? r.id}`}>{r.model}</Link>
                </td>
                <td>{r.category ?? "-"}</td>
                <td>{r.ec_quotation_no ?? "-"}</td>
                <td>
                  {canReassign ? (
                    <select
                      className="res-reassign-select"
                      value={r.responsible_person ?? ""}
                      onChange={(e) => handleReassign(r.id, e.target.value)}
                    >
                      <option value="" disabled>
                        -
                      </option>
                      {RESPONSIBLE_PERSONS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  ) : (
                    r.responsible_person ?? "-"
                  )}
                </td>
                <td>{r.source_team ?? "-"}</td>
                <td>{formatDate(r.date_of_requisition)}</td>
                <td>
                  {(() => {
                    const target = targetDateFor(r);
                    if (!target) return "-";
                    return (
                      <>
                        {formatDate(target.date)}
                        {target.isAuto && <span className="target-date-auto-hint"> (auto)</span>}
                      </>
                    );
                  })()}
                </td>
                <td>{r.retest_needed === null ? "-" : r.retest_needed ? "Yes" : "No"}</td>
                <td>
                  {r.submitted_by ?? "-"}
                  {r.raised_by_group && (
                    <span className={`raised-by-badge raised-by-${r.raised_by_group}`} title={RAISED_BY_LABELS[r.raised_by_group]}>
                      {RAISED_BY_SHORT[r.raised_by_group]}
                    </span>
                  )}
                </td>
                <td>
                  {r.status === "Closed" && r.report_id ? (
                    (() => {
                      const unmetFields = r.report_requirement_unmet_fields ?? [];
                      const unmetTitle = unmetFields.length
                        ? `Outside rated ${unmetFields.join(", ")}`
                        : undefined;
                      return (
                        <span className="status-actions">
                          <Link
                            href={`/reports/${r.report_no ?? r.report_id}`}
                            className={`status-pill ${unmetTitle ? "status-view-report-unmet" : "status-view-report"}`}
                            title={unmetTitle}
                          >
                            View Report{unmetTitle && " ⚠"}
                          </Link>
                          <Link href={`/reports/${r.report_no ?? r.report_id}/curve`} className="status-pill status-view-curve">
                            View Curve
                          </Link>
                        </span>
                      );
                    })()
                  ) : (
                    <span className={`status-pill status-${r.status.replace(/\s+/g, "-").toLowerCase()}`}>
                      {r.status}
                    </span>
                  )}
                </td>
                {canDelete && (
                  <td className={STICKY_END + " bg-surface"}>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(r)}
                      title={`Delete ${r.requisition_no ?? r.model}`}
                      aria-label={`Delete ${r.requisition_no ?? r.model}`}
                      className="inline-flex cursor-pointer appearance-none items-center gap-1.5 whitespace-nowrap rounded-lg border border-neg/30 bg-neg-soft px-2.5 py-1.5 text-xs font-semibold text-neg-strong transition hover:border-neg hover:bg-neg hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neg/40"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
                      </svg>
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!isLoading && requisitions.length > 0 && (
              <tr ref={sentinelRef}>
                <td colSpan={canDelete ? 11 : 10} className="dashboard-load-more-row">
                  {isLoadingMore ? "Loading more…" : hasMore ? "" : `All ${total.toLocaleString()} loaded`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete requisition"
          message={`Are you sure you want to delete requisition ${deleteTarget.requisition_no ?? deleteTarget.model} (${deleteTarget.model}, ${deleteTarget.status})?`}
          warning="This permanently deletes the requisition and all of its attachments. It cannot be undone. The deletion will be recorded in the audit log under your name."
          confirmLabel="Delete"
          danger
          isConfirming={isDeleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
};

export default DashboardPage;
