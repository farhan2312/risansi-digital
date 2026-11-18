// SharePoint links for a version's documents (user, 2026-11-18). The portal always
// generates the documents (Save Version still records the sheets and prices and drives
// the statuses); when a client asks for its own format, the document is made by hand, put
// on SharePoint and its link added on Review. A document with a link opens that file, on
// Review and on Operation's pages, instead of the generated one; one without stays as
// generated. Per enquiry version (projects.doc_links); a new version starts with none.
// Client-safe.

export type DocLinkKind = "technical" | "commercial" | "techno";
export type DocLinks = Partial<Record<DocLinkKind, string>>;

/** A pump has all three; a spare has its quotation only. */
export const docLinkKinds = (orderType: string): { key: DocLinkKind; label: string }[] =>
  orderType === "spare"
    ? [{ key: "commercial", label: "Quotation" }]
    : [
        { key: "technical", label: "Technical" },
        { key: "commercial", label: "Commercial" },
        { key: "techno", label: "Techno-Commercial" },
      ];

const KINDS: DocLinkKind[] = ["technical", "commercial", "techno"];

/** The stored links, only the known keys holding a string. */
export function normalizeDocLinks(v: unknown): DocLinks {
  const out: DocLinks = {};
  if (!v || typeof v !== "object") return out;
  for (const k of KINDS) {
    const s = (v as Record<string, unknown>)[k];
    if (typeof s === "string" && s.trim()) out[k] = s.trim();
  }
  return out;
}

/** Why this isn't a SharePoint link, or null when it is (https on *.sharepoint.com). */
export function sharepointLinkProblem(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "isn't a valid link";
  }
  if (u.protocol !== "https:") return "has to start with https://";
  const host = u.hostname.toLowerCase();
  if (host !== "sharepoint.com" && !host.endsWith(".sharepoint.com")) return "has to be a SharePoint link (…sharepoint.com)";
  return null;
}

