// The documents an enquiry version saved with Save Version, as they were saved: what
// Review shows, and what Operation sees once it is sent to them. Client-safe; they are
// loaded in saved-docs-server.ts.
import type { OfferSheet } from "./commercial-offer";
import type { SpareQuoteSheet } from "./spare-quote-doc";
import type { TechDocGroup, TechDocSheet } from "./tech-doc";

/** One drive group's saved Technical Data Sheet and Commercial Offer; null = not saved. */
export type SavedGroupDocs = { group: TechDocGroup; tech: TechDocSheet | null; offer: OfferSheet | null };

export type SavedDocs = {
  orderType: "pump" | "spare";
  /** A pump's. */
  groups: SavedGroupDocs[];
  /** A spare's quotation, once saved. */
  spare: SpareQuoteSheet | null;
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
};
