// The enquiry filters shared by the Enquiries list and the Dashboard (and its
// KPI lists): client, primary rep, secondary rep, zone, market type, industry
// and status. Client-safe; the SQL is in enquiry-filters-server.ts.

export type EnquiryFilters = {
  /** Words matched in the client name or code. */
  client?: string;
  primaryRep?: string;
  /** One of the enquiry's secondary reps. */
  secondaryRep?: string;
  zone?: string;
  market?: string;
  industry?: string;
  /** The enquiry's status rolled up from its tags. */
  status?: string;
};

export const ENQUIRY_FILTER_KEYS = ["client", "primaryRep", "secondaryRep", "zone", "market", "industry", "status"] as const;

export const ENQUIRY_STATUSES = ["Pending", "In Progress", "Completed"] as const;

/** The filters as query params (blank ones left out). */
export function filterParams(f: EnquiryFilters | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ENQUIRY_FILTER_KEYS) {
    const v = f?.[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

/** Read back from a request's query string. */
export function filtersFromParams(p: URLSearchParams): EnquiryFilters {
  const out: EnquiryFilters = {};
  for (const k of ENQUIRY_FILTER_KEYS) {
    const v = p.get(k)?.trim();
    if (v) out[k] = v.slice(0, 200);
  }
  return out;
}

export const hasEnquiryFilters = (f: EnquiryFilters | undefined): boolean => Object.keys(filterParams(f)).length > 0;

/** Values offered in the filter dropdowns (GET /api/projects/filter-options). */
export type EnquiryFilterOptions = {
  primaryReps: string[];
  secondaryReps: string[];
  zones: string[];
  markets: string[];
  industries: string[];
};
