// "One Click": everything the Export workbook holds, on a single sheet — a
// row per EC (an SO with no EC yet gets one row of its own), its SO's details
// repeated on each so the sheet filters cleanly, each department's own fields
// beside it, and each list (payment terms, PIs, invoices, packing slips,
// drawing versions, bought-out items) as one cell, a line per entry.

import ExcelJS from "exceljs";
import type { OrderExportRow } from "@/lib/orders";
import { SECTION_BY_TABLE, type OrderField, type OrderFieldType, type OrderTable } from "@/lib/order-schema";
import { boiStatus, versionLabel } from "@/lib/dept-view";

type Row = Record<string, unknown>;
export type OneCell = string | number | Date | null;

export type OneColumn = { label: string; type: OrderFieldType | "list" };
export type OneGroup = { name: string; columns: OneColumn[] };
export type OneSheet = { groups: OneGroup[]; rows: OneCell[][] };

const str = (v: unknown) => (v == null ? "" : String(v).trim());

function cell(source: Row | null | undefined, f: OrderField): OneCell {
  const raw = source?.[f.column];
  if (raw == null || raw === "") return null;
  if (f.type === "date") {
    const d = new Date(String(raw).slice(0, 10));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (f.type === "int" || f.type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return String(raw);
}

/** A section's fields, without the keys the sheet already leads with. */
function fieldsOf(table: OrderTable): OrderField[] {
  return (SECTION_BY_TABLE.get(table)?.fields ?? []).filter((f) => f.column !== "so_no" && f.column !== "ec_no");
}

const day = (v: unknown) => {
  const s = str(v).slice(0, 10);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};
const money = (v: unknown) => (str(v) === "" ? "" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const lines = (xs: string[]) => (xs.length ? xs.join("\n") : null);
const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");

/** Each list as one cell, a line per entry. */
const LISTS: { name: string; perEc: boolean; text: (so: OrderExportRow, item: OrderExportRow["items"][number] | null) => string | null }[] = [
  {
    name: "Payment terms",
    perEc: false,
    text: (so) => lines(so.order_payment_terms.map((t) => join(`${str(t.percent)}%`, str(t.term), str(t.days) ? `${str(t.days)} days` : ""))),
  },
  {
    name: "PIs",
    perEc: false,
    text: (so) => lines(so.order_billing_docs.map((d) => join(str(d.pi_no), day(d.pi_date), money(d.pi_value)))),
  },
  {
    name: "Invoices",
    perEc: false,
    text: (so) =>
      lines(
        so.order_invoices.map((v) =>
          join(str(v.invoice_no), day(v.invoice_date), money(v.invoice_value), str(v.invoice_quantity) ? `Qty ${str(v.invoice_quantity)}` : "", str(v.packing_slip_no) ? `Slip ${str(v.packing_slip_no)}` : "")
        )
      ),
  },
  {
    name: "Packing slips",
    perEc: false,
    text: (so) =>
      lines(
        so.order_packing_slips
          .filter((p) => str(p.packing_slip_no))
          .map((p) => join(str(p.packing_slip_no), day(p.packing_slip_date), str(p.quantity) ? `Qty ${str(p.quantity)}` : ""))
      ),
  },
  {
    name: "Drawing versions",
    perEc: true,
    text: (_so, item) => {
      if (!item) return null;
      const byDoc = new Map<string, Row[]>();
      for (const rv of item.order_drawing_revisions) {
        const d = str(rv.doc_type) || "GAD";
        byDoc.set(d, [...(byDoc.get(d) ?? []), rv]);
      }
      return lines(
        [...byDoc].flatMap(([doc, rows]) =>
          rows
            .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
            .map((rv, i) =>
              join(
                `${doc} ${versionLabel(i + 1)}`,
                str(rv.issued_to_client).toLowerCase() === "yes" ? `Sent ${day(rv.issued_to_client_date)}` : "Not sent",
                str(rv.approved).toLowerCase() === "yes" ? `Approved ${day(rv.approved_date)}` : str(rv.approved).toLowerCase() === "no" ? "Resubmit" : "",
                str(rv.issued_to_production).toLowerCase() === "yes" ? `To planning ${day(rv.issued_to_production_date)}` : ""
              )
            )
        )
      );
    },
  },
  {
    name: "Bought-out items",
    perEc: true,
    text: (_so, item) =>
      item
        ? lines(
            item.order_boi_items.map((b) =>
              join(
                str(b.boi_item) === "Others" ? str(b.boi_item_other) || "Others" : str(b.boi_item) || "Item",
                str(b.boi_qty) ? `×${str(b.boi_qty)}` : "",
                str(b.boi_make),
                boiStatus(b).label,
                b.vendor_order === "Yes" && str(b.vendor_name) ? str(b.vendor_name) : ""
              )
            )
          )
        : null,
  },
];

/** The sheet's columns, group by group, and a row per EC (or per SO with none). */
export function buildOneSheet(orders: OrderExportRow[]): OneSheet {
  const order = [
    ...fieldsOf("orders"),
    { column: "order_status", label: "Order Status", type: "text" as OrderFieldType },
  ];
  const ec = fieldsOf("order_items");
  const planning = fieldsOf("order_planning");
  const quality = fieldsOf("order_qc");
  const assembly = fieldsOf("order_assembly_dispatch");
  const accounts = fieldsOf("order_accounts");
  const groups: OneGroup[] = [
    { name: "SO", columns: [{ label: "Sl. No.", type: "int" }, { label: "SO No.", type: "text" }, { label: "EC No.", type: "text" }] },
    { name: "Order details", columns: order.map((f) => ({ label: f.label, type: f.type })) },
    { name: "EC", columns: ec.map((f) => ({ label: f.label, type: f.type })) },
    { name: "Drawing", columns: [{ label: "Drawing versions", type: "list" }] },
    { name: "Purchase", columns: [{ label: "Bought-out items", type: "list" }] },
    { name: "Quality", columns: quality.map((f) => ({ label: f.label, type: f.type })) },
    { name: "Planning", columns: planning.map((f) => ({ label: f.label, type: f.type })) },
    { name: "Assembly & Packing", columns: [...assembly.map((f) => ({ label: f.label, type: f.type })), { label: "Packing slips", type: "list" as const }] },
    {
      name: "Proforma Invoice & Accounts",
      columns: [{ label: "Payment terms", type: "list" }, { label: "PIs", type: "list" }, ...accounts.map((f) => ({ label: f.label, type: f.type }))],
    },
    { name: "Dispatch", columns: [{ label: "Invoices", type: "list" }] },
  ];
  const list = (name: string, so: OrderExportRow, item: OrderExportRow["items"][number] | null) =>
    LISTS.find((l) => l.name === name)!.text(so, item);

  const rows: OneCell[][] = [];
  for (const so of orders) {
    const o = { ...so.order, order_status: so.order.status_override ?? so.order.dispatch_status ?? "Pending" } as Row;
    const items = so.items.length ? so.items : [null];
    for (const item of items) {
      rows.push([
        Number(o.sl_no ?? null) || null,
        str(o.so_no) || null,
        item ? str(item.item.ec_no) || null : null,
        ...order.map((f) => cell(o, f)),
        ...ec.map((f) => cell(item?.item, f)),
        list("Drawing versions", so, item),
        list("Bought-out items", so, item),
        ...quality.map((f) => cell(item?.order_qc, f)),
        ...planning.map((f) => cell(item?.order_planning, f)),
        ...assembly.map((f) => cell(item?.order_assembly_dispatch, f)),
        list("Packing slips", so, item),
        list("Payment terms", so, item),
        list("PIs", so, item),
        ...accounts.map((f) => cell(so.order_accounts, f)),
        list("Invoices", so, item),
      ]);
    }
  }
  return { groups, rows };
}

const GROUP_COLORS = ["FF1F3864", "FF2F5496", "FF385723", "FF7F6000", "FF843C0C", "FF5B2C6F", "FF0B5563", "FF7B3F00", "FF1F4E79", "FF3A3A3A"];
const RULE = "FFBFC9D9";
const KEY_BG = "FFEAF0F8";

/** The sheet as Excel: a title, the groups over their columns, frozen keys, filters, wrapped lists. */
export function buildOneClickWorkbook(sheet: OneSheet, scope: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risansi SO to Dispatch";
  wb.created = new Date();
  const ws = wb.addWorksheet("One Click", { views: [{ state: "frozen", xSplit: 3, ySplit: 3 }] });
  const cols = sheet.groups.flatMap((g) => g.columns);
  const total = cols.length;

  const title = ws.addRow([`Order-to-Dispatch — one sheet · ${scope} · ${sheet.rows.length} rows (one per EC)`]);
  title.font = { bold: true, size: 13, color: { argb: "FF1F3864" } };
  title.height = 24;
  ws.mergeCells(1, 1, 1, total);

  const groupRow = ws.addRow(sheet.groups.flatMap((g) => g.columns.map(() => g.name)));
  const head = ws.addRow(cols.map((c) => c.label));
  let at = 1;
  sheet.groups.forEach((g, gi) => {
    const end = at + g.columns.length - 1;
    if (end > at) ws.mergeCells(2, at, 2, end);
    for (let c = at; c <= end; c++) {
      const color = GROUP_COLORS[gi % GROUP_COLORS.length];
      for (const r of [groupRow, head]) {
        const x = r.getCell(c);
        x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
        x.font = { bold: true, color: { argb: "FFFFFFFF" }, size: r === head ? 10 : 11 };
        x.alignment = { vertical: "middle", horizontal: r === head ? "left" : "center", wrapText: true };
        x.border = { left: { style: "thin", color: { argb: "FFFFFFFF" } } };
      }
    }
    at = end + 1;
  });
  groupRow.height = 20;
  head.height = 40;

  for (const values of sheet.rows) {
    const row = ws.addRow(values);
    row.alignment = { vertical: "top", wrapText: true };
    for (let c = 1; c <= 3; c++) {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: KEY_BG } };
      if (c === 2) row.getCell(c).font = { bold: true };
    }
    cols.forEach((col, i) => {
      const x = row.getCell(i + 1);
      if (x.value == null) return;
      if (col.type === "date") x.numFmt = "dd-mmm-yyyy";
      else if (col.type === "number") x.numFmt = "#,##0.00";
      else if (col.type === "int") x.numFmt = "0";
    });
  }

  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = i === 0 ? 7 : i < 3 ? 17 : c.type === "list" ? 38 : Math.min(28, Math.max(11, c.label.length * 0.85));
  });
  for (let r = 3; r <= ws.rowCount; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (x, c) => {
      if (c > total) return;
      const edge = { style: "thin" as const, color: { argb: RULE } };
      x.border = { top: edge, bottom: edge, left: edge, right: edge };
    });
  }
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, ws.rowCount), column: total } };
  return wb;
}
