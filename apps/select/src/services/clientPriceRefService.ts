import apiClient from "./apiClient";

export interface ClientPriceRef {
  id: string;
  clientCode: string | null;
  clientName: string | null;
  fileName: string;
  /** SharePoint link — opened in a new tab, never modified. */
  url: string;
  fileDate: string | null;
}

/** Reference files for a sales client (by code) and/or matching file-name words. */
export const listClientPriceRefs = async (
  query: { clientCode?: string; q?: string },
  signal?: AbortSignal,
): Promise<ClientPriceRef[]> => {
  const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v && v.trim()));
  const { data } = await apiClient.get<ClientPriceRef[]>("/client-price-refs", { params, signal });
  return data;
};
