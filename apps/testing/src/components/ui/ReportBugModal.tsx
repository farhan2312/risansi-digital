"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { usePathname } from "next/navigation";
import "./EditPasswordModal.css";
import "./ReportBugModal.css";
import { submitBugReport, type NewBugReportInput } from "@/services/testingService";
import type { BugReportSeverity, BugReportType } from "@/types/testing";

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024; // 4MB, matches the API's own cap.
const SEVERITIES: BugReportSeverity[] = ["Low", "Medium", "High", "Critical"];

interface ReportBugModalProps {
  onClose: () => void;
}

/** "Report a Bug" widget, open to every logged-in user regardless of role. */
const ReportBugModal = ({ onClose }: ReportBugModalProps) => {
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<BugReportType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BugReportSeverity>("Medium");
  const [page, setPage] = useState(pathname ?? "");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Screenshot must be an image file.");
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setError("Screenshot exceeds the 4MB limit.");
      return;
    }
    setError("");
    setScreenshot(file);
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      const input: NewBugReportInput = {
        type,
        title: title.trim(),
        severity,
        ...(description.trim() && { description: description.trim() }),
        ...(page.trim() && { page: page.trim() }),
        ...(screenshot && { screenshot }),
      };
      await submitBugReport(input);
      setIsDone(true);
    } catch {
      setError("Could not submit. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isDone) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="settings-modal-header">
            <h3>Thanks!</h3>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              &#10005;
            </button>
          </div>
          <p style={{ margin: 0, color: "var(--text)", fontSize: 14 }}>
            Your {type === "bug" ? "bug report" : "feature request"} has been submitted.
          </p>
          <div className="settings-modal-actions">
            <button type="button" className="btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="settings-modal report-bug-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-bug-title"
      >
        <div className="settings-modal-header">
          <h3 id="report-bug-title">🐛 Report a Bug</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close" disabled={isSubmitting}>
            &#10005;
          </button>
        </div>

        {error && <div className="modal-form-error">{error}</div>}

        <label>Type</label>
        <div className="bug-type-toggle">
          <button
            type="button"
            className={type === "bug" ? "bug-type-btn bug-type-active-bug" : "bug-type-btn"}
            onClick={() => setType("bug")}
          >
            Bug
          </button>
          <button
            type="button"
            className={type === "feature" ? "bug-type-btn bug-type-active-feature" : "bug-type-btn"}
            onClick={() => setType("feature")}
          >
            Feature
          </button>
        </div>

        <label htmlFor="bug-title">
          Title <span style={{ color: "var(--neg)" }}>*</span>
        </label>
        <input
          id="bug-title"
          type="text"
          placeholder="Short summary of the issue"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={255}
        />

        <label htmlFor="bug-description">What happened?</label>
        <textarea
          id="bug-description"
          className="bug-textarea"
          placeholder="Steps to reproduce, what you expected, what actually happened..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
        />

        <div className="bug-field-row">
          <div>
            <label htmlFor="bug-severity">Severity</label>
            <select id="bug-severity" value={severity} onChange={(e) => setSeverity(e.target.value as BugReportSeverity)}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="bug-page">Page / where</label>
            <input id="bug-page" type="text" value={page} onChange={(e) => setPage(e.target.value)} />
          </div>
        </div>

        <label>Screenshot (optional)</label>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        <button type="button" className="bug-screenshot-picker" onClick={() => fileInputRef.current?.click()}>
          {screenshot ? `📎 ${screenshot.name}` : "📎 Click to attach an image"}
        </button>

        <div className="settings-modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : `Submit ${type === "bug" ? "Bug" : "Feature"}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportBugModal;
