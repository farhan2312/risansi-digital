// Purchase's queue filters: the SO's and each EC's Open / Closed, each
// bought-out item's status and its vendor — the same words in the browser
// (boiStatus, the SO view's chips) and in SQL here, so a filter matches what
// the table shows.

import { BOI_ITEM_OPTIONS } from "@/lib/order-schema";
import { boiInHand, boiPartSql, boiReceivedSql, boiStatus, spareEcSql } from "@/lib/dept-view";
import { inListNotHeld, soHoldSql } from "@/lib/dept-status";

export const PURCHASE_STATES = ["Open", "Closed"];
export const BOI_STATUSES = ["Pending", "Partially received", "Fully received"];
/** The bought-out items an EC can list (Others included). */
export const BOI_ITEMS = BOI_ITEM_OPTIONS.map((o) => o.value);

/** The URL params Purchase's own filters live under. */
export const PURCHASE_FILTER_KEYS = { so: "pur_so", ec: "pur_ec", item: "pur_item", boi: "pur_boi", vendor: "pur_vendor" } as const;

/** item and boi go together: an item of that kind at that status (Gear Box, Pending). */
export type PurchaseFilter = { so: string[]; ec: string[]; item: string[]; boi: string[]; vendor: string[] };

const pick = (raw: string | undefined, allowed: string[]) =>
  (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => allowed.includes(v));

/** The filter from the URL. Vendors are kept apart by "|": a name can hold a comma. */
export function parsePurchaseFilter(get: (key: string) => string | undefined): PurchaseFilter {
  return {
    so: pick(get(PURCHASE_FILTER_KEYS.so), PURCHASE_STATES),
    ec: pick(get(PURCHASE_FILTER_KEYS.ec), PURCHASE_STATES),
    item: pick(get(PURCHASE_FILTER_KEYS.item), BOI_ITEMS),
    boi: pick(get(PURCHASE_FILTER_KEYS.boi), BOI_STATUSES),
    vendor: [...new Set((get(PURCHASE_FILTER_KEYS.vendor) ?? "").split("|").map((v) => v.trim()).filter(Boolean))],
  };
}

export function purchaseFilterActive(f: PurchaseFilter): boolean {
  return f.so.length + f.ec.length + f.item.length + f.boi.length + f.vendor.length > 0;
}

type Row = Record<string, unknown>;
const itemsOf = (r: Row) => (Array.isArray(r.boi_items) ? (r.boi_items as Row[]) : []);

/**
 * An EC is Closed once every bought-out item it lists is in hand — or when
 * it lists none (nothing to buy out); Open while any is still to come.
 */
export function ecPurchaseState(r: Row): string {
  const items = itemsOf(r);
  return items.every(boiInHand) ? "Closed" : "Open";
}

/** The SO is Closed once every pump EC on it is; Open while any is. */
export function soPurchaseState(ecs: Row[]): string {
  return ecs.length > 0 && ecs.every((r) => ecPurchaseState(r) === "Closed") ? "Closed" : "Open";
}

/** A bought-out item matches the item-level filters (an empty list matches all). */
export function boiMatches(b: Row, f: PurchaseFilter): boolean {
  return (
    (f.item.length === 0 || f.item.includes(String(b.boi_item ?? "").trim())) &&
    (f.boi.length === 0 || f.boi.includes(boiStatus(b).label)) &&
    (f.vendor.length === 0 || (b.vendor_order === "Yes" && f.vendor.includes(String(b.vendor_name ?? "").trim())))
  );
}

/** The EC row matches the EC- and item-level filters. */
export function ecMatchesPurchaseFilter(r: Row, f: PurchaseFilter): boolean {
  if (f.ec.length && !f.ec.includes(ecPurchaseState(r))) return false;
  if (f.item.length || f.boi.length || f.vendor.length) return itemsOf(r).some((b) => boiMatches(b, f));
  return true;
}

// ---- SQL: the same rules over an item alias b, an EC alias, an SO alias.

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const inList = (expr: string, values: string[]) => `${expr} IN (${values.map(lit).join(", ")})`;

/** A bought-out item's status in SQL, the words boiStatus shows. */
export function boiStatusSql(b: string): string {
  return `(CASE WHEN ${boiReceivedSql(b)} THEN 'Fully received'
                WHEN ${boiPartSql(b)} THEN 'Partially received'
                ELSE 'Pending' END)`;
}

/** An EC's Open / Closed in SQL (alias it). */
export function ecPurchaseStateSql(it: string): string {
  return `(CASE WHEN NOT EXISTS (SELECT 1 FROM order_boi_items eb WHERE eb.item_id = ${it}.id) THEN 'Closed'
                WHEN EXISTS (SELECT 1 FROM order_boi_items eb WHERE eb.item_id = ${it}.id AND NOT ${boiReceivedSql("eb")}) THEN 'Open'
                ELSE 'Closed' END)`;
}

/** The pump ECs of an SO (alias o) — Purchase's ECs; a Spare buys nothing out. */
const pumpEcs = (o: string, cond: string) =>
  `EXISTS (SELECT 1 FROM order_items s WHERE s.order_id = ${o}.id AND NOT (${spareEcSql("s", o)}) AND ${cond})`;

/** The SO's Open / Closed in SQL (alias o): Closed once every pump EC on it is. */
export function soPurchaseStateSql(o: string): string {
  return `(CASE WHEN ${pumpEcs(o, `${ecPurchaseStateSql("s")} = 'Closed'`)}
                 AND NOT ${pumpEcs(o, `${ecPurchaseStateSql("s")} = 'Open'`)} THEN 'Closed'
                ELSE 'Open' END)`;
}

/** An item of an EC (alias it) matching the item-level filters. */
function itemCond(f: PurchaseFilter, it: string): string | null {
  const c: string[] = [];
  if (f.item.length) c.push(inList("TRIM(COALESCE(fb.boi_item, ''))", f.item));
  if (f.boi.length) c.push(inListNotHeld(boiStatusSql("fb"), f.boi, ["Pending"], "o", "purchase"));
  if (f.vendor.length) c.push(`fb.vendor_order = 'Yes' AND ${inList("TRIM(COALESCE(fb.vendor_name, ''))", f.vendor)}`);
  return c.length ? `EXISTS (SELECT 1 FROM order_boi_items fb WHERE fb.item_id = ${it}.id AND ${c.join(" AND ")})` : null;
}

/**
 * The filter as a condition on an SO (alias o): one of its pump ECs matches
 * the EC state and item filters asked for, and the SO's own state is as asked.
 */
export function purchaseFilterSql(f: PurchaseFilter, o = "o"): string {
  const parts: string[] = [];
  const ec: string[] = [];
  if (f.ec.length) ec.push(inListNotHeld(ecPurchaseStateSql("s"), f.ec, ["Open"], o, "purchase"));
  const item = itemCond(f, "s");
  if (item) ec.push(item);
  if (ec.length) parts.push(pumpEcs(o, ec.join(" AND ")));
  if (f.so.length) parts.push(inListNotHeld(soPurchaseStateSql(o), f.so, ["Open"], o, "purchase"));
  return parts.length ? parts.join(" AND ") : "TRUE";
}

/** How many of the SO's (alias o) pump ECs are in this state — a card's figure. */
export function ecCountSql(o: string, state?: string): string {
  return `(SELECT count(*) FROM order_items s WHERE s.order_id = ${o}.id AND NOT (${spareEcSql("s", o)})${
    state ? ` AND ${ecPurchaseStateSql("s")} = ${lit(state)}${state === "Open" ? ` AND NOT ${soHoldSql(o, "purchase")}` : ""}` : ""
  })`;
}

/** How many of the SO's (alias o) bought-out items are at this status (of these kinds, with these vendors) — a card's figure. */
export function boiCountSql(o: string, status: string | null, vendors: string[] = [], items: string[] = []): string {
  const c: string[] = [];
  if (items.length) c.push(inList("TRIM(COALESCE(cb.boi_item, ''))", items));
  if (status) c.push(`${boiStatusSql("cb")} = ${lit(status)}${status === "Pending" ? ` AND NOT ${soHoldSql(o, "purchase")}` : ""}`);
  if (vendors.length) c.push(`cb.vendor_order = 'Yes' AND ${inList("TRIM(COALESCE(cb.vendor_name, ''))", vendors)}`);
  return `(SELECT count(*) FROM order_boi_items cb JOIN order_items s ON s.id = cb.item_id
            WHERE s.order_id = ${o}.id AND NOT (${spareEcSql("s", o)})${c.length ? ` AND ${c.join(" AND ")}` : ""})`;
}
