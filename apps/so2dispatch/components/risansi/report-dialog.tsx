"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, Printer, X } from "lucide-react";

/**
 * A department's report: a button opening it in a pop-up — the PDF to look
 * over or print — with a choice to download it as PDF or Excel. `href` is the
 * report route with the queue's own query; it serves the PDF, `download=1`
 * saves it, and `format=xlsx` gives the Excel.
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
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl ring-1 ring-black/5 sm:rounded-2xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#1F3864] to-[#2F5496] px-5 py-3.5 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
              <FileText className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-base font-semibold">{title}</h2>
              <p className="text-xs text-white/75">As filtered · every page · download it as PDF or Excel</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={print} disabled={!ready} className={ghost}>
              <Printer className="h-4 w-4" />
              Print
            </button>
            <a href={`${href}${join}download=1`} className={ghost}>
              <Download className="h-4 w-4" />
              PDF
            </a>
            <a
              href={`${href}${join}format=xlsx`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-white/90"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </a>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 bg-slate-100">
          {!ready && (
            <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Preparing the report…
            </p>
          )}
          <iframe ref={frameRef} src={`${href}#view=FitH`} title={title} onLoad={() => setReady(true)} className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}
