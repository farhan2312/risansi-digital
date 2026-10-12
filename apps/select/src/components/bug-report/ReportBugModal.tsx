"use client";

import { useEffect, useRef, useState } from "react";
import "./ReportBugModal.css";
import { createBugReport, type BugReportSeverity, type BugReportType } from "../../services/bugReportService";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Current page path, pre-filled into "Page / where" (still editable). */
  page: string;
  onSubmitted?: () => void;
};

const SEVERITIES: BugReportSeverity[] = ["Low", "Medium", "High", "Critical"];

// All the copy that flips between "report a bug" and "request a feature" —
// kept in one place so the two flows read as genuinely different forms
// rather than a bug form with a mislabeled radio button.
const COPY: Record<
  BugReportType,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    titlePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    submitLabel: string;
    submittingLabel: string;
  }
> = {
  bug: {
    eyebrow: "🐞 REPORT A BUG",
    title: "Report a Bug",
    subtitle: "Tell us what went wrong — it goes straight to the admin's Bug Tracker.",
    titlePlaceholder: "Short summary of the issue",
    descriptionLabel: "What happened?",
    descriptionPlaceholder: "Steps to reproduce, what you expected, what actually happened…",
    submitLabel: "Submit Bug",
    submittingLabel: "Submitting…",
  },
  feature: {
    eyebrow: "💡 REPORT A FEATURE",
    title: "Report a Feature",
    subtitle: "Tell us what you'd like to see — it goes straight to the admin's Bug Tracker.",
    titlePlaceholder: "Short summary of the request",
    descriptionLabel: "What would you like?",
    descriptionPlaceholder: "What you're trying to do, and how this feature would help…",
    submitLabel: "Submit Feature",
    submittingLabel: "Submitting…",
  },
};

// Reads a File/Blob (from an <input> pick or a clipboard paste) into a data:
// URL — the shape the API expects for screenshotDataUrl.
const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const ReportBugModal = ({ isOpen, onClose, page, onSubmitted }: Props) => {
  const [type, setType] = useState<BugReportType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BugReportSeverity>("Medium");
  const [pageWhere, setPageWhere] = useState(page);
  const [screenshotName, setScreenshotName] = useState<string | null>(null);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-seed the page field and clear the form each time the modal opens fresh
  // (not on every `page` change while it's already open, so navigating away
  // mid-fill doesn't silently rewrite what the user typed).
  useEffect(() => {
    if (isOpen) {
      setType("bug");
      setTitle("");
      setDescription("");
      setSeverity("Medium");
      setPageWhere(page);
      setScreenshotName(null);
      setScreenshotDataUrl(null);
      setFormError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Ctrl/Cmd+V screenshot paste, while the modal is open.
  useEffect(() => {
    if (!isOpen) return;
    const handlePaste = async (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      e.preventDefault();
      const dataUrl = await readAsDataUrl(file);
      setScreenshotDataUrl(dataUrl);
      setScreenshotName(`pasted-${Date.now()}.png`);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isOpen]);

  if (!isOpen) return null;

  const copy = COPY[type];

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    setScreenshotDataUrl(dataUrl);
    setScreenshotName(file.name);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!title.trim()) {
      setFormError("Title can't be empty.");
      return;
    }
    if (!description.trim()) {
      setFormError("Tell us what happened.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      await createBugReport({
        type,
        title: title.trim(),
        description: description.trim(),
        severity,
        page: pageWhere.trim(),
        screenshotDataUrl: screenshotDataUrl ?? undefined,
        screenshotFileName: screenshotName ?? undefined,
      });
      onSubmitted?.();
      onClose();
    } catch {
      setFormError("Couldn't submit — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bug-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="bug-modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className="bug-modal-eyebrow">{copy.eyebrow}</div>
        <h2 className="bug-modal-title">{copy.title}</h2>
        <p className="bug-modal-subtitle">{copy.subtitle}</p>

        <div className="bug-modal-form">
          <div className="bug-field">
            <label>Type</label>
            <div className="bug-type-toggle">
              <button
                type="button"
                className={type === "bug" ? "active" : ""}
                onClick={() => setType("bug")}
              >
                🐞 Bug
              </button>
              <button
                type="button"
                className={type === "feature" ? "active" : ""}
                onClick={() => setType("feature")}
              >
                💡 Feature
              </button>
            </div>
          </div>

          <div className="bug-field">
            <label>
              Title <span className="req">*</span>
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={copy.titlePlaceholder}
            />
          </div>

          <div className="bug-field">
            <label>
              {copy.descriptionLabel} <span className="req">*</span>
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={copy.descriptionPlaceholder}
            />
          </div>

          <div className="bug-field-row">
            <div className="bug-field">
              <label>Severity</label>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as BugReportSeverity)}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="bug-field">
              <label>Page / where</label>
              <input value={pageWhere} onChange={(e) => setPageWhere(e.target.value)} />
            </div>
          </div>

          <div className="bug-field">
            <label>Screenshot (optional)</label>
            {screenshotName ? (
              <div className="bug-screenshot-attached">
                <span>📎 {screenshotName}</span>
                <button
                  type="button"
                  onClick={() => {
                    setScreenshotName(null);
                    setScreenshotDataUrl(null);
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="bug-screenshot-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                📎 Attach a screenshot — or paste one (Ctrl/⌘+V)
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleFilePick}
            />
          </div>

          {formError && <p className="bug-modal-error">{formError}</p>}
        </div>

        <div className="bug-modal-actions">
          <button className="cancel-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="submit-bug-btn" onClick={handleSubmit} disabled={submitting}>
            {submitting ? copy.submittingLabel : copy.submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportBugModal;
