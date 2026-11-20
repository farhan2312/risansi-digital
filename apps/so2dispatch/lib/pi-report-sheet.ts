import "server-only";
import { orderTypeText, isUsd } from "@/lib/order-schema";
import { C, piReport, piTermText, type PiPendency } from "@/lib/dept-report-pdf";
import type { ReportSheet, SheetCell, Tone } from "@/lib/planning-report-sheet";

// Proforma Invoice's report as a sheet — what the Excel holds and what the
// pop-up's Excel view shows: one row per PI (an SO with none yet, one row),
// the SO's columns repeated, greyed, on its later PIs, so each SO reads as one
// and the sheet still filters and sums.

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
  s === "Fully raised" ? "green" : s === "Partially raised" ? "blue" : s === "Pending" ? "amber" : s ? "muted" : null;
const toneOf = (c: { color?: unknown }): Tone | null =>
  c.color === C.red ? "red" : c.color === C.green ? "green" : c.color === C.amber ? "amber" : c.color === C.blue ? "blue" : null;

export function piSheet(rows: Row[], pendency: Record<string, PiPendency>, filterLine: string): ReportSheet {
  const r = piReport(rows, pendency, filterLine);
  const Col = (label: string, width: number, group: string, numeric = false) => ({ label, width, group, numeric });
  const columns = [
    Col("Sl.", 7, "SO", true),
    Col("SO No.", 18, "SO"),
    Col("SO Date", 12, "SO"),
    Col("Order Type", 12, "SO"),
    Col("Client Name", 30, "SO"),
    Col("Bill Mode", 14, "SO"),
    Col("Payment Terms", 30, "SO"),
    Col("Currency", 9, "Order value"),
    Col("Gross Value (USD)", 14, "Order value", true),
    Col("Gross Value (INR)", 14, "Order value", true),
    Col("PI Status", 15, "Order value"),
    Col("Payment Term", 26, "PI"),
    Col("PI No.", 18, "PI"),
    Col("PI Date", 12, "PI"),
    Col("PI Value", 14, "PI", true),
    Col("Payment Status", 16, "PI"),
    Col("Payment Confirmed", 13, "PI"),
    Col("Amount Received", 14, "PI", true),
    Col("Pendency Reason", 24, "Pendency"),
    Col("Pendency Remarks", 34, "Pendency"),
  ];
  // The SO's columns: greyed on its later PI rows.
  const SO_COLS = 11;
  const out: ReportSheet["rows"] = [];
  rows.forEach((o, i) => {
    const line = r.rows[i];
    const st = str(o.billing_state);
    const p = pendency[str(o.id)];
    const so: [SheetCell, Tone | null][] = [
      [Number(o.sl_no) || str(o.sl_no) || null, null],
      [line[1].text || null, null],
      [line[2].text || null, null],
      [orderTypeText(o) || null, null],
      [line[3].text || null, null],
      [line[4].text || null, null],
      [line[5].text || null, null],
      [str(o.order_currency) || "INR", null],
      [isUsd(o.order_currency) ? rounded(o.gross_value_usd) : null, null],
      [rounded(o.taxable_value), null],
      [st || null, stateTone(st)],
    ];
    const tail: [SheetCell, Tone | null][] = [
      [p?.reason || null, p ? "red" : null],
      [p?.remarks || null, null],
    ];
    const terms = new Map(((Array.isArray(o.term_lines) ? o.term_lines : []) as Row[]).map((t) => [str(t.id), t]));
    const docs = (Array.isArray(o.pi_docs) ? o.pi_docs : []) as Row[];
    const pis: [SheetCell, Tone | null][][] = docs.length
      ? docs.map((d) => {
          const paid = str(d.pi_payment_status);
          return [
            [piTermText(str(d.payment_term_id) ? terms.get(str(d.payment_term_id)) : undefined) || null, null],
            [str(d.pi_no) || null, null],
            [day(d.pi_date), null],
            [amount(d.pi_value), null],
            [paid || null, /hold/i.test(paid) ? "red" : /rcvd|received/i.test(paid) ? "green" : paid ? "amber" : null],
            [day(d.pi_confirmed_date), null],
            [amount(d.pi_amount_received), null],
          ];
        })
      : [[[null, null], ["No PI yet", "muted"], [null, null], [null, null], [null, null], [null, null], [null, null]]];
    pis.forEach((pi, n) => {
      const cells = [...so, ...pi, ...tail];
      out.push({
        cells: cells.map((c) => c[0]),
        tones: cells.map((c) => c[1]),
        bold: columns.map((c) => c.label === "SO No." || c.label === "PI No."),
        repeat: n > 0,
      });
    });
  });

  return {
    title: r.title,
    filterLine,
    summary: {
      tiles: r.tiles.map((t) => ({ label: t.label, value: Number(t.value) || 0, tone: toneOf(t) ?? undefined })),
      counts: r.breakdown?.line ? [{ label: r.breakdown.label, text: r.breakdown.line }] : [],
    },
    columns,
    soColumns: SO_COLS,
    rows: out,
  };
}
