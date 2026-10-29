import apiClient from "./apiClient";
import type { CommercialOfferData, OfferConfig } from "../lib/commercial-offer";

/** The Commercial Offer header lines + each drive group's saved sheet edits. */
export const getCommercialOffer = async (projectId: string): Promise<CommercialOfferData> => {
  const { data } = await apiClient.get<CommercialOfferData>("/commercial-offer", { params: { projectId } });
  return data;
};

/** Saves one drive group's sheet edits (replace-all); returns them cleaned. */
export const saveCommercialOfferConfig = async (projectId: string, group: string, config: OfferConfig): Promise<OfferConfig> => {
  const { data } = await apiClient.put<{ config: OfferConfig }>("/commercial-offer", { projectId, group, config });
  return data.config;
};

/** The Scope of supply / Out of scope lines typed on a document ("" = from
 *  the scope pickers); nothing else of the group's offer config changes. */
export const saveOfferScopeText = async (
  projectId: string,
  group: string,
  lines: { scopeText: string; outOfScopeText: string },
): Promise<void> => {
  await apiClient.put("/commercial-offer/scope", { projectId, group, ...lines });
};
