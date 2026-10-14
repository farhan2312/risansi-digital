// The orders-list filter: the same set the central dashboard offers, carried
// in the URL so it narrows the whole table in SQL rather than the page on
// screen, and so the Export button can send exactly the SOs being looked at.
//
// Plain module (no server imports): the filter bar, the page, the export
// route and the SQL builder all read one definition.

import { DEPT_VIEWS } from "@/lib/dept-view";
import { isRep } from "@/lib/roles";
import { DISPATCH_STAGES } from "@/lib/dispatch-steps";
import {
  BILL_MODE_OPTIONS,
  CLEARANCE_HOLD_REASONS,
  CLEARANCE_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  PAYMENT_TERM_OPTIONS,
  SECTION_BY_TABLE,
  type OrderField,
} from "@/lib/order-schema";
import {
  DEPT_FILTER_KEYS,
  DEPT_FILTER_LABELS,
  statusesFor,
  PLANNING_PACKING_OPTIONS,
  type DeptFilterKey,
} from "@/lib/dept-status";

export const ORDER_DATE_FIELDS = [
  // Inside a department's own queue this is the date that matters: the one it
  // is judged against. Which column that is depends on the department — see
  // DEPT_TARGET_COLUMN — so it is chosen by meaning, not by column name.
  { value: "dept_target", label: "Target date" },
  // Planning's own date: when it says an EC will be ready.
  { value: "readiness", label: "Readiness date" },
  // Assembly & Packing's own: when it plans to pack a Spare's lot.
  { value: "packing", label: "Packing date" },
  { value: "dispatch_target", label: "Dispatch target" },
  { value: "so_date", label: "SO date" },
  { value: "ec_date", label: "EC date" },
  { value: "completed_on", label: "Completed on" },
] as const;

export type OrderDateField = (typeof ORDER_DATE_FIELDS)[number]["value"];

export const SIGN_OFF_OPTIONS = [
  { value: "completed", label: "Completed" },
  { value: "not_completed", label: "Not completed" },
] as const;

export type SignOff = (typeof SIGN_OFF_OPTIONS)[number]["value"];

/**
 * The SO's own fields the list can be narrowed by — "filled" or "pending" —
 * the Order details form's fields, in its order. A computed value is derived,
 * never typed, so it is nobody's to fill.
 */
export const FIELD_FILTER_FIELDS: OrderField[] = (SECTION_BY_TABLE.get("orders")?.fields ?? []).filter(
  (f) => !f.computed
);

export const FIELD_STATES = [
  { value: "pending", label: "Pending" },
  { value: "filled", label: "Filled" },
] as const;

export type FieldState = (typeof FIELD_STATES)[number]["value"];

/** Billing and Accounts narrow their queues by how the SO is paid and billed. */
export const NOT_SET = "Not set";
export const PAYMENT_TERM_FILTER_OPTIONS = [...PAYMENT_TERM_OPTIONS.map((o) => o.value), NOT_SET];
export const BILL_MODE_FILTER_OPTIONS = [...BILL_MODE_OPTIONS.map((o) => o.value), NOT_SET];
/** Accounts' payment status on the SO (the roll-up of its PIs), for the Orders list. */
export const PAYMENT_STATUS_FILTER_OPTIONS = [...PAYMENT_STATUS_OPTIONS.map((o) => o.value), NOT_SET];
/** Clearance: Clear or Hold; and why an SO is held. */
export const CLEARANCE_FILTER_OPTIONS = CLEARANCE_OPTIONS.map((o) => o.value);
export const HOLD_REASON_FILTER_OPTIONS = CLEARANCE_HOLD_REASONS.map((o) => o.value);

/** The departments that see those two filters. */
export const PAYMENT_FILTER_DEPTS: readonly string[] = ["billing", "accounts"];
/** The departments that filter by Bill Mode: those two, Planning and Assembly & Packing. */
export const BILL_MODE_FILTER_DEPTS: readonly string[] = ["billing", "accounts", "planning", "assembly"];
/** The queues that filter by the SO's dispatch status beside their own status. */
export const DISPATCH_STATUS_FILTER_DEPTS: readonly string[] = ["billing", "planning", "assembly"];

export const DATE_PRESETS = [
  "Today",
  "Yesterday",
  "Tomorrow",
  "Last 7 days",
  // Readiness, packing and target dates lie ahead: what is coming up.
  "Next 7 days",
  "Last 30 days",
  "This month",
  "This year",
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number];

/** Today as an IST calendar date — the dates on an order are IST dates. */
export function todayIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** A preset's [from, to] as IST calendar dates. */
export function presetRange(preset: DatePreset): [string, string] {
  const today = todayIst();
  const shift = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  switch (preset) {
    case "Today":
      return [today, today];
    case "Yesterday":
      return [shift(-1), shift(-1)];
    case "Tomorrow":
      return [shift(1), shift(1)];
    case "Last 7 days":
      return [shift(-6), today];
    case "Next 7 days":
      return [today, shift(7)];
    case "Last 30 days":
      return [shift(-29), today];
    case "This month":
      return [`${today.slice(0, 7)}-01`, today];
    default:
      return [`${today.slice(0, 4)}-01-01`, today];
  }
}

export type OrderListFilter = {
  search: string;
  zones: string[];
  reps: string[];
  /** Set for a Rep or Rep Manager: the only reps they may see (their own, and a manager's team). */
  repScope?: string[];
  markets: string[];
  /** Order type on the SO, or the item type on any of its ECs. */
  types: string[];
  dept: DeptFilterKey | null;
  /** Only with a department — its own words; any of them matches. */
  deptStatuses: string[];
  /**
   * The Orders list: statuses in several departments at once — any of a
   * department's ticked statuses, and every department ticked. URL `dsm`.
   */
  deptStatusMulti: Partial<Record<DeptFilterKey, string[]>>;
  /** Only with a department — whose sign-off it is. */
  signOff: SignOff | null;
  dateField: OrderDateField;
  from: string | null;
  to: string | null;
  /**
   * Only with a department: its target date has passed and its work on the
   * order is not finished. The one question a department asks its own queue
   * that no status answers.
   */
  overdue: boolean;
  /**
   * Dispatch only: Assembly & Packing has packed something on this order, so
   * it can go out. Dispatch comes after them, and this is how their queue
   * says so without hiding anything.
   */
  ready: boolean;
  /** A Spare lot packed but on no packing slip yet (Planning, Assembly & Packing, the Orders list). */
  noSlip: boolean;
  /**
   * One of the SO's own fields, filled or still pending. Pending only counts
   * where the field applies — PO No. on an FR order is not owed.
   */
  field: { column: string; state: FieldState } | null;
  /** Billing / Accounts: any of these payment terms on the SO ("Not set": none). */
  paymentTerms: string[];
  /** Billing / Accounts: the SO's Bill Mode ("Not set": blank). */
  billModes: string[];
  /** Payment status (the Orders list). */
  paymentStatuses: string[];
  /** Billing's queue: the SO's dispatch status. */
  dispatchStatuses: string[];
  /** Dispatch's queue: the SO's stage in Invoice → Dispatch → Docket & LR. */
  dispatchStages: string[];
  /** Planning: Assembly & Packing's status on the same EC. */
  packingStatuses: string[];
  /** The orders list: Clear or Hold. */
  clearance: string[];
  /** The orders list: why the held SOs are held. */
  holdReasons: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function list(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    ),
  ];
}

function date(value: string | undefined): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

/**
 * Read the filter out of the URL. Anything unrecognised is dropped rather than
 * trusted — the values end up in SQL, and a status only counts when it is one
 * the chosen department actually has.
 */
export function parseOrderListFilter(
  get: (key: string) => string | undefined,
  /**
   * The orders list dates by SO date, not by dispatch target: there the
   * dispatch target is not offered, and the default is the SO date.
   */
  opts: { noDispatchTarget?: boolean; pinnedDept?: boolean } = {}
): OrderListFilter {
  const fallbackDate: OrderDateField = opts.noDispatchTarget ? "so_date" : "dispatch_target";
  const deptRaw = get("dept");
  const dept = (DEPT_FILTER_KEYS as readonly string[]).includes(deptRaw ?? "")
    ? (deptRaw as DeptFilterKey)
    : null;
  const statuses = dept ? list(get("dstatus")).filter((s) => statusesFor(dept).includes(s)) : [];
  // The department whose own queue this is; null on the Orders list.
  const queue = opts.pinnedDept ? dept : null;
  const signOffRaw = get("signoff");
  const signOff =
    dept && SIGN_OFF_OPTIONS.some((o) => o.value === signOffRaw)
      ? (signOffRaw as SignOff)
      : null;
  const fieldRaw = get("datefield");
  const dateFieldRaw =
    ORDER_DATE_FIELDS.some((f) => f.value === fieldRaw) &&
    !(opts.noDispatchTarget && fieldRaw === "dispatch_target")
      ? (fieldRaw as OrderDateField)
      : fallbackDate;
  // "Their target" needs a department to belong to; without one it names no
  // column, so it falls back rather than matching nothing. Dispatch's own
  // target is the dispatch target, which its queue no longer dates by.
  const dateField: OrderDateField =
    dateFieldRaw === "dept_target" && (!dept || dept === "dispatch")
      ? (dept ? "so_date" : fallbackDate)
      : dateFieldRaw === "readiness" && dept && !["planning", "assembly", "billing", "dispatch"].includes(dept)
        ? (dept ? "so_date" : fallbackDate)
        : dateFieldRaw === "packing" && dept && !["planning", "assembly", "dispatch"].includes(dept)
          ? (dept ? "so_date" : fallbackDate)
        : dateFieldRaw;

  // Picked backwards, the two dates still mean the span between them.
  let from = date(get("from"));
  let to = date(get("to"));
  if (from && to && from > to) [from, to] = [to, from];

  const fieldRaw2 = get("field");
  const field = FIELD_FILTER_FIELDS.some((f) => f.column === fieldRaw2)
    ? { column: fieldRaw2 as string, state: (get("fstate") === "filled" ? "filled" : "pending") as FieldState }
    : null;

  return {
    search: (get("q") ?? "").trim(),
    zones: list(get("zone")),
    reps: list(get("rep")),
    markets: list(get("market")),
    types: list(get("type")),
    dept,
    deptStatuses: statuses,
    deptStatusMulti: opts.noDispatchTarget ? parseDeptStatusMulti(get("dsm")) : {},
    signOff,
    dateField,
    from,
    to,
    // Dispatch is not chased against its dispatch target any more.
    overdue: get("overdue") === "1" && dept !== "dispatch",
    ready: get("ready") === "1",
    noSlip: get("noslip") === "1" && (!dept || dept === "planning" || dept === "assembly"),
    field,
    // Only where the controls are shown — a hidden filter would narrow
    // without saying so.
    // The Orders list (no department) offers them too.
    // A department picked on the Orders list doesn't take them away — only a
    // department's own queue decides.
    paymentTerms:
      !queue || PAYMENT_FILTER_DEPTS.includes(queue)
        ? list(get("pterm")).filter((v) => PAYMENT_TERM_FILTER_OPTIONS.includes(v))
        : [],
    billModes:
      !queue || BILL_MODE_FILTER_DEPTS.includes(queue)
        ? list(get("bmode")).filter((v) => BILL_MODE_FILTER_OPTIONS.includes(v))
        : [],
    paymentStatuses: !queue ? list(get("pstat")).filter((v) => PAYMENT_STATUS_FILTER_OPTIONS.includes(v)) : [],
    dispatchStatuses:
      queue && DISPATCH_STATUS_FILTER_DEPTS.includes(queue)
        ? list(get("dispst")).filter((v) => statusesFor("dispatch").includes(v))
        : [],
    dispatchStages: queue === "dispatch" ? list(get("dstage")).filter((v) => DISPATCH_STAGES.includes(v)) : [],
    packingStatuses: dept === "planning" ? list(get("pack")).filter((v) => PLANNING_PACKING_OPTIONS.includes(v)) : [],
    clearance: list(get("clear")).filter((v) => CLEARANCE_FILTER_OPTIONS.includes(v)),
    holdReasons: list(get("hreason")).filter((v) => HOLD_REASON_FILTER_OPTIONS.includes(v)),
  };
}

/**
 * A Rep sees only their own SOs, a Rep Manager also their team's
 * (User.rep_names). The Rep filter the URL asks for is kept to those names —
 * a manager may narrow to some of their reps, never reach past them — and
 * with nothing (or nothing of theirs) chosen it is all of them. No names
 * sees nothing. Anyone else, as is.
 */
export function scopeToRep<F extends { reps: string[] }>(
  filter: F,
  user: { role: string; rep_names?: string[] }
): F {
  if (!isRep(user.role)) return filter;
  const scope = user.rep_names?.length ? user.rep_names : ["(no rep linked)"];
  const allowed = new Map(scope.map((n) => [n.trim().toLowerCase(), n]));
  const picked = filter.reps.map((r) => allowed.get(r.trim().toLowerCase())).filter((r): r is string => !!r);
  return { ...filter, reps: picked.length ? picked : scope, repScope: scope };
}

/**
 * `dsm`: "planning~Fully ready,In plan;billing~Pending". A status only counts
 * when that department has it; anything else is dropped.
 */
export function parseDeptStatusMulti(raw: string | undefined): Partial<Record<DeptFilterKey, string[]>> {
  const out: Partial<Record<DeptFilterKey, string[]>> = {};
  for (const part of (raw ?? "").split(";")) {
    const [key, list] = part.split("~");
    if (!(DEPT_FILTER_KEYS as readonly string[]).includes(key ?? "")) continue;
    const dept = key as DeptFilterKey;
    const allowed = statusesFor(dept);
    const picked = [...new Set((list ?? "").split(",").map((s) => s.trim()).filter((s) => allowed.includes(s)))];
    if (picked.length) out[dept] = picked;
  }
  return out;
}

/** The URL form of the above, or null when nothing is ticked. */
export function serializeDeptStatusMulti(m: Partial<Record<DeptFilterKey, string[]>>): string | null {
  const parts = Object.entries(m)
    .filter(([, v]) => v && v.length)
    .map(([k, v]) => `${k}~${(v as string[]).join(",")}`);
  return parts.length ? parts.join(";") : null;
}

/** Whether anything narrows the list at all. */
export function isOrderListFiltered(f: OrderListFilter): boolean {
  return !!(
    f.clearance.length ||
    f.holdReasons.length ||
    f.paymentTerms.length ||
    f.billModes.length ||
    f.paymentStatuses.length ||
    f.dispatchStatuses.length ||
    f.dispatchStages.length ||
    Object.keys(f.deptStatusMulti).length ||
    f.packingStatuses.length ||
    f.field ||
    f.ready ||
    f.noSlip ||
    f.overdue ||
    f.search ||
    f.zones.length ||
    f.reps.length ||
    f.markets.length ||
    f.types.length ||
    f.dept ||
    f.from ||
    f.to
  );
}

/** The filter as URL parameters — for the export link. */
export function orderListFilterParams(f: OrderListFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.search) p.set("q", f.search);
  if (f.zones.length) p.set("zone", f.zones.join(","));
  if (f.reps.length) p.set("rep", f.reps.join(","));
  if (f.markets.length) p.set("market", f.markets.join(","));
  if (f.types.length) p.set("type", f.types.join(","));
  if (f.dept) p.set("dept", f.dept);
  if (f.overdue) p.set("overdue", "1");
  if (f.ready) p.set("ready", "1");
  if (f.noSlip) p.set("noslip", "1");
  if (f.clearance.length) p.set("clear", f.clearance.join(","));
  if (f.holdReasons.length) p.set("hreason", f.holdReasons.join(","));
  if (f.paymentTerms.length) p.set("pterm", f.paymentTerms.join(","));
  if (f.billModes.length) p.set("bmode", f.billModes.join(","));
  if (f.paymentStatuses.length) p.set("pstat", f.paymentStatuses.join(","));
  if (f.dispatchStatuses.length) p.set("dispst", f.dispatchStatuses.join(","));
  if (f.dispatchStages.length) p.set("dstage", f.dispatchStages.join(","));
  if (f.packingStatuses.length) p.set("pack", f.packingStatuses.join(","));
  if (f.field) {
    p.set("field", f.field.column);
    p.set("fstate", f.field.state);
  }
  if (f.deptStatuses.length) p.set("dstatus", f.deptStatuses.join(","));
  const dsm = serializeDeptStatusMulti(f.deptStatusMulti);
  if (dsm) p.set("dsm", dsm);
  if (f.signOff) p.set("signoff", f.signOff);
  if (f.from || f.to) {
    p.set("datefield", f.dateField);
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
  }
  return p;
}

/** One line saying what the list is narrowed to — the export's cover sheet. */
export function describeOrderListFilter(f: OrderListFilter): string {
  const parts: string[] = [];
  if (f.search) parts.push(`Search: ${f.search}`);
  if (f.overdue) parts.push("Overdue only");
  if (f.ready) parts.push("Ready to dispatch");
  if (f.noSlip) parts.push("Packed, no slip");
  if (f.field) {
    const label = FIELD_FILTER_FIELDS.find((x) => x.column === f.field!.column)?.label ?? f.field.column;
    parts.push(`${label}: ${f.field.state === "filled" ? "filled" : "pending"}`);
  }
  if (f.clearance.length) parts.push(`Clearance: ${f.clearance.join(", ")}`);
  if (f.holdReasons.length) parts.push(`Hold reason: ${f.holdReasons.join(", ")}`);
  if (f.paymentTerms.length) parts.push(`Payment terms: ${f.paymentTerms.join(", ")}`);
  if (f.billModes.length) parts.push(`Bill mode: ${f.billModes.join(", ")}`);
  if (f.paymentStatuses.length) parts.push(`Payment status: ${f.paymentStatuses.join(", ")}`);
  if (f.dispatchStatuses.length) parts.push(`Dispatch status: ${f.dispatchStatuses.join(", ")}`);
  if (f.dispatchStages.length) parts.push(`Stage: ${f.dispatchStages.join(", ")}`);
  if (f.packingStatuses.length) parts.push(`Packing: ${f.packingStatuses.join(", ")}`);
  if (f.zones.length) parts.push(`Zone: ${f.zones.join(", ")}`);
  if (f.reps.length) parts.push(`Rep: ${f.reps.join(", ")}`);
  if (f.markets.length) parts.push(`Market: ${f.markets.join(", ")}`);
  if (f.types.length) parts.push(`Type: ${f.types.join(", ")}`);
  if (f.dept) {
    const signed = SIGN_OFF_OPTIONS.find((o) => o.value === f.signOff)?.label;
    parts.push(
      [DEPT_FILTER_LABELS[f.dept], f.deptStatuses.join(" / "), signed?.toLowerCase()]
        .filter(Boolean)
        .join(" · ")
    );
  }
  for (const [k, v] of Object.entries(f.deptStatusMulti)) {
    if (v?.length) parts.push(`${DEPT_FILTER_LABELS[k as DeptFilterKey]}: ${v.join(" / ")}`);
  }
  if (f.from || f.to) {
    const field = ORDER_DATE_FIELDS.find((d) => d.value === f.dateField)?.label;
    parts.push(
      `${field}: ${f.from ?? "…"} to ${f.to ?? "…"}`
    );
  }
  return parts.length ? parts.join("  ·  ") : "All orders";
}

/**
 * The same filter read inside one department's own queue, where the
 * department is not a choice: it is pinned, so a status and a sign-off state
 * are validated against that department's vocabulary even though the URL
 * carries no `dept`.
 */
export function parseDeptFilter(
  get: (key: string) => string | undefined,
  dept: DeptFilterKey | null,
  opts: { noDispatchTarget?: boolean } = {}
): OrderListFilter {
  return parseOrderListFilter((key) => {
    if (key === "dept") return dept ?? get(key);
    // A department's queue dates by the department's own target date, not the
    // order list's dispatch-target default — unless it has no target date at
    // all (Billing, Accounts), when the order's own date is the useful one.
    // An explicit choice still wins.
    if (key === "datefield" && dept) {
      // Planning reads by its readiness date; Assembly & Packing by its own
      // packing date — neither by a target.
      return (
        get(key) ??
        (dept === "assembly"
          ? "packing"
          : dept === "planning"
          ? "readiness"
          : DEPT_VIEWS[dept].hasTarget && dept !== "dispatch"
            ? "dept_target"
            : "so_date")
      );
    }
    return get(key);
  }, { ...opts, pinnedDept: !!dept });
}
