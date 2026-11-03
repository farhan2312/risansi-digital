import apiClient from "./apiClient";
import type { SpareQuote } from "../lib/spare-quote";

export type SpareQuoteData = {
  quote: SpareQuote;
  enquiryNo: string;
  enquiryDate: string | null;
  clientName: string | null;
};

export const getSpareQuote = async (projectId: string): Promise<SpareQuoteData> => {
  const { data } = await apiClient.get<SpareQuoteData>("/spare-quote", { params: { projectId } });
  return data;
};

/** Adds a spare enquiry's models and parts to another spare enquiry. */
export const copySpareQuote = async (sourceProjectId: string, targetProjectId: string): Promise<void> => {
  await apiClient.post("/spare-quote/copy", { sourceProjectId, targetProjectId });
};

export const saveSpareQuote = async (projectId: string, quote: SpareQuote): Promise<SpareQuote> => {
  const { data } = await apiClient.put<{ quote: SpareQuote }>("/spare-quote", { projectId, quote });
  return data.quote;
};
