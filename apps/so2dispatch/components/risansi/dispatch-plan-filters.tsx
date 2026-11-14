"use client";

import { X } from "lucide-react";
import { MultiSelectFilter, SingleSelectFilter } from "./multi-select-filter";
import { useUrlTable } from "./url-table";
import { DP_DATE_FIELDS, DP_KEYS, DP_OPTIONS, dispatchPlanFiltered, parseDispatchPlanFilter } from "@/lib/dispatch-plan-filter";

/** The Dispatch Plan's filter bar: what it shows, and a date range on a date picked. */
export function DispatchPlanFilters({
  reps,
  zones,
  statuses,
  total,
}: {
  reps: string[];
  zones: string[];
  statuses: string[];
  total: number;
}) {
  const { get, setParams } = useUrlTable();
  const f = parseDispatchPlanFilter((k) => get(k) || undefined);
  const multi = (key: (typeof DP_KEYS)[number], label: string, options: readonly string[], allLabel: string) => (
    <MultiSelectFilter
      label={label}
      allLabel={allLabel}
      options={[...options]}
      selected={f[key as keyof typeof f] as string[]}
      onChange={(next) => setParams({ [key]: next })}
      searchable={options.length > 12}
    />
  );
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {multi("rdy", "Readiness", DP_OPTIONS.rdy, "Any readiness")}
      {multi("boi", "BOI", DP_OPTIONS.boi, "Any BOI")}
      {multi("hold", "Dispatch hold", DP_OPTIONS.hold, "Held or not")}
      {multi("bp", "Base plate", DP_OPTIONS.bp, "Any base plate")}
      {multi("wb", "Wooden box", DP_OPTIONS.wb, "Any wooden box")}
      {multi("asm", "Assembly", DP_OPTIONS.asm, "Any assembly")}
      {multi("pkg", "Packing", DP_OPTIONS.pkg, "Any packing")}
      {multi("st", "Status", statuses, "Any status")}
      {multi("rep", "Rep", reps, "All reps")}
      {multi("zone", "Zone", zones, "All zones")}
      <SingleSelectFilter
        label="Date"
        allLabel={DP_DATE_FIELDS[0].label}
        showDefault
        active={!!f.from || !!f.to}
        options={DP_DATE_FIELDS.map((d) => ({ value: d.value, label: d.label }))}
        selected={f.df}
        onChange={(next) => setParams({ df: !next || next === DP_DATE_FIELDS[0].value ? null : next })}
      />
      <label className="inline-flex items-center gap-1.5 text-xs text-muted">
        From
        <input
          type="date"
          value={f.from ?? ""}
          max={f.to ?? undefined}
          onChange={(e) => setParams({ from: e.target.value || null })}
          className="h-8 rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none"
        />
      </label>
      <label className="inline-flex items-center gap-1.5 text-xs text-muted">
        To
        <input
          type="date"
          value={f.to ?? ""}
          min={f.from ?? undefined}
          onChange={(e) => setParams({ to: e.target.value || null })}
          className="h-8 rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground focus:border-primary focus:outline-none"
        />
      </label>
      {dispatchPlanFiltered(f) && (
        <button
          type="button"
          onClick={() => setParams(Object.fromEntries(DP_KEYS.map((k) => [k, null])))}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-input-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
        >
          <X className="h-3.5 w-3.5" />
          Clear all
        </button>
      )}
      <span className="ml-auto text-xs text-muted">
        <span className="font-semibold text-foreground">{total}</span> SO{total === 1 ? "" : "s"}
      </span>
    </div>
  );
}
