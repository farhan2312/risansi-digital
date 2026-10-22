// Order Making's Excel report: one row per EC (an SO with no EC yet gets one
// row of its own), the SO's columns repeated on each so the sheet filters
// cleanly. Kept out of the route so the shape can be exercised on its own.
import ExcelJS from "exceljs";
import type { OrderMakingRow } from "@/lib/orders";

const HEAD_BG = "FF1F3864";
const RULE = "FFBFC9D9";

type Cell = string | number | Date | null;

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

const COLUMNS: { header: string; width: number; date?: boolean }[] = [
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
  { header: "EC No.", width: 16 },
  { header: "EC Date", width: 12, date: true },
  { header: "SO Sent to Operation", width: 14, date: true },
  { header: "Assigned Person", width: 18 },
  { header: "Reason for Delay", width: 26 },
  { header: "Remarks", width: 26 },
  { header: "SO Details", width: 11 },
];

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
      ? items.map((i) => [num(i.quantity), text(o.so_no), date(o.so_date), text(i.ec_no), date(i.ec_date)])
      : [[num(o.total_quantity), text(o.so_no), date(o.so_date), null, null]];
    for (const line of lines) {
      const r = ws.addRow([...so, ...line, ...tail]);
      r.alignment = { vertical: "top", wrapText: true };
      const status = r.getCell(COLUMNS.length);
      status.font = { bold: true, color: { argb: filled ? "FF047857" : "FFB45309" } };
    }
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
