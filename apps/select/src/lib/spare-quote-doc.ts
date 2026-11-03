// The spare quotation document, in the format of the user's sample (2026-11-04):
// letterhead, client / enquiry / quotation rows, then Sl. No., Description, Model,
// Reference PO, Part No., Qty/Unit, Unit Cost, Amount. Every row can be edited for
// the document (SpareDocEdits); the saved quote is not changed. Client-safe.
import { downloadXlsx, type XlsxCell } from "./xlsx";
import { BAND, ROW_LABEL, sheetHeaderRows } from "./tech-doc-excel";
import { dotDate, esc, sheetFileStem, sheetHtml, type TechDocHeader } from "./tech-doc";
import { spareDocLineKey, type SpareDocEdits, type SpareQuote } from "./spare-quote";

export type SpareQuoteSheet = {
  projectCode: string;
  /** The automatic header lines; edits apply over them. */
  header: TechDocHeader;
  quote: SpareQuote;
  edits: SpareDocEdits;
};

export const SPARE_DOC_SUBJECT = "Sub:- Supply of Risansi make pump spare parts.";
export const SPARE_DOC_OPENING = "Dear Sir, We thankfully acknowledge having received your above enquiry and herewith submit our lowest possible quotation as follows:";
const TITLE = "Quotation for Spares";
const HEADINGS = ["Sl. No.", "Description", "Model", "Reference PO No. / Date", "Part No.", "Qty/Unit", "Unit Cost (INR)", "Amount (INR)"];

const money = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const toNumber = (s: string): number | null => {
  const n = Number(s.trim());
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
};

export const sparePoAuto = (q: SpareQuote) => [q.poNo, q.poDate ? `Date ${dotDate(q.poDate)}` : ""].filter(Boolean).join(", ");

export type SpareDocLine = { key: string; partNo: string; name: string; qty: string; unit: string; amount: number | null; removed: boolean };
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
      return { key, partNo: e.partNo ?? l.partNo, name: e.name ?? l.partName, qty, unit, amount: q === null || u === null ? null : q * u, removed: removed.has(key) };
    }),
  }));
}

/** What gets printed: removed lines and empty models left off. */
function printed(sheet: SpareQuoteSheet) {
  const models = spareDocModels(sheet.quote, sheet.edits)
    .map((m) => ({ ...m, lines: m.lines.filter((l) => !l.removed) }))
    .filter((m) => m.lines.length > 0);
  const { header, edits } = sheet;
  return {
    models,
    total: models.reduce((s, m) => s + m.lines.reduce((x, l) => x + (l.amount ?? 0), 0), 0),
    count: models.reduce((s, m) => s + m.lines.length, 0),
    po: edits.po ?? sparePoAuto(sheet.quote),
    subject: edits.subject ?? SPARE_DOC_SUBJECT,
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
  let sl = 0;
  const rows = d.models.flatMap((m) =>
    m.lines.map((l, i) => {
      sl += 1;
      return `<tr><td>${sl}</td><td class="l">${esc(l.name)}</td>${i === 0 ? `<td rowspan="${m.lines.length}" class="m">${esc(m.model)}</td>` : ""}${
        sl === 1 ? `<td rowspan="${d.count}" class="m">${esc(d.po || "-")}</td>` : ""
      }<td>${esc(l.partNo)}</td><td>${esc(l.qty || "-")}</td><td class="r">${money(toNumber(l.unit))}</td><td class="r">${money(l.amount)}</td></tr>`;
    }),
  );
  const body = [
    `<tr class="meta"><td colspan="8">${esc(d.subject)}<br>${esc(d.opening)}</td></tr>`,
    `<tr class="band">${HEADINGS.map((h) => `<td>${esc(h)}</td>`).join("")}</tr>`,
    ...rows,
    `<tr class="total"><td colspan="7" class="r">Grand Total</td><td class="r">${money(d.total)}</td></tr>`,
  ].join("\n");
  return sheetHtml({
    projectCode: sheet.projectCode,
    title: TITLE,
    header: d.header,
    tagCount: 7,
    body,
    logoUrl,
    css: `
      col:nth-child(1), col.lbl { width: 5%; }
      col:nth-child(2) { width: 23%; }
      col:nth-child(3) { width: 20%; }
      col:nth-child(4) { width: 14%; }
      col:nth-child(5) { width: 8%; }
      col:nth-child(6) { width: 8%; }
      col:nth-child(7), col:nth-child(8) { width: 11%; }
      td.l { text-align: left; }
      td.r { text-align: right; }
      td.m { font-weight: bold; }
      tr.total td { font-weight: bold; background: #f4f8fd; }
    `,
  });
}

export function downloadSpareQuoteExcel(sheet: SpareQuoteSheet): string {
  const d = printed(sheet);
  let sl = 0;
  const rows: XlsxCell[][] = [
    ...sheetHeaderRows(TITLE, d.header, 7),
    [{ value: d.subject, colSpan: 8, wrap: true }],
    [{ value: d.opening, colSpan: 8, wrap: true }],
    HEADINGS.map((h) => ({ value: h, ...BAND })),
    ...d.models.flatMap((m) =>
      m.lines.map((l, i): XlsxCell[] => {
        sl += 1;
        return [
          { value: String(sl) },
          { value: l.name },
          { value: i === 0 ? m.model : "", bold: true },
          { value: sl === 1 ? d.po : "" },
          { value: l.partNo },
          { value: l.qty },
          { value: money(toNumber(l.unit)) },
          { value: money(l.amount) },
        ];
      }),
    ),
    [{ value: "Grand Total", colSpan: 7, ...ROW_LABEL }, { value: money(d.total), ...ROW_LABEL }],
  ];
  const filename = `${sheetFileStem("Spare-Quotation", { projectCode: sheet.projectCode, header: d.header })}.xlsx`;
  downloadXlsx(filename, [{ name: TITLE, columnWidths: [8, 30, 34, 22, 10, 10, 14, 14], rows }]);
  return filename;
}
