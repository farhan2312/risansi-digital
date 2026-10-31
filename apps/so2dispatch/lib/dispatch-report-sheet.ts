import "server-only";
import { C, dispatchReport, orderInHand, type Cell } from "@/lib/dept-report-pdf";
import type { ReportSheet, SheetCell, Tone } from "@/lib/planning-report-sheet";

// Dispatch's report as a sheet — what the Excel holds and what the pop-up's
// Excel view shows: every column of the Dispatch page but Chat and Payment
// terms & PIs, one row per SO. The packing slips and dispatches read as the
// PDF has them; the order value, cell by cell, so the sheet sums.

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const amount = (v: unknown): number | null => (str(v) && Number.isFinite(Number(v)) ? Number(v) : null);

const toneOf = (c: { color?: unknown }): Tone | null =>
  c.color === C.red ? "red" : c.color === C.green ? "green" : c.color === C.amber ? "amber" : c.color === C.blue ? "blue" : null;
const textOf = (c: Cell) => (c.lines ? c.lines.map((l) => l.text).filter(Boolean).join("\n") : c.text);

export function dispatchSheet(rows: Row[], filterLine: string): ReportSheet {
  const r = dispatchReport(rows, filterLine);
  // The PDF's cells, by its column labels.
  const at = (label: string) => r.columns.findIndex((c) => c.label === label);
  const pdf = ["SO No.", "SO date", "Client", "Bill mode", "Slips waiting", "Dispatches", "Dispatch", "Stage"].map(at);
  const [SO, SODATE, CLIENT, BILL, WAITING, DISPATCHES, STATUS, STAGE] = pdf;

  const Col = (label: string, width: number, group: string, numeric = false) => ({ label, width, group, numeric });
  const columns = [
    Col("Sl.", 7, "SO", true),
    Col("SO No.", 18, "SO"),
    Col("SO Date", 12, "SO"),
    Col("Order Type", 12, "SO"),
    Col("Client Name", 30, "SO"),
    Col("Bill Mode", 14, "SO"),
    Col("Slips waiting", 30, "Packing slips & dispatches"),
    Col("Dispatches", 50, "Packing slips & dispatches"),
    Col("Order Value", 14, "Order value details", true),
    Col("Currency", 9, "Order value details"),
    Col("Discount %", 10, "Order value details", true),
    Col("Packing %", 10, "Order value details", true),
    Col("GST %", 8, "Order value details", true),
    Col("Gross Value", 14, "Order value details", true),
    Col("Order in Hand", 14, "Order in hand", true),
    Col("Invoiced", 14, "Order in hand", true),
    Col("Dispatch Status", 16, "Dispatch"),
    Col("Stage", 20, "Dispatch"),
  ];

  return {
    title: r.title,
    filterLine,
    summary: {
      tiles: r.tiles.map((t) => ({ label: t.label, value: Number(t.value) || 0, tone: toneOf(t) ?? undefined })),
      counts: r.breakdown?.line ? [{ label: r.breakdown.label, text: r.breakdown.line }] : [],
    },
    columns,
    rows: rows.map((o, i) => {
      const line = r.rows[i];
      const pick = (k: number): [SheetCell, Tone | null] => {
        const c = line[k];
        return [textOf(c) || null, c.lines?.length ? toneOf(c.lines[0]) : toneOf(c)];
      };
      const hand = orderInHand(o);
      const replacement = !!hand && "replacement" in hand;
      const left = hand && !("replacement" in hand) ? hand : null;
      const cells: [SheetCell, Tone | null][] = [
        [Number(o.sl_no) || str(o.sl_no) || null, null],
        pick(SO),
        pick(SODATE),
        [str(o.order_type) || null, null],
        pick(CLIENT),
        pick(BILL),
        pick(WAITING),
        pick(DISPATCHES),
        [amount(o.order_value), null],
        [str(o.order_currency) || null, null],
        [amount(o.discount_percent), null],
        [amount(o.packing_forwarding_percent), null],
        [amount(o.gst_percent), null],
        [amount(o.taxable_value), null],
        replacement ? ["Replacement", "muted"] : [left ? left.left : null, left && left.left <= 0 ? "green" : null],
        [left ? left.invoiced : null, null],
        pick(STATUS),
        pick(STAGE),
      ];
      return {
        cells: cells.map((c) => c[0]),
        tones: cells.map((c) => c[1]),
        bold: columns.map((c) => c.label === "SO No." || c.label === "Order in Hand"),
      };
    }),
  };
}
