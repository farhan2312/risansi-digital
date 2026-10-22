// Which of an SO's own details Central Visibility has not filled in yet.
//
// The list of fields is not kept here — it is the Order details section from
// order-schema.ts, the same definition the form renders. A field is only
// counted as missing when it applies: `dependsOn` gates it off (LD Date with
// LD = No, the Purchase target with BOI = No) it is not a gap, exactly as the
// form does not show it.
//
// The check runs in SQL rather than over loaded rows so the modal can page and
// search across every SO without shipping the tracker to the browser.

import { query } from "@/lib/db";
import { SECTION_BY_TABLE, SO_DETAIL_FIELDS, type OrderField } from "@/lib/order-schema";
import { deptInvolvementSql, orderOpenSql } from "@/lib/dept-view";

export type OrderGapRow = {
  id: string;
  sl_no: number;
  so_no: string | null;
  client_name: string | null;
  so_date: string | null;
  order_type: string | null;
  /** The labels of the fields still blank, in the order the form shows them. */
  missing: string[];
};

/** A string literal for SQL — labels and option values come from the schema. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Fields whose blankness is the normal state, not an omission. A revised
 * dispatch date only exists once a date has actually been moved, so an order
 * running to its original target is not waiting on anything.
 */
const NOT_A_GAP = new Set([
  "dispatch_target_revised_date",
  "payment_terms_remarks",
  "master_reason_of_delay",
  "so_remarks",
  "clearance_remarks",
  // Order Making's hold is a decision, not a detail to fill.
  "om_status",
  "om_hold_reason",
  "om_hold_remarks",
  // Only Billing is a switch, not a detail to fill.
  "only_billing",
  "only_billing_remarks",
]);

/** The fields the check covers: everything the Order details form asks for. */
const GAP_FIELDS: OrderField[] = (SECTION_BY_TABLE.get("orders")?.fields ?? []).filter(
  // A computed value is derived, never typed, so it is nobody's omission.
  (f) => !f.computed && !NOT_A_GAP.has(f.column)
);

/** "This field has a value" — over an `orders o` alias. */
export function filledSql(f: OrderField): string {
  // The prose field is not typed into any more — the terms themselves are the
  // lines beneath it — so either one counts as the terms being recorded.
  if (f.column === "payment_terms") {
    return `(nullif(btrim(o.payment_terms::text), '') IS NOT NULL
             OR EXISTS (SELECT 1 FROM order_payment_terms t WHERE t.order_id = o.id))`;
  }
  return `nullif(btrim(o.${f.column}::text), '') IS NOT NULL`;
}

/** "This field applies to this order" — the dependsOn gate, in SQL. */
export function appliesSql(f: OrderField): string {
  // Drawing's target is owed only where there is something to draw: an order
  // of Spares only has none.
  if (f.column === "drg_target_date") return deptInvolvementSql("drawing", "o");
  if (!f.dependsOn) return "TRUE";
  return f.dependsOn
    .map((d) => {
      const values = Array.isArray(d.value) ? d.value : [d.value];
      return `lower(btrim(coalesce(o.${d.column}::text, ''))) ${d.not ? "NOT IN" : "IN"} (${values
        .map((v) => lit(v.trim().toLowerCase()))
        .join(", ")})`;
    })
    .join(" AND ");
}

/** "Every Sales Order detail that applies is in" — over an `orders o` alias. */
export const SO_DETAILS_FILLED_SQL = `(${SO_DETAIL_FIELDS.map(
  (f) => `(NOT (${appliesSql(f)}) OR ${filledSql(f)})`
).join(" AND ")})`;

/** The Sales Order details that apply and are still blank, as labels. */
export const SO_DETAILS_MISSING_SQL = `array_remove(ARRAY[
      ${SO_DETAIL_FIELDS.map((f) => `CASE WHEN (${appliesSql(f)}) AND NOT (${filledSql(f)}) THEN '${f.label.replace(/'/g, "''")}' END`).join(",\n      ")}
    ]::text[], NULL)`;

/** The labels of every field that applies and is still blank, as a text[]. */
const MISSING_SQL = `array_remove(ARRAY[
  ${GAP_FIELDS.map(
    (f) =>
      `CASE WHEN (${appliesSql(f)}) AND NOT (${filledSql(f)}) THEN ${lit(f.label)} END`
  ).join(",\n  ")}
]::text[], NULL)`;

/** How many SOs one scroll of the list fetches. */
export const GAP_BATCH = 10;

/** How many fields the check looks at on an order with no gates closed. */
export const GAP_FIELD_COUNT = GAP_FIELDS.length;

/**
 * One batch of SOs with details still blank, newest serial last, narrowed by
 * an optional search on SO number / client / serial. `total` is every SO with
 * a gap, not just this batch, so the modal can say how far it has scrolled.
 */
export async function listOrderGaps(opts: {
  offset: number;
  limit: number;
  search: string;
  /** Pump or Spare — the SO's order type, or any of its ECs' item type. */
  type?: string | null;
}): Promise<{ rows: OrderGapRow[]; total: number }> {
  const term = opts.search.trim();
  const like = term === "" ? null : `%${term}%`;
  const type = opts.type?.trim() || null;

  const result = await query<OrderGapRow & { total: number }>(
    `WITH checked AS (
       SELECT o.id,
              o.sl_no::int AS sl_no,
              o.so_no,
              o.client_name,
              to_char(o.so_date, 'YYYY-MM-DD') AS so_date,
              o.order_type,
              ${MISSING_SQL} AS missing
         FROM orders o
        WHERE ${orderOpenSql("o")}
          AND ($1::text IS NULL
               OR o.so_no ILIKE $1
               OR o.client_name ILIKE $1
               OR o.client_code ILIKE $1
               OR o.po_no ILIKE $1
               OR o.sl_no::text ILIKE $1)
          AND ($4::text IS NULL
               OR TRIM(COALESCE(o.order_type, '')) = $4
               OR EXISTS (SELECT 1 FROM order_items s
                           WHERE s.order_id = o.id AND TRIM(COALESCE(s.item_type, '')) = $4))
     )
     SELECT id, sl_no, so_no, client_name, so_date, order_type, missing,
            count(*) OVER ()::int AS total
       FROM checked
      WHERE cardinality(missing) > 0
      ORDER BY sl_no
      LIMIT $2 OFFSET $3`,
    [like, opts.limit, opts.offset, type]
  );

  return {
    rows: result.rows.map(({ total: _total, ...row }) => row),
    total: Number(result.rows[0]?.total ?? 0),
  };
}
