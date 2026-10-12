/**
 * Category for a test REPORT, read from the report itself -- never inferred
 * from requisitions (reports and requisitions are separate records; almost
 * every report is an older Excel/PDF import with no requisition at all).
 *
 * What a report can say about its own category:
 *
 *   1. A "Category: ..." note in its remarks. The bulk import copied the
 *      category written on the original sheet into remarks
 *      ("[Imported from H52.xlsx / 4] Category: EC Based"). Spellings vary
 *      ("Quatation test", "Ec Test", "R&D Trails"), so they're normalised
 *      onto the portal's six categories.
 *   2. Failing that, the EC / quotation number itself, when it is text that
 *      names a category ("NEW DIE PIN") or follows one of the portal's
 *      documented number schemes (EC/YY/1/... = EC Based, RIL/QT/... =
 *      Quotation Test -- see ecQuotationFormatHint in types/testing.ts).
 *
 * A plain numeric EC number is deliberately NOT used: the same kind of number
 * appears on both EC Based and Quotation reports, so it can't tell them apart.
 * Anything the report doesn't state lands in "none" -- shown as its own
 * bucket rather than guessed into a real category.
 */
import { REQUISITION_CATEGORIES } from "@/types/testing";

export const REPORT_CATEGORY_NONE = "none";

/** Display order for the category-wise reports view. */
export const REPORT_CATEGORY_ORDER: string[] = [...REQUISITION_CATEGORIES, REPORT_CATEGORY_NONE];

export const reportCategoryLabel = (key: string): string => (key === REPORT_CATEGORY_NONE ? "Not stated on the report" : key);

export const isReportCategoryKey = (value: string | null | undefined): value is string =>
  !!value && REPORT_CATEGORY_ORDER.includes(value);

// First match wins, so the more specific patterns come first. Each is tested
// against the words after "Category:" (or against the EC number text).
const CATEGORY_PATTERNS: [RegExp, string][] = [
  [/improvement/i, "Against Improvement Project"],
  [/die\s*pin\s*rework/i, "Against Die Pin Rework"],
  [/new\s*die\s*pin/i, "Against New Die Pin"],
  [/qu[ao]tation/i, "Against Quotation Test"], // "Quotation test" and the sheets' "Quatation test"
  [/pump\s*testing/i, "Against Pump Testing Project"],
  [/r\s*&\s*d/i, "Against R&D Trials"], // "R&D Trials" and the sheets' "R&D Trails"
  [/^ec\b/i, "Against EC Based"], // "EC Based", "Ec Test", "EC Test"
];

const fromWords = (words: string): string | null => {
  for (const [pattern, category] of CATEGORY_PATTERNS) if (pattern.test(words)) return category;
  return null;
};

/** The category a report states for itself, or "none". A report filed against a requisition takes
 * that requisition's category (pass it as `requisitionCategory`) -- the requisition is where the
 * category was actually chosen. Standalone reports (every legacy import) have no requisition, so
 * for them only the report's own remarks / EC number count, as before. */
export function reportCategoryOf(report: { remarks: string | null; ecNo: string | null; requisitionCategory?: string | null }): string {
  const note = /Category:\s*(.+?)\s*$/i.exec(report.remarks ?? "");
  if (note) {
    const fromNote = fromWords(note[1]);
    if (fromNote) return fromNote;
  }

  const fromRequisition = report.requisitionCategory ? fromWords(report.requisitionCategory.replace(/^Against\s+/i, "")) : null;
  if (fromRequisition) return fromRequisition;

  const ec = (report.ecNo ?? "").trim();
  if (ec) {
    if (/new\s*die\s*pin/i.test(ec)) return "Against New Die Pin";
    if (/^EC\/\d{2}\//i.test(ec)) return "Against EC Based";
    if (/^RIL\/QT\//i.test(ec)) return "Against Quotation Test";
  }
  return REPORT_CATEGORY_NONE;
}
