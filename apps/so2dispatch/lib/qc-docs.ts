// Quality's documents: the SO says which it needs (MTC, IIR, Dimensional
// Report — each Yes / No on the order), and Quality gives each one per EC as
// SharePoint links with the day it was submitted. Shared by the browser and
// the server.

import { isWebLink, splitLinks } from "@/lib/doc-links";

export const QC_DOC_TYPES = ["MTC", "IIR", "Dimensional Report", "QAP", "Test Report", "Photos", "Packing Details"] as const;
export type QcDocType = (typeof QC_DOC_TYPES)[number];

type Row = Record<string, unknown>;

/** The documents an SO (or an EC row carrying its SO's columns) needs: its QC Documents. */
export function requiredQcDocs(order: Row): QcDocType[] {
  const picked = String(order.qc_documents ?? "").split(",").map((v) => v.trim().toLowerCase());
  return QC_DOC_TYPES.filter((d) => picked.includes(d.toLowerCase()));
}

export type QcLink = { doc_type: string; link: string; submitted_date: string; remarks: string };

export function linksFromRows(rows: unknown): QcLink[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const x = (r ?? {}) as Row;
    return {
      doc_type: String(x.doc_type ?? ""),
      link: String(x.link ?? ""),
      submitted_date: String(x.submitted_date ?? "").slice(0, 10),
      remarks: String(x.remarks ?? ""),
    };
  });
}

/** A document counts once it is in: its link given, or the day it was submitted (a link is not a must). */
export const given = (l: QcLink | undefined) =>
  !!l && (/^https?:\/\//i.test(l.link.trim()) || !!l.submitted_date.trim());

export type QcTone = "done" | "part" | "pending" | "na";

/** A pump EC Assembly has not assembled any of yet: not Quality's pending. */
export const QC_NOT_ASSEMBLED = "EC not assembled";

/**
 * Where an EC's documents stand. Quality sees only SOs that need it, whose
 * documents are always named (a mandatory field): Pending until one is in; Submitted once every needed one is; Partially
 * submitted between. A pump EC none of which is assembled yet, with no document
 * in, is EC not assembled — Quality has nothing to inspect.
 */
export function qcDocsStatus(
  required: QcDocType[],
  links: QcLink[],
  notAssembled = false
): { label: string; tone: QcTone; done: number; total: number } {
  const total = required.length;
  const done = required.filter((d) => given(links.find((l) => l.doc_type === d))).length;
  if (total > 0 && done === total) return { label: "Submitted", tone: "done", done, total };
  if (done > 0) return { label: "Partially submitted", tone: "part", done, total };
  if (notAssembled) return { label: QC_NOT_ASSEMBLED, tone: "na", done, total };
  return { label: "Pending", tone: "pending", done, total };
}

/** The links, one on each line, or "" — every link Quality gives must be a web address. */
export function cleanLink(v: unknown): string {
  const links = splitLinks(v);
  return links.every(isWebLink) ? links.map((l) => l.slice(0, 2000)).join("\n") : "";
}
