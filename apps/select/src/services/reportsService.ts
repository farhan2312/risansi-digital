import apiClient from "./apiClient";

// One row per TAG with a saved final Selection Summary report (see
// /api/reports). Reports are per-tag now that each tag has its own wizard.
export interface ReportRecord {
  tag_id: string;
  tag_name: string;
  project_id: string;
  project_code: string;
  project_name: string | null;
  client_code: string | null;
  /** Status of the TAG (not the project) - Completed once its final report
   *  is generated. */
  status: string | null;
  created_by_name: string | null;
  document_filename: string | null;
  document_generated_at: string | null;
}

export const listReports = async (): Promise<ReportRecord[]> => {
  const { data } = await apiClient.get<ReportRecord[]>("/reports");
  return data;
};

/** Direct download URL for a tag's saved final report - hits the binary
 * document route (see /api/enquiry-tags/[id]/report) rather than going
 * through apiClient, since this is meant to be used as a plain <a href> /
 * window.open target, not fetched into JS. */
export const reportDownloadUrl = (tagId: string): string =>
  `/api/enquiry-tags/${encodeURIComponent(tagId)}/report`;

/** Uploads the generated Selection Summary PDF's raw bytes so it's saved on
 * the tag (and shows up in the Reports list) - called from "Confirm Pump
 * Selection" on the last wizard step. Raw binary body (not JSON). */
export const uploadFinalReport = async (
  tagId: string,
  filename: string,
  bytes: ArrayBuffer,
): Promise<void> => {
  await apiClient.post(`/enquiry-tags/${encodeURIComponent(tagId)}/report`, bytes, {
    params: { filename },
    headers: { "Content-Type": "application/pdf" },
  });
};

// Structured mirror of the PDF's own content (see selection-summary-pdf.ts)
// - one field-value list for the confirmed pump, then one section per
// wizard step, so the Reports list can render a summary on click.
export type ReportSummaryField = [string, string | undefined];

export interface ReportSummarySection {
  title: string;
  items: ReportSummaryField[];
  /** Rendered in the app's positive/confirmed green - the Drive step's
   * selected V-Belt/Gearbox option. */
  highlight?: boolean;
}

export interface ReportSummary {
  pumpFields: ReportSummaryField[];
  sections: ReportSummarySection[];
}

/** Saves the structured summary snapshot alongside the PDF - same "Confirm
 * Pump Selection" action, a separate call since the PDF upload's body is
 * raw binary, not JSON. */
export const saveReportSummary = async (
  tagId: string,
  summary: ReportSummary,
): Promise<void> => {
  await apiClient.put(
    `/enquiry-tags/${encodeURIComponent(tagId)}/report-summary`,
    summary,
  );
};

/** Loads a tag's saved report summary. Returns null if none exists yet - not
 * an error state. */
export const getReportSummary = async (tagId: string): Promise<ReportSummary | null> => {
  try {
    const { data } = await apiClient.get<ReportSummary>(
      `/enquiry-tags/${encodeURIComponent(tagId)}/report-summary`,
    );
    return data;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw err;
  }
};
