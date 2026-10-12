"use client";

import "./EditPasswordModal.css";

interface ConfirmModalProps {
  title: string;
  message: string;
  /** Optional red callout under the message for consequences the user must not miss. */
  warning?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** In-app replacement for window.confirm() -- native confirm() dialogs can be
 * silently suppressed by the browser (after repeated triggers, in some
 * embedded/webview contexts, or by extensions), in which case confirm()
 * just returns false with no dialog at all and the destructive action
 * silently never happens. This can't be suppressed the same way. */
const ConfirmModal = ({
  title,
  message,
  warning,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  isConfirming = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) => {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div className="settings-modal-header">
          <h3 id="confirm-modal-title">{title}</h3>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            &#10005;
          </button>
        </div>

        <p style={{ margin: 0, color: "var(--text)", fontSize: 14 }}>{message}</p>

        {warning && (
          <div role="alert" className="mt-3 flex items-start gap-2.5 rounded-xl border border-neg/30 bg-neg-soft px-3.5 py-3 text-[13px] font-medium leading-snug text-neg-strong">
            <span aria-hidden="true" className="text-base leading-none">
              ⚠️
            </span>
            <span>{warning}</span>
          </div>
        )}

        <div className="settings-modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={isConfirming}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "btn-primary btn-danger" : "btn-primary"}
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
