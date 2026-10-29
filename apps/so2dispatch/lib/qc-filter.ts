// Quality's queue filters: the SO's Open / Closed and each EC's documents
// status — the same words in the browser (qcDocsStatus) and in SQL here, so a
// filter matches what the table shows.

import { QC_DOC_TYPES, linksFromRows, qcDocsStatus, requiredQcDocs } from "@/lib/qc-docs";
import { inListNotHeld, soHoldSql } from "@/lib/dept-status";

export const QC_SO_STATES = ["Open", "Closed"];
export const QC_EC_STATUSES = ["Pending", "Partially submitted", "Submitted", "Docs not specified"];

/** The URL params Quality's own filters live under. */
export const QC_FILTER_KEYS = { so: "qc_so", ec: "qc_ec" } as const;

export type QcFilter = { so: string[]; ec: string[] };

const pick = (raw: string | undefined, allowed: string[]) =>
  (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => allowed.includes(v));

export function parseQcFilter(get: (key: string) => string | undefined): QcFilter {
  return { so: pick(get(QC_FILTER_KEYS.so), QC_SO_STATES), ec: pick(get(QC_FILTER_KEYS.ec), QC_EC_STATUSES) };
}

export function qcFilterActive(f: QcFilter): boolean {
  return f.so.length + f.ec.length > 0;
}

type Row = Record<string, unknown>;

/** An EC's documents status (the row carries its SO's QC Documents), as the table shows it. */
export function ecQcStatus(r: Row): string {
  return qcDocsStatus(requiredQcDocs(r), linksFromRows(r.qc_links)).label;
}

/** The SO is Closed once every EC on it has all its documents submitted; Open until then. */
export function soQcState(ecs: Row[]): string {
  return ecs.length > 0 && ecs.every((r) => ecQcStatus(r) === "Submitted") ? "Closed" : "Open";
}

// ---- SQL: the same rules over an EC alias and its SO's alias.

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** The documents the SO (alias o) names, lower-cased, of those Quality knows. */
const neededSql = (o: string) =>
  `(SELECT lower(d) FROM unnest(ARRAY[${QC_DOC_TYPES.map(lit).join(", ")}]::text[]) d
     WHERE lower(d) IN (SELECT lower(btrim(x)) FROM unnest(string_to_array(COALESCE(${o}.qc_documents, ''), ',')) x))`;

/** An EC's (alias it, its SO o) documents status in SQL — the twin of ecQcStatus. */
export function ecQcStatusSql(it: string, o: string): string {
  const total = `(SELECT count(*) FROM ${neededSql(o)} n)`;
  const done = `(SELECT count(DISTINCT lower(ql.doc_type)) FROM order_qc_doc_links ql
                  WHERE ql.item_id = ${it}.id AND (btrim(ql.link) ~* '^https?://' OR ql.submitted_date IS NOT NULL)
                    AND lower(ql.doc_type) IN ${neededSql(o)})`;
  return `(CASE WHEN ${total} = 0 THEN 'Docs not specified'
                WHEN ${done} >= ${total} THEN 'Submitted'
                WHEN ${done} > 0 THEN 'Partially submitted'
                ELSE 'Pending' END)`;
}

/**
 * The EC (alias it) has reached Quality: Assembly has assembled some of it.
 * Until then it is not on Quality's page, cards or filters.
 */
export function qcEcReadySql(it: string): string {
  return `EXISTS (SELECT 1 FROM order_lot_assembly qla WHERE qla.item_id = ${it}.id AND qla.assembled_date IS NOT NULL)`;
}

/** The SO's (alias o) Open / Closed in SQL. */
export function soQcStateSql(o: string): string {
  return `(CASE WHEN EXISTS (SELECT 1 FROM order_items s WHERE s.order_id = ${o}.id)
                 AND NOT EXISTS (SELECT 1 FROM order_items s WHERE s.order_id = ${o}.id
                                   AND ${ecQcStatusSql("s", o)} <> 'Submitted')
                THEN 'Closed' ELSE 'Open' END)`;
}

/** The filter as a condition on an SO (alias o): one of its ECs at the status asked, the SO as asked. */
export function qcFilterSql(f: QcFilter, o = "o"): string {
  const parts: string[] = [];
  if (f.ec.length) {
    parts.push(`EXISTS (SELECT 1 FROM order_items s WHERE s.order_id = ${o}.id AND ${qcEcReadySql("s")} AND ${inListNotHeld(ecQcStatusSql("s", o), f.ec, ["Pending"], o, "quality")})`);
  }
  if (f.so.length) parts.push(inListNotHeld(soQcStateSql(o), f.so, ["Open"], o, "quality"));
  return parts.length ? parts.join(" AND ") : "TRUE";
}

/** How many of the SO's (alias o) ECs are at this status (all of them with none) — a card's figure. */
export function qcEcCountSql(o: string, status?: string): string {
  return `(SELECT count(*) FROM order_items s WHERE s.order_id = ${o}.id AND ${qcEcReadySql("s")}${
    status ? ` AND ${ecQcStatusSql("s", o)} = ${lit(status)}${status === "Pending" ? ` AND NOT ${soHoldSql(o, "quality")}` : ""}` : ""
  })`;
}
