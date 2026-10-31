import apiClient from "./apiClient";

/** One client from the Market Intell client master (read-only lookup source
 * for the Create Enquiry form). `code` is the client code, `legal_name` the
 * client name. */
export interface ClientLookupRow {
  code: string;
  legal_name: string;
  industry: string | null;
  /** "Domestic" | "Export". */
  market_type: string | null;
  /** The client's tour-route zone, e.g. "West". */
  zone: string | null;
  primary_rep: string | null;
  /** Comma-separated names. */
  secondary_reps: string | null;
}

/** Typeahead over client code / legal name. Returns [] for queries shorter
 * than 2 characters (the route enforces the same floor). */
export const searchClients = async (
  q: string,
  signal?: AbortSignal,
): Promise<ClientLookupRow[]> => {
  const { data } = await apiClient.get<ClientLookupRow[]>("/clients/search", {
    params: { q },
    signal,
  });
  return data;
};
