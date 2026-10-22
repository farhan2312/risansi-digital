// Order Making's Excel report: one row per EC (an SO with no EC yet gets one
// row of its own), the SO's columns repeated on each so the sheet filters
// cleanly. Kept out of the route so the shape can be exercised on its own.
import ExcelJS from "exceljs";
import { listOrdersForOrderMaking, type OrderMakingRow } from "@/lib/orders";
import { parseQuery } from "@/lib/pagination";
import { isOrderMakingFiltered, parseOrderMakingFilter } from "@/lib/order-making-filter";
import { isOrderMakingSo } from "@/lib/roles";

const HEAD_BG = "FF1F3864";
const RULE = "FFBFC9D9";

export type Cell = string | number | Date | null;

function text(v: unknown): string | null {
  return v == null || String(v).trim() === "" ? null : String(v);
}
function date(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const COLUMNS: { header: string; width: number; date?: boolean }[] = [
  { header: "PO Receiving Date", width: 14, date: true },
  { header: "Client Code", width: 13 },
  { header: "Client Name", width: 34 },
  { header: "Rep", width: 18 },
  { header: "Zone", width: 10 },
  { header: "Order Type", width: 11 },
  { header: "Bill Mode", width: 15 },
  { header: "Purchase Order No.", width: 20 },
  { header: "Complaint No.", width: 15 },
  { header: "Item Qty", width: 9 },
  { header: "SO No.", width: 16 },
  { header: "SO Date", width: 12, date: true },
  { header: "File No.", width: 14 },
  { header: "EC No.", width: 16 },
  { header: "EC Date", width: 12, date: true },
  { header: "SO Sent to Operation", width: 14, date: true },
  { header: "Assigned Person", width: 18 },
  { header: "Reason for Delay", width: 26 },
  { header: "Remarks", width: 26 },
  { header: "SO Details", width: 11 },
];

/** One line per EC (or per SO with none): its cells, and whether the SO details are filled. */
export function orderMakingReportLines(rows: OrderMakingRow[]): { cells: Cell[]; filled: boolean }[] {
  const out: { cells: Cell[]; filled: boolean }[] = [];
  for (const o of rows) {
    const filled = (o.so_missing ?? []).length === 0;
    const so: Cell[] = [
      date(o.po_received_date),
      text(o.client_code),
      text(o.client_name),
      text(o.reps),
      text(o.zone),
      text(o.order_type),
      text(o.bill_mode),
      text(o.po_no),
      text(o.complaint_no),
    ];
    const tail: Cell[] = [
      date(o.ec_sent_operation_date),
      text(o.so_assignee_name),
      text(o.om_hold_reason),
      text(o.om_hold_remarks),
      filled ? "Filled" : "Pending",
    ];
    const items = o.items ?? [];
    const lines = items.length
      ? items.map((i) => [num(i.quantity), text(o.so_no), date(o.so_date), text(o.file_no), text(i.ec_no), date(i.ec_date)])
      : [[num(o.total_quantity), text(o.so_no), date(o.so_date), text(o.file_no), null, null]];
    for (const line of lines) out.push({ cells: [...so, ...line, ...tail], filled });
  }
  return out;
}

/**
 * The report as the page has it filtered and searched, every page. An Order
 * Making SO member gets only the SOs assigned to them, as on the page.
 */
export async function loadOrderMakingReport(
  user: { id: string; role: string },
  get: (key: string) => string | undefined
): Promise<{ rows: OrderMakingRow[]; scope: string; filtered: boolean; today: string }> {
  const filter = parseOrderMakingFilter(get);
  const soMember = isOrderMakingSo(user.role);
  const search = parseQuery(get("q"));
  const { rows } = await listOrdersForOrderMaking({
    page: 1,
    all: true,
    search,
    filter: soMember ? { ...filter, assignees: [] } : filter,
    assigneeScope: soMember ? user.id : undefined,
  });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const filtered = isOrderMakingFiltered(filter) || !!search;
  const scope = `${filtered ? "filtered view" : "all SOs"}${search ? ` matching "${search}"` : ""} · ${rows.length} SOs · ${today}`;
  return { rows, scope, filtered, today };
}

export function buildOrderMakingWorkbook(rows: OrderMakingRow[], scope: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risansi SO to Dispatch";
  wb.created = new Date();
  const ws = wb.addWorksheet("Order Making", { views: [{ state: "frozen", ySplit: 2 }] });

  // A line saying what the sheet holds, then the header.
  const title = ws.addRow([`Order Making report — ${scope}`]);
  title.font = { bold: true, size: 12 };
  ws.mergeCells(1, 1, 1, COLUMNS.length);

  const head = ws.addRow(COLUMNS.map((c) => c.header));
  head.height = 30;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  COLUMNS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width;
    if (c.date) col.numFmt = "dd-mmm-yyyy";
  });

  for (const { cells, filled } of orderMakingReportLines(rows)) {
    const r = ws.addRow(cells);
    r.alignment = { vertical: "top", wrapText: true };
    r.getCell(COLUMNS.length).font = { bold: true, color: { argb: filled ? "FF047857" : "FFB45309" } };
  }

  const last = ws.rowCount;
  for (let r = 2; r <= last; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: RULE } },
        bottom: { style: "thin", color: { argb: RULE } },
        left: { style: "thin", color: { argb: RULE } },
        right: { style: "thin", color: { argb: RULE } },
      };
    });
  }
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: Math.max(2, last), column: COLUMNS.length } };
  return wb;
}
