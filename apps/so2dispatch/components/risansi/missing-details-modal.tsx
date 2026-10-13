"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ClipboardX, Loader2, Search, X } from "lucide-react";
import { orderGapsAction } from "@/app/risansi/orders/gap-actions";
import type { OrderGapRow } from "@/lib/order-gaps";

function dayOnly(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Every SO whose order details are still blank, one line per order with the
 * fields it is waiting on.
 *
 * The list is fetched a batch at a time as it is scrolled rather than by page
 * number: the point is to run an eye down the whole backlog, and a pager makes
 * that a chore. Search narrows it in SQL, so it reaches orders far past the
 * ones scrolled to.
 */
function MissingDetailsModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<OrderGapRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [type, setType] = useState<"" | "Pump" | "Spare">("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // The batch in flight, and what is already shown: the observer fires between
  // renders, so it reads these rather than state it may not have seen yet.
  const requestRef = useRef(0);
  const loadingRef = useRef(false);
  const rowsRef = useRef<OrderGapRow[]>([]);

  const fetchBatch = useCallback(
    async (offset: number, q: string, t: string, request: number) => {
      loadingRef.current = true;
      setLoading(true);
      const res = await orderGapsAction(offset, q, t || null);
      // A newer search has since been typed; this answer is for a list that no
      // longer exists, and that newer request owns the flags.
      if (request !== requestRef.current) return;
      loadingRef.current = false;
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        setDone(true);
        return;
      }
      setError(null);
      setTotal(res.total);
      rowsRef.current =
        offset === 0 ? res.rows : [...rowsRef.current, ...res.rows];
      setRows(rowsRef.current);
      // The batch size is the server's business, so the end of the list is read
      // off the count instead — and an empty answer ends it either way.
      if (res.rows.length === 0 || rowsRef.current.length >= res.total) {
        setDone(true);
      }
    },
    []
  );

  // Typing narrows the whole list, so hold off until the typing stops.
  useEffect(() => {
    const id = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    requestRef.current += 1;
    rowsRef.current = [];
    setRows([]);
    setDone(false);
    setError(null);
    scrollRef.current?.scrollTo({ top: 0 });
    fetchBatch(0, term, type, requestRef.current);
  }, [term, type, fetchBatch]);

  // The next batch loads when the foot of the list comes into view.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || done) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingRef.current) return;
        fetchBatch(rowsRef.current.length, term, type, requestRef.current);
      },
      { root: scrollRef.current, rootMargin: "160px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [done, term, type, rows.length, fetchBatch]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Order details not filled"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-card-border px-5 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
              <ClipboardX className="h-3.5 w-3.5" />
              Details not filled
            </p>
            <p className="truncate font-display text-sm font-semibold text-foreground">
              {total} {total === 1 ? "order" : "orders"} with details missing
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-card-border px-5 py-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SO no., client or serial…"
              aria-label="Search orders"
              autoFocus
              className="h-9 w-full rounded-lg border border-input-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
          {/* Pump or Spare: the SO's order type, or any of its ECs'. */}
          <div role="group" aria-label="Order type" className="inline-flex overflow-hidden rounded-lg border border-input-border">
            {([["", "All"], ["Pump", "Pump"], ["Spare", "Spare"]] as const).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setType(value)}
                aria-pressed={type === value}
                className={`h-9 px-3 text-sm font-medium transition-colors ${
                  type === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface text-foreground hover:bg-background"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <p role="alert" className="px-5 py-10 text-sm text-danger">
              {error}
            </p>
          ) : rows.length === 0 && !loading ? (
            <p className="px-5 py-10 text-sm text-muted">
              {term || type
                ? "No order matching that search has details missing."
                : "Every order has its details filled in."}
            </p>
          ) : (
            <ul className="divide-y divide-card-border">
              {rows.map((row) => (
                <li key={row.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <Link
                        href={`/risansi/orders/${row.id}`}
                        className="font-display text-sm font-semibold text-primary hover:underline"
                      >
                        {row.so_no || `#${row.sl_no}`}
                      </Link>
                      <span className="ml-2 text-xs text-muted">
                        {[row.order_type, row.client_name || "—", dayOnly(row.so_date)].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      {row.missing.length} missing
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {row.missing.map((label) => (
                      <span
                        key={label}
                        className="rounded-md border border-card-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* The foot of the list: seeing it is what asks for the next batch. */}
          <div ref={sentinelRef} className="h-px" />

          {loading && (
            <div className="flex items-center gap-2 px-5 py-4 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}
          {!loading && done && rows.length > 0 && (
            <p className="px-5 py-4 text-center text-[11px] text-muted-foreground">
              All {rows.length} shown.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The toolbar button that opens the list. */
export function MissingDetailsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-500/20"
      >
        <ClipboardX className="h-4 w-4" />
        Details not filled
      </button>
      {open && <MissingDetailsModal onClose={() => setOpen(false)} />}
    </>
  );
}
