"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { monthLabel, monthLong } from "./chartUtils";

interface HeatmapProps {
  /** Column keys -- months ("2026-03"), days ("2026-03-14") or anything else
   * the formatters below understand (e.g. "0".."23" for hours). */
  months: string[];
  rows: { label: string; counts: number[] }[];
  /** Where a non-empty cell drills down to. */
  cellHref?: (rowLabel: string, month: string) => string | null;
  /** Short column header ("" to skip that column's label). Defaults to month/day labels. */
  formatColumn?: (key: string, index: number) => string;
  /** Long column name for the tooltip. Defaults to "March 2026" / "14 March 2026". */
  formatColumnLong?: (key: string) => string;
  /** What one unit is called in the tooltip ("requisition", "event"). */
  unit?: string;
  /** Narrowest a column may get before the grid scrolls sideways. */
  minColumnWidth?: number;
  /** Width reserved for the row labels. */
  labelWidth?: number;
}

const lastDayOfMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
/** A column key is a month ("2026-03") or, for short windows, a single day ("2026-03-14"). */
export const monthRange = (key: string) =>
  key.length === 10 ? { from: key, to: key } : { from: `${key}-01`, to: lastDayOfMonth(key) };

/** Sequential heatmap -- one hue, light -> dark (its own dark-mode ramp,
 * see charts.css). Zero cells stay neutral so "none" never reads as "a
 * little". Values live in the tooltip and the card's table view. */
const Heatmap = ({
  months,
  rows,
  cellHref,
  formatColumn,
  formatColumnLong = monthLong,
  unit = "requisition",
  minColumnWidth = 22,
  labelWidth = 120,
}: HeatmapProps) => {
  const router = useRouter();
  const [hover, setHover] = useState<{ row: string; month: string; value: number; x: number; y: number } | null>(null);

  const max = Math.max(1, ...rows.flatMap((r) => r.counts));
  const shade = (v: number) =>
    v === 0 ? "var(--bg-sunk)" : `color-mix(in oklab, var(--seq-hi) ${Math.round(15 + (v / max) * 85)}%, var(--seq-lo))`;
  const columnLabel = formatColumn ?? ((key: string, i: number) => (i % 2 === 0 || months.length <= 12 ? monthLabel(key) : ""));

  if (rows.length === 0) return <p className="py-6 text-center text-sm text-text-muted">Nothing in this range.</p>;

  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <div className="overflow-x-auto">
        <div
          className="grid gap-[2px]"
          style={{ gridTemplateColumns: `minmax(${labelWidth}px, max-content) repeat(${months.length}, minmax(${minColumnWidth}px, 1fr))` }}
        >
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <div className="truncate pr-3 text-xs leading-7 text-text-muted" title={row.label}>
                {row.label.replace(/^Against\s+/i, "")}
              </div>
              {row.counts.map((v, i) => {
                const href = v > 0 && cellHref ? cellHref(row.label, months[i]) : null;
                return (
                  <button
                    key={months[i]}
                    type="button"
                    disabled={!href}
                    aria-label={`${row.label}, ${formatColumnLong(months[i])}: ${v}`}
                    className="h-7 rounded-[4px] transition-transform enabled:cursor-pointer enabled:hover:scale-110 disabled:cursor-default"
                    style={{ background: shade(v) }}
                    onPointerEnter={(e) => {
                      const cell = e.currentTarget.getBoundingClientRect();
                      const box = e.currentTarget.closest(".relative")!.getBoundingClientRect();
                      setHover({ row: row.label, month: months[i], value: v, x: cell.left - box.left + cell.width / 2, y: cell.top - box.top });
                    }}
                    onClick={() => href && router.push(href)}
                  />
                );
              })}
            </div>
          ))}
          <div />
          {months.map((m, i) => (
            <div key={m} className="pt-1 text-center text-[10px] text-text-muted">
              {columnLabel(m, i)}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-text-muted">
        <span>0</span>
        <span className="h-2 w-5 rounded-sm" style={{ background: "var(--bg-sunk)" }} />
        <span className="h-2 w-24 rounded-sm" style={{ background: "linear-gradient(to right, color-mix(in oklab, var(--seq-hi) 15%, var(--seq-lo)), var(--seq-hi))" }} />
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{max}</span>
      </div>

      {hover && (
        <div className="viz-tooltip" style={{ left: hover.x, top: hover.y - 8, transform: "translate(-50%, -100%)" }}>
          <div className="text-[13px] font-semibold text-text-h" style={{ fontVariantNumeric: "tabular-nums" }}>
            {hover.value} {unit}
            {hover.value === 1 ? "" : "s"}
          </div>
          <div className="text-text-muted">{hover.row.replace(/^Against\s+/i, "")}</div>
          <div className="text-text-muted">{formatColumnLong(hover.month)}</div>
        </div>
      )}
    </div>
  );
};

export default Heatmap;
