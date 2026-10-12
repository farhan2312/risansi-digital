"use client";

/**
 * Search, sort and filter for the client-side master lists (Pump Model,
 * Motor, Pulley, Gearbox). Every row is already in memory, so all of this runs
 * in the browser and covers the whole table, not just the visible page.
 *
 *  - Search: every word must appear somewhere in the row (any searchable
 *    column), so "abb ie3 7.5" narrows to ABB IE3 7.5 kW motors.
 *  - Filters: a dropdown per "select" column (options narrow to what the
 *    other filters leave) and a min–max pair per "range" column.
 *  - Sort: click a header to sort asc, again for desc, a third time to go
 *    back to the page's default order.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";

type Cell = string | number | null | undefined;

export interface ColumnSpec<T> {
  key: string;
  label: string;
  get: (row: T) => Cell;
  /** Numeric columns sort by value and can take a range filter. */
  numeric?: boolean;
  /** Filter control shown for this column in the filter bar. */
  filter?: "select" | "range";
  /** Custom sort for this column (e.g. the pump-model family order). */
  compare?: (a: T, b: T) => number;
  /** Orders a "select" column's dropdown options. */
  optionCompare?: (a: string, b: string) => number;
  /** Excluded from the free-text search when false. Default true. */
  searchable?: boolean;
}

export type SortState = { key: string; dir: "asc" | "desc" } | null;

const text = (v: Cell): string => (v === null || v === undefined ? "" : String(v));
const numOf = (v: Cell): number => {
  const n = typeof v === "number" ? v : parseFloat(text(v));
  return Number.isNaN(n) ? NaN : n;
};

export function useTableControls<T>(
  rows: T[],
  columns: ColumnSpec<T>[],
  defaultSort: (a: T, b: T) => number,
) {
  const [search, setSearch] = useState("");
  const [selects, setSelects] = useState<Record<string, string>>({});
  const [ranges, setRanges] = useState<Record<string, { min: string; max: string }>>({});
  const [sort, setSort] = useState<SortState>(null);

  const setSelect = useCallback((key: string, value: string) => {
    setSelects((s) => ({ ...s, [key]: value }));
  }, []);
  const setRange = useCallback((key: string, end: "min" | "max", value: string) => {
    setRanges((r) => ({ ...r, [key]: { ...(r[key] ?? { min: "", max: "" }), [end]: value } }));
  }, []);
  const toggleSort = useCallback((key: string) => {
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  }, []);
  const clearAll = useCallback(() => {
    setSearch("");
    setSelects({});
    setRanges({});
    setSort(null);
  }, []);

  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  // Row passes every select filter except `skip` (used to build faceted options).
  const passesSelects = useCallback(
    (row: T, skip?: string) =>
      Object.entries(selects).every(([key, want]) => {
        if (!want || key === skip) return true;
        const col = byKey.get(key);
        return !col || text(col.get(row)) === want;
      }),
    [selects, byKey],
  );

  const passesRanges = useCallback(
    (row: T) =>
      Object.entries(ranges).every(([key, { min, max }]) => {
        const col = byKey.get(key);
        if (!col || (min === "" && max === "")) return true;
        const v = numOf(col.get(row));
        if (Number.isNaN(v)) return false;
        const lo = parseFloat(min);
        const hi = parseFloat(max);
        return (Number.isNaN(lo) || v >= lo) && (Number.isNaN(hi) || v <= hi);
      }),
    [ranges, byKey],
  );

  const passesSearch = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return () => true;
    const searchable = columns.filter((c) => c.searchable !== false);
    return (row: T) => {
      const hay = searchable.map((c) => text(c.get(row)).toLowerCase()).join("  ");
      return terms.every((t) => hay.includes(t));
    };
  }, [search, columns]);

  const result = useMemo(() => {
    const kept = rows.filter((r) => passesSearch(r) && passesSelects(r) && passesRanges(r));
    const col = sort ? byKey.get(sort.key) : undefined;
    if (!sort || !col) return kept.sort(defaultSort);
    const dir = sort.dir === "asc" ? 1 : -1;
    const cmp =
      col.compare ??
      (col.numeric
        ? (a: T, b: T) => {
            const x = numOf(col.get(a));
            const y = numOf(col.get(b));
            // Blanks always last, whichever direction.
            if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) ? (Number.isNaN(y) ? 0 : dir) : -dir;
            return x - y;
          }
        : (a: T, b: T) => text(col.get(a)).localeCompare(text(col.get(b)), undefined, { numeric: true }));
    // Ties keep the default order.
    return kept.sort((a, b) => cmp(a, b) * dir || defaultSort(a, b));
  }, [rows, passesSearch, passesSelects, passesRanges, sort, byKey, defaultSort]);

  // Dropdown options: values present among rows that pass everything else.
  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const col of columns) {
      if (col.filter !== "select") continue;
      const set = new Set<string>();
      for (const r of rows) {
        if (!passesSearch(r) || !passesRanges(r) || !passesSelects(r, col.key)) continue;
        const v = text(col.get(r));
        if (v) set.add(v);
      }
      const cmp =
        col.optionCompare ??
        (col.numeric
          ? (a: string, b: string) => parseFloat(a) - parseFloat(b)
          : (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }));
      out[col.key] = [...set].sort(cmp);
    }
    return out;
  }, [rows, columns, passesSearch, passesRanges, passesSelects]);

  const activeFilters =
    Object.values(selects).filter(Boolean).length +
    Object.values(ranges).filter((r) => r.min !== "" || r.max !== "").length +
    (search.trim() ? 1 : 0);

  return {
    search,
    setSearch,
    selects,
    setSelect,
    ranges,
    setRange,
    sort,
    toggleSort,
    clearAll,
    activeFilters,
    options,
    result,
    /** Changes whenever the visible set changes — pass to usePagination. */
    resetKey: JSON.stringify([search, selects, ranges, sort]),
  };
}

export type TableControls<T> = ReturnType<typeof useTableControls<T>>;

const inputCls =
  "h-8 rounded-md border border-line bg-paper px-2 text-[12.5px] text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft";

/** The filter controls, the result count and a Clear button. */
export function FilterBar<T>({
  controls,
  columns,
  total,
  children,
}: {
  controls: TableControls<T>;
  columns: ColumnSpec<T>[];
  total: number;
  /** Extra controls rendered before the filters (e.g. a table switcher). */
  children?: ReactNode;
}) {
  const { selects, setSelect, ranges, setRange, options, activeFilters, clearAll, result, sort } = controls;
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-line bg-elev px-4 py-3">
      {children}
      {columns
        .filter((c) => c.filter)
        .map((c) =>
          c.filter === "select" ? (
            <label key={c.key} className="flex min-w-0 flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-fg-3">{c.label}</span>
              <select
                className={`${inputCls} min-w-[110px] max-w-[190px] ${selects[c.key] ? "border-accent text-accent" : ""}`}
                value={selects[c.key] ?? ""}
                onChange={(e) => setSelect(c.key, e.target.value)}
              >
                <option value="">All</option>
                {(options[c.key] ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div key={c.key} className="flex min-w-0 flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-fg-3">{c.label}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="any"
                  placeholder="Min"
                  aria-label={`${c.label} minimum`}
                  className={`${inputCls} w-[74px]`}
                  value={ranges[c.key]?.min ?? ""}
                  onChange={(e) => setRange(c.key, "min", e.target.value)}
                />
                <span className="text-fg-4">–</span>
                <input
                  type="number"
                  step="any"
                  placeholder="Max"
                  aria-label={`${c.label} maximum`}
                  className={`${inputCls} w-[74px]`}
                  value={ranges[c.key]?.max ?? ""}
                  onChange={(e) => setRange(c.key, "max", e.target.value)}
                />
              </div>
            </div>
          ),
        )}
      <div className="ml-auto flex items-center gap-3 self-center">
        <span className="text-[12px] text-fg-3">
          <b className="font-mono text-fg">{result.length}</b> of <span className="font-mono">{total}</span> rows
        </span>
        {(activeFilters > 0 || sort) && (
          <button
            type="button"
            onClick={clearAll}
            className="rounded-md border border-line bg-paper px-2.5 py-1 text-[12px] font-semibold text-fg-2 transition hover:border-accent hover:text-accent"
          >
            Clear{activeFilters > 0 ? ` (${activeFilters})` : ""}
          </button>
        )}
      </div>
    </div>
  );
}

/** A sortable column header: click for asc, again for desc, again for default. */
export function SortTh<T>({
  controls,
  colKey,
  children,
  className,
}: {
  controls: TableControls<T>;
  colKey: string;
  children: ReactNode;
  className?: string;
}) {
  const active = controls.sort?.key === colKey ? controls.sort.dir : null;
  return (
    <th className={className} aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"}>
      <button
        type="button"
        onClick={() => controls.toggleSort(colKey)}
        title="Sort"
        className={`inline-flex items-center gap-1 whitespace-nowrap bg-transparent p-0 [font:inherit] [letter-spacing:inherit] [text-transform:inherit] transition hover:text-accent ${
          active ? "text-accent" : "text-inherit"
        }`}
      >
        {children}
        <svg viewBox="0 0 10 14" aria-hidden="true" className="h-3 w-2.5 shrink-0">
          <path d="M5 1 1.5 5h7L5 1Z" fill="currentColor" opacity={active === "asc" ? 1 : 0.3} />
          <path d="M5 13 1.5 9h7L5 13Z" fill="currentColor" opacity={active === "desc" ? 1 : 0.3} />
        </svg>
      </button>
    </th>
  );
}
