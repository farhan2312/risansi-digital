"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, Loader2, X } from "lucide-react";

type Report = {
  scope: string;
  columns: { header: string; width: number; date?: boolean }[];
  lines: { cells: (string | number | null)[]; filled: boolean }[];
};

function show(v: string | number | null, isDate?: boolean): string {
  if (v == null) return "";
  if (isDate) {
    const d = new Date(String(v));
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }
  return String(v);
}

/**
 * Order Making's Excel report in a pop-up: the list as filtered and searched,
 * every page, one row per EC — looked over here, then downloaded.
 */
export function OmReportModal({ query, onClose }: { query: string; onClose: () => void }) {
  const qs = query ? `?${query}` : "";
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/risansi/departments/order-making/export${qs}${qs ? "&" : "?"}view=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Could not load the report (${r.status}).`))))
      .then((data: Report) => live && setReport(data))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [qs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Order Making report"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[96rem] flex-col rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">Order Making report</h2>
              <p className="text-xs text-muted">
                {report
                  ? `${report.scope} · ${report.lines.length} row${report.lines.length === 1 ? "" : "s"}, one per EC`
                  : "The list as filtered and searched, every page"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/risansi/departments/order-making/export${qs}`}
              aria-disabled={!report}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover ${
                report ? "" : "pointer-events-none opacity-50"
              }`}
            >
              <Download className="h-4 w-4" />
              Download Excel
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-card-border">
          {!report && !error && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading the report…
            </div>
          )}
          {error && <p className="py-16 text-center text-sm text-rose-600">{error}</p>}
          {report && (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  {report.columns.map((c) => (
                    <th key={c.header} className="whitespace-nowrap bg-[#1F3864] px-2.5 py-2 text-left font-semibold text-white">
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.lines.map(({ cells, filled }, i) => (
                  <tr key={i} className="border-b border-card-border/70 odd:bg-background/40 hover:bg-primary/[0.04]">
                    {cells.map((c, j) =>
                      j === cells.length - 1 ? (
                        <td key={j} className={`whitespace-nowrap px-2.5 py-1.5 font-semibold ${filled ? "text-emerald-600" : "text-amber-600"}`}>
                          {show(c)}
                        </td>
                      ) : (
                        <td
                          key={j}
                          className={`px-2.5 py-1.5 text-foreground ${report.columns[j].width > 20 ? "min-w-[12rem]" : "whitespace-nowrap"}`}
                        >
                          {show(c, report.columns[j].date)}
                        </td>
                      )
                    )}
                  </tr>
                ))}
                {report.lines.length === 0 && (
                  <tr>
                    <td colSpan={report.columns.length} className="px-3 py-12 text-center text-sm text-muted">
                      No SOs match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
