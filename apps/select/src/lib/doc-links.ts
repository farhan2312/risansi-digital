// Client's own format (user, 2026-11-19). The portal always generates the documents (Save
// Version still records the sheets and prices and drives the statuses). When the client
// needs its own format, Review turns it on: the documents ticked to send are made by hand,
// put on SharePoint and their links added - each needed before Review - and only those
// links are shared with Operation; no generated document is. projects.doc_links: null =
// off (the generated documents go), an object (even {}) = on. Per enquiry version; a new
// version starts with it off. A document can have several links (user, 2026-11-26): each
// kind holds a list; one stored as a plain string (before) reads as a list of one. Client-safe.

export type DocLinkKind = "technical" | "commercial" | "techno";
/** Each document's SharePoint links, in order; a kind with none is left out. */
export type DocLinks = Partial<Record<DocLinkKind, string[]>>;

/** Most links one document can have. */
export const MAX_LINKS_PER_DOC = 10;

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

/** The stored links, or null when the client's own format is off. */
export function docLinksOrNull(v: unknown): DocLinks | null {
  return v === null || v === undefined ? null : normalizeDocLinks(v);
}

/** With the client's own format on: what the documents to send still need, or null. */
export function missingDocLinks(orderType: string, kinds: DocLinkKind[], links: DocLinks): string | null {
  const missing = docLinkKinds(orderType).filter((k) => kinds.includes(k.key) && !links[k.key]?.length);
  return missing.length ? `Add the SharePoint link for ${missing.map((k) => k.label).join(", ")} (client's own format).` : null;
}

/** A document to send that was never generated - no Save Version, its status completed
 *  by hand on the Edit form (user, 2026-11-19) - can go only as a SharePoint link: what
 *  stops it, or null. With the client's own format on, missingDocLinks asks for the link. */
export function ungeneratedDocsProblem(orderType: string, kinds: DocLinkKind[], generated: DocLinkKind[], links: DocLinks | null): string | null {
  if (links) return null;
  const none = docLinkKinds(orderType).filter((k) => kinds.includes(k.key) && !generated.includes(k.key));
  if (none.length === 0) return null;
  const names = none.map((k) => k.label).join(", ");
  return `${names} ${none.length > 1 ? "have" : "has"} no saved version (completed by hand): tick Client's own format and add ${none.length > 1 ? "their" : "its"} SharePoint link.`;
}

/** One document's links from a string (one link, as stored before) or a list: trimmed,
 *  blanks and repeats dropped. */
export function linkList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const x of raw) {
    const s = typeof x === "string" ? x.trim() : "";
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** The stored links, only the known keys, each a list with at least one link. */
export function normalizeDocLinks(v: unknown): DocLinks {
  const out: DocLinks = {};
  if (!v || typeof v !== "object") return out;
  for (const k of KINDS) {
    const list = linkList((v as Record<string, unknown>)[k]);
    if (list.length) out[k] = list;
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

