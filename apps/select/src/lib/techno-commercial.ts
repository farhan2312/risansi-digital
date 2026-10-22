/**
 * The Techno-Commercial Offer: one drive group's Technical Data Sheet and
 * Commercial Offer as ONE sheet: letterhead, "<company> - Techno-Commercial
 * Offer", the client / enquiry / quotation rows (as on the Commercial Offer),
 * the technical sections, the Commercial Offer section, then the scope lines
 * once. Both sheets' own edits apply as saved; nothing is stored for this
 * sheet itself. Client-safe.
 */
import { buildOffer, offerOutOfScope, offerScope, sheetGroup, type OfferSheet } from "./commercial-offer";
import { BAND, ROW_LABEL, sheetHeaderRows } from "./tech-doc-excel";
import { SCOPE_CSS, buildTechDoc, esc, scopeRowsHtml, sheetFileStem, sheetHtml, type TechDocSheet } from "./tech-doc";
import { downloadXlsx, type XlsxCell } from "./xlsx";

export const TECHNO_COMMERCIAL_TITLE = "Techno-Commercial Offer";

/** Commercial Offer rows the technical part already shows (Liquid, Pump
 *  Model, Drive Motor Rating) - left out of the combined sheet. */
export const IN_TECHNICAL = new Set(["t_liquid", "t_pumpModel", "t_motorKw"]);

/** A row of the combined sheet: one value per column, or one across all. */
type Row = { label: string; values: string[]; span?: boolean };
type Section = { title: string; rows: Row[] };

export interface TechnoCommercial {
  /** Tag names, one per column: the technical sheet's tags in order, then any
   *  tag only the Commercial Offer has. */
  columns: string[];
  sections: Section[];
  scope: { scope: string; out: string };
}

export function technoCommercial(tech: TechDocSheet, offer: OfferSheet): TechnoCommercial {
  const ids = tech.tags.map((t) => t.tagId);
  const names = tech.tags.map((t) => t.tagName);
  for (const t of offer.tags)
    if (!ids.includes(t.tagId)) {
      ids.push(t.tagId);
      names.push(t.tagName);
    }
  // A row's values put into the shared columns ("" where the sheet has no such tag).
  const place = (tagIds: string[], values: string[]) => ids.map((id) => values[tagIds.indexOf(id)] ?? "");

  const techIds = tech.tags.map((t) => t.tagId);
  const sections: Section[] = buildTechDoc(tech.tags, tech.config)
    .filter((b) => b.rows.length > 0)
    .map((b) => ({ title: b.title, rows: b.rows.map((r) => ({ label: r.label, values: place(techIds, r.values) })) }));

  // The offer's tags in column order, so its rows line up with the technical ones.
  const offerTags = [...offer.tags].sort((a, b) => ids.indexOf(a.tagId) - ids.indexOf(b.tagId));
  const offerIds = offerTags.map((t) => t.tagId);
  const [block] = buildOffer(offerTags, offer.config, offer.geared, { fx: offer.fx });
  sections.push({
    title: "Commercial Offer",
    rows: block.rows.filter((r) => !IN_TECHNICAL.has(r.key)).map((r) => (r.span ? { label: r.label, values: [r.values[0] ?? ""], span: true } : { label: r.label, values: place(offerIds, r.values) })),
  });

  return {
    columns: names,
    sections,
    scope: { scope: offerScope(offer.config, sheetGroup(offer)), out: offerOutOfScope(offer.config) },
  };
}

export function buildTechnoCommercialHtml(tech: TechDocSheet, offer: OfferSheet, logoUrl = "/logo.png"): string {
  const tc = technoCommercial(tech, offer);
  const n = Math.max(tc.columns.length, 1);
  const cols = n + 1;
  const body =
    tc.sections
      .map(
        (s) =>
          `<tr class="band"><td colspan="${cols}">${esc(s.title)}</td></tr>` +
          s.rows
            .map((r) =>
              r.span
                ? `<tr><th scope="row">${esc(r.label)}</th><td colspan="${n}"><b>${esc(r.values[0] || "-")}</b></td></tr>`
                : `<tr><th scope="row">${esc(r.label)}</th>${r.values.map((v) => `<td>${esc(v || "-")}</td>`).join("")}</tr>`,
            )
            .join(""),
      )
      .join("") + scopeRowsHtml(tc.scope, cols);
  return sheetHtml({
    projectCode: offer.projectCode,
    title: TECHNO_COMMERCIAL_TITLE,
    header: offer.header,
    tagCount: tc.columns.length,
    body,
    logoUrl,
    css: SCOPE_CSS,
  });
}

export function downloadTechnoCommercialExcel(tech: TechDocSheet, offer: OfferSheet): string {
  const tc = technoCommercial(tech, offer);
  const n = Math.max(tc.columns.length, 1);
  const width = n + 1;
  const rows: XlsxCell[][] = sheetHeaderRows(TECHNO_COMMERCIAL_TITLE, offer.header, tc.columns.length);
  for (const s of tc.sections) {
    rows.push([{ value: s.title, colSpan: width, ...BAND }]);
    for (const r of s.rows)
      rows.push(
        r.span
          ? [{ value: r.label, ...ROW_LABEL }, { value: r.values[0] || "-", bold: true, align: "center", colSpan: n }]
          : [{ value: r.label, ...ROW_LABEL, wrap: true }, ...r.values.map((v) => ({ value: v || "-", align: "center", wrap: true }) as XlsxCell)],
      );
  }
  if (tc.scope.scope)
    rows.push([{ value: `Scope of supply :- ${tc.scope.scope}`, colSpan: width, color: "C00000", bold: true, align: "center", wrap: true }]);
  if (tc.scope.out) rows.push([{ value: `Out Of Scope :- ${tc.scope.out}`, colSpan: width, align: "center", wrap: true }]);

  const filename = `${sheetFileStem("Techno-Commercial-Offer", offer)}.xlsx`;
  downloadXlsx(filename, [{ name: TECHNO_COMMERCIAL_TITLE, columnWidths: [40, ...Array.from({ length: n }, () => 26)], rows }]);
  return filename;
}
