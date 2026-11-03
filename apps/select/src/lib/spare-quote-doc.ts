// The spare quotation document, in the format of the user's sample (2026-11-04):
// letterhead, client / enquiry / quotation rows, then Sl. No., Description, Model,
// Reference PO, Part No., Qty/Unit, Unit Cost, Amount. Client-safe.
import { downloadXlsx, type XlsxCell } from "./xlsx";
import { BAND, ROW_LABEL, sheetHeaderRows } from "./tech-doc-excel";
import { dotDate, esc, sheetFileStem, sheetHtml, type TechDocHeader } from "./tech-doc";
import { lineAmount, quoteTotal, type SpareQuote } from "./spare-quote";

export type SpareQuoteSheet = {
  projectCode: string;
  header: TechDocHeader;
  quote: SpareQuote;
};

const TITLE = "Quotation for Spares";
const SUBJECT = "Sub:- Supply of Risansi make pump spare parts.";
const OPENING = "Dear Sir, We thankfully acknowledge having received your above enquiry and herewith submit our lowest possible quotation as follows:";
const HEADINGS = ["Sl. No.", "Description", "Model", "Reference PO No. / Date", "Part No.", "Qty/Unit", "Unit Cost (INR)", "Amount (INR)"];

const money = (n: number | null) => (n === null ? "-" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const poText = (q: SpareQuote) => [q.poNo, q.poDate ? `Date ${dotDate(q.poDate)}` : ""].filter(Boolean).join("\n");

export function buildSpareQuoteHtml(sheet: SpareQuoteSheet, logoUrl = "/logo.png"): string {
  const { quote } = sheet;
  const lines = quote.models.flatMap((m) => m.lines);
  let sl = 0;
  const rows = quote.models.flatMap((m) =>
    m.lines.map((l, i) => {
      sl += 1;
      const first = sl === 1;
      return `<tr><td>${sl}</td><td class="l">${esc(l.partName)}</td>${
        i === 0 ? `<td rowspan="${m.lines.length}" class="m">${esc(m.productCode)}</td>` : ""
      }${first ? `<td rowspan="${lines.length}" class="m">${esc(poText(quote) || "-").replace(/\n/g, "<br>")}</td>` : ""}<td>${esc(l.partNo)}</td><td>${esc(
        l.qty === null ? "-" : String(l.qty),
      )}</td><td class="r">${money(l.unitPrice)}</td><td class="r">${money(lineAmount(l))}</td></tr>`;
    }),
  );
  const body = [
    `<tr class="meta"><td colspan="8">${esc(SUBJECT)}<br>${esc(OPENING)}</td></tr>`,
    `<tr class="band">${HEADINGS.map((h) => `<td>${esc(h)}</td>`).join("")}</tr>`,
    ...rows,
    `<tr class="total"><td colspan="7" class="r">Grand Total</td><td class="r">${money(quoteTotal(quote))}</td></tr>`,
  ].join("\n");
  return sheetHtml({
    projectCode: sheet.projectCode,
    title: TITLE,
    header: sheet.header,
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
  const { quote } = sheet;
  let sl = 0;
  const po = poText(quote).replace(/\n/g, ", ");
  const rows: XlsxCell[][] = [
    ...sheetHeaderRows(TITLE, sheet.header, 7),
    [{ value: SUBJECT, colSpan: 8, wrap: true }],
    [{ value: OPENING, colSpan: 8, wrap: true }],
    HEADINGS.map((h) => ({ value: h, ...BAND })),
    ...quote.models.flatMap((m) =>
      m.lines.map((l, i): XlsxCell[] => {
        sl += 1;
        return [
          { value: String(sl) },
          { value: l.partName },
          { value: i === 0 ? m.productCode : "", bold: true },
          { value: sl === 1 ? po : "" },
          { value: l.partNo },
          { value: l.qty === null ? "" : String(l.qty) },
          { value: money(l.unitPrice) },
          { value: money(lineAmount(l)) },
        ];
      }),
    ),
    [{ value: "Grand Total", colSpan: 7, ...ROW_LABEL }, { value: money(quoteTotal(quote)), ...ROW_LABEL }],
  ];
  const filename = `${sheetFileStem("Spare-Quotation", { projectCode: sheet.projectCode, header: sheet.header })}.xlsx`;
  downloadXlsx(filename, [{ name: TITLE, columnWidths: [8, 30, 34, 22, 10, 10, 14, 14], rows }]);
  return filename;
}
