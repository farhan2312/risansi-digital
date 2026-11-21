import "server-only";
import { isUsd } from "@/lib/order-schema";
import { billModeLabel } from "@/lib/order-schema";
import { C, piDispatchText, piReadinessText, piReport, piTermLines, type PiPendency } from "@/lib/dept-report-pdf";
import type { ReportSheet, SheetCell, Tone } from "@/lib/planning-report-sheet";

// Proforma Invoice's report as a sheet — what the Excel holds and what the
// pop-up's Excel view shows: the page's table, one row per SO, its columns as
// on the page (but Chat). The order value, cell by cell, so the sheet sums.

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const amount = (v: unknown): number | null => (str(v) && Number.isFinite(Number(v)) ? Number(v) : null);
const rounded = (v: unknown): number | null => {
  const n = amount(v);
  return n === null ? null : Math.round(n);
};
const day = (v: unknown): string | null => {
  const s = str(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" })
    : null;
};
const stateTone = (s: string): Tone | null =>
  s === "Fully raised" ? "green" : s === "Partially raised" ? "blue" : s === "Pending" || s === "Readiness date awaited" ? "amber" : s ? "muted" : null;
const toneOf = (c: { color?: unknown }): Tone | null =>
  c.color === C.red ? "red" : c.color === C.green ? "green" : c.color === C.amber ? "amber" : c.color === C.blue ? "blue" : null;

export function piSheet(rows: Row[], pendency: Record<string, PiPendency>, filterLine: string): ReportSheet {
  const r = piReport(rows, pendency, filterLine);
  const Col = (label: string, width: number, group: string, numeric = false) => ({ label, width, group, numeric });
  const columns = [
    Col("Sl.", 7, "SO", true),
    Col("SO No.", 18, "SO"),
    Col("SO Date", 12, "SO"),
    Col("Readiness Date", 18, "SO"),
    Col("Order Type", 12, "SO"),
    Col("Client Name", 30, "SO"),
    Col("Bill Mode", 14, "SO"),
    Col("Payment terms & PIs", 46, "Payment terms & PIs"),
    Col("Order Value", 14, "Order value details", true),
    Col("Currency", 9, "Order value details"),
    Col("Discount %", 10, "Order value details", true),
    Col("Packing %", 10, "Order value details", true),
    Col("GST %", 8, "Order value details", true),
    Col("Gross Value (USD)", 14, "Order value details", true),
    Col("Gross Value (INR)", 14, "Order value details", true),
    Col("PI Status", 16, "PI status"),
    Col("Pendency Reason", 30, "PI status"),
    Col("Dispatch Status", 16, "Dispatch"),
  ];
  return {
    title: r.title,
    filterLine,
    summary: {
      tiles: r.tiles.map((t) => ({ label: t.label, value: Number(t.value) || 0, tone: toneOf(t) ?? undefined })),
      counts: [],
    },
    columns,
    rows: rows.map((o) => {
      const st = str(o.billing_state) || "Pending";
      const p = pendency[str(o.id)];
      const ready = piReadinessText(o);
      const terms = piTermLines(o);
      const ds = piDispatchText(o);
      const cells: [SheetCell, Tone | null][] = [
        [Number(o.sl_no) || str(o.sl_no) || null, null],
        [str(o.so_no) || `#${str(o.sl_no)}`, null],
        [day(o.so_date), null],
        [[ready, str(o.readiness_status)].filter(Boolean).join("\n") || null, null],
        [str(o.order_type) || null, null],
        [str(o.client_name) || null, null],
        [billModeLabel(null, o.bill_type as string | null) || null, null],
        // Each term line, its PI on the next line.
        [terms.map((l) => (l.small ? `   ${l.text}` : l.text)).join("\n") || null, null],
        [amount(o.order_value), null],
        [str(o.order_currency) || null, null],
        [amount(o.discount_percent), null],
        [amount(o.packing_forwarding_percent), null],
        [amount(o.gst_percent), null],
        [isUsd(o.order_currency) ? rounded(o.gross_value_usd) : null, null],
        [rounded(o.taxable_value), null],
        [st, stateTone(st)],
        [p ? [p.reason, p.remarks].filter(Boolean).join(" · ") : null, p ? "red" : null],
        [ds, ds === "Fully dispatch" ? "green" : ds.startsWith("LOT dispatch") ? "blue" : ds === "Not at Dispatch yet" ? "muted" : "amber"],
      ];
      return {
        cells: cells.map((c) => c[0]),
        tones: cells.map((c) => c[1]),
        bold: columns.map((c) => c.label === "SO No." || c.label === "PI Status"),
      };
    }),
  };
}
