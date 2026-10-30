"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, Printer, X } from "lucide-react";
import type { ReportSheet, Tone } from "@/lib/planning-report-sheet";

/**
 * A department's report: a button opening it in a pop-up, as a PDF or as the
 * Excel sheet, each to look over and then download. `href` is the report
 * route with the queue's own query; it serves the PDF, `download=1` saves it,
 * `format=xlsx` gives the Excel and `format=json` the sheet to view.
 */
export function ReportDialogButton({ title, href }: { title: string; href: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#1F3864] to-[#2F5496] px-3.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
      >
        <FileText className="h-4 w-4" />
        {title}
      </button>
      {open && <ReportDialog title={title} href={href} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportDialog({ title, href, onClose }: { title: string; href: string; onClose: () => void }) {
  // Opens on the Excel; the PDF is read only once asked for, then kept.
  const [view, setView] = useState<"pdf" | "excel">("excel");
  const [pdfAsked, setPdfAsked] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const join = href.includes("?") ? "&" : "?";
  const print = () => {
    try {
      frameRef.current?.contentWindow?.focus();
      frameRef.current?.contentWindow?.print();
    } catch {
      // The viewer would not print from here: open it on its own to print.
      window.open(href, "_blank");
    }
  };
  const ghost =
    "inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-sm font-semibold text-white transition-colors hover:bg-white/25 disabled:opacity-50";
  const solid = "inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-semibold transition-colors hover:bg-white/90";
  const tab = (k: "pdf" | "excel", label: string, Icon: typeof FileText) => (
    <button
      type="button"
      onClick={() => {
        setView(k);
        if (k === "pdf") setPdfAsked(true);
      }}
      aria-pressed={view === k}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors ${
        view === k ? "bg-white text-[#1F3864] shadow-sm" : "text-white/80 hover:text-white"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl ring-1 ring-black/5 sm:rounded-2xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#1F3864] to-[#2F5496] px-5 py-3.5 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
              {view === "pdf" ? <FileText className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />}
            </span>
            <div>
              <h2 className="font-display text-base font-semibold">{title}</h2>
              <p className="text-xs text-white/75">As filtered · every page · view it, then download</p>
            </div>
          </div>
          {/* PDF or Excel: what to look at, and so what to download. */}
          <div role="group" aria-label="View" className="inline-flex rounded-lg bg-white/15 p-0.5">
            {tab("excel", "Excel", FileSpreadsheet)}
            {tab("pdf", "PDF", FileText)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {view === "pdf" ? (
              <>
                <button type="button" onClick={print} disabled={!ready} className={ghost}>
                  <Printer className="h-4 w-4" />
                  Print
                </button>
                <a href={`${href}${join}download=1`} className={`${solid} text-[#1F3864]`}>
                  <Download className="h-4 w-4" />
                  Download PDF
                </a>
              </>
            ) : (
              <a href={`${href}${join}format=xlsx`} className={`${solid} text-emerald-700`}>
                <Download className="h-4 w-4" />
                Download Excel
              </a>
            )}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 bg-slate-100">
          {/* The PDF, once opened, stays loaded behind the Excel view, so switching back is instant. */}
          {pdfAsked && (
          <div className={view === "pdf" ? "h-full" : "hidden"}>
            {!ready && (
              <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Preparing the report…
              </p>
            )}
            <iframe ref={frameRef} src={`${href}#view=FitH`} title={title} onLoad={() => setReady(true)} className="h-full w-full" />
          </div>
          )}
          {view === "excel" && <ExcelView src={`${href}${join}format=json`} />}
        </div>
      </div>
    </div>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  red: "text-rose-700",
  green: "text-emerald-700",
  amber: "text-amber-700",
  blue: "text-sky-700",
  muted: "text-slate-400",
};

/** The Excel sheet on screen, as the download will have it. */
function ExcelView({ src }: { src: string }) {
  const [sheet, setSheet] = useState<ReportSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(src, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Could not load the sheet (${r.status}).`))))
      .then((data: ReportSheet) => live && setSheet(data))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [src]);

  if (error) return <p className="px-5 py-6 text-sm text-danger">{error}</p>;
  if (!sheet)
    return (
      <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Preparing the sheet…
      </p>
    );

  // Each group of columns once, over its columns.
  const groups: { label: string; span: number }[] = [];
  if (sheet.columns.some((c) => c.group)) {
    for (const c of sheet.columns) {
      const last = groups[groups.length - 1];
      if (last && last.label === (c.group ?? "")) last.span++;
      else groups.push({ label: c.group ?? "", span: 1 });
    }
  }
  const sticky = "sticky z-10";
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        {sheet.summary.tiles.map((t) => (
          <span key={t.label} className="inline-flex items-baseline gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 ring-1 ring-slate-200">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">{t.label}</span>
            <span className={`text-sm font-bold tabular-nums ${t.tone ? TONE_TEXT[t.tone] : "text-slate-900"}`}>{t.value}</span>
          </span>
        ))}
        <span className="ml-auto text-xs text-slate-500">
          {sheet.rows.length} rows · {sheet.columns.length} columns
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <table className="border-separate border-spacing-0 text-[12px] text-slate-700">
          <thead>
            {groups.length > 0 && (
              <tr>
                {groups.map((g, i) => (
                  <th
                    key={`${g.label}-${i}`}
                    colSpan={g.span}
                    className={`${sticky} top-0 h-7 border-b border-r border-white/20 bg-[#2F5496] px-2 text-center text-[11px] font-semibold text-white`}
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {sheet.columns.map((c, i) => (
                <th
                  key={i}
                  style={{ minWidth: Math.max(56, c.width * 6.5) }}
                  className={`${sticky} ${groups.length ? "top-7" : "top-0"} border-b border-r border-white/20 bg-[#1F3864] px-2 py-2 text-left text-[11px] font-semibold text-white`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.length === 0 && (
              <tr>
                <td colSpan={sheet.columns.length} className="px-4 py-10 text-center text-sm text-slate-500">
                  Nothing matches the filters.
                </td>
              </tr>
            )}
            {sheet.rows.map((r, ri) => (
              <tr key={ri} className={!r.repeat && ri > 0 ? "[&>td]:border-t [&>td]:border-t-slate-300" : ""}>
                {r.cells.map((v, i) => {
                  const dim = r.repeat && i < (sheet.soColumns ?? 0);
                  const tone = dim ? "muted" : r.tones[i];
                  return (
                    <td
                      key={i}
                      className={`whitespace-pre-line border-b border-r border-slate-100 px-2 py-1.5 align-top ${
                        sheet.columns[i].numeric ? "text-right tabular-nums" : ""
                      } ${tone ? TONE_TEXT[tone] : r.bold[i] ? "text-slate-900" : ""} ${r.bold[i] && !dim ? "font-semibold" : ""}`}
                    >
                      {v ?? ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
