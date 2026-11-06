// The Enquiries page's report for the User Master (user, 2026-11-04): one row per
// enquiry, in the user's column order, as a sheet to print or as an Excel. Client-safe.
import { holdReasonText } from "./clearance";
import type { TsmOption } from "./commercial";
import { orderSubtypeLabel, orderTypeLabel } from "./roles";
import { dotDate, esc } from "./tech-doc";
import { BAND } from "./tech-doc-excel";
import { downloadXlsx, type XlsxCell } from "./xlsx";
import type { ProjectRecord } from "../services/projectService";

export type EnquiryReportRow = {
  id: string;
  rilRep: string;
  client: string;
  type: string;
  /** Technical and Commercial; a spare has just its one status, with no label. */
  statuses: { label: string | null; value: string }[];
  date: string;
  /** YYYY-MM-DD, or "" when there is none: what the date sort goes by. */
  sortDate: string;
  category: string;
  enquiryNo: string;
  assignee: string;
  remark: string;
  onHold: boolean;
};

type TextKey = "rilRep" | "client" | "type" | "date" | "category" | "enquiryNo" | "assignee" | "remark";
export type ColumnKey = TextKey | "status";

/** pct: share of the printed sheet's width. width: the Excel's, in characters. */
export const REPORT_COLUMNS: { key: ColumnKey; label: string; pct: number; width: number }[] = [
  { key: "rilRep", label: "RIL Rep.", pct: 7, width: 11 },
  { key: "client", label: "Client Name", pct: 21, width: 38 },
  { key: "type", label: "Enquiry Type (Domestic / Export)", pct: 8, width: 13 },
  { key: "status", label: "Enquiry Status", pct: 14, width: 24 },
  { key: "date", label: "Enquiry Date", pct: 7, width: 12 },
  { key: "category", label: "Product Category", pct: 7, width: 11 },
  { key: "enquiryNo", label: "Enq. No.", pct: 12, width: 22 },
  { key: "assignee", label: "Assign Person", pct: 9, width: 18 },
  { key: "remark", label: "Detail Remark", pct: 15, width: 40 },
];

const ZONE_CODES: Record<string, string> = { north: "NI", south: "SI", east: "EI", west: "WI", central: "CI", export: "EX" };

const zoneCode = (zone: string | null | undefined): string => {
  const z = (zone ?? "").trim();
  return z ? (ZONE_CODES[z.toLowerCase()] ?? z.toUpperCase()) : "";
};

/** "WI_SV": the zone's code and the rep's initials. The client's primary rep, else the
 *  TSM on the enquiry's quotation (picked by hand when a client has no rep). */
function rilRep(p: ProjectRecord, reps: TsmOption[]): string {
  const name = (p.client_primary_rep ?? "").trim();
  const known = name ? reps.find((r) => r.name.toLowerCase() === name.toLowerCase()) : undefined;
  const initials = known?.initials ?? (name ? name.split(/\s+/).map((w) => w[0]!.toUpperCase()).join("").slice(0, 5) : (p.quotation_tsm?.initials ?? ""));
  return [zoneCode(p.client_zone || known?.zone || p.quotation_tsm?.zone), initials].filter(Boolean).join("_");
}

/** Test enquiries stay off the report: "test" as a word in the client name or enquiry
 *  no. (test, test-spare, RIL/EN/26-27/test). They stay in the Enquiries list. */
const isTestEnquiry = (p: ProjectRecord): boolean => [p.name, p.project_code].some((v) => /(^|[^a-z])test([^a-z]|$)/i.test(v ?? ""));

export function enquiryReportRows(projects: ProjectRecord[], reps: TsmOption[]): EnquiryReportRow[] {
  return projects.filter((p) => !isTestEnquiry(p)).map((p) => {
    const c = p.clearance;
    const onHold = c?.status === "Hold";
    const spare = p.order_type === "spare";
    return {
      id: p.id,
      rilRep: rilRep(p, reps),
      client: p.name ?? "",
      type: p.client_market_type?.trim() ?? "",
      statuses: spare
        ? [{ label: null, value: p.status ?? "Pending" }]
        : [
            { label: "Technical", value: p.status ?? "Pending" },
            { label: "Commercial", value: p.commercial_status ?? "Pending" },
          ],
      date: dotDate(p.enquiry_date),
      sortDate: p.enquiry_date ?? "",
      // A retrofit spare says so; a plain spare and every pump keep Spare / Pump.
      category: spare && p.order_subtype === "retrofit_spare" ? orderSubtypeLabel(p.order_subtype) : orderTypeLabel(p.order_type),
      enquiryNo: p.project_code,
      assignee: p.assigned_to_name ?? "",
      remark: [
        onHold ? `Hold: ${holdReasonText(c?.group, c?.reason) || "no reason given"}` : null,
        c?.remarks,
        p.revision_note ? `Revision: ${p.revision_note}` : null,
        p.remarks,
      ]
        .map((x) => x?.trim())
        .filter(Boolean)
        .join("\n"),
      onHold,
    };
  });
}

/** The columns the report sorts on, by clicking their heading (user, 2026-11-06). */
export const SORTABLE_COLUMNS = ["rilRep", "client", "assignee", "date"] as const;
export type ReportSortBy = (typeof SORTABLE_COLUMNS)[number];
export type ReportSortDir = "asc" | "desc";
export type ReportSort = { by: ReportSortBy; dir: ReportSortDir } | null;
export const isSortable = (key: ColumnKey): key is ReportSortBy => (SORTABLE_COLUMNS as readonly string[]).includes(key);
/** A first click: names A to Z, dates newest first. */
export const firstSortDir = (by: ReportSortBy): ReportSortDir => (by === "date" ? "desc" : "asc");

/** The report in the order picked (null = as the Enquiries list has it). Blanks go last
 *  either way, and rows that tie run newest first. */
export function sortReportRows(rows: EnquiryReportRow[], sort: ReportSort): EnquiryReportRow[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  const byDate = (a: EnquiryReportRow, b: EnquiryReportRow, s: number) =>
    !a.sortDate || !b.sortDate ? Number(!a.sortDate) - Number(!b.sortDate) : s * a.sortDate.localeCompare(b.sortDate);
  return [...rows].sort((a, b) => {
    if (sort.by === "date") return byDate(a, b, sign);
    const [x, y] = [a[sort.by].trim(), b[sort.by].trim()];
    if (!x || !y) return Number(!x) - Number(!y) || byDate(a, b, -1);
    return sign * x.localeCompare(y, undefined, { sensitivity: "base" }) || byDate(a, b, -1);
  });
}

export const reportCell = (r: EnquiryReportRow, key: ColumnKey): string =>
  key === "status" ? r.statuses.map((s) => (s.label ? `${s.label}: ${s.value}` : s.value)).join("\n") : r[key];

const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const statusClass = (s: string) => (s === "Completed" || s === "Sent to client" ? "done" : s === "In Progress" ? "going" : s === "Not Quoted" ? "closed" : "waiting");

/** The printed report: just the table, its heading repeated on every page. On screen
 *  (`sort` given) the sortable headings carry an arrow; what prints has none. */
export function buildEnquiryReportHtml(rows: EnquiryReportRow[], sort?: ReportSort): string {
  const heading = (key: ColumnKey, label: string) => {
    if (sort === undefined || !isSortable(key)) return `<th>${esc(label)}</th>`;
    const on = sort?.by === key;
    return `<th data-col="${key}">${esc(label)} <span class="arrow${on ? " on" : ""}">${on ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span></th>`;
  };
  const cell = (r: EnquiryReportRow, key: ColumnKey): string => {
    if (key === "status")
      return r.statuses
        .map((s) => `<div class="st">${s.label ? `<span class="st-l">${esc(s.label)}</span>` : ""}<span class="pill ${statusClass(s.value)}">${esc(s.value)}</span></div>`)
        .join("");
    if (key === "client") return `<b>${esc(r.client)}</b>`;
    if (key === "enquiryNo") return `<span class="no">${esc(r.enquiryNo)}</span>`;
    if (key === "rilRep") return `<b class="rep">${esc(r.rilRep) || "-"}</b>`;
    return esc(r[key]) || (key === "remark" ? "" : "-");
  };
  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Enquiry Report ${esc(dotDate(todayIst()))}</title>
<style>
  @page { margin: 8mm; }
  * { box-sizing: border-box; }
  html { color-scheme: light; }
  body { margin: 0; padding: 12px; background: #fff; font-family: Arial, Helvetica, sans-serif; color: #1f2937; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print { body { padding: 0; } }
  .sheet { max-width: 1100px; margin: 0 auto; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8pt; }
  thead { display: table-header-group; }
  th { padding: 6px 5px; background: #0b2f63; color: #fff; font-size: 7.5pt; font-weight: bold; text-align: left; vertical-align: bottom; border: 1px solid #0b2f63; }
  td { padding: 5px; border: 1px solid #d5deea; vertical-align: top; overflow-wrap: anywhere; white-space: pre-line; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #f8fafd; }
  .rep, .no { color: #06408c; }
  .no { font-family: Consolas, Menlo, monospace; font-weight: bold; }
  .st { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; }
  .st + .st { margin-top: 3px; }
  .st-l { width: 100%; font-size: 6.8pt; color: #6b7a8c; }
  .pill { padding: 1px 6px; border-radius: 9px; font-size: 7.3pt; font-weight: bold; white-space: nowrap; }
  .done { background: #dcf5e6; color: #11703d; }
  .going { background: #dcebfb; color: #0b4ea2; }
  .waiting { background: #fdf0d5; color: #9a6400; }
  .closed { background: #e9edf2; color: #4b5a6b; }
  .empty { padding: 28px; text-align: center; color: #6b7a8c; }
  .arrow { font-size: 7pt; opacity: 0.45; }
  .arrow.on { opacity: 1; color: #ffd166; }
</style></head>
<body><div class="sheet">
  <table>
    <colgroup>${REPORT_COLUMNS.map((c) => `<col style="width:${c.pct}%">`).join("")}</colgroup>
    <thead><tr>${REPORT_COLUMNS.map((c) => heading(c.key, c.label)).join("")}</tr></thead>
    <tbody>${
      rows.length
        ? rows.map((r) => `<tr>${REPORT_COLUMNS.map((c) => `<td>${cell(r, c.key)}</td>`).join("")}</tr>`).join("\n")
        : `<tr><td class="empty" colspan="${REPORT_COLUMNS.length}">No enquiries match the filters.</td></tr>`
    }</tbody>
  </table>
</div></body></html>`;
}

export function downloadEnquiryReportExcel(rows: EnquiryReportRow[]): void {
  const sheetRows: XlsxCell[][] = [
    REPORT_COLUMNS.map((c) => ({ value: c.label, wrap: true, ...BAND })),
    ...rows.map((r) => REPORT_COLUMNS.map((c): XlsxCell => ({ value: reportCell(r, c.key), wrap: true, bold: c.key === "rilRep" || c.key === "enquiryNo" }))),
  ];
  downloadXlsx(`Enquiry-Report_${todayIst()}.xlsx`, [{ name: "Enquiry Report", columnWidths: REPORT_COLUMNS.map((c) => c.width), printA3Landscape: true, rows: sheetRows }]);
}
