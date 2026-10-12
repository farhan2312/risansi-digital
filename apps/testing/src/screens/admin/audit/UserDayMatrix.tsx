"use client";

import { avatarColor } from "@/lib/avatar";
import { dayOfMonth, personInitials, weekdayInitial, dayShort } from "./auditFormat";

/** Saturday / Sunday, from the YYYY-MM-DD key (UTC parse, so the weekday can't shift with the viewer's zone). */
const isWeekend = (day: string) => {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
};

export interface MatrixRow {
  key: string;
  email: string | null;
  name: string | null;
  /** Small line under the name ("Admin · 5 days"). */
  sub: string;
  cells: number[];
  total: number;
}

interface UserDayMatrixProps {
  days: string[];
  rows: MatrixRow[];
  /** Text inside a non-empty cell. */
  formatCell: (value: number) => string;
  /** Text in the Total column. */
  formatTotal: (value: number) => string;
  /** Optional bottom row (per-day sums across users). */
  footer?: { label: string; cells: number[]; total: number };
  emptyText?: string;
}

/** Users x days grid, one sequential hue, light -> dark by that cell's share
 * of the busiest cell. The value is printed in every non-empty cell, so color
 * never carries the number alone. */
const UserDayMatrix = ({ days, rows, formatCell, formatTotal, footer, emptyText = "No activity in this range." }: UserDayMatrixProps) => {
  if (rows.length === 0 || days.length === 0) return <p className="py-8 text-center text-sm text-text-muted">{emptyText}</p>;

  const max = Math.max(1, ...rows.flatMap((r) => r.cells));
  const columns = `minmax(190px, 1.3fr) repeat(${days.length}, minmax(40px, 1fr)) 84px`;

  return (
    <div className="overflow-x-auto">
      <div className="grid items-center gap-x-[3px] gap-y-[3px]" style={{ gridTemplateColumns: columns, minWidth: 190 + days.length * 44 + 84 }}>
        <div className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">User</div>
        {days.map((d) => {
          const weekend = isWeekend(d);
          return (
            <div key={d} className={`pb-1 text-center text-[11px] leading-tight ${weekend ? "text-neg" : "text-text-muted"}`} title={dayShort(d)}>
              <div>{weekdayInitial(d)}</div>
              <div className={`font-semibold ${weekend ? "text-neg" : "text-text"}`}>{dayOfMonth(d)}</div>
            </div>
          );
        })}
        <div className="pb-1 text-right text-[11px] font-semibold uppercase tracking-wide text-text-muted">Total</div>

        {rows.map((row) => (
          <div key={row.key} className="contents">
            <div className="flex min-w-0 items-center gap-2.5 py-1 pr-2">
              <span
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: avatarColor(row.email ?? row.name ?? row.key) }}
                aria-hidden="true"
              >
                {personInitials(row.name, row.email)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-text-h" title={row.email ?? row.name ?? ""}>
                  {row.email ?? row.name ?? "Unknown user"}
                </div>
                <div className="truncate text-[11px] text-text-muted">{row.sub}</div>
              </div>
            </div>
            {row.cells.map((v, i) => {
              const t = v / max;
              return (
                <div
                  key={days[i]}
                  title={`${row.email ?? row.name ?? "User"} · ${dayShort(days[i])} · ${v > 0 ? formatCell(v) : "no activity"}`}
                  className="flex h-9 items-center justify-center rounded-md text-[11px] font-semibold"
                  style={{
                    background:
                      v === 0 ? "var(--bg-sunk)" : `color-mix(in oklab, var(--seq-hi) ${Math.round(15 + t * 85)}%, var(--seq-lo))`,
                    color: t > 0.55 ? "var(--seq-on-hi)" : "var(--text-h)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {v > 0 ? formatCell(v) : ""}
                </div>
              );
            })}
            <div className="text-right text-[13px] font-semibold text-text-h" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatTotal(row.total)}
            </div>
          </div>
        ))}

        {footer && (
          <>
            <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{footer.label}</div>
            {footer.cells.map((v, i) => (
              <div key={days[i]} className="pt-2 text-center text-[11px] font-semibold text-text" style={{ fontVariantNumeric: "tabular-nums" }}>
                {v > 0 ? v : ""}
              </div>
            ))}
            <div className="pt-2 text-right text-[13px] font-bold text-accent" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatTotal(footer.total)}
            </div>
          </>
        )}
      </div>
      <div className="mt-4 flex items-center justify-end gap-1.5 text-[11px] text-text-muted">
        Less
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span
            key={t}
            className="h-3 w-3 rounded-sm"
            style={{ background: t === 0 ? "var(--bg-sunk)" : `color-mix(in oklab, var(--seq-hi) ${Math.round(15 + t * 85)}%, var(--seq-lo))` }}
          />
        ))}
        More ({formatCell(max)})
      </div>
    </div>
  );
};

export default UserDayMatrix;
