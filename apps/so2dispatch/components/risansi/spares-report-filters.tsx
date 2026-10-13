"use client";

import { Loader2, X } from "lucide-react";
import { MultiSelectFilter } from "./multi-select-filter";
import { useUrlTable } from "./url-table";
import { rangePresets, type SparesReportFilter } from "@/lib/spares-report-filter";

/**
 * The Spares report's controls: a quick range or From / To, which SOs it
 * covers, and the three status selections. Everything lives in the URL, so
 * the PDF link carries the same filter.
 */
export function SparesReportFilters({
  filter,
  options,
}: {
  filter: SparesReportFilter;
  options: { planning: string[]; assembly: string[]; dispatch: string[] };
}) {
  const { setParams, pending } = useUrlTable();
  const presets = rangePresets();
  const active = presets.find((p) => p.from === filter.from && p.to === filter.to)?.key;
  const narrowed = filter.scope === "created" || filter.planning.length || filter.assembly.length || filter.dispatch.length;

  const chip = (on: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      on ? "border-primary bg-primary text-primary-foreground" : "border-input-border text-foreground hover:bg-background"
    }`;
  const dateInput =
    "h-8 rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none";

  return (
    <div className="space-y-3 rounded-xl border border-card-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setParams({ from: p.from, to: p.to })}
            className={chip(active === p.key)}
          >
            {p.label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-card-border" aria-hidden />
        <label className="inline-flex items-center gap-1.5 text-xs text-muted">
          From
          <input
            type="date"
            value={filter.from}
            max={filter.to}
            onChange={(e) => e.target.value && setParams({ from: e.target.value })}
            className={dateInput}
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted">
          To
          <input
            type="date"
            value={filter.to}
            min={filter.from}
            onChange={(e) => e.target.value && setParams({ to: e.target.value })}
            className={dateInput}
          />
        </label>
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Loading" />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">SOs</span>
        <button type="button" onClick={() => setParams({ scope: null })} className={chip(filter.scope === "all")}>
          All active
        </button>
        <button
          type="button"
          onClick={() => setParams({ scope: "created" })}
          className={chip(filter.scope === "created")}
        >
          Created in this period
        </button>
        <span className="mx-1 h-5 w-px bg-card-border" aria-hidden />
        <MultiSelectFilter
          label="Planning status"
          allLabel="Any planning status"
          options={options.planning}
          selected={filter.planning}
          onChange={(next) => setParams({ pst: next })}
        />
        <MultiSelectFilter
          label="Assembly status"
          allLabel="Any assembly status"
          options={options.assembly}
          selected={filter.assembly}
          onChange={(next) => setParams({ ast: next })}
        />
        <MultiSelectFilter
          label="Dispatch status"
          allLabel="Any dispatch status"
          options={options.dispatch}
          selected={filter.dispatch}
          onChange={(next) => setParams({ dst: next })}
        />
        {narrowed ? (
          <button
            type="button"
            onClick={() => setParams({ scope: null, pst: null, ast: null, dst: null })}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-input-border px-2 text-xs font-medium text-foreground hover:bg-background"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
