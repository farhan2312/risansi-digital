import { ExternalLink } from "lucide-react";
import { drawingDocStatus, drawingVersions, versionLabel } from "@/lib/dept-view";
import { isWebLink, splitLinks } from "@/lib/doc-links";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function shortDate(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * The EC's GAD as Planning and Quality need it: once Drawing issues it to
 * Planning, the date and its SharePoint links; until then, where it stands.
 */
export function GadCell({ versions }: { versions: Row[] }) {
  const st = drawingDocStatus(versions, "GAD");
  const all = drawingVersions(versions, "GAD");
  const last = all[all.length - 1];
  const issued = st.label === "Issued to planning";
  if (!issued) {
    return <span className="text-xs text-muted">{st.version ? `${versionLabel(st.version)} · ` : ""}{st.label}</span>;
  }
  const links = splitLinks(last?.planning_link).filter(isWebLink);
  const date = str(last?.issued_to_production_date);
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-emerald-700">
        {versionLabel(st.version)} · Issued{date ? ` ${shortDate(date)}` : ""}
      </span>
      {links.length > 0 ? (
        links.map((href, i) => (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={href}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {links.length > 1 ? `GAD link ${i + 1}` : "Open GAD"}
          </a>
        ))
      ) : (
        <span className="text-[11px] text-muted">No link</span>
      )}
    </span>
  );
}
