// Drawing's queue filters and the SO's Open / Closed: each EC's GAD,
// Performance Curve and Part Drawing status, the same words in the browser
// (drawingDocStatus, partDrawingStatus) and in SQL here, so a filter matches
// what the table shows.

import { drawingDocStatus, spareEcSql } from "@/lib/dept-view";
import { partDrawingStatus } from "@/lib/part-drawings";
import { inListNotHeld, soHoldSql } from "@/lib/dept-status";

export const NOT_REQUIRED = "Not required";

export const GAD_STATUSES = [
  "Pending",
  "Sent to client – approval pending",
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

/**
 * When Drawing finished an EC: the last of its GAD issued to Planning, its
 * curve approved and its last part drawn (each where asked). "" until done.
 */
export function ecDrawingDoneDate(r: Row): string {
  if (!ecDrawingDone(r)) return "";
  const day = (v: unknown) => String(v ?? "").slice(0, 10);
  const last = (rows: Row[]) => rows.sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))[rows.length - 1];
  const dates: string[] = [];
  const gad = last(versionsOf(r).filter((v) => String(v.doc_type ?? "GAD") === "GAD"));
  if (gad) dates.push(day(gad.issued_to_production_date));
  if (yes(r.performance_curve_required)) {
    const pc = last(versionsOf(r).filter((v) => v.doc_type === "Performance Curve"));
    if (pc) dates.push(day(pc.approved_date));
  }
  if (yes(r.part_drawing)) dates.push(...partsOf(r).map((p) => day(p.completed_date)));
  return dates.filter(Boolean).sort().pop() ?? "";
}

/**
 * The SO's Open / Closed from all its pump ECs, and the day it closed — the
 * latest day one of its ECs was finished.
 */
export function soDrawingState(ecs: Row[]): { closed: boolean; date: string } {
  const closed = ecs.length > 0 && ecs.every(ecDrawingDone);
  return { closed, date: closed ? ecs.map(ecDrawingDoneDate).filter(Boolean).sort().pop() ?? "" : "" };
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

/** An EC's GAD status in SQL (alias it), the words the Drawing page shows. */
export function ecGadStatusSql(it: string): string {
  return docStatusSql(it, "GAD");
}

function docStatusSql(it: string, doc: "GAD" | "Performance Curve"): string {
  const gad = doc === "GAD";
  return `(SELECT CASE
             WHEN lv.id IS NULL OR lower(COALESCE(lv.issued_to_client, '')) <> 'yes' THEN 'Pending'
             WHEN ${gad ? "TRUE" : "FALSE"} AND lower(COALESCE(lv.approved, '')) = 'yes'
                  AND lower(COALESCE(lv.issued_to_production, '')) = 'yes' THEN 'Issued to planning'
             WHEN lower(COALESCE(lv.approved, '')) = 'yes' THEN 'Approved by client'
             WHEN lower(COALESCE(lv.approved, '')) = 'no' THEN 'Resubmit'
             ELSE ${lit(gad ? "Sent to client – approval pending" : "Sent to client for approval")} END
           FROM (SELECT 1) one
           LEFT JOIN LATERAL (SELECT rv.id, rv.issued_to_client, rv.approved, rv.issued_to_production
                                FROM order_drawing_revisions rv
                               WHERE rv.item_id = ${it}.id AND rv.doc_type = ${lit(doc)}
                               ORDER BY rv.seq DESC LIMIT 1) lv ON TRUE)`;
}

export function curveStatusSql(it: string, o: string): string {
  return `(CASE WHEN lower(COALESCE(${o}.performance_curve_required, '')) <> 'yes' THEN ${lit(NOT_REQUIRED)}
                ELSE ${docStatusSql(it, "Performance Curve")} END)`;
}

export function partStatusSql(it: string): string {
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

/** Drawing is done with an EC (alias it, its SO o): the SQL twin of ecDrawingDone. */
export function ecDrawingDoneSql(it: string, o: string): string {
  return ecDoneSql(it, o);
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
  if (f.gad.length) ec.push(inListNotHeld(docStatusSql("s", "GAD"), f.gad, ["Pending"], o, "drawing"));
  if (f.curve.length) ec.push(inListNotHeld(curveStatusSql("s", o), f.curve, ["Pending"], o, "drawing"));
  if (f.part.length) ec.push(inListNotHeld(partStatusSql("s"), f.part, ["Pending"], o, "drawing"));
  if (ec.length) {
    parts.push(`EXISTS (SELECT 1 FROM order_items s
                         WHERE s.order_id = ${o}.id AND NOT (${spareEcSql("s", o)})
                           AND ${ec.join(" AND ")})`);
  }
  if (f.so.length === 1) {
    const open = `EXISTS (SELECT 1 FROM order_items s
                           WHERE s.order_id = ${o}.id AND NOT (${spareEcSql("s", o)})
                             AND NOT ${ecDoneSql("s", o)})`;
    parts.push(f.so[0] === "Open" ? `${open} AND NOT ${soHoldSql(o, "drawing")}` : `NOT ${open}`);
  }
  return parts.length ? parts.join(" AND ") : "TRUE";
}
