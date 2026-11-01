import { Paperclip } from "lucide-react";

/** The EC's attachment link as one that may be opened: http(s) only, else none. */
export function ecLinkHref(v: unknown): string {
  const s = v == null ? "" : String(v).trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

/**
 * The EC's attachment (its SharePoint link, from the Pump Add-On), as a clip
 * beside the EC No. that opens it in a new tab. Nothing when the EC has none.
 * `label` shows the words too, for the EC's own details.
 */
export function EcLink({ href, label }: { href: unknown; label?: boolean }) {
  const url = ecLinkHref(href);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      // The row behind it often opens something of its own.
      onClick={(e) => e.stopPropagation()}
      title="Open the EC attachment (SharePoint)"
      aria-label="Open the EC attachment"
      // Set apart from the EC No., and big enough to hit on its own.
      className="ml-3 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 align-middle font-medium text-primary transition-colors hover:bg-primary/15"
    >
      <Paperclip className="h-3.5 w-3.5 shrink-0" />
      {label && <span className="text-sm">EC attachment</span>}
    </a>
  );
}
