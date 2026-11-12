// The spare quotation document, in the format of the user's sample (2026-11-04):
// letterhead, client / enquiry / quotation rows (no Sub / Dear Sir lines since
// 2026-11-11; a narrower enquiry cell), then Sl. No., Description, Model,
// Reference PO, Part No., Qty/Unit, Unit Cost, Amount, then the ticked terms and
// conditions (lib/spare-terms.ts). Every row can be edited for
// the document (SpareDocEdits); the saved quote is not changed. Client-safe.
import { downloadXlsx, type XlsxCell } from "./xlsx";
import { BAND, ROW_LABEL, sheetHeaderRows } from "./tech-doc-excel";
import { dotDate, esc, sheetFileStem, sheetHtml, type TechDocHeader } from "./tech-doc";
import { spareDocLineKey, type SpareDocEdits, type SpareQuote } from "./spare-quote";
import type { QuoteFx } from "./commercial";
import { SPARE_TERMS, SPARE_WARRANTY, SPARE_WARRANTY_HEADING, WARRANTY_TERM, type SpareTerm } from "./spare-terms";

export type SpareQuoteSheet = {
  /** Quoted in USD at this rate (user, 2026-11-12): Unit Cost / Amount / totals print in
   *  USD (prices are entered in INR). Absent = INR. */
  fx?: QuoteFx;
  projectCode: string;
  /** The automatic header lines; edits apply over them. */
  header: TechDocHeader;
  quote: SpareQuote;
  edits: SpareDocEdits;
};

export const SPARE_DOC_SUBJECT = "Sub:- Supply of Risansi make pump spare parts.";
export const SPARE_DOC_GREETING = "Dear Sir,";
export const SPARE_DOC_OPENING = "We thankfully acknowledge having received your above enquiry and herewith submit our lowest possible quotation as follows:";
const TITLE = "Quotation for Spares";
const PO_HEADING = "Reference PO No. / Date";
const HEADINGS = ["Sl. No.", "Description", "Model", PO_HEADING, "Part No.", "Qty/Unit", "Unit Cost (INR)", "Amount (INR)"];
const TERMS_HEADING = "TERMS AND CONDITIONS";
/** The Enquiry No. & Date cell: Sl. No. + Description + Model with the PO column
 *  (about half), Sl. No. + Description without (about a third). */
const enquirySpan = (showPo: boolean) => (showPo ? 3 : 2);

const money = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const toNumber = (s: string): number | null => {
  const n = Number(s.trim());
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
};

/** "10" or "" as the document's discount box shows it. */
export const spareDiscountAuto = (q: SpareQuote) => (q.discountPct === null ? "" : String(q.discountPct));

/** A part's reference PO as printed: "2025-26/106, Date 04.11.2026". */
export const sparePoAuto = (l: { poNo: string; poDate: string }) => [l.poNo, l.poDate ? `Date ${dotDate(l.poDate)}` : ""].filter(Boolean).join(", ");

export type SpareDocLine = { key: string; partNo: string; name: string; po: string; qty: string; unit: string; amount: number | null; removed: boolean };
export type SpareDocModel = { id: string; auto: string; model: string; lines: SpareDocLine[] };

/** The document's rows with the edits applied; removed lines are kept, flagged. */
export function spareDocModels(quote: SpareQuote, edits: SpareDocEdits): SpareDocModel[] {
  const removed = new Set(edits.removed ?? []);
  return quote.models.map((m) => ({
    id: m.id,
    auto: m.productCode,
    model: edits.models?.[m.id] ?? m.productCode,
    lines: m.lines.map((l) => {
      const key = spareDocLineKey(m.id, l);
      const e = edits.lines?.[key] ?? {};
      const qty = e.qty ?? (l.qty === null ? "" : String(l.qty));
      const unit = e.unit ?? (l.unitPrice === null ? "" : String(l.unitPrice));
      const q = toNumber(qty);
      const u = toNumber(unit);
      return { key, partNo: e.partNo ?? l.partNo, name: e.name ?? l.partName, po: e.po ?? sparePoAuto(l), qty, unit, amount: q === null || u === null ? null : q * u, removed: removed.has(key) };
    }),
  }));
}

export type SpareDocTerm = { id: string; auto: string; text: string };

/** The ticked terms with the edits applied. */
export function spareDocTerms(quote: SpareQuote, edits: SpareDocEdits): { terms: SpareDocTerm[]; warranty: SpareDocTerm[] } {
  const off = new Set(quote.termsOff);
  const ticked = (list: SpareTerm[]) => list.filter((t) => !off.has(t.id)).map((t) => ({ id: t.id, auto: t.text, text: edits.terms?.[t.id] ?? t.text }));
  return {
    terms: ticked(SPARE_TERMS[quote.termsMarket]),
    warranty: off.has(WARRANTY_TERM[quote.termsMarket]) ? [] : ticked(SPARE_WARRANTY),
  };
}

/** What gets printed: removed lines and empty models left off. */
function printed(sheet: SpareQuoteSheet) {
  // In USD: every amount divided by the rate, two decimals.
  const fx = sheet.fx;
  const conv = (n: number | null) => (n === null ? null : fx ? n / fx.rate : n);
  const usdFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (n: number | null) => (n === null ? "-" : fx ? usdFmt.format(n) : money(n));
  const models = spareDocModels(sheet.quote, sheet.edits)
    .map((m) => ({
      ...m,
      lines: m.lines.filter((l) => !l.removed).map((l) => ({ ...l, unitNum: conv(toNumber(l.unit)), amount: conv(l.amount) })),
    }))
    .filter((m) => m.lines.length > 0);
  const { header, edits } = sheet;
  const subtotal = models.reduce((s, m) => s + m.lines.reduce((x, l) => x + (l.amount ?? 0), 0), 0);
  const discountPct = toNumber(edits.discount ?? spareDiscountAuto(sheet.quote)) ?? 0;
  const discount = (subtotal * discountPct) / 100;
  // No PO tick: no column for it. Each row prints its own part's PO.
  const showPo = sheet.quote.hasPo;
  // A term whose wording was cleared on the document doesn't print.
  const { terms, warranty } = spareDocTerms(sheet.quote, edits);
  const printable = (list: SpareDocTerm[]) => list.map((t) => t.text.trim()).filter(Boolean);
  return {
    models,
    subtotal,
    discountPct,
    discount,
    total: subtotal - discount,
    note: (edits.note ?? sheet.quote.note).trim(),
    terms: printable(terms),
    warranty: printable(warranty),
    showPo,
    headings: (showPo ? HEADINGS : HEADINGS.filter((h) => h !== PO_HEADING)).map((h) => (fx ? h.replace("(INR)", "(USD)") : h)),
    fmt,
    count: models.reduce((s, m) => s + m.lines.length, 0),
    subject: edits.subject ?? SPARE_DOC_SUBJECT,
    greeting: edits.greeting ?? SPARE_DOC_GREETING,
    opening: edits.opening ?? SPARE_DOC_OPENING,
    header: {
      ...header,
      clientName: edits.client ?? header.clientName,
      enquiry: edits.enquiry ?? header.enquiry,
      quotation: edits.quotation ?? header.quotation,
    },
  };
}

export function buildSpareQuoteHtml(sheet: SpareQuoteSheet, logoUrl = "/logo.png"): string {
  const d = printed(sheet);
  const cols = d.headings.length;
  let sl = 0;
  const rows = d.models.flatMap((m) =>
    m.lines.map((l, i) => {
      sl += 1;
      return `<tr><td>${sl}</td><td class="l">${esc(l.name)}</td>${i === 0 ? `<td rowspan="${m.lines.length}" class="m">${esc(m.model)}</td>` : ""}${
        d.showPo ? `<td>${esc(l.po || "-")}</td>` : ""
      }<td>${esc(l.partNo)}</td><td>${esc(l.qty || "-")}</td><td class="r">${d.fmt(l.unitNum)}</td><td class="r">${d.fmt(l.amount)}</td></tr>`;
    }),
  );
  const termRows = (heading: string, list: string[]) =>
    list.length === 0
      ? []
      : [
          `<tr class="band"><td colspan="${cols}">${esc(heading)}</td></tr>`,
          ...list.map((t, i) => `<tr class="term"><td>${i + 1}</td><td colspan="${cols - 1}">${esc(t)}</td></tr>`),
        ];
  const body = [
    `<tr class="band">${d.headings.map((h) => `<td>${esc(h)}</td>`).join("")}</tr>`,
    ...rows,
    ...(d.discountPct > 0
      ? [
          `<tr class="total"><td colspan="${cols - 1}" class="r">Total</td><td class="r">${d.fmt(d.subtotal)}</td></tr>`,
          `<tr class="total"><td colspan="${cols - 1}" class="r">Discount (${d.discountPct}%)</td><td class="r">-${d.fmt(d.discount)}</td></tr>`,
        ]
      : []),
    `<tr class="total"><td colspan="${cols - 1}" class="r">Grand Total</td><td class="r">${d.fmt(d.total)}</td></tr>`,
    ...(d.note ? [`<tr class="meta"><td colspan="${cols}" style="white-space:pre-line"><b>Note:</b> ${esc(d.note)}</td></tr>`] : []),
    ...termRows(TERMS_HEADING, d.terms),
    ...termRows(SPARE_WARRANTY_HEADING, d.warranty),
  ].join("\n");
  return sheetHtml({
    projectCode: sheet.projectCode,
    title: TITLE,
    header: d.header,
    tagCount: cols - 1,
    enquirySpan: enquirySpan(d.showPo),
    body,
    logoUrl,
    css: `
      ${
        d.showPo
          ? `col:nth-child(1), col.lbl { width: 5%; }
      col:nth-child(2) { width: 23%; }
      col:nth-child(3) { width: 20%; }
      col:nth-child(4) { width: 14%; }
      col:nth-child(5) { width: 8%; }
      col:nth-child(6) { width: 8%; }
      col:nth-child(7), col:nth-child(8) { width: 11%; }`
          : `col:nth-child(1), col.lbl { width: 5%; }
      col:nth-child(2) { width: 29%; }
      col:nth-child(3) { width: 26%; }
      col:nth-child(4) { width: 9%; }
      col:nth-child(5) { width: 9%; }
      col:nth-child(6), col:nth-child(7) { width: 11%; }`
      }
      td.l { text-align: left; }
      td.r { text-align: right; }
      td.m { font-weight: bold; }
      tr.total td { font-weight: bold; background: #f4f8fd; }
      tr.term td { vertical-align: top; }
      tr.term td:last-child { text-align: left; white-space: pre-line; }
    `,
  });
}

export function downloadSpareQuoteExcel(sheet: SpareQuoteSheet): string {
  const d = printed(sheet);
  const cols = d.headings.length;
  const widths = d.showPo ? [8, 30, 34, 22, 10, 10, 14, 14] : [8, 34, 38, 10, 10, 14, 14];
  // Roughly one character per width unit; 409 is as tall as Excel allows.
  const heightOf = (text: string, chars: number) => Math.min(409, 14 * text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / chars)), 0));
  const allWidth = widths.reduce((s, w) => s + w, 0);
  const termRows = (heading: string, list: string[]): XlsxCell[][] =>
    list.length === 0
      ? []
      : [
          [{ value: heading, colSpan: cols, ...BAND }],
          ...list.map((t, i): XlsxCell[] => [
            { value: String(i + 1), align: "center", wrap: true },
            { value: t, colSpan: cols - 1, wrap: true, rowHeight: heightOf(t, allWidth - widths[0]) },
          ]),
        ];
  let sl = 0;
  const rows: XlsxCell[][] = [
    ...sheetHeaderRows(TITLE, d.header, cols - 1, enquirySpan(d.showPo)),
    d.headings.map((h) => ({ value: h, ...BAND })),
    ...d.models.flatMap((m) =>
      m.lines.map((l, i): XlsxCell[] => {
        sl += 1;
        return [
          { value: String(sl) },
          { value: l.name },
          { value: i === 0 ? m.model : "", bold: true },
          ...(d.showPo ? [{ value: l.po || "-" }] : []),
          { value: l.partNo },
          { value: l.qty },
          { value: d.fmt(l.unitNum) },
          { value: d.fmt(l.amount) },
        ];
      }),
    ),
    ...(d.discountPct > 0
      ? [
          [{ value: "Total", colSpan: cols - 1, ...ROW_LABEL }, { value: d.fmt(d.subtotal), ...ROW_LABEL }],
          [{ value: `Discount (${d.discountPct}%)`, colSpan: cols - 1, ...ROW_LABEL }, { value: `-${d.fmt(d.discount)}`, ...ROW_LABEL }],
        ]
      : []),
    [{ value: "Grand Total", colSpan: cols - 1, ...ROW_LABEL }, { value: d.fmt(d.total), ...ROW_LABEL }],
    ...(d.note ? [[{ value: `Note: ${d.note}`, colSpan: cols, wrap: true, rowHeight: heightOf(`Note: ${d.note}`, allWidth) }]] : []),
    ...termRows(TERMS_HEADING, d.terms),
    ...termRows(SPARE_WARRANTY_HEADING, d.warranty),
  ];
  const filename = `${sheetFileStem("Spare-Quotation", { projectCode: sheet.projectCode, header: d.header })}.xlsx`;
  downloadXlsx(filename, [{ name: TITLE, columnWidths: widths, rows }]);
  return filename;
}
