/** Shared shape of the selection report (matches the old build_selection_report
 * output and the frontend's recommendationService types). */
export interface ReportField {
  label: string;
  value: string | number | null;
  available: boolean;
  note: string | null;
  /** AI-generated (Claude) suggestion for fields with no source master data.
   * Distinct from `value` — never tested/calculated, always flagged as such. */
  aiSuggestion?: string | null;
}

export interface ReportSection {
  title: string;
  fields: ReportField[];
}

export interface SelectionReport {
  recommendationId: string;
  model: string;
  mocCodeUsed: string;
  sections: ReportSection[];
}
