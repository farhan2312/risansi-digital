// Quality's documents: the SO says which it needs (MTC, IIR, Dimensional
// Report — each Yes / No on the order), and Quality gives each one per EC as a
// SharePoint link with the day it was submitted. Shared by the browser and
// the server.

export const QC_DOC_TYPES = ["MTC", "IIR", "Dimensional Report"] as const;
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

/** A link counts once it is there. */
const given = (l: QcLink | undefined) => !!l && /^https?:\/\//i.test(l.link.trim());

export type QcTone = "done" | "part" | "pending" | "na";

/**
 * Where an EC's documents stand: Not specified until the SO names any;
 * Pending until one is in; Submitted once every needed one is; Partially
 * submitted between.
 */
export function qcDocsStatus(required: QcDocType[], links: QcLink[]): { label: string; tone: QcTone; done: number; total: number } {
  const total = required.length;
  const done = required.filter((d) => given(links.find((l) => l.doc_type === d))).length;
  if (total === 0) return { label: "Docs not specified", tone: "na", done, total };
  if (done === total) return { label: "Submitted", tone: "done", done, total };
  if (done > 0) return { label: "Partially submitted", tone: "part", done, total };
  return { label: "Pending", tone: "pending", done, total };
}

/** "https://…" or "" — a link Quality gives must be a web address. */
export function cleanLink(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^https?:\/\/\S+$/i.test(s) ? s.slice(0, 2000) : "";
}
