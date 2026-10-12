"use client";

import { useEffect, useState } from "react";
import "./EditPasswordModal.css";
import { getBugReport, openBugReportScreenshot } from "@/services/adminService";
import type { BugReport } from "@/types/testing";

interface BugReportDetailModalProps {
  reportId: string;
  onClose: () => void;
  /** Fired once the detail fetch confirms the report is (now) read --
   * lets the board drop its unread dot without waiting on the next poll. */
  onRead: (report: BugReport) => void;
}

const severityColor: Record<string, string> = {
  Low: "var(--text-muted)",
  Medium: "var(--warn)",
  High: "var(--neg)",
  Critical: "var(--neg)",
};

/** Opening this modal is what "visiting" a report means for the sidebar
 * bell -- the fetch itself (GET /api/bug-reports/[id]) marks it read
 * server-side, so simply mounting this is enough to clear its unread state. */
const BugReportDetailModal = ({ reportId, onClose, onRead }: BugReportDetailModalProps) => {
  const [report, setReport] = useState<BugReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getBugReport(reportId)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        onRead(r);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this report.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-detail-title"
      >
        <div className="settings-modal-header">
          <h3 id="bug-detail-title">{report ? (report.type === "bug" ? "🐛 Bug Report" : "✨ Feature Request") : "Loading..."}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        {error && (
          <div className="modal-form-error" role="alert">
            {error}
          </div>
        )}

        {report && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-h)" }}>{report.title}</div>
              {report.description && (
                <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--text)", whiteSpace: "pre-wrap" }}>
                  {report.description}
                </p>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12.5 }}>
              <span style={{ color: severityColor[report.severity], fontWeight: 700 }}>{report.severity} severity</span>
              <span style={{ color: "var(--text-muted)" }}>&middot; {report.status}</span>
              {report.page && <span style={{ color: "var(--text-muted)" }}>&middot; {report.page}</span>}
            </div>

            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              Reported by {report.reported_by_name ?? "Unknown"} on {new Date(report.created_at).toLocaleString()}
            </div>

            {report.has_screenshot && (
              <button
                type="button"
                className="bug-link-btn"
                style={{ alignSelf: "flex-start" }}
                onClick={() => openBugReportScreenshot(report.id)}
              >
                View screenshot
              </button>
            )}
          </div>
        )}

        <div className="settings-modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default BugReportDetailModal;
