"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Image as ImageIcon, Loader2, Plus, Trash2, X } from "lucide-react";
import { addDispatchPicturesAction, removeDispatchPictureAction } from "@/app/risansi/orders/picture-actions";

export type PictureLink = { id: string; link: string };

/**
 * The order's pictures on one dispatch: its SharePoint links, each opening
 * directly. Dispatch adds and removes them here; the Orders page shows them
 * as they stand.
 */
export function DispatchPictures({
  invoiceId,
  label,
  links,
  canEdit,
}: {
  invoiceId: string;
  /** What the pop-up says it is for: the SO and the dispatch. */
  label: string;
  links?: PictureLink[] | null;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const list = links ?? [];
  return (
    <span className="flex flex-col items-start gap-1">
      {list.map((l, i) => (
        <a
          key={l.id}
          href={l.link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={l.link}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
        >
          <ImageIcon className="h-3.5 w-3.5 shrink-0" />
          Picture {i + 1}
        </a>
      ))}
      {canEdit ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-input-border px-1.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
        >
          <Plus className="h-3.5 w-3.5" />
          {list.length ? "Add / remove" : "Add link"}
        </button>
      ) : (
        list.length === 0 && <span className="text-muted-foreground">—</span>
      )}
      {open && <PicturesDialog invoiceId={invoiceId} label={label} links={list} onClose={() => setOpen(false)} />}
    </span>
  );
}

function PicturesDialog({
  invoiceId,
  label,
  links,
  onClose,
}: {
  invoiceId: string;
  label: string;
  links: PictureLink[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await addDispatchPicturesAction(invoiceId, text);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setText("");
    router.refresh();
  }

  async function remove(l: PictureLink, n: number) {
    if (!window.confirm(`Remove Picture ${n}?`)) return;
    setBusy(true);
    setError(null);
    const res = await removeDispatchPictureAction(l.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Order pictures"
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-6"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={add}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Order pictures</h2>
            <p className="text-xs text-muted">{label}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-[10px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">{error}</div>
        )}

        {links.length > 0 && (
          <ul className="mb-4 space-y-2">
            {links.map((l, i) => (
              <li key={l.id} className="flex items-center gap-2 rounded-lg border border-card-border px-3 py-2 text-sm">
                <a href={l.link} target="_blank" rel="noopener noreferrer" title={l.link} className="min-w-0 flex-1 truncate font-medium text-primary hover:underline">
                  Picture {i + 1} · {l.link}
                </a>
                <button
                  type="button"
                  onClick={() => remove(l, i + 1)}
                  disabled={busy}
                  aria-label={`Remove Picture ${i + 1}`}
                  className="shrink-0 rounded-md p-1 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">SharePoint links, one on each line</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="https://…sharepoint.com/…"
            className="w-full rounded-lg border border-input-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-lg border border-input-border px-3 text-sm font-medium text-foreground hover:bg-background"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
