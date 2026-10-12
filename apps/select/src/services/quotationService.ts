import apiClient from "./apiClient";
import type { QuotationInfo, TsmOption } from "../lib/commercial";

/** One drive group's quotation for the enquiry (null if not created yet) and
 *  the client's rep in sales (the locked TSM; null if none). */
export const getQuotation = async (
  projectId: string,
  group: string,
): Promise<{ quotation: QuotationInfo | null; clientTsm: TsmOption | null }> => {
  const { data } = await apiClient.get("/quotations", { params: { projectId, group } });
  return data;
};

/** Active sales reps / managers who can be the TSM (read from sales). */
export const listTsmOptions = async (): Promise<TsmOption[]> => {
  const { data } = await apiClient.get<TsmOption[]>("/quotations/tsm-options");
  return data;
};

export const createQuotation = async (
  projectId: string,
  group: string,
  tsmRepId?: number,
  erpSerial?: string,
): Promise<QuotationInfo> => {
  const { data } = await apiClient.post<QuotationInfo>("/quotations", { projectId, group, tsmRepId, erpSerial });
  return data;
};

/** Sets (or clears, with "") the quotation's ERP serial — no new version. */
export const setQuotationErpSerial = async (id: string, erpSerial: string): Promise<QuotationInfo> => {
  const { data } = await apiClient.patch<QuotationInfo>(`/quotations/${id}`, { erpSerial });
  return data;
};

/** Sets the TSM (only allowed to the client's rep, or any when the client has none) — no new version. */
export const changeQuotationTsm = async (id: string, tsmRepId: number): Promise<QuotationInfo> => {
  const { data } = await apiClient.patch<QuotationInfo>(`/quotations/${id}`, { tsmRepId });
  return data;
};

/** Records a send to the client — creates the next client version. */
export const sendQuotationToClient = async (id: string): Promise<QuotationInfo> => {
  const { data } = await apiClient.post<QuotationInfo>(`/quotations/${id}/send`);
  return data;
};

/** The TSM asked for changes (call BEFORE making them): freezes the live
 *  internal version and starts the next one, live, with what was asked. */
export const newInternalVersion = async (id: string, note: string): Promise<QuotationInfo> => {
  const { data } = await apiClient.post<QuotationInfo>(`/quotations/${id}/internal-version`, {
    note,
    requestedBy: "TSM",
  });
  return data;
};
