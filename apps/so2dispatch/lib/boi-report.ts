import "server-only";
// Purchase's BOI view as a report: one row per bought-out item, with its SO
// and EC and every column the BOI view shows. The Excel (and the pop-up's
// Excel view) has each figure in its own column; the PDF stacks a number
// with its date, as the page does, to fit A4.

import { boiStatus } from "@/lib/dept-view";
import { C, type Cell, type Report } from "@/lib/dept-report-pdf";
import type { ReportSheet, SheetCell, Tone } from "@/lib/planning-report-sheet";

type Row = Record<string, unknown>;
export type BoiLine = { so: Row; ec: Row; b: Row };

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v: unknown): number | null => (str(v) && Number.isFinite(Number(v)) ? Number(v) : null);
const day = (v: unknown): string => {
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" })
    : "";
};
const money = (v: unknown) => {
  const n = num(v);
  return n === null ? "" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

/** The item's name as the BOI view shows it ("Others" by what was typed). */
export function boiName(b: Row): string {
  const item = str(b.boi_item);
  return item === "Others" ? str(b.boi_item_other) || "Others" : item || "Item";
}

/** The queue's EC rows as the BOI view's lines: each EC's items, under its SO, in the queue's order. */
export function boiLines(rows: Row[], sort: string | null): BoiLine[] {
  const heads = new Map<string, Row>();
  for (const r of rows) if (!heads.has(str(r.order_id))) heads.set(str(r.order_id), r);
  const lines = rows.flatMap((ec) => ((ec.boi_items ?? []) as Row[]).map((b) => ({ so: heads.get(str(ec.order_id)) ?? ec, ec, b })));
  // Sorted by an item's date, or its SO's / EC's, as the BOI view (undated last).
  const key = (sort ?? "").replace("-", "");
  const dateOf: ((x: BoiLine) => unknown) | null = ["ril_po_date", "vendor_so_date", "expected_receipt_date", "receipt_date"].includes(key)
    ? (x) => x.b[key]
    : key === "so_date"
      ? (x) => x.so.so_date
      : key === "ec_date"
        ? (x) => x.ec.ec_date
        : null;
  if (dateOf) {
    const at = (x: BoiLine) => str(dateOf(x)).slice(0, 10);
    lines.sort((x, y) => {
      if (!at(x) || !at(y)) return at(x) ? -1 : at(y) ? 1 : 0;
      return sort!.startsWith("-") ? at(y).localeCompare(at(x)) : at(x).localeCompare(at(y));
    });
  }
  return lines;
}

const STATUS_TONE: Record<string, Tone> = { done: "green", part: "blue", pending: "amber" };
const STATUSES = ["Pending", "Order placed", "Partially received", "Fully received"];

function summary(lines: BoiLine[]) {
  const by = (s: string) => lines.filter((l) => boiStatus(l.b).label === s).length;
  const ordered = lines.filter((l) => l.b.vendor_order === "Yes");
  const value = ordered.reduce((a, l) => a + (num(l.b.total_value) ?? 0), 0);
  return {
    tiles: [
      { label: "BOI items", value: lines.length, tone: undefined as Tone | undefined },
      { label: "SOs", value: new Set(lines.map((l) => str(l.so.order_id ?? l.so.id))).size, tone: undefined as Tone | undefined },
      ...STATUSES.map((s) => ({ label: s, value: by(s), tone: (s === "Fully received" ? "green" : s === "Pending" ? "amber" : "blue") as Tone | undefined })),
    ],
    value,
  };
}

/** Vendor figures only when an order is placed, as the BOI view. */
const vend = (b: Row, v: unknown) => (b.vendor_order === "Yes" ? v : null);

/** The Excel: every BOI view column, a number and its date each in its own column. */
export function boiSheet(lines: BoiLine[], filterLine: string): ReportSheet {
  const s = summary(lines);
  const Col = (label: string, width: number, group: string, numeric = false) => ({ label, width, group, numeric });
  const columns = [
    Col("SO No.", 18, "SO"),
    Col("SO Date", 11, "SO"),
    Col("EC No.", 20, "EC"),
    Col("EC Date", 11, "EC"),
    Col("Item", 22, "Item"),
    Col("Make", 14, "Item"),
    Col("Qty", 7, "Item", true),
    Col("Description", 30, "Item"),
    Col("RIL Allocated", 10, "Item", true),
    Col("Vendor", 24, "Vendor order"),
    Col("Vendor Code", 12, "Vendor order"),
    Col("RIL PO No.", 14, "Vendor order"),
    Col("RIL PO Date", 11, "Vendor order"),
    Col("Vendor SO No.", 14, "Vendor order"),
    Col("Vendor SO Date", 11, "Vendor order"),
    Col("Order Qty", 9, "Vendor order", true),
    Col("Expected", 11, "Vendor order"),
    Col("Rate", 11, "Vendor order", true),
    Col("Total", 13, "Vendor order", true),
    Col("Recd Qty", 9, "Receipt", true),
    Col("Recd Date", 11, "Receipt"),
    Col("Status", 16, "Status"),
  ];
  return {
    title: "Purchase BOI report",
    filterLine,
    summary: { tiles: s.tiles, counts: [{ label: "Ordered value", text: `₹${money(s.value) || 0}` }] },
    columns,
    rows: lines.map(({ so, ec, b }) => {
      const st = boiStatus(b);
      const vendor = b.vendor_order === "Yes";
      const cells: [SheetCell, Tone | null, boolean?][] = [
        [str(so.so_no) || `#${str(so.sl_no)}`, null, true],
        [day(so.so_date) || null, null],
        [str(ec.ec_no) || null, null],
        [day(ec.ec_date) || null, null],
        [boiName(b), null, true],
        [str(b.boi_make) || null, null],
        [num(b.boi_qty), null],
        [str(b.boi_description) || null, null],
        [num(b.stock_allocated_qty), null],
        [vendor ? str(b.vendor_name) || null : "No order", vendor ? null : "muted"],
        [str(vend(b, b.vendor_code)) || null, null],
        [str(vend(b, b.ril_po_no)) || null, null],
        [day(vend(b, b.ril_po_date)) || null, null],
        [str(vend(b, b.vendor_so_no)) || null, null],
        [day(vend(b, b.vendor_so_date)) || null, null],
        [num(vend(b, b.order_qty)), null],
        [day(vend(b, b.expected_receipt_date)) || null, null],
        [num(vend(b, b.rate_per_unit)), null],
        [num(vend(b, b.total_value)), null],
        [num(vend(b, b.received_qty)), null],
        [day(vend(b, b.receipt_date)) || null, null],
        [st.label, STATUS_TONE[st.tone] ?? null, true],
      ];
      return { cells: cells.map((c) => c[0]), tones: cells.map((c) => c[1]), bold: cells.map((c) => !!c[2]) };
    }),
  };
}

/** The PDF: the BOI view's columns on A4, a number with its date under it. */
export function boiReport(lines: BoiLine[], filterLine: string): Report {
  const s = summary(lines);
  const two = (a: string, b: string): Cell => (a || b ? { text: a, lines: [{ text: a || "—" }, ...(b ? [{ text: b, small: true }] : [])] } : { text: "" });
  const statusColor = (tone: string) => (tone === "done" ? C.green : tone === "part" ? C.blue : C.amber);
  // Sums to the page's 770 points.
  const W = [62, 62, 60, 40, 22, 56, 30, 66, 52, 52, 28, 40, 40, 44, 40, 56];
  const labels = ["SO", "EC", "Item", "Make", "Qty", "Description", "RIL Alloc.", "Vendor", "RIL PO", "Vendor SO", "Order Qty", "Expected", "Rate", "Total", "Recd", "Status"];
  return {
    title: "Purchase BOI report",
    filterLine,
    tiles: [...s.tiles.map((t) => ({ label: t.label, value: t.value, color: t.tone === "green" ? C.green : t.tone === "amber" ? C.amber : t.tone === "blue" ? C.blue : undefined })), { label: "Ordered value", value: `Rs ${money(s.value) || 0}` }],
    columns: labels.map((label, i) => ({ label, width: W[i] })),
    empty: "No bought-out items on these SOs.",
    rows: lines.map(({ so, ec, b }) => {
      const vendor = b.vendor_order === "Yes";
      const st = boiStatus(b);
      return [
        { ...two(str(so.so_no) || `#${str(so.sl_no)}`, day(so.so_date)), bold: true },
        two(str(ec.ec_no), day(ec.ec_date)),
        { text: boiName(b), bold: true },
        { text: str(b.boi_make) },
        { text: str(b.boi_qty) },
        { text: str(b.boi_description) },
        { text: str(b.stock_allocated_qty) },
        vendor ? two(str(b.vendor_name), str(b.vendor_code)) : { text: "No order", color: C.muted },
        two(str(vend(b, b.ril_po_no)), day(vend(b, b.ril_po_date))),
        two(str(vend(b, b.vendor_so_no)), day(vend(b, b.vendor_so_date))),
        { text: str(vend(b, b.order_qty)) },
        { text: day(vend(b, b.expected_receipt_date)) },
        { text: money(vend(b, b.rate_per_unit)) },
        { text: money(vend(b, b.total_value)) },
        two(str(vend(b, b.received_qty)), day(vend(b, b.receipt_date))),
        { text: st.label, color: statusColor(st.tone), bold: true },
      ];
    }),
  };
}
