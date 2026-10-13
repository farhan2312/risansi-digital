"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, BellRing, Clock } from "lucide-react";
import type { ReminderRow, ReminderTier } from "@/lib/reminders";

const TIER_STYLE: Record<
  ReminderTier,
  { label: string; chip: string; dot: string }
> = {
  overdue: {
    label: "Overdue",
    chip: "bg-rose-100 text-rose-800 ring-rose-300",
    dot: "bg-rose-600",
  },
  "24h": {
    label: "Within 24h",
    chip: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
  "72h": {
    label: "Within 72h",
    chip: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  "7d": {
    label: "Within 7 days",
    chip: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
};

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function dueText(daysLeft: number): string {
  if (daysLeft < 0) return `Overdue by ${-daysLeft} day${daysLeft === -1 ? "" : "s"}`;
  if (daysLeft === 0) return "Due today";
  if (daysLeft === 1) return "Due tomorrow";
  return `Due in ${daysLeft} days`;
}

/**
 * Upcoming department deadlines (7d / 72h / 24h). Renders nothing when there
 * are none, so it stays out of the way until something is actually coming due.
 * `showDepartment` labels each row with its department (for cross-department
 * views); omit it on a single-department page.
 */
export function RemindersPanel({
  reminders,
  showDepartment = false,
  showClient = true,
  focusInQueue = false,
}: {
  reminders: ReminderRow[];
  showDepartment?: boolean;
  /**
   * On a department's queue: a reminder brings its SO up in the queue
   * (expanded and highlighted) rather than opening another page.
   */
  focusInQueue?: boolean;
  /** Off for departments not shown client details (Planning, Assembly). */
  showClient?: boolean;
}) {
  // Closed until asked for: the queue is the work. Two buttons — what is
  // coming due, and what is already past — each opening its own list.
  const [open, setOpen] = useState<"upcoming" | "overdue" | null>(null);

  if (reminders.length === 0) return null;

  const overdue = reminders.filter((r) => r.tier === "overdue");
  const upcoming = reminders.filter((r) => r.tier !== "overdue");
  const critical = upcoming.filter((r) => r.tier === "24h").length;
  const shown = open === "overdue" ? overdue : open === "upcoming" ? upcoming : [];
  const toggle = (which: "upcoming" | "overdue") => setOpen((prev) => (prev === which ? null : which));

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => toggle("upcoming")}
          aria-pressed={open === "upcoming"}
          disabled={upcoming.length === 0}
          className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
            open === "upcoming"
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-input-border bg-surface text-foreground hover:bg-background"
          }`}
        >
          <BellRing className="h-4 w-4 text-amber-600" />
          Reminders
          <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">
            {upcoming.length}
          </span>
          {critical > 0 && <span className="text-xs text-rose-600">· {critical} within 24h</span>}
        </button>
        <button
          type="button"
          onClick={() => toggle("overdue")}
          aria-pressed={open === "overdue"}
          disabled={overdue.length === 0}
          className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
            open === "overdue"
              ? "border-rose-300 bg-rose-50 text-rose-800"
              : "border-input-border bg-surface text-foreground hover:bg-background"
          }`}
        >
          <AlertTriangle className="h-4 w-4 text-rose-600" />
          Overdue
          <span className="rounded-full bg-rose-100 px-1.5 text-xs font-semibold text-rose-800">
            {overdue.length}
          </span>
        </button>
      </div>

      {shown.length > 0 && (
        <ul className="mt-2 divide-y divide-card-border overflow-hidden rounded-xl border border-card-border bg-surface shadow-sm">
          {shown.map((r) => {
            const style = TIER_STYLE[r.tier];
            return (
              <li
                key={`${r.id}-${r.dept}-${r.ec_no ?? ""}`}
                className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.chip}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                    {style.label}
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      {dueText(r.days_left)} · {formatDate(r.due_date)}
                      {showDepartment ? ` · ${r.department}` : ""}
                    </p>
                    <p className="truncate text-xs text-muted">
                      #{r.sl_no} · {r.so_no ?? "—"}
                      {r.ec_no ? ` · ${r.ec_no}` : ""}
                      {showClient && r.client_name ? ` · ${r.client_name}` : ""}
                    </p>
                  </div>
                </div>
                <Link
                  href={focusInQueue ? { query: { focus: r.id } } : `/risansi/orders/${r.id}`}
                  scroll={!focusInQueue}
                  onClick={() => focusInQueue && setOpen(null)}
                  className="shrink-0 text-sm font-medium text-primary hover:text-primary-hover"
                >
                  {focusInQueue ? "Show" : "Open"}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
