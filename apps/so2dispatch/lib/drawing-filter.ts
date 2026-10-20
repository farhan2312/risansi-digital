// Drawing's queue filters and the SO's Open / Closed: each EC's GAD,
// Performance Curve and Part Drawing status, the same words in the browser
// (drawingDocStatus, partDrawingStatus) and in SQL here, so a filter matches
// what the table shows.

import { drawingDocStatus, spareEcSql } from "@/lib/dept-view";
import { partDrawingStatus } from "@/lib/part-drawings";

export const NOT_REQUIRED = "Not required";

export const GAD_STATUSES = [
  "Drawing pending",
  "Sent to client, approval pending",
  "Resubmit",
  "Approved by client",
  "Issued to planning",
];
export const CURVE_STATUSES = [NOT_REQUIRED, "Pending", "Sent to client for approval", "Resubmit", "Approved by client"];
export const PART_STATUSES = [NOT_REQUIRED, "Pending", "Partial complete", "Fully complete"];
export const SO_STATES = ["Open", "Closed"];

/** The URL params Drawing's own filters live under. */
export const DRAWING_FILTER_KEYS = { so: "drg_so", gad: "drg_gad", curve: "drg_pc", part: "drg_part" } as const;

export type DrawingFilter = { so: string[]; gad: string[]; curve: string[]; part: string[] };

const pick = (raw: string | undefined, allowed: string[]) =>
  (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => allowed.includes(v));

/** The filter from the URL, keeping only the words each list knows. */
export function parseDrawingFilter(get: (key: string) => string | undefined): DrawingFilter {
  return {
    so: pick(get(DRAWING_FILTER_KEYS.so), SO_STATES),
    gad: pick(get(DRAWING_FILTER_KEYS.gad), GAD_STATUSES),
    curve: pick(get(DRAWING_FILTER_KEYS.curve), CURVE_STATUSES),
    part: pick(get(DRAWING_FILTER_KEYS.part), PART_STATUSES),
  };
}

type Row = Record<string, unknown>;
const yes = (v: unknown) => String(v ?? "").trim().toLowerCase() === "yes";
const versionsOf = (r: Row) => (Array.isArray(r.child_rows) ? (r.child_rows as Row[]) : []);
const partsOf = (r: Row) => (Array.isArray(r.part_drawings) ? (r.part_drawings as Row[]) : []);

/** An EC's three statuses, as the table shows them. */
export function ecDrawingStatuses(r: Row): { gad: string; curve: string; part: string } {
  return {
    gad: drawingDocStatus(versionsOf(r), "GAD").label,
    curve: yes(r.performance_curve_required) ? drawingDocStatus(versionsOf(r), "Performance Curve").label : NOT_REQUIRED,
    part: partDrawingStatus(r.part_drawing, partsOf(r))?.label ?? NOT_REQUIRED,
  };
}

/** Drawing is done with an EC: GAD issued to Planning, curve approved and parts all drawn where asked. */
export function ecDrawingDone(r: Row): boolean {
  const s = ecDrawingStatuses(r);
  return (
    s.gad === "Issued to planning" &&
    [NOT_REQUIRED, "Approved by client"].includes(s.curve) &&
    [NOT_REQUIRED, "Fully complete"].includes(s.part)
  );
}

/** The EC row matches the EC-level filters (an empty list matches all). */
export function ecMatchesDrawingFilter(r: Row, f: DrawingFilter): boolean {
  const s = ecDrawingStatuses(r);
  return (
    (f.gad.length === 0 || f.gad.includes(s.gad)) &&
    (f.curve.length === 0 || f.curve.includes(s.curve)) &&
    (f.part.length === 0 || f.part.includes(s.part))
  );
}

export function drawingFilterActive(f: DrawingFilter): boolean {
  return f.so.length + f.gad.length + f.curve.length + f.part.length > 0;
}

// ---- SQL: the same rules over an EC alias (and its SO's alias).

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const inList = (expr: string, values: string[]) => `${expr} IN (${values.map(lit).join(", ")})`;

function docStatusSql(it: string, doc: "GAD" | "Performance Curve"): string {
  const gad = doc === "GAD";
  return `(SELECT CASE
             WHEN lv.id IS NULL OR lower(COALESCE(lv.issued_to_client, '')) <> 'yes' THEN ${lit(gad ? "Drawing pending" : "Pending")}
             WHEN ${gad ? "TRUE" : "FALSE"} AND lower(COALESCE(lv.approved, '')) = 'yes'
                  AND lower(COALESCE(lv.issued_to_production, '')) = 'yes' THEN 'Issued to planning'
             WHEN lower(COALESCE(lv.approved, '')) = 'yes' THEN 'Approved by client'
             WHEN lower(COALESCE(lv.approved, '')) = 'no' THEN 'Resubmit'
             ELSE ${lit(gad ? "Sent to client, approval pending" : "Sent to client for approval")} END
           FROM (SELECT 1) one
           LEFT JOIN LATERAL (SELECT rv.id, rv.issued_to_client, rv.approved, rv.issued_to_production
                                FROM order_drawing_revisions rv
                               WHERE rv.item_id = ${it}.id AND rv.doc_type = ${lit(doc)}
                               ORDER BY rv.seq DESC LIMIT 1) lv ON TRUE)`;
}

function curveStatusSql(it: string, o: string): string {
  return `(CASE WHEN lower(COALESCE(${o}.performance_curve_required, '')) <> 'yes' THEN ${lit(NOT_REQUIRED)}
                ELSE ${docStatusSql(it, "Performance Curve")} END)`;
}

function partStatusSql(it: string): string {
  return `(SELECT CASE
             WHEN lower(COALESCE(pl.part_drawing, '')) <> 'yes' THEN ${lit(NOT_REQUIRED)}
             WHEN n.total > 0 AND n.done = n.total THEN 'Fully complete'
             WHEN n.done > 0 THEN 'Partial complete'
             ELSE 'Pending' END
           FROM (SELECT 1) one
           LEFT JOIN order_planning pl ON pl.item_id = ${it}.id
           CROSS JOIN LATERAL (SELECT count(*) AS total,
                                      count(*) FILTER (WHERE lower(COALESCE(pd.completed, '')) = 'yes') AS done
                                 FROM order_part_drawings pd WHERE pd.item_id = ${it}.id) n)`;
}

function ecDoneSql(it: string, o: string): string {
  return `(${docStatusSql(it, "GAD")} = 'Issued to planning'
           AND ${inList(curveStatusSql(it, o), [NOT_REQUIRED, "Approved by client"])}
           AND ${inList(partStatusSql(it), [NOT_REQUIRED, "Fully complete"])})`;
}

/**
 * The filter as a condition on an SO (alias o): one of its pump ECs matches
 * every EC-level status asked for, and the SO is Open or Closed as asked —
 * Closed when Drawing is done with every pump EC on it.
 */
export function drawingFilterSql(f: DrawingFilter, o = "o"): string {
  const parts: string[] = [];
  const ec: string[] = [];
  if (f.gad.length) ec.push(inList(docStatusSql("s", "GAD"), f.gad));
  if (f.curve.length) ec.push(inList(curveStatusSql("s", o), f.curve));
  if (f.part.length) ec.push(inList(partStatusSql("s"), f.part));
  if (ec.length) {
    parts.push(`EXISTS (SELECT 1 FROM order_items s
                         WHERE s.order_id = ${o}.id AND NOT (${spareEcSql("s", o)})
                           AND ${ec.join(" AND ")})`);
  }
  if (f.so.length === 1) {
    const open = `EXISTS (SELECT 1 FROM order_items s
                           WHERE s.order_id = ${o}.id AND NOT (${spareEcSql("s", o)})
                             AND NOT ${ecDoneSql("s", o)})`;
    parts.push(f.so[0] === "Open" ? open : `NOT ${open}`);
  }
  return parts.length ? parts.join(" AND ") : "TRUE";
}
