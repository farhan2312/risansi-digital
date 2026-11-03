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
 * The EC's attachment (its SharePoint link, from the Pump Add-On), as a clip
 * beside the EC No. that opens it in a new tab. Nothing when the EC has none.
 * `at` is when it was attached: on the clip's tooltip and, with `label` (which
 * shows the words too, for the EC's own details), beside it.
 */
export function EcLink({ href, label, at }: { href: unknown; label?: boolean; at?: unknown }) {
  const url = ecLinkHref(href);
  if (!url) return null;
  const when = ecLinkWhen(at);
  return (
    <>
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      // The row behind it often opens something of its own.
      onClick={(e) => e.stopPropagation()}
      title={`Open the EC attachment (SharePoint)${when ? ` · attached ${when}` : ""}`}
      aria-label="Open the EC attachment"
      // Set apart from the EC No., and big enough to hit on its own.
      className="ml-3 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 align-middle font-medium text-primary transition-colors hover:bg-primary/15"
    >
      <Paperclip className="h-3.5 w-3.5 shrink-0" />
      {label && <span className="text-sm">EC attachment</span>}
    </a>
    {label && when && <span className="ml-2 whitespace-nowrap text-xs font-normal text-muted">Attached {when}</span>}
    </>
  );
}
