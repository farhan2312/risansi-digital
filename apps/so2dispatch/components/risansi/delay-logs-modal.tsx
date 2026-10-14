"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, X } from "lucide-react";
import { roleLabel } from "@/lib/roles";
import type { DelayLogReport } from "@/lib/order-messages";
import { delayLogsAction } from "@/app/risansi/orders/thread-actions";

/**
 * The SO target date each department works to. Which target it is follows
 * from the Department column, so only the column name is needed here.
 * Departments without a target of their own fall back to the dispatch target.
 */
const TARGET_BY_ROLE: Record<string, string> = {
  drawing: "drg_target_date",
  purchase: "purchase_target_date",
  qc: "qc_doc_target_date",
  // The packing team's own target. Dispatch is absent on purpose: it works to
  // the SO's dispatch date, which is what targetFor falls back to.
  assembly: "dispatch_team_target_date",
};

/**
 * The date this department is judged against, out of the SO's targets. A
 * revised dispatch date supersedes the original wherever it is quoted.
 */
function targetFor(
  role: string,
  targets: Record<string, string | null | undefined>
): string | null {
  const column = TARGET_BY_ROLE[role];
  if (column) return targets[column] ?? null;
  return targets.dispatch_target_revised_date ?? targets.dispatch_target_date ?? null;
}

function dayOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })} · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Every delay logged on one SO, as a table. */
export function DelayLogsModal({
  orderId,
  soLabel,
  onClose,
}: {
  orderId: string;
  soLabel?: string;
  onClose: () => void;
}) {
  const [report, setReport] = useState<DelayLogReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await delayLogsAction(orderId);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) setError(res.error);
      else setReport(res.report);
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const logs = report?.logs ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Delay logs for SO ${soLabel ?? ""}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-card-border px-5 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              Delay logs
            </p>
            <p className="truncate font-display text-sm font-semibold text-foreground">
              {soLabel || report?.so_no || "—"}
              {logs.length > 0 && (
                <span className="ml-2 font-normal text-muted">
                  {logs.length} {logs.length === 1 ? "entry" : "entries"}
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* The route re-runs the same lane-filtered query server-side,
                so the export can only contain what this user may see. */}
            <a
              href={`/risansi/orders/${orderId}/delay-logs/pdf`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input-border bg-surface px-3 text-xs font-semibold text-foreground transition-colors hover:bg-background"
            >
              <Download className="h-3.5 w-3.5" />
              Download PDF
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : error ? (
            <p role="alert" className="px-5 py-10 text-sm text-danger">
              {error}
            </p>
          ) : logs.length === 0 ? (
            <p className="px-5 py-10 text-sm text-muted">
              No delays logged on this order.
            </p>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="border-b border-card-border px-4 py-3">
                    Department
                  </th>
                  <th className="border-b border-card-border px-4 py-3">
                    Target date
                  </th>
                  <th className="border-b border-card-border px-4 py-3">
                    Logged on
                  </th>
                  <th className="border-b border-card-border px-4 py-3">
                    Reason
                  </th>
                  <th className="border-b border-card-border px-4 py-3">
                    Logged by
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {logs.map((log) => {
                  const date = targetFor(log.dept_role, report?.targets ?? {});
                  return (
                    <tr key={log.id} className="align-top">
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-foreground">
                        {roleLabel(log.dept_role)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-foreground">
                        {dayOnly(date)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted">
                        {stamp(log.created_at)}
                      </td>
                      <td className="px-4 py-3 text-foreground">{log.body}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-foreground">
                        {log.author_name}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
