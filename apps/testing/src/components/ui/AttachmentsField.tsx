"use client";

import { useState, type ChangeEvent } from "react";
import { formatFileSize } from "@/lib/formUtils";
import type { RequisitionAttachment } from "@/types/testing";
import "./AttachmentsField.css";

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // 4MB -- see schema.ts comment on requisitionAttachments.
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];
export const ATTACHMENT_ACCEPT = ALLOWED_TYPES.join(",");

interface AttachmentsFieldProps {
  pendingFiles: File[];
  onPendingFilesChange: (files: File[]) => void;
  /** Only present once the requisition actually exists (Edit, not New). */
  existingAttachments?: RequisitionAttachment[];
  onView?: (attachment: RequisitionAttachment) => void;
  onDeleteExisting?: (attachment: RequisitionAttachment) => void;
  deletingId?: string | null;
}

/** File picker + staged/uploaded attachment list, shared between New and
 * Edit Requisition. New has only pendingFiles (nothing exists to attach to
 * yet); Edit also passes existingAttachments with view/delete handlers. */
const AttachmentsField = ({
  pendingFiles,
  onPendingFilesChange,
  existingAttachments,
  onView,
  onDeleteExisting,
  deletingId,
}: AttachmentsFieldProps) => {
  const [pickError, setPickError] = useState("");

  const handleFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = ""; // lets the same filename be re-picked later
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const f of selected) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        rejected.push(`${f.name} (unsupported file type)`);
        continue;
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        rejected.push(`${f.name} (over 4MB)`);
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length) onPendingFilesChange([...pendingFiles, ...accepted]);
    setPickError(rejected.length ? `Skipped: ${rejected.join(", ")}` : "");
  };

  const removePending = (index: number) => {
    onPendingFilesChange(pendingFiles.filter((_, i) => i !== index));
  };

  return (
    <div className="field field-full">
      <label htmlFor="attachments">Attachments (PDF or image, max 4MB each)</label>
      <input id="attachments" type="file" multiple accept={ATTACHMENT_ACCEPT} onChange={handleFilesSelected} />
      {pickError && <span className="field-error">{pickError}</span>}

      {(existingAttachments?.length ?? 0) > 0 && (
        <ul className="attachment-list">
          {existingAttachments!.map((a) => (
            <li key={a.id}>
              <button type="button" className="attachment-open-btn" onClick={() => onView?.(a)}>
                {a.file_name}
              </button>
              <span className="attachment-meta">
                {formatFileSize(a.file_size)}
                {a.uploaded_by_name && ` · ${a.uploaded_by_name}`}
              </span>
              {onDeleteExisting && (
                <button
                  type="button"
                  className="attachment-remove-btn"
                  disabled={deletingId === a.id}
                  onClick={() => onDeleteExisting(a)}
                >
                  {deletingId === a.id ? "Removing…" : "Remove"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {pendingFiles.length > 0 && (
        <ul className="attachment-list attachment-list-pending">
          {pendingFiles.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className="attachment-pending-name">{f.name}</span>
              <span className="attachment-meta">{formatFileSize(f.size)} · not yet uploaded</span>
              <button type="button" className="attachment-remove-btn" onClick={() => removePending(i)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AttachmentsField;
