"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Paperclip, Trash2, X } from "lucide-react";
import {
  deleteQcDocumentAction,
  listQcDocumentsAction,
  uploadQcDocumentsAction,
} from "@/app/risansi/orders/actions";
import type { QcDocTable, QcDocumentMeta } from "@/lib/orders";

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function QcDocumentsModal({
  table,
  title = "Attach Docs",
  orderId,
  label,
  canEdit,
  onClose,
}: {
  table: QcDocTable;
  title?: string;
  orderId: string;
  label: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<QcDocumentMeta[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const rows = await listQcDocumentsAction(table, orderId);
    setDocs(rows);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, orderId]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    const formData = new FormData();
    for (const file of files) formData.append("files", file);
    const result = await uploadQcDocumentsAction(table, orderId, formData);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await reload();
    router.refresh();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const result = await deleteQcDocumentAction(table, id);
    setDeletingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await reload();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-card-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:p-6 sm:pb-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="font-display text-lg font-semibold text-foreground">
          {title}
        </h2>
        <p className="mb-5 text-sm text-muted">{label}</p>

        {error && (
          <div className="mb-4 rounded-[10px] border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        {canEdit && (
          <div className="mb-5">
            <label className="flex h-10 w-fit cursor-pointer items-center gap-2 rounded-[10px] border border-input-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-background">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
              {uploading ? "Uploading…" : "Attach files"}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                disabled={uploading}
                onChange={(e) => handleFiles(e.target.files)}
                className="hidden"
              />
            </label>
            <p className="mt-1.5 text-xs text-muted">Up to 8MB per file.</p>
          </div>
        )}

        {docs === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted">No documents attached yet.</p>
        ) : (
          <ul className="divide-y divide-card-border rounded-xl border border-card-border">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {doc.file_name}
                  </p>
                  <p className="text-xs text-muted">
                    {formatSize(doc.file_size)} · {formatDate(doc.uploaded_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <a
                    href={`/api/orders/qc-documents/${doc.id}`}
                    aria-label={`Download ${doc.file_name}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-input-border text-foreground transition-colors hover:bg-background"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleDelete(doc.id)}
                      disabled={deletingId === doc.id}
                      aria-label={`Delete ${doc.file_name}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                    >
                      {deletingId === doc.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
