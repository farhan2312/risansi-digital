"use client";

import { useMemo, useState } from "react";

/**
 * Shared date filter: quick ranges (Today · This week · This month · 7 · 30 ·
 * 90 days · All time) plus
 * an explicit From → To pair, which wins over the quick range while set.
 * Used by the Dashboard, Enquiries and Reports pages.
 *
 * Picked calendar days are converted to instants in the user's own time zone
 * (start of the From day, end of the To day). "Today" starts at local midnight,
 * "This week" on Monday and "This month" on the 1st, both at local midnight.
 */
export type DateRangeKey = "today" | "week" | "month" | "7d" | "30d" | "90d" | "all";

export const DATE_RANGES: { key: DateRangeKey; label: string; days: number | null }[] = [
  { key: "today", label: "Today", days: 0 },
  { key: "week", label: "This week", days: null },
  { key: "month", label: "This month", days: null },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];

const dayBoundary = (ymd: string, edge: "start" | "end"): string | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  return (edge === "start" ? new Date(y, mo, d) : new Date(y, mo, d, 23, 59, 59, 999)).toISOString();
};

export interface DateRangeState {
  range: DateRangeKey;
  fromDate: string;
  toDate: string;
  /** True while explicit From/To dates are in force. */
  customDates: boolean;
  /** True when anything other than "All time" is applied. */
  active: boolean;
  /** ISO instants for the query; either may be undefined (open-ended). */
  window: { from?: string; to?: string };
  /** Short description, e.g. "30 days" or "2026-09-01 → today". */
  label: string;
  setRange: (key: DateRangeKey) => void;
  setFromDate: (ymd: string) => void;
  setToDate: (ymd: string) => void;
  reset: () => void;
}

export function useDateRange(initial: DateRangeKey = "all"): DateRangeState {
  const [range, setRangeKey] = useState<DateRangeKey>(initial);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const customDates = Boolean(fromDate || toDate);

  const window = useMemo(() => {
    if (customDates) {
      return {
        from: fromDate ? dayBoundary(fromDate, "start") : undefined,
        to: toDate ? dayBoundary(toDate, "end") : undefined,
      };
    }
    if (range === "week" || range === "month") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      if (range === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      else start.setDate(1);
      return { from: start.toISOString() };
    }
    const days = DATE_RANGES.find((r) => r.key === range)?.days;
    if (days === null || days === undefined) return {};
    if (days === 0) {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      return { from: midnight.toISOString() };
    }
    return { from: new Date(Date.now() - days * 86400_000).toISOString() };
  }, [customDates, fromDate, toDate, range]);

  return {
    range,
    fromDate,
    toDate,
    customDates,
    active: customDates || range !== "all",
    window,
    label: customDates
      ? `${fromDate || "start"} → ${toDate || "today"}`
      : DATE_RANGES.find((r) => r.key === range)?.label ?? "All time",
    // A quick range replaces custom dates rather than being silently overridden.
    setRange: (key) => {
      setRangeKey(key);
      setFromDate("");
      setToDate("");
    },
    setFromDate,
    setToDate,
    reset: () => {
      setRangeKey("all");
      setFromDate("");
      setToDate("");
    },
  };
}

/** True when an ISO timestamp falls inside the window (for client-side lists). */
export function inDateWindow(iso: string | null | undefined, w: { from?: string; to?: string }): boolean {
  if (!w.from && !w.to) return true;
  if (!iso) return false;
  if (w.from && iso < w.from) return false;
  if (w.to && iso > w.to) return false;
  return true;
}

const CalendarGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

export default function DateRangeFilter({
  state,
  onChange,
  fromLabel = "From",
  toLabel = "To",
  showClear = true,
}: {
  state: DateRangeState;
  /** Called after any change, e.g. to go back to page 1. */
  onChange?: () => void;
  fromLabel?: string;
  toLabel?: string;
  /** Show a Clear button inside the date box while dates are set. */
  showClear?: boolean;
}) {
  const changed = () => onChange?.();
  return (
    <>
      <div className="inline-flex flex-wrap rounded-lg border border-line bg-paper p-0.5">
        {DATE_RANGES.map((r) => {
          const on = !state.customDates && state.range === r.key;
          return (
            <button
              key={r.key}
              type="button"
              aria-pressed={on}
              onClick={() => {
                state.setRange(r.key);
                changed();
              }}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
                on ? "bg-accent text-white" : "text-fg-3 hover:bg-elev hover:text-fg"
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <div
        className={`inline-flex flex-wrap items-center gap-2 rounded-lg border bg-paper px-2.5 py-1 ${
          state.customDates ? "border-accent ring-2 ring-accent-soft" : "border-line"
        }`}
      >
        <span className="text-fg-3">
          <CalendarGlyph />
        </span>
        <input
          type="date"
          aria-label={fromLabel}
          title={fromLabel}
          value={state.fromDate}
          max={state.toDate || undefined}
          onChange={(e) => {
            state.setFromDate(e.target.value);
            changed();
          }}
          className="bg-transparent px-1 py-1 font-mono text-[12.5px] text-fg outline-none"
        />
        <span className="text-fg-4">→</span>
        <input
          type="date"
          aria-label={toLabel}
          title={toLabel}
          value={state.toDate}
          min={state.fromDate || undefined}
          onChange={(e) => {
            state.setToDate(e.target.value);
            changed();
          }}
          className="bg-transparent px-1 py-1 font-mono text-[12.5px] text-fg outline-none"
        />
        {showClear && state.customDates && (
          <button
            type="button"
            onClick={() => {
              state.setFromDate("");
              state.setToDate("");
              changed();
            }}
            className="rounded-md px-2 py-1 text-[12px] font-semibold text-accent hover:bg-accent-soft"
          >
            Clear
          </button>
        )}
      </div>
    </>
  );
}
