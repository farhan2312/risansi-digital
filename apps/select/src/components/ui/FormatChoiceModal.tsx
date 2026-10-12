"use client";

import "./FormatChoiceModal.css";

export type DownloadFormat = "pdf" | "excel";

type Props = {
  title: string;
  /** One line of context, e.g. what is being downloaded. */
  message?: string;
  busy?: DownloadFormat | null;
  onChoose: (format: DownloadFormat) => void;
  onCancel: () => void;
};

/**
 * "PDF or Excel?" prompt shown before a report download. Two big targets
 * rather than a dropdown + confirm — there are only ever two answers, and the
 * choice IS the action.
 */
const FormatChoiceModal = ({ title, message, busy = null, onChoose, onCancel }: Props) => (
  <div className="fmt-overlay" onClick={busy ? undefined : onCancel}>
    <div
      className="fmt-modal"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
    >
      <h3>{title}</h3>
      {message && <p className="fmt-message">{message}</p>}

      <div className="fmt-choices">
        <button
          type="button"
          className="fmt-choice"
          onClick={() => onChoose("pdf")}
          disabled={busy !== null}
        >
          <span className="fmt-choice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="fmt-choice-text">
            <b>{busy === "pdf" ? "Preparing…" : "PDF"}</b>
            <em>Formatted document, ready to send</em>
          </span>
        </button>

        <button
          type="button"
          className="fmt-choice"
          onClick={() => onChoose("excel")}
          disabled={busy !== null}
        >
          <span className="fmt-choice-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <rect
                x="4"
                y="4"
                width="16"
                height="16"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M4 10h16M10 10v10"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="fmt-choice-text">
            <b>{busy === "excel" ? "Preparing…" : "Excel"}</b>
            <em>Spreadsheet you can edit and filter</em>
          </span>
        </button>
      </div>

      <div className="fmt-actions">
        <button type="button" className="fmt-cancel" onClick={onCancel} disabled={busy !== null}>
          Cancel
        </button>
      </div>
    </div>
  </div>
);

export default FormatChoiceModal;
