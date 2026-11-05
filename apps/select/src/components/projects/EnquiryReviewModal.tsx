"use client";

import { useEffect, useState } from "react";

import SavedDocsViewer from "./SavedDocsViewer";
import type { SavedDocs } from "../../lib/saved-docs";
import { getReviewState, reviewEnquiry, type ProjectRecord } from "../../services/projectService";

// Review on the Enquiries list: the versions saved with Save Version, as they were
// saved, nothing to edit. Then Mark as reviewed, and after that Send to operation, which
// puts them on Operation's Pump Docs / Spare Docs.

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function EnquiryReviewModal({
  project,
  onChanged,
  onClose,
}: {
  project: ProjectRecord;
  onChanged: (patch: Pick<ProjectRecord, "reviewed_at" | "released_to_operation_at">) => void;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<SavedDocs | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getReviewState(project.id)
      .then((state) => {
        if (cancelled) return;
        setMissing(state.missing);
        setDocs(state.docs);
      })
      .catch(() => !cancelled && setLoadError("Couldn't load the saved versions."));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = async (action: "reviewed" | "send") => {
    setBusy(true);
    setActionError("");
    try {
      onChanged(await reviewEnquiry(project.id, action));
    } catch (e) {
      setActionError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-xl border border-line bg-paper" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-fg">
              Review
              <span className="ml-2 text-[13px] font-normal text-fg-3">
                {project.project_code}
              </span>
            </h3>
            <p className="text-[12.5px] text-fg-3">{project.name || "—"} · the saved versions, exactly as saved. Nothing can be edited here.</p>
          </div>
          <button type="button" className={btn} onClick={onClose}>
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          {loadError && <p className="text-[13px] text-neg">{loadError}</p>}
          {!docs && !loadError && <p className="py-8 text-center text-[13px] text-fg-3">Loading…</p>}
          {docs && <SavedDocsViewer docs={docs} />}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-4 py-3">
          {actionError && <span className="mr-auto text-[12.5px] text-neg">{actionError}</span>}
          {project.released_to_operation_at ? (
            <span className="text-[12.5px] font-semibold text-pos">Sent to operation on {fmtDay(project.released_to_operation_at)}</span>
          ) : project.reviewed_at ? (
            <>
              <span className="text-[12.5px] font-semibold text-pos">Reviewed on {fmtDay(project.reviewed_at)}</span>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void act("send")}>
                {busy ? "Sending…" : "Send to operation"}
              </button>
            </>
          ) : (
            <>
              {docs && missing && <span className="text-[12.5px] font-semibold text-warn">{missing}</span>}
              <button type="button" className={btnPrimary} disabled={busy || !docs || Boolean(missing)} onClick={() => void act("reviewed")}>
                {busy ? "Saving…" : "Mark as reviewed"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
