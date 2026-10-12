/**
 * The Commercial Offer as Excel — the same layout as the printed sheet
 * (lib/commercial-offer.ts): letterhead lines, title band, client / enquiry /
 * quotation rows, the Commercial Offer band, tag row, price rows, scope lines.
 */
import { downloadXlsx, type XlsxCell } from "./xlsx";
import { sheetFileStem } from "./tech-doc";
import { BAND as OFFER_BAND, ROW_LABEL, sheetHeaderRows } from "./tech-doc-excel";
import { OFFER_TITLE, buildOffer, offerOutOfScope, offerScope, sheetGroup, type OfferSheet } from "./commercial-offer";

export function downloadOfferExcel(sheet: OfferSheet): string {
  const n = Math.max(sheet.tags.length, 1);
  const width = n + 1;
  const rows: XlsxCell[][] = sheetHeaderRows(OFFER_TITLE, sheet.header, sheet.tags.length);
  rows.push([{ value: OFFER_TITLE, colSpan: width, ...OFFER_BAND }]);
  rows.push([
    { value: "Tag No.", ...ROW_LABEL },
    ...sheet.tags.map((t) => ({ value: t.tagName, bold: true, align: "center" }) as XlsxCell),
  ]);
  const [block] = buildOffer(sheet.tags, sheet.config, sheet.geared);
  for (const r of block.rows) {
    rows.push(
      r.span
        ? [{ value: r.label, ...ROW_LABEL }, { value: r.values[0] || "-", bold: true, align: "center", colSpan: n }]
        : [{ value: r.label, ...ROW_LABEL, wrap: true }, ...r.values.map((v) => ({ value: v || "-", align: "center" }) as XlsxCell)],
    );
  }
  const scope = offerScope(sheet.config, sheetGroup(sheet));
  const out = offerOutOfScope(sheet.config);
  if (scope) rows.push([{ value: `Scope of supply :- ${scope}`, colSpan: width, color: "C00000", bold: true, align: "center", wrap: true }]);
  if (out) rows.push([{ value: `Out Of Scope :- ${out}`, colSpan: width, align: "center", wrap: true }]);

  const filename = `${sheetFileStem("Commercial-Offer", sheet, sheet.versionLabel)}.xlsx`;
  downloadXlsx(filename, [{ name: OFFER_TITLE, columnWidths: [44, ...Array.from({ length: n }, () => 24)], rows }]);
  return filename;
}
