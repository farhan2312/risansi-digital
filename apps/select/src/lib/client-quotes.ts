// Client Quoted Prices page (sidebar): API shapes. Client-safe.
import type { QuotationInfo } from "./commercial";

/** GET /api/client-quotes/search — a client with price history. */
export interface ClientQuoteHit {
  clientCode: string | null;
  clientName: string;
  quotations: number;
  files: number;
  /** Spare price reference files (user, 2026-11-16). */
  spareFiles?: number;
  /** Spare quotations (drive group SP); `quotations` counts the pump ones. */
  spareQuotations?: number;
}

/** GET /api/client-quotes — the client's quotations (all versions) + SharePoint files. */
export interface ClientQuoteHistory {
  client: { code: string | null; name: string };
  quotations: { projectId: string; projectCode: string; enquiryName: string; info: QuotationInfo }[];
  files: { id: string; fileName: string; url: string; fileDate: string | null }[];
  /** The client's spare price reference files. */
  spareFiles: { id: string; fileName: string; url: string; fileDate: string | null }[];
}
