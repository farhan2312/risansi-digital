"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import StatusPill from "../ui/StatusPill";
import { listEnquiryVersions, type ProjectRecord } from "../../services/projectService";
import { listTags, type TagRecord } from "../../services/tagsService";

const fmtDay = (ymd: string | null) =>
  ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const btn =
  "rounded-lg border border-line px-2.5 py-1 text-[12px] font-semibold text-fg-2 transition-colors hover:border-accent hover:text-accent";

/** Every version of an enquiry, newest first. The older ones open view only;
 *  the latest is worked on from the Enquiries list. */
export default function EnquiryVersionsModal({
  project,
  showCommercial,
  onClose,
  onOpenTag,
  onOpenTechnical,
}: {
  project: ProjectRecord;
  /** A rep can't open the Commercial page. */
  showCommercial: boolean;
  onClose: () => void;
  onOpenTag: (version: ProjectRecord, tag: TagRecord) => void;
  onOpenTechnical: (version: ProjectRecord) => void;
}) {
  const [versions, setVersions] = useState<ProjectRecord[] | null>(null);
  const [error, setError] = useState("");
  const [tagsFor, setTagsFor] = useState<Record<string, TagRecord[] | "loading" | "error">>({});

  useEffect(() => {
    let cancelled = false;
    listEnquiryVersions(project.id)
      .then((v) => !cancelled && setVersions(v))
      .catch(() => !cancelled && setError("Couldn't load the versions."));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleTags = (id: string) => {
    if (tagsFor[id]) {
      setTagsFor(({ [id]: _closed, ...rest }) => rest);
      return;
    }
    setTagsFor((m) => ({ ...m, [id]: "loading" }));
    listTags(id)
      .then((rows) => setTagsFor((m) => ({ ...m, [id]: rows })))
      .catch(() => setTagsFor((m) => ({ ...m, [id]: "error" })));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-line bg-paper"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-fg">Enquiry versions</h3>
            <p className="truncate font-mono text-[12.5px] text-fg-2">
              {project.project_code}
              {project.name ? ` · ${project.name}` : ""}
            </p>
          </div>
          <button type="button" className={btn} onClick={onClose}>
            Close
          </button>
        </header>

        <div className="overflow-y-auto">
          {error && <p className="px-4 py-3 text-[12.5px] font-medium text-neg">{error}</p>}
          {!versions && !error && <p className="px-4 py-3 text-[12.5px] text-fg-3">Loading…</p>}
          <ul className="divide-y divide-line">
            {(versions ?? []).map((v) => {
              const tags = tagsFor[v.id];
              return (
                <li key={v.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[12px] font-bold text-accent">
                      {v.version_no === v.commercial_version_no ? `V${v.version_no}` : `T${v.version_no} · C${v.commercial_version_no}`}
                    </span>
                    {v.version_kind === "technical" && <span className="text-[11.5px] font-semibold text-fg-3">Technical only</span>}
                    {v.is_latest && <span className="text-[11.5px] font-semibold text-pos">Latest</span>}
                    {v.order_type !== "spare" && (
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-3">
                        Technical <StatusPill status={v.status} />
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-3">
                      {v.order_type === "spare" ? "" : "Commercial "}
                      <StatusPill status={v.commercial_status} />
                    </span>
                    <span className="text-[12px] text-fg-3">
                      Enquiry date <span className="text-fg-2">{fmtDay(v.enquiry_date)}</span>
                    </span>
                    {v.completed_on && v.order_type !== "spare" && (
                      <span className="text-[12px] text-fg-3">
                        Technical completed <span className="text-fg-2">{fmtDay(v.completed_on)}</span>
                      </span>
                    )}
                    {v.commercial_completed_on && (
                      <span className="text-[12px] text-fg-3">
                        {v.order_type === "spare" ? "Completed" : "Commercial completed"} <span className="text-fg-2">{fmtDay(v.commercial_completed_on)}</span>
                      </span>
                    )}
                    <span className="text-[12px] text-fg-3">
                      Assigned to <span className="text-fg-2">{v.assigned_to_name || "nobody"}</span>
                    </span>
                  </div>
                  {v.revision_note && <p className="mt-1.5 text-[12.5px] whitespace-pre-wrap text-fg-2">{v.revision_note}</p>}
                  {!v.is_latest && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {v.order_type !== "spare" && (
                        <>
                          <button type="button" className={btn} aria-expanded={Boolean(tags)} onClick={() => toggleTags(v.id)}>
                            Tags
                          </button>
                          <button type="button" className={btn} onClick={() => onOpenTechnical(v)}>
                            Technical
                          </button>
                        </>
                      )}
                      {showCommercial && (
                        <Link href={`/commercial?projectId=${v.id}`} className={btn}>
                          {v.order_type === "spare" ? "Quotation" : "Commercial"}
                        </Link>
                      )}
                      <span className="text-[11.5px] text-fg-3">View only</span>
                    </div>
                  )}
                  {tags === "loading" && <p className="mt-2 text-[12px] text-fg-3">Loading tags…</p>}
                  {tags === "error" && <p className="mt-2 text-[12px] font-medium text-neg">Couldn&apos;t load the tags.</p>}
                  {Array.isArray(tags) && (
                    <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                      {tags.map((t) => (
                        <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg">{t.name}</span>
                          <StatusPill status={t.status} />
                          <button type="button" className={btn} onClick={() => onOpenTag(v, t)}>
                            View
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
