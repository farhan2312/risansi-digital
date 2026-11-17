// Non-standard format (user, 2026-11-17): when a client asks for its own format, the
// documents are made by hand and kept on SharePoint. The enquiry is still worked in the
// portal (Save Version still records the sheets and prices and drives the statuses), but
// what is reviewed and what Operation opens are these links, not the generated documents.
// Per enquiry version (projects.doc_links); a new version starts with none. Client-safe.

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

/** What is still to be added before the version can be reviewed, or null. */
export function missingDocLinks(orderType: string, links: DocLinks): string | null {
  const missing = docLinkKinds(orderType).filter((k) => !links[k.key]);
  if (missing.length === 0) return null;
  return `Add the SharePoint link for ${missing.map((k) => k.label).join(", ")} first (non-standard format).`;
}
