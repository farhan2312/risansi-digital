// Proforma Invoice's Excel report: one row per PI (an SO with none yet gets a
// row of its own), the SO's columns repeated on each so the sheet filters
// cleanly. The SOs are the page's: its filter bar, pendency filter and search.
import ExcelJS from "exceljs";
import { listOrdersForBillingPage, parseQueueSort, type BillingQueueRow } from "@/lib/orders";
import { parseQuery } from "@/lib/pagination";
import { parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { parsePendencyFilter, type Pendency } from "@/lib/pendency";
import { listPendency, pendencyFilterSql } from "@/lib/pendency-db";
import { orderTypeText } from "@/lib/order-schema";

const HEAD_BG = "FF1F3864";
const RULE = "FFBFC9D9";

type Cell = string | number | Date | null;

function text(v: unknown): string | null {
  return v == null || String(v).trim() === "" ? null : String(v);
}
function date(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v).slice(0, 10));
  return Number.isNaN(d.getTime()) ? null : d;
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const COLUMNS: { header: string; width: number; date?: boolean; money?: boolean }[] = [
  { header: "Sl No.", width: 7 },
  { header: "SO No.", width: 16 },
  { header: "SO Date", width: 12, date: true },
  { header: "Client Name", width: 34 },
  { header: "Order Type", width: 11 },
  { header: "Bill Type", width: 12 },
  { header: "Payment Terms", width: 30 },
  { header: "Currency", width: 9 },
  { header: "Gross Order Value", width: 15, money: true },
  { header: "PI Status", width: 15 },
  { header: "Payment Term", width: 26 },
  { header: "PI No.", width: 18 },
  { header: "PI Date", width: 12, date: true },
  { header: "PI Value", width: 14, money: true },
  { header: "Payment Status", width: 14 },
  { header: "Payment Confirmed", width: 13, date: true },
  { header: "Amount Received", width: 14, money: true },
  { header: "Pendency Reason", width: 24 },
  { header: "Pendency Remarks", width: 34 },
];

type Row = Record<string, unknown>;

function termText(t: Row | undefined): string | null {
  if (!t) return null;
  const pct = num(t.percent);
  return text([text(t.term), pct != null ? `${pct}%` : null, num(t.days) != null ? `${t.days} days` : null].filter(Boolean).join(" · "));
}

function lines(rows: BillingQueueRow[], pendency: Record<string, Pendency>): Cell[][] {
  const out: Cell[][] = [];
  for (const o of rows) {
    const p = pendency[String(o.id)];
    const usd = String(o.order_currency ?? "").toUpperCase() === "USD";
    const so: Cell[] = [
      num(o.sl_no),
      text(o.so_no),
      date(o.so_date),
      text(o.client_name),
      text(orderTypeText(o)),
      text(o.bill_type),
      text(o.payment_terms),
      text(o.order_currency) ?? "INR",
      num(usd ? o.gross_value_usd ?? o.taxable_value : o.taxable_value),
      text(o.billing_state),
    ];
    const tail: Cell[] = [p && !p.clearedAt ? text(p.reason) : null, p && !p.clearedAt ? text(p.remarks) : null];
    const terms = new Map((o.term_lines ?? []).map((t) => [String(t.id), t]));
    const docs = (o.pi_docs ?? []) as Row[];
    if (!docs.length) {
      out.push([...so, null, null, null, null, null, null, null, ...tail]);
      continue;
    }
    for (const d of docs) {
      out.push([
        ...so,
        termText(d.payment_term_id ? terms.get(String(d.payment_term_id)) : undefined),
        text(d.pi_no),
        date(d.pi_date),
        num(d.pi_value),
        text(d.pi_payment_status),
        date(d.pi_confirmed_date),
        num(d.pi_amount_received),
        ...tail,
      ]);
    }
  }
  return out;
}

/** The report as the page has it filtered and searched, every page. */
export async function loadPiReport(
  user: { id: string; role: string },
  get: (key: string) => string | undefined,
  /** Whether the link carried any filter or search (the department is always pinned, so the filter itself cannot tell). */
  anyFilter: boolean
): Promise<{ wb: ExcelJS.Workbook; filtered: boolean; today: string }> {
  const filter = scopeToRep(parseDeptFilter(get, "billing"), user);
  const search = parseQuery(get("q"));
  const pendencyFilter = parsePendencyFilter(get, "billing");
  const extra = pendencyFilterSql("billing", pendencyFilter);
  const { rows } = await listOrdersForBillingPage({
    page: 1,
    all: true,
    search,
    sort: parseQueueSort(get("sort")),
    filter,
    extraRestrict: extra,
  });
  const pendency = await listPendency(rows.map((r) => String(r.id)), "billing");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const filtered = anyFilter;
  const scope = `${filtered ? "filtered view" : "all SOs"}${search ? ` matching "${search}"` : ""} · ${rows.length} SOs · ${today}`;
  return { wb: buildWorkbook(lines(rows, pendency), scope), filtered, today };
}

function buildWorkbook(body: Cell[][], scope: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Risansi SO to Dispatch";
  wb.created = new Date();
  const ws = wb.addWorksheet("Proforma Invoice", { views: [{ state: "frozen", ySplit: 2 }] });

  const title = ws.addRow([`Proforma Invoice report — ${scope}`]);
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
    if (c.money) col.numFmt = "#,##0.00";
  });

  for (const cells of body) ws.addRow(cells).alignment = { vertical: "top", wrapText: true };

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
