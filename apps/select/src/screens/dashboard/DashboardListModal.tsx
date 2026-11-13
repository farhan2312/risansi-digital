"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { fmtNum } from "../../components/charts/charts";
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Input } from "@/components/shadcn/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import type { EnquiryFilters } from "../../lib/enquiry-filters";
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

/** A status as a soft badge, coloured by what it means (as on the Enquiries page). */
const STATUS_TONE: Record<string, "warning" | "info" | "success" | "neutral" | "danger" | "primary"> = {
  pending: "warning",
  "in progress": "info",
  completed: "success",
  "not quoted": "neutral",
  regret: "danger",
  "sent to client": "primary",
};
const StatusBadge = ({ status }: { status: string | null | undefined }) => (
  <Badge tone={STATUS_TONE[(status ?? "").trim().toLowerCase()] ?? "neutral"} dot>
    {status || "—"}
  </Badge>
);

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * The list behind a Dashboard KPI card. Loaded BATCH rows at a time as it is
 * scrolled, and searched on the server, with
 * the dashboard's own period, "Assigned to me" scope and filters, so its total always
 * matches the number on the card. Clicking a row opens that enquiry / tag.
 */
export default function DashboardListModal({
  target,
  period,
  mine,
  filters,
  rep,
  scopeLabel,
  onClose,
  onOpenEnquiry,
  onOpenTag,
  hideTagCount = false,
}: {
  target: DashboardListTarget;
  period: { from?: string; to?: string };
  mine: boolean;
  /** The Dashboard's enquiry filters (client, reps, zone, …). */
  filters?: EnquiryFilters;
  /** Rep Manager: one of their reps. */
  rep?: string;
  /** "All enquiries" / "Created by me" and the period, shown under the title. */
  scopeLabel: string;
  onClose: () => void;
  onOpenEnquiry: (row: DashboardListEnquiry) => void;
  onOpenTag: (row: DashboardListTag) => void;
  /** Spares have no tags. */
  hideTagCount?: boolean;
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
        filters,
        rep,
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
    [target.kind, target.status, q, period.from, period.to, mine, filters, rep],
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

  const isTags = target.kind === "tags";

  return (
    // Escape, the X or a click outside closes it (as before).
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" className="max-w-[880px]" onInteractOutside={() => {}}>
        {/* Header */}
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-[16px]">
            {target.title}
            <Badge tone="neutral" className="font-mono text-[12px]">
              {loading && !rows.length ? "…" : fmtNum(total)}
            </Badge>
          </DialogTitle>
          <DialogDescription>{scopeLabel}</DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="shrink-0 border-b border-border px-5 py-3">
          <Input
            type="search"
            autoFocus
            icon={<Search />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isTags ? "Search tag, enquiry no., client, media, model…" : "Search enquiry no., client, customer, creator…"}
          />
        </div>

        {/* Rows */}
        <div ref={scrollRef} className="min-h-[120px] flex-1 overflow-y-auto">
          {error && <p className="px-5 py-6 text-center text-[13px] font-medium text-destructive">{error}</p>}
          {!error && loading && !rows.length && <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">Loading…</p>}
          {!error && !loading && !rows.length && (
            <p className="px-5 py-6 text-center text-[13px] text-muted-foreground">{q ? "Nothing matches this search." : "Nothing here."}</p>
          )}
          <ul className="divide-y divide-border">
            {rows.map((r) =>
              r.kind === "enquiry" ? (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpenEnquiry(r)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12.5px] font-semibold text-primary">{r.code}</span>
                        <StatusBadge status={r.status} />
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-foreground">
                        {r.client}
                        {r.customer ? <span className="text-muted-foreground"> · {r.customer}</span> : null}
                      </span>
                    </span>
                    <span className="text-right text-[11.5px] text-muted-foreground">
                      {!hideTagCount && (
                        <span className="block">
                          {r.tagCount} tag{r.tagCount === 1 ? "" : "s"}
                        </span>
                      )}
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
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-foreground">{r.name}</span>
                        <StatusBadge status={r.status} />
                        {r.awaitingSteps > 0 && <Badge tone="warning">{r.awaitingSteps} awaiting approval</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-foreground">
                        <span className="font-mono text-primary">{r.enquiry.code}</span> · {r.enquiry.client}
                        {r.liquid ? <span className="text-muted-foreground"> · {r.liquid}</span> : null}
                      </span>
                    </span>
                    <span className="text-right text-[11.5px] text-muted-foreground">
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
              <Button ref={sentinelRef} variant="outline" size="sm" onClick={loadMore} disabled={loading} className="border-dashed">
                {loading ? "Loading…" : `Show more (${fmtNum(total - rows.length)} left)`}
              </Button>
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <div className="shrink-0 border-t border-border bg-muted/40 px-5 py-2 text-[11.5px] text-muted-foreground">
            Showing <b className="font-mono font-semibold text-foreground">{fmtNum(rows.length)}</b> of{" "}
            <b className="font-mono font-semibold text-foreground">{fmtNum(total)}</b> {isTags ? "tags" : "enquiries"}
            {!hasMore && total > BATCH ? " · end of list" : ""}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
