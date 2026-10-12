import { useEffect } from "react";
import Spinner from "./Spinner";
import "./ConfirmModal.css";

type Tone = "danger" | "primary";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  /** Optional extra body content between description and the actions row. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  /** Show a spinner + disable the confirm button while true. */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Accessible replacement for window.confirm. Overlay click + Escape close
 * the modal (unless busy). Focus lands on the confirm button on open. */
const ConfirmModal = ({
  open,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  onConfirm,
  onClose,
}: ConfirmModalProps) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      className="confirm-modal-overlay"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="confirm-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className={`confirm-modal-icon confirm-modal-icon-${tone}`} aria-hidden="true">
          {tone === "danger" ? <DangerIcon /> : <QuestionIcon />}
        </div>
        <div className="confirm-modal-body">
          <h3 id="confirm-modal-title" className="confirm-modal-title">
            {title}
          </h3>
          {description && (
            <div className="confirm-modal-desc">{description}</div>
          )}
          {children}
        </div>
        <div className="confirm-modal-actions">
          <button
            type="button"
            className="confirm-modal-btn confirm-modal-btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-modal-btn confirm-modal-btn-${tone}`}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? <Spinner size="sm" inline /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const DangerIcon = () => (
  <svg viewBox="0 0 48 48" fill="none" width="26" height="26">
    <path
      d="M24 8 6 40h36L24 8Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path d="M24 20v10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <circle cx="24" cy="34" r="1.8" fill="currentColor" />
  </svg>
);

const QuestionIcon = () => (
  <svg viewBox="0 0 48 48" fill="none" width="26" height="26">
    <circle cx="24" cy="24" r="16" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M19 20a5 5 0 0 1 10 0c0 3-5 3.5-5 6.5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="24" cy="33" r="1.6" fill="currentColor" />
  </svg>
);

export default ConfirmModal;
