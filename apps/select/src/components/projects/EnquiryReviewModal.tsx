"use client";

import { useEffect, useState } from "react";
import { CircleCheck, Send, X } from "lucide-react";

import { Button } from "@/components/shadcn/button";
import SavedDocsViewer from "./SavedDocsViewer";
import type { SavedDocs } from "../../lib/saved-docs";
import { getReviewState, reviewEnquiry, type ProjectRecord } from "../../services/projectService";

// Review on the Enquiries list: the versions saved with Save Version, as they were
// saved, nothing to edit. Then Mark as reviewed, and after that Send to operation, which
// puts them on Operation's Pump Docs / Spare Docs.
//
// Its shell is a plain overlay, not a Radix Dialog: printing goes through a hidden iframe
// added to the page body (lib/enquiry-print), which a Radix focus trap would fight.

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
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="enquiry-review-title"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-[0_24px_64px_rgba(15,23,42,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="grid shrink-0 gap-1 border-b border-border px-5 py-4 pr-12">
          <h3 id="enquiry-review-title" className="text-[15px] leading-snug font-semibold text-foreground">
            Review
            <span className="ml-2 font-mono text-[12.5px] font-normal text-muted-foreground">{project.project_code}</span>
          </h3>
          <p className="text-[12.5px] text-muted-foreground">{project.name || "—"} · the saved versions, exactly as saved. Nothing can be edited here.</p>
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3.5 right-3.5 rounded-md p-1 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30"
            aria-label="Close"
            title="Close"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-5 py-4">
          {loadError && (
            <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-[12.5px] font-medium text-destructive">
              {loadError}
            </p>
          )}
          {!docs && !loadError && <p className="py-8 text-center text-[13px] text-muted-foreground">Loading…</p>}
          {docs && <SavedDocsViewer docs={docs} />}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-border bg-muted/40 px-5 py-3">
          {actionError && <span className="mr-auto text-[12.5px] font-medium text-destructive">{actionError}</span>}
          {project.released_to_operation_at ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-success">
              <Send className="size-3.5" /> Sent to operation on {fmtDay(project.released_to_operation_at)}
            </span>
          ) : project.reviewed_at ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-success">
                <CircleCheck className="size-3.5" /> Reviewed on {fmtDay(project.reviewed_at)}
              </span>
              <Button disabled={busy} onClick={() => void act("send")}>
                <Send /> {busy ? "Sending…" : "Send to operation"}
              </Button>
            </>
          ) : (
            <>
              {docs && missing && <span className="text-[12.5px] font-medium text-warning">{missing}</span>}
              <Button disabled={busy || !docs || Boolean(missing)} onClick={() => void act("reviewed")}>
                <CircleCheck /> {busy ? "Saving…" : "Mark as reviewed"}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
