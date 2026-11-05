import apiClient from "./apiClient";
import type { OperationDoc, SavedDocs } from "../lib/saved-docs";

/** The enquiries sent to operation, pump or spare; mine = the ones the caller created. */
export const listOperationDocs = async (type: "pump" | "spare", mine = false): Promise<OperationDoc[]> => {
  const { data } = await apiClient.get<OperationDoc[]>("/operation-docs", { params: { type, ...(mine ? { mine: 1 } : {}) } });
  return data;
};

/** Operation confirms this version was mailed to the client. */
export const markOperationDocMailed = async (projectId: string): Promise<{ mailedAt: string }> => {
  const { data } = await apiClient.post<{ mailedAt: string }>(`/operation-docs/${projectId}/mailed`);
  return data;
};

/** One enquiry version's saved documents. */
export const getOperationDocs = async (projectId: string): Promise<SavedDocs> => {
  const { data } = await apiClient.get<SavedDocs>(`/operation-docs/${projectId}`);
  return data;
};
