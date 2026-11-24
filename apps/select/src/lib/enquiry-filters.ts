// The enquiry filters shared by the Enquiries list and the Dashboard (and its
// KPI lists): client, order type, primary rep, secondary rep, zone, market
// type, industry and the two statuses. Every filter but the client search is multi-select. Client-safe;
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
  /** A pump's Technical status. */
  status?: string[];
  /** A pump's Commercial status. */
  commercialStatus?: string[];
  /** With both statuses picked (user, 2026-11-25): "any" = either one matches (Technical
   *  Pending or Commercial Pending, in one list); left out = both must match. */
  statusMatch?: "any";
  /** A spare's one status, independent of the pump ones (user, 2026-11-06). */
  spareStatus?: string[];
  /** The person the enquiry is assigned to, by name (user, 2026-11-13). */
  assignee?: string[];
  /** Where it is with operation (user, 2026-11-19): OPERATION_STATES. */
  operation?: string[];
};

/** The Sent to operation filter's values: sent, or not sent yet (no review step since 2026-11-25). */
export const OPERATION_STATES = ["Sent to operation", "Not sent"] as const;

export const MULTI_FILTER_KEYS = ["orderType", "pumpType", "spareType", "primaryRep", "secondaryRep", "zone", "market", "industry", "status", "commercialStatus", "spareStatus", "assignee", "operation"] as const;
export type MultiFilterKey = (typeof MULTI_FILTER_KEYS)[number];

/** Not Quoted, Regret and Sent to client are only ever picked by hand on the Edit form
 *  (Regret: user, 2026-11-07). */
export const ENQUIRY_STATUSES = ["Pending", "In Progress", "Completed", "Not Quoted", "Regret", "Sent to client"] as const;

/** A new version can be made from this "status" (Technical, or a spare's one status):
 *  the work is done, and Sent to client comes after Completed. */
export const versionReady = (status: string | null | undefined): boolean => status === "Completed" || status === "Sent to client";

/** The Enquiries list's column sorts, in order of priority (user, 2026-11-06): client
 *  name, primary rep, enquiry date, assigned person. Empty = newest created first. */
export const ENQUIRY_SORT_KEYS = ["client", "rep", "date", "assignee"] as const;
export type EnquirySortKey = (typeof ENQUIRY_SORT_KEYS)[number];
export type EnquirySort = { key: EnquirySortKey; dir: "asc" | "desc" }[];

/** "date:desc,client:asc" as the `sort` query param. */
export const sortParam = (sort: EnquirySort | undefined): string | undefined =>
  sort?.length ? sort.map((s) => `${s.key}:${s.dir}`).join(",") : undefined;

/** Read back; anything unknown or repeated is dropped. */
export function sortFromParam(raw: string | null): EnquirySort {
  const out: EnquirySort = [];
  for (const part of (raw ?? "").split(",").slice(0, ENQUIRY_SORT_KEYS.length)) {
    const [key, dir] = part.split(":");
    if ((ENQUIRY_SORT_KEYS as readonly string[]).includes(key) && (dir === "asc" || dir === "desc") && !out.some((s) => s.key === key)) {
      out.push({ key: key as EnquirySortKey, dir });
    }
  }
  return out;
}

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
  if (f?.statusMatch === "any") out[param("statusMatch")] = "any";
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
  if (p.get(param("statusMatch")) === "any") out.statusMatch = "any";
  return out;
}

/** The Match switch alone filters nothing. */
export const hasEnquiryFilters = (f: EnquiryFilters | undefined): boolean =>
  Object.keys(filterParams(f)).some((k) => k !== param("statusMatch"));

/** Values offered in the filter dropdowns (GET /api/projects/filter-options):
 *  one entry per value, in its most used spelling. */
export type EnquiryFilterOptions = {
  primaryReps: string[];
  secondaryReps: string[];
  zones: string[];
  markets: string[];
  industries: string[];
  /** Everyone some enquiry is assigned to. */
  assignees: string[];
};
