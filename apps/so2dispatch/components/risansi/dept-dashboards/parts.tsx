"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  Search,
  X,
} from "lucide-react";
import type { OrderOverviewRow } from "@/lib/orders";
import { describeDays } from "@/lib/dept-completion";
import { MultiSelectFilter, SingleSelectFilter } from "../multi-select-filter";
import { Pagination } from "../table-tools";
import { daysFromToday, describeDue, formatDate } from "./dates";
import type { DeptDashboard } from "./use-dept-dashboard";

// The pieces every department dashboard is built from. They hold no state:
// each department's file owns the layout and decides which of these to show,
// which columns its table carries, and what it adds of its own.

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: typeof ClipboardList;
  label: string;
  value: ReactNode;
  hint?: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-display text-2xl font-bold tracking-tight text-foreground">
            {value}
          </div>
          <div className="truncate text-xs text-muted">{label}</div>
        </div>
      </div>
      {hint && <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The counts every department has an answer for. A department with no deadline
 * of its own drops the two that depend on one rather than printing zeroes that
 * mean "not applicable", and `extra` is the card only that department wants —
 * so the row is sized to what is actually in it.
 */
export function DeptStatCards({ d, extra }: { d: DeptDashboard; extra?: ReactNode }) {
  const { view, mine, stats } = d;
  const notApplicable = mine.length - stats.applicable.length;
  const count = 3 + (view.hasTarget ? 2 : 0) + (extra ? 1 : 0);
  const wide = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 6: "lg:grid-cols-6" }[count]
    ?? "lg:grid-cols-5";
  return (
    <div className={`mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 ${wide}`}>
      <StatCard
        icon={ClipboardList}
        label={view.perEc ? "ECs assigned" : "Orders assigned"}
        value={stats.applicable.length}
        hint={notApplicable > 0 ? `${notApplicable} not applicable` : undefined}
        accent="bg-primary/10 text-primary"
      />
      <StatCard
        icon={Clock}
        label="Still open"
        value={stats.outstanding.length}
        accent="bg-blue-50 text-blue-600"
      />
      {view.hasTarget && (
        <>
          <StatCard
            icon={AlertTriangle}
            label="Overdue"
            value={stats.overdue.length}
            hint="past target, not finished"
            accent="bg-rose-50 text-rose-600"
          />
          <StatCard
            icon={CalendarClock}
            label="Due in 7 days"
            value={stats.dueSoon.length}
            accent="bg-amber-50 text-amber-600"
          />
        </>
      )}
      <StatCard
        icon={CheckCircle2}
        label="Finished"
        value={stats.finished.length}
        hint={`${stats.signedOff} marked complete`}
        accent="bg-emerald-50 text-emerald-600"
      />
      {extra}
    </div>
  );
}

export function Panel({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-card-border bg-surface p-5 shadow-sm ${
        wide ? "lg:col-span-2" : ""
      }`}
    >
      <h3 className="mb-4 font-display text-sm font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** Horizontal bars, longest first — the department's own status vocabulary. */
export function StatusBars({ d }: { d: DeptDashboard }) {
  const total = d.mine.length;
  if (total === 0) {
    return <p className="py-6 text-sm text-muted">Nothing assigned yet.</p>;
  }
  return (
    <div className="space-y-2.5">
      {d.stats.statusBars.map((item) => {
        const pct = Math.round((item.count / total) * 100);
        return (
          <div key={item.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-foreground">{item.label}</span>
              <span className="shrink-0 tabular-nums text-muted">
                {item.count} · {pct}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-background">
              <div
                className={`h-full rounded-full ${
                  item.done ? "bg-emerald-500" : "bg-primary"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RowLink({ d, row }: { d: DeptDashboard; row: OrderOverviewRow }) {
  return (
    <Link
      href={d.rowHref(row)}
      className="truncate font-medium text-primary hover:text-primary-hover"
    >
      {row.so_no ?? `#${row.sl_no}`}
      {d.view.perEc && row.ec_no ? ` · ${row.ec_no}` : ""}
    </Link>
  );
}

/** What is late, then what is about to be — soonest first. */
export function DeadlineList({ d }: { d: DeptDashboard }) {
  const items = [...d.stats.overdue, ...d.stats.dueSoon].sort((a, b) =>
    (d.view.target(a) ?? "") < (d.view.target(b) ?? "") ? -1 : 1
  );
  if (items.length === 0) {
    return <p className="py-6 text-sm text-muted">Nothing due in the next week.</p>;
  }
  return (
    <ol className="space-y-2">
      {items.slice(0, 6).map((r) => {
        const days = daysFromToday(d.view.target(r)!);
        return (
          <li
            key={String(r.id ?? r.order_id)}
            className="flex items-baseline justify-between gap-2 text-xs"
          >
            <RowLink d={d} row={r} />
            <span
              className={`shrink-0 tabular-nums ${
                days < 0 ? "font-semibold text-rose-600" : "text-muted"
              }`}
            >
              {describeDue(days)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** For departments with no deadline: what they have closed off lately. */
export function SignOffList({ d }: { d: DeptDashboard }) {
  if (d.stats.recentSignOffs.length === 0) {
    return <p className="py-6 text-sm text-muted">Nothing marked complete yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {d.stats.recentSignOffs.map(({ row, done }) => (
        <li
          key={String(row.id ?? row.order_id)}
          className="flex items-baseline justify-between gap-2 text-xs"
        >
          <RowLink d={d} row={row} />
          <span className="shrink-0 tabular-nums text-muted">
            {formatDate(done.completed_on)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Search, the facets every department shares, and the date range. `extra` is
 * where a department drops a filter only it needs — its state lives in its own
 * file and reaches the rows through the hook's `extras.filter`.
 */
export function FilterBar({ d, extra }: { d: DeptDashboard; extra?: ReactNode }) {
  const f = d.filters;
  return (
    <div className="mb-4 space-y-2 rounded-xl border border-card-border bg-surface p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={f.text}
            onChange={(e) => {
              f.setText(e.target.value);
              d.paging.setPage(1);
            }}
            placeholder="Search SO, EC, client…"
            aria-label="Search orders"
            className="h-9 w-60 rounded-lg border border-input-border bg-surface pl-8 pr-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <MultiSelectFilter
          label="Zone"
          options={f.options.zones}
          selected={f.zones}
          onChange={f.setZones}
        />
        <MultiSelectFilter
          label="Rep"
          options={f.options.reps}
          selected={f.reps}
          onChange={f.setReps}
        />
        <MultiSelectFilter
          label="Type"
          options={f.options.types}
          selected={f.types}
          onChange={f.setTypes}
        />
        <SingleSelectFilter
          label="Status"
          allLabel="Any status"
          options={f.options.statuses.map((s) => ({ value: s, label: s }))}
          selected={f.status}
          onChange={f.setStatus}
        />
        <SingleSelectFilter
          label="Completion"
          allLabel="Any"
          options={[
            // The stored values stay as they were; only the words changed.
            { value: "Signed off", label: "Completed" },
            { value: "Not signed off", label: "Not completed" },
          ]}
          selected={f.signOff}
          onChange={f.setSignOff}
        />
        {extra}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {f.dateLabel}
        </span>
        {f.presets.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => f.applyPreset(f.preset === label ? null : label)}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
              f.preset === label
                ? "border-primary/40 bg-primary/[0.06] text-foreground"
                : "border-input-border bg-surface text-muted hover:bg-background hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        <input
          type="date"
          aria-label={`${f.dateLabel} from`}
          value={f.fromDate}
          onChange={(e) => {
            f.applyPreset(null);
            f.setFromDate(e.target.value);
            d.paging.setPage(1);
          }}
          max={f.toDate || undefined}
          className="h-8 rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground"
        />
        <input
          type="date"
          aria-label={`${f.dateLabel} to`}
          value={f.toDate}
          onChange={(e) => {
            f.applyPreset(null);
            f.setToDate(e.target.value);
            d.paging.setPage(1);
          }}
          min={f.fromDate || undefined}
          className="h-8 rounded-lg border border-input-border bg-surface px-2 text-xs text-foreground"
        />
        {f.filterActive && (
          <button
            type="button"
            onClick={f.clearFilters}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-input-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
          >
            <X className="h-3.5 w-3.5" />
            Clear all
          </button>
        )}
        <span className="ml-auto text-xs text-muted">
          <span className="font-semibold text-foreground">{d.rows.length}</span> of{" "}
          {d.mine.length}
        </span>
      </div>
    </div>
  );
}

export type Column = {
  key: string;
  label: string;
  /** Extra classes for both the header and the cells in this column. */
  className?: string;
  cell: (row: OrderOverviewRow) => ReactNode;
};

export function StatusPill({ d, row }: { d: DeptDashboard; row: OrderOverviewRow }) {
  const { view } = d;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        view.na(row)
          ? "bg-slate-100 text-slate-500"
          : view.done(row)
            ? "bg-emerald-50 text-emerald-700"
            : "bg-amber-50 text-amber-700"
      }`}
    >
      {view.status(row)}
    </span>
  );
}

/** A plain text column, for the one-field extras a department adds. */
export function textColumn(
  key: string,
  label: string,
  pick: (row: OrderOverviewRow) => string | null
): Column {
  return {
    key,
    label,
    className: "whitespace-nowrap text-muted",
    cell: (r) => pick(r) || "—",
  };
}

/**
 * The columns every department's table is built from. A department picks the
 * ones it wants, in the order it wants, and slots its own in between.
 */
export function baseColumns(d: DeptDashboard) {
  const { view } = d;
  return {
    sl: {
      key: "sl",
      label: "Sl.",
      className: "tabular-nums",
      cell: (r: OrderOverviewRow) => r.sl_no,
    } satisfies Column,
    so: {
      key: "so",
      label: "SO No.",
      className: "whitespace-nowrap font-medium",
      cell: (r: OrderOverviewRow) => (
        <Link href={d.rowHref(r)} className="text-primary hover:text-primary-hover">
          {r.so_no ?? "—"}
        </Link>
      ),
    } satisfies Column,
    ec: {
      key: "ec",
      label: "EC No.",
      className: "whitespace-nowrap",
      cell: (r: OrderOverviewRow) => r.ec_no ?? "—",
    } satisfies Column,
    client: {
      key: "client",
      label: "Client",
      cell: (r: OrderOverviewRow) => r.client_name ?? "—",
    } satisfies Column,
    zone: textColumn("zone", "Zone", (r) => r.zone),
    status: {
      key: "status",
      label: "Status",
      cell: (r: OrderOverviewRow) => <StatusPill d={d} row={r} />,
    } satisfies Column,
    target: {
      key: "target",
      label: "Target",
      className: "whitespace-nowrap",
      cell: (r: OrderOverviewRow) => {
        const target = view.target(r);
        const late = !!target && target < d.today && !view.done(r);
        return (
          <span className={late ? "font-medium text-rose-600" : "text-muted"}>
            {formatDate(target)}
            {late ? " · overdue" : ""}
          </span>
        );
      },
    } satisfies Column,
    signOff: {
      key: "signOff",
      label: "Completed",
      className: "whitespace-nowrap",
      cell: (r: OrderOverviewRow) => {
        const signed = d.signOffOf(r);
        if (!signed) return <span className="text-muted-foreground">—</span>;
        const days = describeDays(signed.days_taken);
        return (
          <span className="text-[11px] font-medium text-emerald-700">
            {formatDate(signed.completed_on)}
            {days ? ` · ${days}` : ""}
          </span>
        );
      },
    } satisfies Column,
  };
}

export function WorkTable({
  d,
  columns,
  minWidth = 900,
}: {
  d: DeptDashboard;
  columns: Column[];
  minWidth?: number;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-surface shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead>
            <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-3 first:pl-4">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {d.pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-muted"
                >
                  {d.filters.filterActive
                    ? "No orders match these filters."
                    : "Nothing assigned yet."}
                </td>
              </tr>
            )}
            {d.pageRows.map((r) => (
              <tr
                key={String(r.id ?? r.order_id)}
                className="text-foreground transition-colors hover:bg-background/60"
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-3 first:pl-4 ${c.className ?? ""}`}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination {...d.paging} />
    </div>
  );
}
