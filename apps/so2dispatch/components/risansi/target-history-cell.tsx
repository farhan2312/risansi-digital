"use client";

import { useEffect, useRef, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { getTargetHistoryAction } from "@/app/risansi/orders/actions";
import { TARGET_DATES, type TargetDate, type TargetRevision } from "@/lib/target-dates";

const TARGET_BY_COLUMN = new Map<string, TargetDate>(
  TARGET_DATES.map((t) => [t.column, t])
);
// The revised dispatch column is written by a dispatch revision, so its
// history is the dispatch target's.
for (const t of TARGET_DATES) {
  if (t.revisedColumn) TARGET_BY_COLUMN.set(t.revisedColumn, t);
}

/** A target date column a department sees read-only, or null if it isn't one. */
export function targetForColumn(column: string): TargetDate | null {
  return TARGET_BY_COLUMN.get(column) ?? null;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function shift(from: string, to: string): number | null {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * A target date in a department queue, with the history behind it.
 *
 * Departments work to these dates but cannot set them, and a date that has
 * moved twice reads very differently from one that never has — so the value
 * carries a button that opens every value it has held, and why it moved.
 * Loaded on click: a queue page shows dozens of rows and almost none are
 * opened.
 */
export function TargetHistoryCell({
  orderId,
  target,
  value,
}: {
  orderId: string;
  target: TargetDate;
  value: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<TargetRevision[] | null>(null);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // Re-fetch each time it opens: the date can move while the queue is on
    // screen, and a stale history is worse than a spinner.
    setLoading(true);
    setRows(await getTargetHistoryAction(orderId, target.key));
    setLoading(false);
  }

  const changes = rows ? Math.max(rows.length - 1, 0) : 0;

  return (
    <span ref={wrapRef} className="relative inline-flex items-center gap-1">
      {value}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={`${target.label} history`}
        title="Why this date changed"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        <History className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border border-card-border bg-surface p-2.5 text-left shadow-lg">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {target.label}
            {changes > 0 && (
              <span className="ml-1 font-normal normal-case text-amber-700">
                · moved {changes}×
              </span>
            )}
          </p>
          {loading ? (
            <p className="flex items-center gap-1.5 py-1 text-[11px] text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </p>
          ) : !rows || rows.length === 0 ? (
            <p className="py-1 text-[11px] text-muted">No target set yet.</p>
          ) : (
            <ol className="space-y-1 border-l-2 border-card-border pl-2.5">
              {rows.map((rev, i) => {
                const previous = rows[i - 1];
                const moved = previous
                  ? shift(previous.target_date, rev.target_date)
                  : null;
                return (
                  <li
                    key={rev.id}
                    className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted-foreground"
                  >
                    <span className="font-medium tabular-nums text-foreground">
                      {formatDate(rev.target_date)}
                    </span>
                    {moved !== null && moved !== 0 && (
                      <span
                        className={moved > 0 ? "text-danger" : "text-emerald-600"}
                      >
                        {moved > 0 ? `+${moved}` : moved}d
                      </span>
                    )}
                    {rev.reason && <span>· {rev.reason}</span>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </span>
  );
}
