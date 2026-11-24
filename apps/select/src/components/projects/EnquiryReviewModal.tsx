"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Send, X } from "lucide-react";

import { Button } from "@/components/shadcn/button";
import DocLinksForm from "./DocLinksForm";
import SavedDocsViewer from "./SavedDocsViewer";
import { SAVED_DOC_KINDS, unsavedDocsProblem, type SavedDocKind, type SavedDocs, type UnsavedSteps } from "../../lib/saved-docs";
import { missingDocLinks, ungeneratedDocsProblem, type DocLinkKind } from "../../lib/doc-links";
import { TECHNO_COMMERCIAL_TITLE } from "../../lib/techno-commercial";
import { getReviewState, reviewEnquiry, type ProjectRecord } from "../../services/projectService";

// Send to operation on the Enquiries list: the versions saved with Save Version, as they
// were saved, nothing to edit, and Send to operation, which puts them on Operation's Pump
// Docs / Spare Docs. No Mark as reviewed step before it any more (user, 2026-11-25). A pump's ticks pick which of its
// documents go (user, 2026-11-17); a spare's quotation always goes. Client's own format
// (user, 2026-11-19): each document to send needs its SharePoint link (made by hand), and
// only those links are shared with Operation - the generated documents are not.
// Only the ticked documents need their Save Version (user, 2026-11-21): Technical can go
// without Commercial saved and the other way round. Once sent, Reopen takes it back from
// operation to be reviewed and sent again (with other documents ticked, say).
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
  const [unsaved, setUnsaved] = useState<UnsavedSteps>({ technical: false, commercial: false });
  const [hand, setHand] = useState({ technical: false, commercial: false });
  // Reopen asks once more before it takes the version back from operation.
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  // A pump's documents to send; Technical and Techno-Commercial need a saved data sheet.
  const [picked, setPicked] = useState<SavedDocKind[]>([]);
  const isPump = docs?.orderType === "pump";
  const hasTech = Boolean(docs?.groups.some((g) => g.tech));
  // Technical set to Completed by hand (Edit form): its documents can be picked too, though
  // none was generated - they then go as SharePoint links (user, 2026-11-19).
  const techByHand = project.technical_status_override === "Completed";
  const available = SAVED_DOC_KINDS.filter((k) => k === "commercial" || hasTech || techByHand);
  const pickedDocs = available.filter((k) => picked.includes(k));
  const sent = Boolean(project.released_to_operation_at);
  // Client's own format: the documents to send, and the SharePoint links they still need.
  const toSend: SavedDocKind[] = isPump ? pickedDocs : ["commercial"];
  // What was generated (saved with Save Version); the rest can go only as links.
  const hasOffer = docs ? (docs.orderType === "spare" ? Boolean(docs.spare) : docs.groups.some((g) => g.offer)) : false;
  const generated: DocLinkKind[] = docs?.orderType === "spare" ? (hasOffer ? ["commercial"] : []) : [...(hasTech ? (["technical"] as const) : []), ...(hasOffer ? (["commercial"] as const) : []), ...(hasTech && hasOffer ? (["techno"] as const) : [])];
  const noLink = docs
    ? docs.links
      ? missingDocLinks(docs.orderType, toSend, docs.links)
      : ungeneratedDocsProblem(docs.orderType, toSend, generated, docs.links)
    : null;
  // Only the ticked documents need their Save Version.
  const missing = docs ? unsavedDocsProblem(docs.orderType, toSend, unsaved, hand) : null;

  // Bumped after the links are saved: what is missing, and the viewer, follow them.
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getReviewState(project.id)
      .then((state) => {
        if (cancelled) return;
        setUnsaved(state.unsaved);
        setHand(state.hand);
        setDocs(state.docs);
        // As picked before, else those that can go (their Save Version done), else all.
        const ready = SAVED_DOC_KINDS.filter((k) => !unsavedDocsProblem(state.docs.orderType, [k], state.unsaved, state.hand));
        setPicked(state.docs.sent ?? (ready.length ? ready : SAVED_DOC_KINDS));
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

  const act = async (action: "reviewed" | "send" | "reopen") => {
    setBusy(true);
    setActionError("");
    setConfirmReopen(false);
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
            Send to operation
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
          {/* Client's own format: SharePoint links instead of the generated documents. Not
              on an older version (view only). */}
          {docs && project.is_latest !== false && (
            <DocLinksForm
              projectId={project.id}
              orderType={docs.orderType}
              links={docs.links}
              kinds={toSend}
              locked={sent}
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
              <span className="text-[12.5px] font-medium text-foreground">
                {sent ? "Sent:" : "Send to operation:"}
                {docs.links && <span className="ml-1 font-normal text-muted-foreground">(as SharePoint links)</span>}
              </span>
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
            <>
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-success">
                <Send className="size-3.5" /> Sent to operation on {fmtDay(project.released_to_operation_at)}
              </span>
              {/* Reopen: back from operation, to be sent again. The latest version only. */}
              {project.is_latest !== false &&
                (confirmReopen ? (
                  <>
                    <span className="text-[12.5px] font-medium text-warning">It leaves operation&apos;s list until it is sent again.</span>
                    <Button variant="outline" disabled={busy} onClick={() => setConfirmReopen(false)}>
                      Cancel
                    </Button>
                    <Button disabled={busy} onClick={() => void act("reopen")}>
                      <RotateCcw /> {busy ? "Reopening…" : "Yes, reopen"}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={() => setConfirmReopen(true)} title="Take it back from operation to send it again">
                    <RotateCcw /> Reopen
                  </Button>
                ))}
            </>
          ) : (
            <>
              {docs && (missing || noLink) && <span className="text-[12.5px] font-medium text-warning">{missing || noLink}</span>}
              <Button disabled={busy || !docs || Boolean(missing) || Boolean(noLink) || (isPump && pickedDocs.length === 0)} onClick={() => void act("send")}>
                <Send /> {busy ? "Sending…" : "Send to operation"}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
