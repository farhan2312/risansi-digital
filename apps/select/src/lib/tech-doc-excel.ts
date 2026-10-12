/**
 * The enquiry's Technical Data Sheet as Excel — the same layout as the printed
 * sheet (lib/tech-doc.ts): letterhead lines, title band, client / enquiry /
 * quotation rows, then the section bands and rows, one column per tag.
 */
import { downloadXlsx, type XlsxCell } from "./xlsx";
import { LETTERHEAD, buildTechDoc, headerCells, techDocFileStem, type TechDocHeader, type TechDocSheet } from "./tech-doc";

/** Sheet colours (as the printed sheet): navy title bar, light-blue section
 *  bands with navy text, faint-blue row labels. */
export const TITLE_BAND: Partial<XlsxCell> = { fill: "06408C", color: "FFFFFF", bold: true, align: "center" };
export const BAND: Partial<XlsxCell> = { fill: "DCEBFB", color: "0B3D7E", bold: true, align: "center" };
export const ROW_LABEL: Partial<XlsxCell> = { fill: "F4F8FD", bold: true };

/** The letterhead, "<company> - <title>" band and client / enquiry /
 *  quotation rows shared by the Risansi sheets' Excel exports. */
export function sheetHeaderRows(title: string, header: TechDocHeader, tagCount: number): XlsxCell[][] {
  const n = Math.max(tagCount, 1);
  const width = n + 1;
  const leftSpan = 1 + Math.floor(n / 2);
  const L = LETTERHEAD;
  return [
    [{ value: `${L.company.toUpperCase()}`, bold: true, colSpan: width }],
    [{ value: `GST: ${L.gst}  |  CIN: ${L.cin}`, colSpan: width }],
    [{ value: `${L.email}  |  ${L.website}  |  ${L.phone}  |  ${L.address}`, colSpan: width }],
    [{ value: `${L.company} - ${title}`, colSpan: width, ...TITLE_BAND }],
    ...headerRows(header, width, leftSpan),
  ];
}

/** Client row + enquiry / quotation row, minus removed lines (as the printed sheet). */
function headerRows(header: TechDocHeader, width: number, leftSpan: number): XlsxCell[][] {
  const c = headerCells(header);
  const quote = c.quote.join("\n");
  const rows: XlsxCell[][] = [];
  if (c.client !== null) rows.push([{ value: c.client, colSpan: width, wrap: true }]);
  if (c.enquiry !== null && quote)
    rows.push([
      { value: c.enquiry, colSpan: leftSpan, wrap: true },
      { value: quote, colSpan: width - leftSpan, wrap: true },
    ]);
  else if (c.enquiry !== null || quote) rows.push([{ value: c.enquiry ?? quote, colSpan: width, wrap: true }]);
  return rows;
}

export function downloadTechDocExcel(data: TechDocSheet): string {
  const n = Math.max(data.tags.length, 1);
  const width = n + 1;
  const rows: XlsxCell[][] = sheetHeaderRows("Technical Data Sheet", data.header, data.tags.length);

  for (const block of buildTechDoc(data.tags, data.config)) {
    if (block.rows.length === 0) continue;
    rows.push([{ value: block.title, colSpan: width, ...BAND }]);
    for (const r of block.rows) {
      rows.push([
        { value: r.label, ...ROW_LABEL },
        ...r.values.map((v) => ({ value: v || "-", align: "center", wrap: true }) as XlsxCell),
      ]);
    }
  }

  const filename = `${techDocFileStem(data)}.xlsx`;
  downloadXlsx(filename, [
    { name: "Technical Data Sheet", columnWidths: [30, ...Array.from({ length: n }, () => 28)], rows },
  ]);
  return filename;
}
