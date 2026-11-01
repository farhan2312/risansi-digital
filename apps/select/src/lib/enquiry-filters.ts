// The enquiry filters shared by the Enquiries list and the Dashboard (and its
// KPI lists): client, order type, primary rep, secondary rep, zone, market
// type, industry and status. Every filter but the client search is multi-select. Client-safe;
// the SQL is in enquiry-filters-server.ts.

export type EnquiryFilters = {
  /** Words matched in the client name or code. */
  client?: string;
  /** "Pump" / "Spare". */
  orderType?: string[];
  /** PCP / MMP / Barrel / Online blind (lib/roles ORDER_SUBTYPES). */
  pumpType?: string[];
  /** Spare / Retrofit spare. */
  spareType?: string[];
  primaryRep?: string[];
  /** Any one of the enquiry's secondary reps. */
  secondaryRep?: string[];
  zone?: string[];
  market?: string[];
  industry?: string[];
  /** The enquiry's status rolled up from its tags. */
  status?: string[];
};

export const MULTI_FILTER_KEYS = ["orderType", "pumpType", "spareType", "primaryRep", "secondaryRep", "zone", "market", "industry", "status"] as const;
export type MultiFilterKey = (typeof MULTI_FILTER_KEYS)[number];

export const ENQUIRY_STATUSES = ["Pending", "In Progress", "Completed"] as const;

/** Picked values travel as one param joined by this (no value contains it). */
const SEP = "|";

/** Every filter's query param is prefixed, so none can collide with a route's
 *  own params - /api/dashboard/list has its own `status` (all | Pending | ... ,
 *  the KPI card), and an unprefixed filter read it as "enquiry status = all"
 *  and matched nothing. */
const param = (k: string) => `f_${k}`;

/**
 * How two spellings of one value are told apart from two values: case,
 * spaces and punctuation are ignored ("Sugar" = "SUGAR", "Biogas" = "BIO GAS").
 * The SQL side (enquiry-filters-server) compares the same way.
 */
export const filterKey = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The filters as query params (blank ones left out). */
export function filterParams(f: EnquiryFilters | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const client = f?.client?.trim();
  if (client) out[param("client")] = client;
  for (const k of MULTI_FILTER_KEYS) {
    const v = (f?.[k] ?? []).map((x) => x.trim()).filter(Boolean);
    if (v.length) out[param(k)] = v.join(SEP);
  }
  return out;
}

/** Read back from a request's query string. */
export function filtersFromParams(p: URLSearchParams): EnquiryFilters {
  const out: EnquiryFilters = {};
  const client = p.get(param("client"))?.trim();
  if (client) out.client = client.slice(0, 200);
  for (const k of MULTI_FILTER_KEYS) {
    const v = (p.get(param(k)) ?? "")
      .split(SEP)
      .map((x) => x.trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 50);
    if (v.length) out[k] = v;
  }
  return out;
}

export const hasEnquiryFilters = (f: EnquiryFilters | undefined): boolean => Object.keys(filterParams(f)).length > 0;

/** Values offered in the filter dropdowns (GET /api/projects/filter-options):
 *  one entry per value, in its most used spelling. */
export type EnquiryFilterOptions = {
  primaryReps: string[];
  secondaryReps: string[];
  zones: string[];
  markets: string[];
  industries: string[];
};
