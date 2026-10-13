"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, FileText, Loader2, Plus, Trash2, X } from "lucide-react";
import {
  addDrawingDocAction,
  deleteDrawingDocAction,
  listEcDocsAction,
  listRevisionDocsAction,
} from "@/app/risansi/orders/drawing-doc-actions";
import {
  DRAWING_DOC_ASSIGNEES,
  DRAWING_DOC_TYPES,
  assigneeLabel,
  type DrawingDocument,
} from "@/lib/drawing-docs";
import { ConfirmDialog } from "./confirm-dialog";

function dayOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function revisionLabel(doc: Pick<DrawingDocument, "revision_no">): string {
  const no = (doc.revision_no ?? "").trim();
  return no ? `Rev. ${no}` : "First issue";
}

const inputClass =
  "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";

/**
 * The documents on one drawing revision (mode "revision") or on a whole EC
 * (mode "ec"). The revision view is where Drawing adds them; the EC view is
 * what an assigned department reads.
 */
function DrawingDocsModal({
  mode,
  id,
  label,
  onClose,
}: {
  mode: "revision" | "ec";
  id: string;
  label: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [docs, setDocs] = useState<DrawingDocument[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [docType, setDocType] = useState("");
  const [link, setLink] = useState("");
  const [assigned, setAssigned] = useState<string[]>([]);
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<DrawingDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const res =
      mode === "revision" ? await listRevisionDocsAction(id) : await listEcDocsAction(id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDocs(res.docs);
    setCanManage(mode === "revision" && res.canManage);
    // With nothing shared yet, the form is the only thing worth showing.
    if (mode === "revision" && res.canManage && res.docs.length === 0) setFormOpen(true);
  }, [mode, id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pendingDelete) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pendingDelete]);

  function toggleAssignee(role: string) {
    setAssigned((cur) => (cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role]));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!docType) return setFormError("Choose which document this is.");
    if (!link.trim()) return setFormError("Paste the link to the document.");
    if (assigned.length === 0) return setFormError("Assign it to at least one department.");
    setSaving(true);
    const res = await addDrawingDocAction(id, {
      docType,
      link,
      assignedRoles: assigned,
      remarks,
    });
    setSaving(false);
    if (!res.ok) {
      setFormError(res.error);
      return;
    }
    setDocType("");
    setLink("");
    setAssigned([]);
    setRemarks("");
    setFormOpen(false);
    await load();
    // The count on the revision's button lives in the page's data.
    router.refresh();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const res = await deleteDrawingDocAction(pendingDelete.id);
    setDeleting(false);
    setPendingDelete(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await load();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Drawing documents"
        className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-card-border bg-card shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-card-border px-5 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Drawing documents
            </p>
            <p className="truncate font-display text-sm font-semibold text-foreground">
              {label}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canManage && !formOpen && (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                Add document
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {canManage && formOpen && (
            <form
              onSubmit={save}
              className="space-y-4 border-b border-card-border bg-background/50 px-5 py-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-brand-label">
                    Document <span className="text-danger">*</span>
                  </label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="">Choose…</option>
                    {DRAWING_DOC_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-brand-label">
                    Link <span className="text-danger">*</span>
                  </label>
                  <input
                    type="url"
                    inputMode="url"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://…"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[13px] font-medium text-brand-label">
                  Assign to <span className="text-danger">*</span>
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                    choose one or more — they will be notified
                  </span>
                </p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Assign to">
                  {DRAWING_DOC_ASSIGNEES.map((a) => {
                    const on = assigned.includes(a.role);
                    return (
                      <button
                        key={a.role}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleAssignee(a.role)}
                        className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input-border bg-surface text-foreground hover:bg-background"
                        }`}
                      >
                        {on && <Check className="h-3.5 w-3.5" />}
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-brand-label">
                  Remarks
                </label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  maxLength={1000}
                  className="w-full rounded-[10px] border border-input-border bg-surface px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>

              {formError && (
                <p role="alert" className="rounded-[10px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
                  {formError}
                </p>
              )}

              <div className="flex justify-end gap-2">
                {docs && docs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormOpen(false);
                      setFormError(null);
                    }}
                    className="h-10 rounded-[10px] border border-input-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-background"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-70"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? "Saving…" : "Save & notify"}
                </button>
              </div>
            </form>
          )}

          {error ? (
            <p role="alert" className="px-5 py-8 text-sm text-danger">
              {error}
            </p>
          ) : docs === null ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : docs.length === 0 ? (
            !formOpen && (
              <p className="px-5 py-8 text-sm text-muted">
                {mode === "ec"
                  ? "No drawing documents have been shared with you on this EC."
                  : "No documents on this revision yet."}
              </p>
            )
          ) : (
            <ul className="divide-y divide-card-border">
              {docs.map((d) => (
                <li key={d.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold text-foreground">{d.doc_type}</span>
                      {mode === "ec" && (
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                          {revisionLabel(d)}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{dayOnly(d.created_at)}</span>
                    </div>
                    {/* noopener: the document host gets no handle on this tab. */}
                    <a
                      href={d.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover"
                    >
                      <span className="truncate">{d.link}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {d.assigned_roles.map((r) => (
                        <span
                          key={r}
                          className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700"
                        >
                          {assigneeLabel(r)}
                        </span>
                      ))}
                    </div>
                    {d.remarks && (
                      <p className="mt-1.5 whitespace-pre-line text-xs text-muted">{d.remarks}</p>
                    )}
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(d)}
                      aria-label={`Remove ${d.doc_type}`}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-danger-bg hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Remove this document?"
        message={`${pendingDelete?.doc_type ?? "The document"} will be removed from this revision.`}
        detail="The departments it was assigned to will no longer see it."
        confirmLabel="Remove"
        tone="danger"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function CountBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">
      {n}
    </span>
  );
}

/** Top-right of a drawing revision card: that revision's documents. */
export function RevisionDocsButton({
  revisionId,
  label,
  count = 0,
}: {
  revisionId: string;
  label: string;
  count?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-input-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-background"
      >
        <FileText className="h-3.5 w-3.5 text-primary" />
        Documents
        <CountBadge n={count} />
      </button>
      {open && (
        <DrawingDocsModal
          mode="revision"
          id={revisionId}
          label={label}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** On an EC in Planning or Purchase: the drawing documents shared with them. */
export function EcDrawingDocsButton({
  itemId,
  label,
  count,
}: {
  itemId: string;
  label: string;
  count?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-input-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
      >
        <FileText className="h-3.5 w-3.5 text-primary" />
        Drawing docs
        {count !== undefined && <CountBadge n={count} />}
      </button>
      {open && (
        <DrawingDocsModal mode="ec" id={itemId} label={label} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
