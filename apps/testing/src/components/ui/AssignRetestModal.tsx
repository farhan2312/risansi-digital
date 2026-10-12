"use client";

import { useState } from "react";
import "./EditPasswordModal.css";
import "./AssignRetestModal.css";
import { assignRetest, type AssignRetestResult } from "@/services/testingService";
import type { UnmetRow } from "@/lib/requirementCheck";

interface AssignRetestModalProps {
  reportId: string;
  model: string;
  reportNo: string | null;
  unmetRows: UnmetRow[];
  onClose: () => void;
  onAssigned: (result: AssignRetestResult) => void;
}

/** Opens when Admin/Central Admin clicks "Assign Retest" on a report that
 * missed a rated target. Prefilled with exactly which parameters failed and
 * by how much, plus a free-form list of action points to record against the
 * new retest requisition -- see the Action Registry (CLAUDE.md's role table
 * covers who can do this). */
const AssignRetestModal = ({ reportId, model, reportNo, unmetRows, onClose, onAssigned }: AssignRetestModalProps) => {
  const [actionPoints, setActionPoints] = useState<string[]>([""]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updatePoint = (i: number, value: string) => {
    setActionPoints((prev) => prev.map((p, idx) => (idx === i ? value : p)));
  };

  const addPoint = () => setActionPoints((prev) => [...prev, ""]);

  const removePoint = (i: number) => {
    setActionPoints((prev) => (prev.length === 1 ? [""] : prev.filter((_, idx) => idx !== i)));
  };

  const handleSubmit = async () => {
    setError("");
    setIsSubmitting(true);
    try {
      const cleaned = actionPoints.map((p) => p.trim()).filter(Boolean);
      const result = await assignRetest(reportId, cleaned);
      onAssigned(result);
    } catch {
      setError("Could not assign retest. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="settings-modal assign-retest-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-retest-title"
      >
        <div className="settings-modal-header">
          <h3 id="assign-retest-title">Action Registry — Assign Retest</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close" disabled={isSubmitting}>
            &#10005;
          </button>
        </div>

        {error && <div className="modal-form-error">{error}</div>}

        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
          {model}
          {reportNo ? ` — ${reportNo}` : ""} did not meet its rated requirement on the parameter(s) below. This
          raises a fresh Pending requisition for retest and logs the entry in the Action Registry.
        </p>

        <label>Parameters not met</label>
        <div className="retest-unmet-table">
          <div className="retest-unmet-head">
            <span>Parameter</span>
            <span>Rated</span>
            <span>Measured</span>
          </div>
          {unmetRows.map((row) => (
            <div className="retest-unmet-row" key={row.label}>
              <span>{row.label}</span>
              <span>
                {row.rated ?? "-"} {row.unit}
              </span>
              <span className="retest-unmet-bad">
                {row.measured ?? "-"} {row.unit}
                <em>{row.direction === "over-limit" ? "over limit" : "below target"}</em>
              </span>
            </div>
          ))}
        </div>

        <label>Action points</label>
        <div className="retest-action-points">
          {actionPoints.map((point, i) => (
            <div className="retest-action-point-row" key={i}>
              <input
                type="text"
                placeholder={`Action point ${i + 1}`}
                value={point}
                onChange={(e) => updatePoint(i, e.target.value)}
              />
              <button
                type="button"
                className="retest-action-point-remove"
                onClick={() => removePoint(i)}
                aria-label="Remove action point"
                disabled={actionPoints.length === 1 && !point}
              >
                &#10005;
              </button>
            </div>
          ))}
          <button type="button" className="retest-action-point-add" onClick={addPoint}>
            + Add action point
          </button>
        </div>

        <div className="settings-modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Assigning..." : "Assign Retest"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssignRetestModal;
