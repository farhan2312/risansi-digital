// The documents an enquiry version saved with Save Version, as they were saved: what
// Review shows, and what Operation sees once it is sent to them. Client-safe; they are
// loaded in saved-docs-server.ts.
import type { OfferSheet } from "./commercial-offer";
import type { DocLinks } from "./doc-links";
import type { SpareQuoteSheet } from "./spare-quote-doc";
import type { TechDocGroup, TechDocSheet } from "./tech-doc";

/** One drive group's saved Technical Data Sheet and Commercial Offer; null = not saved. */
export type SavedGroupDocs = { group: TechDocGroup; tech: TechDocSheet | null; offer: OfferSheet | null };

/** A pump's three documents; a spare has only the quotation ("commercial"). */
export type SavedDocKind = "technical" | "commercial" | "techno";
export const SAVED_DOC_KINDS: SavedDocKind[] = ["technical", "commercial", "techno"];

/** projects.operation_docs as read: the documents picked on Review to go to operation,
 *  or null (not picked - older enquiries, a spare: all of them). */
export function operationDocKinds(raw: unknown): SavedDocKind[] | null {
  if (!Array.isArray(raw)) return null;
  const kinds = SAVED_DOC_KINDS.filter((k) => raw.includes(k));
  return kinds.length > 0 ? kinds : null;
}

/** The steps whose Save Version is missing: technical (a Technical Data Sheet with
 *  confirmed tags not saved), commercial (a drive system not quoted; a spare's quotation). */
export type UnsavedSteps = { technical: boolean; commercial: boolean };

/** What stops these documents going to operation, or null (user, 2026-11-21): only the
 *  documents ticked to send need their Save Version (Techno-Commercial needs both), so
 *  Technical can go without Commercial saved, and the other way round. A step completed
 *  by hand needs none (its documents go as SharePoint links - ungeneratedDocsProblem). */
export function unsavedDocsProblem(
  orderType: string,
  kinds: SavedDocKind[],
  unsaved: UnsavedSteps,
  hand: { technical: boolean; commercial: boolean },
): string | null {
  if (orderType === "spare") return unsaved.commercial && !hand.commercial ? "Save Version on the quotation first." : null;
  const label: Record<SavedDocKind, string> = { technical: "Technical", commercial: "Commercial", techno: "Techno-Commercial" };
  for (const step of ["technical", "commercial"] as const) {
    const needing = kinds.filter((k) => k === step || k === "techno");
    if (needing.length && unsaved[step] && !hand[step]) {
      return `Save Version on ${step === "technical" ? "the Technical Data Sheet" : "Commercial"} first, or untick ${needing.map((k) => label[k]).join(" and ")}.`;
    }
  }
  return null;
}

export type SavedDocs = {
  orderType: "pump" | "spare";
  /** For the file name a document saves as (savedDocFileName). */
  enquiry: { code: string; clientName: string; enquiryDate: string | null };
  /** The documents picked on Review to go to operation; null = all of them. */
  sent: SavedDocKind[] | null;
  /** A pump's. */
  groups: SavedGroupDocs[];
  /** A spare's quotation, once saved. */
  spare: SpareQuoteSheet | null;
  /** Client's own format (lib/doc-links.ts): null = off, the generated documents go; else
   *  the SharePoint links, the only documents shared. */
  links: DocLinks | null;
};

/** One enquiry version sent to operation, a row of Pump Docs, Spare Docs and Client
 *  Operation Docs (GET /api/operation-docs). */
export type OperationDoc = {
  id: string;
  projectCode: string;
  enquiryDate: string | null;
  clientName: string;
  clientCode: string | null;
  primaryRep: string | null;
  secondaryReps: string | null;
  zone: string | null;
  /** Domestic / Export. */
  market: string | null;
  /** PCP / MMP / … or Spare / Retrofit spare. */
  subtype: string;
  /** The quotation no. & date as its saved document prints it, typed by hand or not; one
   *  per drive group. */
  quotations: string[];
  /** On its View buttons, never beside the enquiry no. */
  version: number;
  reviewedAt: string | null;
  reviewedByName: string | null;
  sentAt: string;
  sentByName: string | null;
  /** Operation confirmed it was mailed to the client. */
  mailedAt: string | null;
  mailedByName: string | null;
  /** A Technical Data Sheet was saved (so Technical and Techno-Commercial open). */
  hasTechnical: boolean;
  /** The documents sent: what was picked on Review, else all of them. */
  sentDocs: SavedDocKind[];
  /** Client's own format: the SharePoint links, the only documents shared; null = the
   *  generated documents. */
  links: DocLinks | null;
};

/** The file name a printed document saves as (user, 2026-11-17):
 *  "Risansi_Spare_Quotation_BANNARI AMMAN SUGARS LTD_Dt. 24-10-2026_ENQ. No.2026".
 *  A pump's: Risansi_Pump_Technical / Quotation (the Commercial) / Techno-Commercial, and
 *  its drive system when it has more than one. Characters Windows won't take become "-". */
export function savedDocFileName(docs: Pick<SavedDocs, "orderType" | "enquiry">, kind: SavedDocKind, group?: string): string {
  const { code, clientName, enquiryDate: d } = docs.enquiry;
  const spare = docs.orderType === "spare";
  const doc = spare || kind === "commercial" ? "Quotation" : kind === "technical" ? "Technical" : "Techno-Commercial";
  return [
    "Risansi",
    spare ? "Spare" : "Pump",
    doc,
    group ?? "",
    clientName.trim(),
    d ? `Dt. ${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : "",
    `ENQ. No.${code}`,
  ]
    .filter(Boolean)
    .join("_")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
