// Order Making's filter: who the SO is for (zone, rep, market), what it is
// (type, bill mode, bill type), when (SO date or PO date), how far its details
// are filled, and its order. Carried in the URL, like the other queues.
//
// Plain module (no server imports): the page, the filter bar and the query
// read one definition.

import { BILL_TYPE_OPTIONS } from "@/lib/order-schema";
import {
  BILL_MODE_FILTER_OPTIONS,
  NOT_SET,
  type OrderListFilter,
} from "@/lib/order-list-filter";

export const BILL_TYPE_FILTER_OPTIONS = [...BILL_TYPE_OPTIONS.map((o) => o.value), NOT_SET];
export { BILL_MODE_FILTER_OPTIONS };

export const OM_DATE_FIELDS = [
  { value: "so_date", label: "SO date" },
  { value: "po_date", label: "PO date" },
  { value: "op_date", label: "SO sent to Operation" },
] as const;
export type OmDateField = (typeof OM_DATE_FIELDS)[number]["value"];

/** Sl. No., SO date or number of ECs, either way ("-" = latest / most first). Default: newest Sl. No. first. */
export type OmSort = "sl" | "-sl" | "so_date" | "-so_date" | "ecs" | "-ecs";
const SORTS: OmSort[] = ["sl", "-sl", "so_date", "-so_date", "ecs", "-ecs"];

export type OrderMakingFilter = {
  /** What the summary cards count over: this filter less the card clicked (cardBaseGet). */
  kpiFilter?: OrderMakingFilter;
  zones: string[];
  reps: string[];
  markets: string[];
  types: string[];
  billModes: string[];
  billTypes: string[];
  dateField: OmDateField;
  from: string | null;
  to: string | null;
  missingOnly: boolean;
  /** On hold: by Order Making itself ("om"), or by anyone ("all"). */
  hold: "om" | "all" | null;
  /** Whose SOs: Order Making SO member ids, and/or UNASSIGNED. */
  assignees: string[];
  /** The Sales Order details: still pending, or filled. */
  soState: "pending" | "filled" | null;
  /** SO Sent to Operation: its date entered (yes) or not (no). */
  sentOps: "yes" | "no" | null;
  sort: OmSort | null;
};

/** The "nobody yet" choice in the Assigned to filter. */
export const UNASSIGNED = "none";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every parameter the filter owns — what "Clear all" empties. */
export const OM_FILTER_KEYS = ["zone", "rep", "market", "type", "bmode", "btype", "datefield", "from", "to", "missing", "asg", "sos", "omhold", "sops"];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const list = (v: string | undefined) => [...new Set((v ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
const date = (v: string | undefined) => (v && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

export function parseOrderMakingFilter(get: (key: string) => string | undefined): OrderMakingFilter {
  let from = date(get("from"));
  let to = date(get("to"));
  if (from && to && from > to) [from, to] = [to, from];
  const sort = get("sort");
  return {
    zones: list(get("zone")),
    reps: list(get("rep")),
    markets: list(get("market")),
    types: list(get("type")),
    billModes: list(get("bmode")).filter((v) => BILL_MODE_FILTER_OPTIONS.includes(v)),
    billTypes: list(get("btype")).filter((v) => BILL_TYPE_FILTER_OPTIONS.includes(v)),
    dateField: OM_DATE_FIELDS.find((d) => d.value === get("datefield"))?.value ?? "so_date",
    from,
    to,
    missingOnly: get("missing") === "1",
    hold: get("omhold") === "om" || get("omhold") === "all" ? (get("omhold") as "om" | "all") : null,
    assignees: list(get("asg")).filter((v) => v === UNASSIGNED || UUID.test(v)),
    soState: get("sos") === "pending" || get("sos") === "filled" ? (get("sos") as "pending" | "filled") : null,
    sentOps: get("sops") === "yes" || get("sops") === "no" ? (get("sops") as "yes" | "no") : null,
    sort: SORTS.includes(sort as OmSort) ? (sort as OmSort) : null,
  };
}

export function isOrderMakingFiltered(f: OrderMakingFilter): boolean {
  return !!(
    f.zones.length ||
    f.reps.length ||
    f.markets.length ||
    f.types.length ||
    f.billModes.length ||
    f.billTypes.length ||
    f.from ||
    f.to ||
    f.missingOnly ||
    f.hold ||
    f.assignees.length ||
    f.soState ||
    f.sentOps
  );
}

/**
 * The facets the shared orders-list filter already knows how to put into SQL
 * — zone, rep, market, type, bill mode and an SO-date range. Bill type and a
 * PO-date range are Order Making's own (see listOrdersForOrderMaking).
 */
export function sharedFacets(f: OrderMakingFilter): OrderListFilter {
  return {
    search: "",
    zones: f.zones,
    reps: f.reps,
    markets: f.markets,
    types: f.types,
    dept: null,
    deptStatuses: [],
    deptStatusMulti: {},
    signOff: null,
    dateField: "so_date",
    from: f.dateField === "so_date" ? f.from : null,
    to: f.dateField === "so_date" ? f.to : null,
    overdue: false,
    ready: false,
    noSlip: false,
    onHold: false,
    onlyBilling: false,
    field: null,
    paymentTerms: [],
    billModes: f.billModes,
    paymentStatuses: [],
    dispatchStatuses: [],
    dispatchStages: [],
    packingStatuses: [],
    clearance: [],
    holdReasons: [],
    accountsHold: [],
    accountsHoldReasons: [],
  };
}
