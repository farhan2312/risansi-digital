import apiClient from "./apiClient";
import type { CommercialPrices, CommercialSummary } from "../lib/commercial";

/** The enquiry's Commercial Summary: every tag with its quantity and prices. */
export const getCommercialSummary = async (projectId: string): Promise<CommercialSummary> => {
  const { data } = await apiClient.get<CommercialSummary>("/commercial", { params: { projectId } });
  return data;
};

/** Saves the one remarks note for the whole Commercial Summary. */
/** Answers a flagged price: the new item's master price, or keep the old one. */
export const answerPriceChange = async (tagId: string, key: string, useNew: boolean): Promise<{ price: number; model: string | null }> => {
  const { data } = await apiClient.patch<{ price: number; model: string | null }>(`/commercial/${tagId}`, { key, useNew });
  return data;
};

/** Takes a flagged line off, when the selection no longer has it. */
export const removeFlaggedPrice = async (tagId: string, key: string): Promise<void> => {
  await apiClient.patch(`/commercial/${tagId}`, { key, remove: true });
};

/** The notes about items removed by themselves were seen. */
export const dismissRemovedBoi = async (tagId: string): Promise<void> => {
  await apiClient.patch(`/commercial/${tagId}`, { dismissRemoved: true });
};

/** The Prices reviewed tick on a new version. */
export const setPricesReviewed = async (projectId: string, reviewed: boolean): Promise<{ pricesReviewedAt: string | null }> => {
  const { data } = await apiClient.put<{ pricesReviewedAt: string | null }>("/commercial/reviewed", { projectId, reviewed });
  return data;
};

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
