"use client";

import { useEffect, useState } from "react";
import { CircleCheck, Send, X } from "lucide-react";

import { Button } from "@/components/shadcn/button";
import DocLinksForm from "./DocLinksForm";
import SavedDocsViewer from "./SavedDocsViewer";
import { SAVED_DOC_KINDS, type SavedDocKind, type SavedDocs } from "../../lib/saved-docs";
import { TECHNO_COMMERCIAL_TITLE } from "../../lib/techno-commercial";
import { getReviewState, reviewEnquiry, type ProjectRecord } from "../../services/projectService";

// Review on the Enquiries list: the versions saved with Save Version, as they were
// saved, nothing to edit. Then Mark as reviewed, and after that Send to operation, which
// puts them on Operation's Pump Docs / Spare Docs. A pump's ticks pick which of its
// documents go (user, 2026-11-17); a spare's quotation always goes. Any document can be
// given a SharePoint link (user, 2026-11-18) - the client's own format, made by hand -
// which is then used instead of the generated one, here and on Operation's pages.
//
// Its shell is a plain overlay, not a Radix Dialog: printing goes through a hidden iframe
// added to the page body (lib/enquiry-print), which a Radix focus trap would fight.

const DOC_LABEL: Record<SavedDocKind, string> = { technical: "Technical", commercial: "Commercial", techno: TECHNO_COMMERCIAL_TITLE };

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
  // A pump's documents to send; Technical and Techno-Commercial need a saved data sheet.
  const [picked, setPicked] = useState<SavedDocKind[]>([]);
  const isPump = docs?.orderType === "pump";
  const hasTech = Boolean(docs?.groups.some((g) => g.tech));
  const available = SAVED_DOC_KINDS.filter((k) => k === "commercial" || hasTech);
  const pickedDocs = available.filter((k) => picked.includes(k));
  const sent = Boolean(project.released_to_operation_at);

  // Bumped after the links are saved: what is missing, and the viewer, follow them.
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getReviewState(project.id)
      .then((state) => {
        if (cancelled) return;
        setMissing(state.missing);
        setDocs(state.docs);
        // As picked before, else all of them.
        setPicked(state.docs.sent ?? SAVED_DOC_KINDS);
      })
      .catch(() => !cancelled && setLoadError("Couldn't load the saved versions."));
    return () => {
      cancelled = true;
    };
  }, [project.id, reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = async (action: "reviewed" | "send") => {
    setBusy(true);
    setActionError("");
    try {
      const r = await reviewEnquiry(project.id, action, isPump ? pickedDocs : undefined);
      onChanged({ reviewed_at: r.reviewed_at, released_to_operation_at: r.released_to_operation_at });
      if (r.operation_docs) setPicked(r.operation_docs);
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
          {/* Optional SharePoint links: a document with one is used instead of the generated
              one. Not on an older version (view only). */}
          {docs && project.is_latest !== false && (
            <DocLinksForm
              projectId={project.id}
              orderType={docs.orderType}
              links={docs.links}
              wasReviewed={Boolean(project.reviewed_at || project.released_to_operation_at)}
              onSaved={(links, changed) => {
                setDocs({ ...docs, links });
                if (changed) onChanged({ reviewed_at: null, released_to_operation_at: null });
                setReload((n) => n + 1);
              }}
            />
          )}
          {docs && <SavedDocsViewer key={JSON.stringify(docs.links)} docs={docs} />}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-border bg-muted/40 px-5 py-3">
          {docs && isPump && (
            <fieldset className="mr-auto flex flex-wrap items-center gap-x-3 gap-y-1.5" disabled={sent || busy}>
              <legend className="sr-only">Documents to send to operation</legend>
              <span className="text-[12.5px] font-medium text-foreground">{sent ? "Sent:" : "Send to operation:"}</span>
              {available.map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-foreground has-[:disabled]:cursor-default">
                  <input
                    type="checkbox"
                    className="size-3.5 cursor-pointer accent-[var(--sc-primary)] disabled:cursor-default"
                    checked={picked.includes(k)}
                    onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, k] : cur.filter((x) => x !== k)))}
                  />
                  {DOC_LABEL[k]}
                </label>
              ))}
              {!sent && pickedDocs.length === 0 && <span className="text-[12px] font-medium text-warning">Tick at least one.</span>}
            </fieldset>
          )}
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
              <Button disabled={busy || (isPump && pickedDocs.length === 0)} onClick={() => void act("send")}>
                <Send /> {busy ? "Sending…" : "Send to operation"}
              </Button>
            </>
          ) : (
            <>
              {docs && missing && <span className="text-[12.5px] font-medium text-warning">{missing}</span>}
              <Button disabled={busy || !docs || Boolean(missing) || (isPump && pickedDocs.length === 0)} onClick={() => void act("reviewed")}>
                <CircleCheck /> {busy ? "Saving…" : "Mark as reviewed"}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
