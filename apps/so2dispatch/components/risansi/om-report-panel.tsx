"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, FileSpreadsheet, Loader2 } from "lucide-react";

type Line = { cells: (string | number | null)[]; filled: boolean };
type Report = { scope: string; columns: { header: string; date?: boolean }[]; lines: Line[] };

/** The report's columns this view shows, in its order; SO-level ones span the SO's ECs. */
const SHOWN: { header: string; perEc?: boolean; wide?: boolean }[] = [
  { header: "PO Receiving Date" },
  { header: "Client Name", wide: true },
  { header: "Order Type" },
  { header: "Bill Mode" },
  { header: "SO No." },
  { header: "SO Date" },
  { header: "EC No.", perEc: true },
  { header: "EC Date", perEc: true },
  { header: "SO Sent to Operation" },
  { header: "Assigned Person" },
  { header: "Reason for Delay", wide: true },
  { header: "Remarks", wide: true },
];

function day(v: string | number | null): string {
  if (v == null || v === "") return "";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Order Making's report on the page, to look over and screenshot: the list
 * as filtered and searched, every page — each SO once, its ECs beside it —
 * scrolling sideways in a panel that opens and closes.
 */
export function OmReportPanel({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => setOpen((o) => !o);

  // Read when open, and again whenever the filters change.
  useEffect(() => {
    if (!open || loadedFor === query) return;
    let live = true;
    const qs = query ? `?${query}&view=1` : "?view=1";
    fetch(`/risansi/departments/order-making/export${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Could not load the report (${r.status}).`))))
      .then((data: Report) => {
        if (!live) return;
        setReport(data);
        setLoadedFor(query);
        setError(null);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [open, query, loadedFor]);

  const loading = open && loadedFor !== query && !error;
  const at = (h: string) => report?.columns.findIndex((c) => c.header === h) ?? -1;
  const isDate = (h: string) => !!report?.columns.find((c) => c.header === h)?.date;

  // Each SO's lines together: the report repeats the SO on every EC line.
  const groups: Line[][] = [];
  if (report) {
    const soAt = at("SO No.");
    const clientAt = at("Client Name");
    for (const l of report.lines) {
      const last = groups[groups.length - 1];
      const same =
        last && last[0].cells[soAt] && last[0].cells[soAt] === l.cells[soAt] && last[0].cells[clientAt] === l.cells[clientAt];
      if (same) last.push(l);
      else groups.push([l]);
    }
  }

  const cell = (h: string, line: Line) => {
    const v = line.cells[at(h)] ?? null;
    if (h === "SO Sent to Operation" && v === "HOLD") {
      return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">HOLD</span>;
    }
    if (h === "Assigned Person" && v === "Migrated") return <span className="text-slate-400">Migrated</span>;
    const text = isDate(h) ? day(v) : v == null ? "" : String(v);
    if (!text) return <span className="text-slate-300">—</span>;
    if (h === "SO No." || h === "EC No.") return <span className="font-semibold text-slate-900">{text}</span>;
    if (h === "Bill Mode" || h === "Order Type") {
      return <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{text}</span>;
    }
    if (h === "Reason for Delay" || h === "Remarks") return <span className="whitespace-pre-line">{text}</span>;
    return text;
  };

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-card-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-background/60"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15">
          <FileSpreadsheet className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">Order Making report</span>
          <span className="block truncate text-xs text-muted">
            {report && open ? `${report.scope} · ${report.lines.length} EC lines` : "The list as filtered, each SO with its ECs — to view and screenshot"}
          </span>
        </span>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
        <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-card-border">
          {error ? (
            <p className="px-4 py-6 text-sm text-danger">{error}</p>
          ) : !report ? (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the report…
            </p>
          ) : report.lines.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">No SOs match the filters.</p>
          ) : (
            // A light sheet in either theme, so a screenshot reads the same.
            <div className={`max-h-[70vh] overflow-auto bg-white transition-opacity ${loading ? "opacity-60" : ""}`}>
              <table className="w-max min-w-full border-separate border-spacing-0 text-[12.5px] text-slate-700">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {SHOWN.map((c, i) => (
                      <th
                        key={c.header}
                        className={`whitespace-nowrap border-b border-[#16294d] bg-[#1F3864] px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white ${
                          i > 0 ? "border-l border-l-white/15" : ""
                        }`}
                      >
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, gi) => (
                    <Fragment key={gi}>
                      {g.map((line, li) => (
                        <tr key={li} className={gi % 2 ? "bg-slate-50" : "bg-white"}>
                          {SHOWN.map((c, ci) => {
                            if (!c.perEc && li > 0) return null;
                            const lastLine = li === g.length - 1;
                            const edge = c.perEc && !lastLine ? "border-b border-dashed border-slate-200" : "border-b border-slate-200";
                            return (
                              <td
                                key={c.header}
                                rowSpan={c.perEc ? undefined : g.length}
                                className={`px-3 py-2 align-top ${edge} ${ci > 0 ? "border-l border-l-slate-100" : ""} ${
                                  c.wide ? "min-w-[14rem] max-w-[22rem]" : "whitespace-nowrap"
                                }`}
                              >
                                {cell(c.header, line)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
