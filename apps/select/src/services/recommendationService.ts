import apiClient from "./apiClient";
import type {
  PumpRecommendation,
  PumpSelectionFormData,
} from "../data/Recommendations";

type RecommendationsResponse = {
  input: { capacity: string; head: string };
  /** Every pump_model_master model that satisfies the duty point — no
   * ranking/limit, selection is manual. */
  recommendations: PumpRecommendation[];
};

export const getRecommendations = async (
  formData: PumpSelectionFormData
): Promise<RecommendationsResponse> => {
  const { data } = await apiClient.post<RecommendationsResponse>(
    "/recommendations",
    formData
  );
  return data;
};

/** Live wizard preview — same engine and same full result set; kept as a
 * separate call so the panel that refreshes on every keystroke has its own
 * debounce/cancel lifecycle. Nothing is persisted either way yet. */
export const previewRecommendations = async (
  formData: PumpSelectionFormData,
  signal?: AbortSignal
): Promise<RecommendationsResponse> => {
  const { data } = await apiClient.post<RecommendationsResponse>(
    "/recommendations?preview=1",
    formData,
    { signal }
  );
  return data;
};

export type ReportField = {
  label: string;
  value: string | number | null;
  available: boolean;
  note: string | null;
  /** AI-generated (Claude) suggestion for fields with no source master data.
   * Distinct from `value` — never tested/calculated, always flagged as such. */
  aiSuggestion?: string | null;
};

export type ReportSection = {
  title: string;
  fields: ReportField[];
};

export type SelectionReport = {
  recommendationId: string;
  model: string;
  mocCodeUsed: string;
  sections: ReportSection[];
};

export const getSelectionReport = async (
  recommendationId: string
): Promise<SelectionReport> => {
  const { data } = await apiClient.get<SelectionReport>(
    `/recommendations/${recommendationId}/report`
  );
  return data;
};
