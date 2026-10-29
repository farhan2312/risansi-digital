"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2, Maximize2, Minus, Plus, Printer, X } from "lucide-react";
import { blocksOf, type SoBlock } from "@/lib/order-making-blocks";

type Line = { cells: (string | number | null)[]; filled: boolean };
type Report = { scope: string; columns: { header: string; date?: boolean }[]; lines: Line[] };

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.5;

const HEADS = ["PO Received", "Client", "Type", "Sales Order", "ECs", "Sent to Operation", "Assigned to", "Reason for Delay", "Remarks"];

/**
 * Order Making's report on the page, to look over and screenshot: the list
 * as filtered and searched, every page — each SO once, its ECs beside it —
 * fitted to the panel's width (or zoomed in and out), in a panel that opens
 * and closes.
 */
export function OmReportPanel({ query, hideSentToOps = false }: { query: string; hideSentToOps?: boolean }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "fit" follows the panel's width; a number is a zoom the viewer chose.
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const frameRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [sheet, setSheet] = useState({ w: 0, h: 0 });

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

  // The panel's width and the sheet's own size, as either changes (the
  // window resized, the sidebar folded, the rows reloaded).
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const body = sheetRef.current;
    if (!frame || !body) return;
    const ro = new ResizeObserver(() => {
      // Less its padding (p-3 each side): the room the sheet has.
      setFrameWidth(frame.clientWidth - 24);
      setSheet({ w: body.offsetWidth, h: body.offsetHeight });
    });
    ro.observe(frame);
    ro.observe(body);
    return () => ro.disconnect();
  }, [report, open]);

  const fit = sheet.w > 0 && frameWidth > 0 ? Math.min(1, frameWidth / sheet.w) : 1;
  const scale = zoom === "fit" ? fit : zoom;
  const step = (d: number) => setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((scale + d) * 10) / 10)));

  const loading = open && loadedFor !== query && !error;

  // The report as a PDF, in its pop-up: to print or download.
  const [showPdf, setShowPdf] = useState(false);
  const blocks = report ? blocksOf(report) : [];
  const ecCount = blocks.reduce((t, b) => t + b.ecs.length, 0);

  const zoomButton =
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground disabled:opacity-40";

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-card-border bg-surface shadow-sm">
      {showPdf && <ReportPdfDialog query={query} onClose={() => setShowPdf(false)} />}
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15">
            <FileSpreadsheet className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">Order Making report</span>
            <span className="block truncate text-xs text-muted">
              {report && open ? `${report.scope} · ${ecCount} ECs` : "The list as filtered, each SO with its ECs — to view and screenshot"}
            </span>
          </span>
        </button>
        {open && report && (
          // Zoom: smaller to take in more, Fit to the panel's width.
          <div className="flex items-center gap-0.5 rounded-lg border border-input-border p-0.5">
            <button type="button" onClick={() => step(-ZOOM_STEP)} disabled={scale <= ZOOM_MIN} aria-label="Zoom out" className={zoomButton}>
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-11 text-center text-xs font-semibold tabular-nums text-foreground">{Math.round(scale * 100)}%</span>
            <button type="button" onClick={() => step(ZOOM_STEP)} disabled={scale >= ZOOM_MAX} aria-label="Zoom in" className={zoomButton}>
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowPdf(true)}
              title="Print, or Save as PDF"
              className="ml-0.5 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <Printer className="h-3 w-3" />
              Print / PDF
            </button>
            <button
              type="button"
              onClick={() => setZoom("fit")}
              aria-pressed={zoom === "fit"}
              className={`ml-0.5 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold transition-colors ${
                zoom === "fit" ? "bg-primary text-primary-foreground" : "text-muted hover:bg-background hover:text-foreground"
              }`}
            >
              <Maximize2 className="h-3 w-3" />
              Fit
            </button>
          </div>
        )}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close the report" : "Open the report"} className={zoomButton}>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="border-t border-card-border">
          {error ? (
            <p className="px-4 py-6 text-sm text-danger">{error}</p>
          ) : !report ? (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the report…
            </p>
          ) : blocks.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">No SOs match the filters.</p>
          ) : (
            // A light sheet in either theme, so a screenshot reads the same.
            <div ref={frameRef} className={`max-h-[75vh] overflow-auto bg-slate-100 p-3 transition-opacity ${loading ? "opacity-60" : ""}`}>
              {/* Scaled as a whole; the box beneath takes its scaled size so nothing is cut or left blank. */}
              <div style={{ width: sheet.w * scale || undefined, height: sheet.h * scale || undefined }}>
                <div ref={sheetRef} style={{ transform: `scale(${scale})`, transformOrigin: "top left" }} className="w-max">
                  <Sheet scope={report.scope} blocks={blocks} ecCount={ecCount} hideSentToOps={hideSentToOps} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** The report itself: a title, then one card-row per SO. */
function Sheet({ scope, blocks, ecCount, hideSentToOps }: { scope: string; blocks: SoBlock[]; ecCount: number; hideSentToOps: boolean }) {
  // An Order Making SO member does not see Sent to Operation.
  const heads = hideSentToOps ? HEADS.filter((h) => h !== "Sent to Operation") : HEADS;
  return (
    <div className="w-[1180px] overflow-hidden rounded-xl bg-white text-[12.5px] text-slate-700 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-end justify-between gap-4 bg-gradient-to-r from-[#1F3864] to-[#2F5496] px-5 py-4 text-white">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Risansi · Order Making</p>
          <p className="mt-0.5 text-lg font-semibold">Order Making report</p>
        </div>
        <div className="text-right text-[11.5px] text-white/80">
          <p>{scope}</p>
          <p>
            {blocks.length} SOs · {ecCount} ECs
          </p>
        </div>
      </div>
      <table className="w-full table-fixed border-separate border-spacing-0">
        <colgroup>
          <col className="w-[92px]" />
          <col className="w-[190px]" />
          <col className="w-[92px]" />
          <col className="w-[120px]" />
          <col className="w-[170px]" />
          {!hideSentToOps && <col className="w-[96px]" />}
          <col className="w-[110px]" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h} className="border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.map((b, i) => (
            <tr key={`${b.soNo}-${i}`} className={i % 2 ? "bg-slate-50/60" : "bg-white"}>
              <Td muted>{b.poDate}</Td>
              <Td>
                <span className="font-medium text-slate-900">{b.client}</span>
              </Td>
              <Td>
                <span className="flex flex-col items-start gap-1">
                  {b.orderType && <Pill tone={/pump|rolb/i.test(b.orderType) ? "indigo" : "teal"}>{b.orderType}</Pill>}
                  {b.billMode && <span className="text-[11px] text-slate-500">{b.billMode}</span>}
                </span>
              </Td>
              <Td>
                <span className="block font-semibold text-slate-900">{b.soNo || "—"}</span>
                {b.soDate && <span className="block text-[11px] text-slate-500">{b.soDate}</span>}
              </Td>
              <Td>
                {b.ecs.length ? (
                  <span className="flex flex-col gap-1">
                    {b.ecs.map((e, k) => (
                      <span key={`${e.no}-${k}`} className="flex flex-wrap items-baseline gap-x-1.5">
                        <span className="font-medium text-slate-800">{e.no}</span>
                        {e.date && <span className="text-[11px] text-slate-400">{e.date}</span>}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-slate-300">No EC yet</span>
                )}
              </Td>
              {!hideSentToOps && (
                <Td>
                  {b.sentToOps === "HOLD" ? (
                    <Pill tone="rose">HOLD</Pill>
                  ) : b.sentToOps ? (
                    <span className="text-emerald-700">{b.sentToOps}</span>
                  ) : (
                    <span className="text-slate-300">Not yet</span>
                  )}
                </Td>
              )}
              <Td>{b.assigned === "Migrated" ? <span className="text-slate-400">Migrated</span> : b.assigned}</Td>
              <Td>
                <span className="whitespace-pre-line text-amber-800">{b.reason}</span>
              </Td>
              <Td>
                <span className="whitespace-pre-line">{b.remarks}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Td({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  const empty = children == null || children === "" || children === false;
  return (
    <td className={`border-b border-slate-100 px-3 py-2.5 align-top break-words ${muted ? "text-slate-500" : ""}`}>
      {empty ? <span className="text-slate-300">—</span> : children}
    </td>
  );
}

function Pill({ tone, children }: { tone: "indigo" | "teal" | "rose"; children: React.ReactNode }) {
  const cls = {
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    teal: "bg-teal-50 text-teal-700 ring-teal-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${cls}`}>{children}</span>;
}

/**
 * The report as a PDF in a pop-up — as filtered, A4 landscape, laid out as on
 * the page — to look over, print or download.
 */
function ReportPdfDialog({ query, onClose }: { query: string; onClose: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const src = `/risansi/departments/order-making/export?${query ? `${query}&` : ""}pdf=1`;
  const print = () => {
    try {
      frameRef.current?.contentWindow?.focus();
      frameRef.current?.contentWindow?.print();
    } catch {
      // The viewer would not print from here: open it on its own to print.
      window.open(src, "_blank");
    }
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Order Making report PDF"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl ring-1 ring-black/5 sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-[#1F3864] to-[#2F5496] px-5 py-3.5 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
              <FileText className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-base font-semibold">Order Making report</h2>
              <p className="text-xs text-white/75">As filtered · A4 landscape · print it or save it as a PDF</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={print}
              disabled={!ready}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-sm font-semibold text-white transition-colors hover:bg-white/25 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
            <a
              href={`${src}&download=1`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-semibold text-[#1F3864] transition-colors hover:bg-white/90"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </a>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 bg-slate-100">
          {!ready && (
            <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Preparing the PDF…
            </p>
          )}
          <iframe ref={frameRef} src={`${src}#view=FitH`} title="Order Making report PDF" onLoad={() => setReady(true)} className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}
