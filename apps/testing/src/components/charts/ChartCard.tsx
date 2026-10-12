"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import "./charts.css";

export interface LegendItem {
  label: string;
  color: string;
  /** Mirrors the mark: "line" for line series, "rect" for bars/segments. */
  shape?: "line" | "rect";
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  /** Every chart has a table twin -- the accessible, no-hover way to read
   * every value. */
  table?: { columns: string[]; rows: (string | number)[][] };
  href?: string;
  hrefLabel?: string;
  /** Extra controls (a segmented toggle, say) shown in the header, before Table. */
  actions?: ReactNode;
  className?: string;
  /** "panel": the flat admin look -- a ruled header with an uppercase title and the subtitle on the right. */
  variant?: "card" | "panel";
  /** Panel variant only: a small line icon shown in a tinted chip before the title. */
  icon?: ReactNode;
  children: ReactNode;
}

const ChartCard = ({ title, subtitle, legend, table, href, hrefLabel = "View all", actions, className = "", variant = "card", icon, children }: ChartCardProps) => {
  const [showTable, setShowTable] = useState(false);
  const panel = variant === "panel";

  return (
    <section
      className={`viz-root flex flex-col border border-border bg-surface shadow-sm ${panel ? "rounded-xl" : "rounded-2xl p-5"} ${className}`}
    >
      <div className={`flex items-center justify-between gap-3 ${panel ? "border-b border-border px-5 py-3.5" : "mb-4 items-start"}`}>
        {panel ? (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {icon && <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">{icon}</span>}
            <div className="min-w-0">
              <h2 className="m-0 text-[15px] font-bold text-text-h">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="m-0 text-[15px] font-semibold text-text-h">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
          </div>
        )}
        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
          {actions}
          {table && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              className="rounded-md px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              aria-pressed={showTable}
            >
              {showTable ? "Chart" : "Table"}
            </button>
          )}
          {href && (
            <Link
              href={href}
              className="rounded-md px-2 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent-soft"
            >
              {hrefLabel} &rarr;
            </Link>
          )}
        </div>
      </div>

      {legend && legend.length > 1 && !showTable && (
        <ul className={`mb-3 flex flex-wrap gap-x-4 gap-y-1.5 ${panel ? "px-5 pt-4" : ""}`} aria-label="Legend">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5 text-xs text-text-muted">
              {item.shape === "line" ? (
                <span className="h-0.5 w-3.5 rounded-full" style={{ background: item.color }} />
              ) : (
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
              )}
              {item.label}
            </li>
          ))}
        </ul>
      )}

      <div className={`relative flex-1 ${panel ? "p-5" : ""}`}>
        {showTable && table ? (
          <div className="max-h-80 overflow-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-bg-sunk">
                <tr>
                  {table.columns.map((c) => (
                    <th key={c} className="px-3 py-2 text-left font-semibold text-text-muted">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-t border-border">
                    {row.map((cell, j) => (
                      <td key={j} className={`px-3 py-1.5 text-text ${typeof cell === "number" ? "tabular-nums" : ""}`}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
};

export default ChartCard;
