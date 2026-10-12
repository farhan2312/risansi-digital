import apiClient from "./apiClient";
import type { PaPriceData } from "../lib/pa-price";

/** The L1–L4 P&A price lists, for the Commercial Summary's P&A suggestion. */
export const getPaPriceList = async (): Promise<PaPriceData> => {
  const { data } = await apiClient.get<PaPriceData>("/pa-price-list");
  return data;
};
