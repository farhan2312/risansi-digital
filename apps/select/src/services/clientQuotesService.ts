import apiClient from "./apiClient";
import type { ClientQuoteHistory, ClientQuoteHit } from "../lib/client-quotes";

/** Clients with a price history whose name or code matches every word. */
export const searchClientQuotes = async (q: string, signal?: AbortSignal): Promise<ClientQuoteHit[]> => {
  const { data } = await apiClient.get<ClientQuoteHit[]>("/client-quotes/search", { params: { q }, signal });
  return data;
};

/** A client's quotations (every version's prices) and SharePoint price files. */
export const getClientQuotes = async (client: { clientCode: string | null; clientName: string }): Promise<ClientQuoteHistory> => {
  const params = client.clientCode ? { clientCode: client.clientCode } : { clientName: client.clientName };
  const { data } = await apiClient.get<ClientQuoteHistory>("/client-quotes", { params });
  return data;
};
