"use client";

import { useEffect, type ReactNode } from "react";

export interface PdfPreview {
  /** Object URL of the generated PDF blob. */
  url: string;
  filename: string;
}

/**
 * Shows a generated PDF before it is saved: the document in an iframe, with a
 * Download button that saves that same file. Closes on the backdrop, Close or
 * Escape. The caller owns the object URL (revoke it in onClose).
 */
export default function PdfPreviewModal({
  preview,
  title,
  onClose,
  onDownload,
  downloadLabel = "Download",
  actions,
}: {
  preview: PdfPreview;
  title: string;
  onClose: () => void;
  /** Runs when the user clicks Download (the browser saves the file itself). */
  onDownload?: () => void;
  /** Text on the PDF download button (e.g. "Download PDF" beside an Excel one). */
  downloadLabel?: string;
  /** Extra buttons before Download (e.g. "Download Excel"). */
  actions?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(10,22,40,0.6)] p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} preview`}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[92vh] w-full max-w-[960px] flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-[0_24px_64px_rgba(0,0,0,0.3)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-fg">{title}</div>
            <div className="truncate font-mono text-[11.5px] text-fg-3">{preview.filename}</div>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <a
              href={preview.url}
              download={preview.filename}
              onClick={onDownload}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(10,61,143,0.15)] transition hover:-translate-y-px"
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
                <path
                  d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {downloadLabel}
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-fg-2 transition hover:border-accent hover:text-accent"
            >
              Close
            </button>
          </div>
        </div>
        <iframe title={title} src={preview.url} className="w-full flex-1 border-0 bg-sunk" />
      </div>
    </div>
  );
}
