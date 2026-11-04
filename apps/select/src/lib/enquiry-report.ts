// The Enquiries page's report for the User Master (user, 2026-11-04): one row per
// enquiry, in the user's column order, as a sheet to print or as an Excel. Client-safe.
import { holdReasonText } from "./clearance";
import type { TsmOption } from "./commercial";
import { orderTypeLabel } from "./roles";
import { LETTERHEAD_CSS, dotDate, esc, letterheadHtml } from "./tech-doc";
import { BAND, TITLE_BAND } from "./tech-doc-excel";
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
  category: string;
  enquiryNo: string;
  assignee: string;
  remark: string;
  onHold: boolean;
};

type TextKey = "rilRep" | "client" | "type" | "date" | "category" | "enquiryNo" | "assignee" | "remark";
type ColumnKey = TextKey | "status";

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

export function enquiryReportRows(projects: ProjectRecord[], reps: TsmOption[]): EnquiryReportRow[] {
  return projects.map((p) => {
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
      category: orderTypeLabel(p.order_type),
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

export const reportCell = (r: EnquiryReportRow, key: ColumnKey): string =>
  key === "status" ? r.statuses.map((s) => (s.label ? `${s.label}: ${s.value}` : s.value)).join("\n") : r[key];

export const reportCounts = (rows: EnquiryReportRow[]): { label: string; value: number }[] => {
  const count = (test: (r: EnquiryReportRow) => boolean) => rows.filter(test).length;
  return [
    { label: "Enquiries", value: rows.length },
    { label: "Pump", value: count((r) => r.category === "Pump") },
    { label: "Spare", value: count((r) => r.category === "Spare") },
    { label: "Domestic", value: count((r) => /domestic/i.test(r.type)) },
    { label: "Export", value: count((r) => /export/i.test(r.type)) },
    { label: "On hold", value: count((r) => r.onHold) },
  ];
};

const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const statusClass = (s: string) => (s === "Completed" ? "done" : s === "In Progress" ? "going" : "waiting");

/** The printed report: letterhead, title band, counts, then the table, its heading
 *  repeated on every page. */
export function buildEnquiryReportHtml(rows: EnquiryReportRow[], scope: string, logoUrl = "/logo.png"): string {
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
  ${LETTERHEAD_CSS}
  .band { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-top: 10px; padding: 11px 14px; border-radius: 6px 6px 0 0; color: #fff; background: linear-gradient(90deg, #06408c, #1e6fd0); }
  .band h1 { margin: 0; font-size: 15pt; letter-spacing: 0.02em; }
  .band p { margin: 0; font-size: 8.5pt; color: #dcebfb; text-align: right; }
  .counts { display: flex; flex-wrap: wrap; gap: 6px 22px; padding: 8px 14px; background: #f4f8fd; border: 1px solid #dcebfb; border-top: 0; font-size: 8.5pt; color: #4b5b6e; }
  .counts b { margin-left: 4px; font-size: 10.5pt; color: #06408c; }
  table { width: 100%; margin-top: 8px; border-collapse: collapse; table-layout: fixed; font-size: 8pt; }
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
  .empty { padding: 28px; text-align: center; color: #6b7a8c; }
</style></head>
<body><div class="sheet">
  ${letterheadHtml(logoUrl)}
  <div class="band"><h1>Enquiry Report</h1><p>${esc(scope)}<br>Generated ${esc(dotDate(todayIst()))}</p></div>
  <div class="counts">${reportCounts(rows)
    .map((c) => `<span>${esc(c.label)}<b>${c.value}</b></span>`)
    .join("")}</div>
  <table>
    <colgroup>${REPORT_COLUMNS.map((c) => `<col style="width:${c.pct}%">`).join("")}</colgroup>
    <thead><tr>${REPORT_COLUMNS.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>
    <tbody>${
      rows.length
        ? rows.map((r) => `<tr>${REPORT_COLUMNS.map((c) => `<td>${cell(r, c.key)}</td>`).join("")}</tr>`).join("\n")
        : `<tr><td class="empty" colspan="${REPORT_COLUMNS.length}">No enquiries match the filters.</td></tr>`
    }</tbody>
  </table>
</div></body></html>`;
}

export function downloadEnquiryReportExcel(rows: EnquiryReportRow[], scope: string): void {
  const cols = REPORT_COLUMNS.length;
  const sheetRows: XlsxCell[][] = [
    [{ value: "Enquiry Report", colSpan: cols, ...TITLE_BAND }],
    [{ value: `${scope} - ${rows.length} enquiries - generated ${dotDate(todayIst())}`, colSpan: cols }],
    REPORT_COLUMNS.map((c) => ({ value: c.label, wrap: true, ...BAND })),
    ...rows.map((r) => REPORT_COLUMNS.map((c): XlsxCell => ({ value: reportCell(r, c.key), wrap: true, bold: c.key === "rilRep" || c.key === "enquiryNo" }))),
  ];
  downloadXlsx(`Enquiry-Report_${todayIst()}.xlsx`, [{ name: "Enquiry Report", columnWidths: REPORT_COLUMNS.map((c) => c.width), rows: sheetRows }]);
}
