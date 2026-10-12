"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import StatusPill from "../../components/ui/StatusPill";
import { fmtNum } from "../../components/charts/charts";
import {
  getDashboardList,
  type DashboardListEnquiry,
  type DashboardListKind,
  type DashboardListStatus,
  type DashboardListTag,
} from "../../services/dashboardService";

/** Which KPI list is open: e.g. { kind: "tags", status: "Pending", title: "Pending tags" }. */
export interface DashboardListTarget {
  kind: DashboardListKind;
  status: DashboardListStatus;
  title: string;
}

/** Rows fetched per batch; the next batch loads as the list is scrolled to its end. */
const BATCH = 10;
const SEARCH_DEBOUNCE_MS = 300;

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * The list behind a Dashboard KPI card. Loaded BATCH rows at a time as it is
 * scrolled, and searched on the server, with
 * the dashboard's own period and "Created by me" scope, so its total always
 * matches the number on the card. Clicking a row opens that enquiry / tag.
 */
export default function DashboardListModal({
  target,
  period,
  mine,
  scopeLabel,
  onClose,
  onOpenEnquiry,
  onOpenTag,
}: {
  target: DashboardListTarget;
  period: { from?: string; to?: string };
  mine: boolean;
  /** "All enquiries" / "Created by me" and the period, shown under the title. */
  scopeLabel: string;
  onClose: () => void;
  onOpenEnquiry: (row: DashboardListEnquiry) => void;
  onOpenTag: (row: DashboardListTag) => void;
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<(DashboardListEnquiry | DashboardListTag)[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLButtonElement>(null);
  // Only the newest request may write rows (a slow batch for an old search
  // can't land in a new one).
  const reqId = useRef(0);

  // Search is sent once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const fetchBatch = useCallback(
    (offset: number) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      getDashboardList({
        kind: target.kind,
        status: target.status,
        q,
        offset,
        limit: BATCH,
        from: period.from,
        to: period.to,
        mine,
      })
        .then((res) => {
          if (id !== reqId.current) return;
          setTotal(res.total);
          setRows((prev) => {
            if (offset === 0) return res.rows;
            const have = new Set(prev.map((r) => r.id));
            return [...prev, ...res.rows.filter((r) => !have.has(r.id))];
          });
        })
        .catch(() => {
          if (id === reqId.current) setError("Couldn't load this list.");
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false);
        });
    },
    [target.kind, target.status, q, period.from, period.to, mine],
  );

  // First batch - again whenever the search (or list) changes, from the top.
  useEffect(() => {
    setRows([]);
    scrollRef.current?.scrollTo({ top: 0 });
    fetchBatch(0);
  }, [fetchBatch]);

  const hasMore = rows.length < total;
  const loadMore = useCallback(() => {
    if (!loading && hasMore && !error) fetchBatch(rows.length);
  }, [loading, hasMore, error, fetchBatch, rows.length]);

  // Next batch when the end of the list scrolls into view. Re-armed after
  // every batch, so a list shorter than the window keeps filling it.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), {
      root: scrollRef.current,
      rootMargin: "120px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, loadMore, rows.length]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isTags = target.kind === "tags";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(10,22,40,0.55)] p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={target.title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-[880px] flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-[0_24px_64px_rgba(0,0,0,0.25)]"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-fg">
              {target.title}
              <span className="ml-2 rounded-full bg-sunk px-2 py-0.5 align-middle font-mono text-[12px] font-semibold text-fg-2">
                {loading && !rows.length ? "…" : fmtNum(total)}
              </span>
            </h2>
            <p className="mt-0.5 text-[12px] text-fg-3">{scopeLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg border border-line px-2.5 py-1.5 text-[13px] font-semibold text-fg-2 transition hover:border-accent hover:text-accent"
          >
            Close
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-line px-5 py-3">
          <input
            type="search"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isTags ? "Search tag, enquiry no., client, media, model…" : "Search enquiry no., client, customer, creator…"}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-4 focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </div>

        {/* Rows */}
        <div ref={scrollRef} className="min-h-[120px] flex-1 overflow-y-auto">
          {error && <p className="px-5 py-6 text-center text-[13px] text-neg">{error}</p>}
          {!error && loading && !rows.length && <p className="px-5 py-6 text-center text-[13px] text-fg-3">Loading…</p>}
          {!error && !loading && !rows.length && (
            <p className="px-5 py-6 text-center text-[13px] text-fg-3">{q ? "Nothing matches this search." : "Nothing here."}</p>
          )}
          <ul className="divide-y divide-line">
            {rows.map((r) =>
              r.kind === "enquiry" ? (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpenEnquiry(r)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-elev"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12.5px] font-semibold text-title">{r.code}</span>
                        <StatusPill status={r.status} />
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-fg-2">
                        {r.client}
                        {r.customer ? <span className="text-fg-3"> · {r.customer}</span> : null}
                      </span>
                    </span>
                    <span className="text-right text-[11.5px] text-fg-3">
                      <span className="block">
                        {r.tagCount} tag{r.tagCount === 1 ? "" : "s"}
                      </span>
                      <span className="block">
                        {r.createdByName || "—"} · {fmtDate(r.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ) : (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTag(r)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-elev"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-fg">{r.name}</span>
                        <StatusPill status={r.status} />
                        {r.awaitingSteps > 0 && (
                          <span className="rounded-full bg-[color-mix(in_srgb,var(--purple)_14%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--purple)]">
                            {r.awaitingSteps} awaiting approval
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-fg-2">
                        <span className="font-mono text-title">{r.enquiry.code}</span> · {r.enquiry.client}
                        {r.liquid ? <span className="text-fg-3"> · {r.liquid}</span> : null}
                      </span>
                    </span>
                    <span className="text-right text-[11.5px] text-fg-3">
                      <span className="block font-mono">{r.model || "No model yet"}</span>
                      <span className="block">
                        {r.enquiry.createdByName || "—"} · {fmtDate(r.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ),
            )}
          </ul>
          {hasMore && rows.length > 0 && (
            <div className="px-5 py-3 text-center">
              <button
                ref={sentinelRef}
                type="button"
                onClick={loadMore}
                disabled={loading}
                className="rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-[12px] font-semibold text-fg-3 transition hover:border-accent hover:text-accent disabled:cursor-wait"
              >
                {loading ? "Loading…" : `Show more (${fmtNum(total - rows.length)} left)`}
              </button>
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <div className="border-t border-line px-5 py-2 text-[11.5px] text-fg-3">
            Showing <b className="font-mono text-fg">{fmtNum(rows.length)}</b> of{" "}
            <b className="font-mono text-fg">{fmtNum(total)}</b> {isTags ? "tags" : "enquiries"}
            {!hasMore && total > BATCH ? " · end of list" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
