import { Paperclip } from "lucide-react";

/** The EC's attachment link as one that may be opened: http(s) only, else none. */
export function ecLinkHref(v: unknown): string {
  const s = v == null ? "" : String(v).trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

/** When the link was attached, in India: 03 Nov 2026, 04:08 pm. "" when not known. */
export function ecLinkWhen(v: unknown): string {
  if (!v) return "";
  const d = new Date(v instanceof Date ? v : String(v));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Each attachment with when it was attached: from ec_links when the row has
 * it, else the lines of ec_link (the one time, ec_link_at, when there is one).
 */
export function ecLinksOf(href: unknown, at?: unknown, links?: unknown): { url: string; at: unknown }[] {
  if (Array.isArray(links) && links.length > 0) {
    return links
      .map((l) => ({ url: ecLinkHref((l as { link?: unknown })?.link), at: (l as { at?: unknown })?.at }))
      .filter((l) => l.url);
  }
  const lines = (href == null ? "" : String(href)).split(/\r?\n/).map(ecLinkHref).filter(Boolean);
  return lines.map((url) => ({ url, at: lines.length === 1 ? at : undefined }));
}

/**
 * The EC's attachments (SharePoint links, from the Pump Add-On), each a clip
 * beside the EC No. that opens it in a new tab, with when it was attached in
 * small type after it. Nothing when the EC has none. `label` shows the words
 * too, for the EC's own details, each on its own line.
 */
export function EcLink({ href, label, at, links }: { href: unknown; label?: boolean; at?: unknown; links?: unknown }) {
  const list = ecLinksOf(href, at, links);
  if (list.length === 0) return null;
  const many = list.length > 1;
  const one = (l: { url: string; at: unknown }, i: number) => {
    const when = ecLinkWhen(l.at);
    return (
      <span key={`${l.url}-${i}`} className={label && many ? "flex items-center" : "inline"}>
        <a
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          // The row behind it often opens something of its own.
          onClick={(e) => e.stopPropagation()}
          title={many ? `Open EC attachment ${i + 1} (SharePoint)` : "Open the EC attachment (SharePoint)"}
          aria-label={many ? `Open EC attachment ${i + 1}` : "Open the EC attachment"}
          // Set apart from the EC No., and big enough to hit on its own.
          className={`${label && many ? "" : i === 0 ? "ml-3" : "ml-1.5"} inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 align-middle font-medium text-primary transition-colors hover:bg-primary/15`}
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0" />
          {label && <span className="text-sm">{many ? `EC attachment ${i + 1}` : "EC attachment"}</span>}
          {!label && many && <span className="text-[10px] font-semibold">{i + 1}</span>}
        </a>
        {when && <span title="Attached on" className="ml-1.5 whitespace-nowrap align-middle text-[10px] font-normal text-muted">{when}</span>}
      </span>
    );
  };
  return label && many ? <span className="flex flex-col gap-1">{list.map(one)}</span> : <>{list.map(one)}</>;
}
