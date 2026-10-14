import apiClient from "./apiClient";
import type { CommercialPrices, CommercialSummary } from "../lib/commercial";

/** The enquiry's Commercial Summary: every tag with its quantity and prices. */
export const getCommercialSummary = async (projectId: string): Promise<CommercialSummary> => {
  const { data } = await apiClient.get<CommercialSummary>("/commercial", { params: { projectId } });
  return data;
};

/** Saves the one remarks note for the whole Commercial Summary. */
export const saveCommercialRemarks = async (projectId: string, remarks: string): Promise<void> => {
  await apiClient.put("/commercial/remarks", { projectId, remarks });
};

/** Saves one tag's full price set (replace-all). */
export const saveCommercialPrices = async (
  tagId: string,
  prices: CommercialPrices,
): Promise<{ ok: boolean; changed: boolean }> => {
  const { data } = await apiClient.put(`/commercial/${tagId}`, prices);
  return data;
};

/** The Quote in USD toggle: USD fixes the current USD -> INR rate on the
 *  enquiry (refreshRate re-takes it); INR clears it. */
export const setQuoteCurrency = async (
  projectId: string,
  currency: "INR" | "USD",
  refreshRate = false,
): Promise<{ quoteCurrency: "INR" | "USD"; usdInrRate: number | null }> => {
  const { data } = await apiClient.put("/commercial/currency", { projectId, currency, refreshRate });
  return data;
};
