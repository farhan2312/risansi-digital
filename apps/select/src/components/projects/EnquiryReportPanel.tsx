"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  REPORT_COLUMNS,
  buildEnquiryReportHtml,
  downloadEnquiryReportExcel,
  enquiryReportRows,
  firstSortDir,
  isSortable,
  reportCell,
  sortReportRows,
  type ColumnKey,
  type EnquiryReportRow,
  type ReportSort,
  type ReportSortBy,
} from "../../lib/enquiry-report";
import { printHtml } from "../../lib/enquiry-print";
import { listProjectsReport, type ProjectListQuery } from "../../services/projectService";
import { listTsmOptions } from "../../services/quotationService";

// The User Master's report on the Enquiries page: the list as filtered, every page,
// in a panel that opens and closes. PDF view (what prints) or Excel view (what
// downloads), zoomed or fitted to the panel's width. Clicking the RIL Rep., Client Name,
// Assigned To or Enquiry Date heading sorts by it (again: the other way; a third time:
// back to the list's order); it prints and downloads in that order.

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.5;
/** The PDF view's page, and the Excel view's sheet, at 100%. */
const PDF_WIDTH = 1124;
const EXCEL_WIDTH = REPORT_COLUMNS.reduce((s, c) => s + c.width, 0) * 6.6;

const btn =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-paper px-3 text-[12.5px] font-semibold whitespace-nowrap text-fg-2 hover:border-accent hover:text-accent";
const zoomBtn = "inline-flex h-7 w-7 items-center justify-center rounded-md text-[15px] font-semibold text-fg-3 hover:bg-elev hover:text-fg disabled:opacity-40";

export default function EnquiryReportPanel({ query, scope }: { query: ProjectListQuery; scope: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"pdf" | "excel">("pdf");
  const [loaded, setLoaded] = useState<EnquiryReportRow[] | null>(null);
  const [sort, setSort] = useState<ReportSort>(null);
  const rows = useMemo(() => (loaded ? sortReportRows(loaded, sort) : null), [loaded, sort]);
  const sortOn = (by: ReportSortBy) =>
    setSort((s) => (s?.by !== by ? { by, dir: firstSortDir(by) } : s.dir === firstSortDir(by) ? { by, dir: s.dir === "asc" ? "desc" : "asc" } : null));
  // Where the PDF view's sortable headings sit in its page, to lay buttons over them.
  const [headings, setHeadings] = useState<{ key: ReportSortBy; left: number; top: number; width: number; height: number }[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "fit" follows the panel's width; a number is a zoom the viewer chose.
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [pdfHeight, setPdfHeight] = useState(700);

  // Read when open, and again whenever the filters change.
  const key = JSON.stringify(query);
  useEffect(() => {
    if (!open || loadedFor === key) return;
    let live = true;
    Promise.all([listProjectsReport(query), listTsmOptions().catch(() => [])])
      .then(([projects, reps]) => {
        if (!live) return;
        setLoaded(enquiryReportRows(projects, reps));
        setLoadedFor(key);
        setError(null);
      })
      .catch(() => live && setError("Couldn't load the report."));
    return () => {
      live = false;
    };
    // `key` is the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, loadedFor]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const ro = new ResizeObserver(() => setFrameWidth(frame.clientWidth - 24)); // less p-3 each side
    ro.observe(frame);
    return () => ro.disconnect();
  }, [open, rows === null]);

  const sheetWidth = view === "pdf" ? PDF_WIDTH : EXCEL_WIDTH;
  const fit = frameWidth > 0 ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, frameWidth / sheetWidth)) : 1;
  const scale = zoom === "fit" ? fit : zoom;
  const step = (d: number) => setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((scale + d) * 10) / 10)));

  // On screen the headings show the sort; the printed copy doesn't.
  const html = useMemo(() => (rows ? buildEnquiryReportHtml(rows, sort, scope) : ""), [rows, sort, scope]);
  const loading = open && loadedFor !== key && !error;

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-line bg-paper">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-[220px] flex-1 items-center gap-3 text-left">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition ${open ? "rotate-90 border-transparent bg-accent text-white" : "border-line text-fg-3"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-fg">Enquiry Report</span>
            <span className="block truncate text-[12px] text-fg-3">
              {open && rows ? `${scope} · ${rows.length} enquiries${loading ? " · updating…" : ""}` : "The list as filtered, every page - PDF or Excel"}
            </span>
          </span>
        </button>

        {open && rows && (
          <div className="flex flex-wrap items-center gap-2">
            {sort && (
              <span className="flex items-center gap-1.5 text-[12px] text-fg-3">
                Sorted by <b className="font-semibold text-fg">{REPORT_COLUMNS.find((c) => c.key === sort.by)?.label}</b>
                {sort.by === "date" ? (sort.dir === "desc" ? "· newest first" : "· oldest first") : sort.dir === "asc" ? "· A to Z" : "· Z to A"}
                <button type="button" onClick={() => setSort(null)} className="rounded-md px-1.5 py-0.5 font-semibold text-accent hover:bg-accent-soft">
                  Clear
                </button>
              </span>
            )}
            <div className="inline-flex rounded-lg border border-line bg-sunk p-0.5" role="group" aria-label="View">
              {(
                [
                  ["pdf", "PDF"],
                  ["excel", "Excel"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-3 py-1 text-[12px] font-semibold ${view === v ? "bg-paper text-fg shadow-sm" : "text-fg-3 hover:text-fg"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 rounded-lg border border-line p-0.5">
              <button type="button" className={zoomBtn} onClick={() => step(-ZOOM_STEP)} disabled={scale <= ZOOM_MIN} aria-label="Zoom out">
                −
              </button>
              <span className="w-11 text-center font-mono text-[12px] font-semibold text-fg">{Math.round(scale * 100)}%</span>
              <button type="button" className={zoomBtn} onClick={() => step(ZOOM_STEP)} disabled={scale >= ZOOM_MAX} aria-label="Zoom in">
                +
              </button>
              <button
                type="button"
                aria-pressed={zoom === "fit"}
                onClick={() => setZoom("fit")}
                className={`ml-0.5 h-7 rounded-md px-2 text-[12px] font-semibold ${zoom === "fit" ? "bg-accent text-white" : "text-fg-3 hover:bg-elev hover:text-fg"}`}
              >
                Fit to screen
              </button>
            </div>
            {view === "pdf" ? (
              <button type="button" className={btn} onClick={() => void printHtml(buildEnquiryReportHtml(rows, undefined, scope), "A3 landscape")}>
                Print / PDF
              </button>
            ) : (
              <button type="button" className={btn} onClick={() => downloadEnquiryReportExcel(rows)}>
                Download Excel
              </button>
            )}
          </div>
        )}
      </div>

      {open && (
        <div className="border-t border-line">
          {error ? (
            <p className="px-4 py-6 text-[13px] text-neg">{error}</p>
          ) : !rows ? (
            <p className="px-4 py-6 text-[13px] text-fg-3">Loading the report…</p>
          ) : (
            // A light sheet in either theme, as it prints.
            <div ref={frameRef} className={`max-h-[75vh] overflow-auto bg-sunk p-3 [scrollbar-gutter:stable] transition-opacity ${loading ? "opacity-60" : ""}`}>
              {view === "pdf" ? (
                // Scaled as a whole; the box takes its scaled size so nothing is cut or left blank.
                <div className="relative mx-auto" style={{ width: PDF_WIDTH * scale, height: pdfHeight * scale }}>
                  <iframe
                    title="Enquiry Report"
                    srcDoc={html}
                    scrolling="no"
                    onLoad={(e) => {
                      const doc = e.currentTarget.contentDocument;
                      if (!doc?.body) return;
                      setPdfHeight(doc.body.offsetHeight);
                      setHeadings(
                        [...doc.querySelectorAll<HTMLElement>("th[data-col]")].map((th) => {
                          const r = th.getBoundingClientRect();
                          return { key: th.dataset.col as ReportSortBy, left: r.left, top: r.top, width: r.width, height: r.height };
                        }),
                      );
                    }}
                    className="pointer-events-none origin-top-left border-0 bg-white shadow-[0_2px_12px_rgba(10,22,40,0.18)]"
                    style={{ width: PDF_WIDTH, height: pdfHeight, transform: `scale(${scale})` }}
                  />
                  {/* The page is a picture; these lie over its sortable headings. */}
                  {headings.map((h) => (
                    <button
                      key={h.key}
                      type="button"
                      onClick={() => sortOn(h.key)}
                      title={`Sort by ${REPORT_COLUMNS.find((c) => c.key === h.key)?.label}`}
                      aria-label={`Sort by ${REPORT_COLUMNS.find((c) => c.key === h.key)?.label}`}
                      className="absolute cursor-pointer hover:bg-[#1F3864]/5"
                      style={{ left: h.left * scale, top: h.top * scale, width: h.width * scale, height: h.height * scale }}
                    />
                  ))}
                </div>
              ) : (
                <ExcelSheet rows={rows} scale={scale} sort={sort} onSort={sortOn} />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** The Excel on screen, as the download has it. */
function ExcelSheet({ rows, scale, sort, onSort }: { rows: EnquiryReportRow[]; scale: number; sort: ReportSort; onSort: (by: ReportSortBy) => void }) {
  const heading = (key: ColumnKey, label: string) => {
    if (!isSortable(key)) return label;
    const on = sort?.by === key;
    return (
      <button type="button" onClick={() => onSort(key)} className="inline-flex w-full items-center justify-center gap-1 hover:underline" title={`Sort by ${label}`}>
        {label}
        <span className={on ? "" : "opacity-40"}>{on ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    );
  };
  return (
    <div className="mx-auto w-max bg-white text-[#1f2937]" style={{ zoom: scale }}>
      <table className="table-fixed border-separate border-spacing-0 text-[12px]" style={{ width: EXCEL_WIDTH }}>
        <colgroup>
          {REPORT_COLUMNS.map((c) => (
            <col key={c.key} style={{ width: c.width * 6.6 }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {REPORT_COLUMNS.map((c) => (
              <th key={c.key} className="sticky top-0 border border-[#c9d3df] bg-[#dcebfb] px-2 py-1.5 text-center text-[11.5px] font-bold text-[#0b3d7e]">
                {heading(c.key, c.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={REPORT_COLUMNS.length} className="border border-[#c9d3df] px-3 py-8 text-center text-[#6b7a8c]">
                No enquiries match the filters.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              {REPORT_COLUMNS.map((c) => (
                <td
                  key={c.key}
                  className={`border border-[#d9dfe7] px-2 py-1 align-top whitespace-pre-line [overflow-wrap:anywhere] ${c.key === "rilRep" || c.key === "enquiryNo" ? "font-semibold" : ""}`}
                >
                  {reportCell(r, c.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
