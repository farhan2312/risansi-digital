"use client";

import { useEffect, useMemo, useState } from "react";

import {
  SENT_APPROVAL_STATUS,
  approvalStatusTone,
  type DecisionStatus,
} from "../../lib/approval";
import type { ApprovalReview, ApprovalReviewStep } from "../../lib/approval-details";
import {
  decideApprovals,
  getApprovalReview,
  type ApprovalDecision,
} from "../../services/approvalService";

type Draft = { status: DecisionStatus | null; remarks: string };

const fmtWhen = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
};

const errorText = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;

const isOpen = (s: ApprovalReviewStep) => s.status === SENT_APPROVAL_STATUS;

/**
 * The selection head's review of one tag's approval request: every sent step
 * with its saved values, and an Approve / Reject choice (with a remark,
 * required to reject) for each one still awaiting a decision. Steps already
 * decided show that decision read-only.
 */
const ApprovalReviewModal = ({
  tagId,
  onClose,
  onDecided,
}: {
  tagId: string;
  onClose: () => void;
  /** Called after decisions are saved, so the list behind can refresh. */
  onDecided: () => void;
}) => {
  const [review, setReview] = useState<ApprovalReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApprovalReview(tagId)
      .then((r) => {
        if (cancelled) return;
        setReview(r);
        // Open on the first step still waiting, else the first step.
        setActiveStep((r.steps.find(isOpen) ?? r.steps[0])?.step ?? null);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorText(e, "Couldn't load this request."));
      });
    return () => {
      cancelled = true;
    };
  }, [tagId]);

  // Esc closes, unless a save is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const openSteps = useMemo(() => review?.steps.filter(isOpen) ?? [], [review]);
  const chosen = openSteps.filter((s) => drafts[s.step]?.status);
  const missingRemark = (s: ApprovalReviewStep) =>
    drafts[s.step]?.status === "Rejected" && !drafts[s.step]?.remarks.trim();
  const blocked = chosen.filter(missingRemark);

  const setDraft = (step: number, patch: Partial<Draft>) => {
    setSavedCount(null);
    setSaveError(null);
    setDrafts((d) => {
      const base: Draft = d[step] ?? { status: null, remarks: "" };
      return { ...d, [step]: { ...base, ...patch } };
    });
  };

  const approveAllRemaining = () => {
    for (const s of openSteps) {
      if (!drafts[s.step]?.status) setDraft(s.step, { status: "Approved" });
    }
  };

  const submit = async () => {
    setTriedSubmit(true);
    if (chosen.length === 0 || blocked.length > 0 || saving) {
      if (blocked.length > 0) setActiveStep(blocked[0].step);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const decisions: ApprovalDecision[] = chosen.map((s) => ({
        step: s.step,
        status: drafts[s.step].status as DecisionStatus,
        remarks: drafts[s.step].remarks.trim(),
      }));
      const updated = await decideApprovals(tagId, decisions);
      setReview(updated);
      setDrafts({});
      setTriedSubmit(false);
      setSavedCount(decisions.length);
      onDecided();
    } catch (e) {
      setSaveError(errorText(e, "Couldn't save the decisions. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  const active = review?.steps.find((s) => s.step === activeStep) ?? null;

  return (
    <div className="apv-overlay" onClick={() => !saving && onClose()}>
      <div
        className="apv-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="apv-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="apv-modal-head">
          <div className="apv-modal-titles">
            <p className="apv-kicker">Approval request</p>
            <h2 id="apv-modal-title">
              {review ? `${review.enquiryCode} · ${review.tagName}` : "Loading…"}
            </h2>
            {review && (
              <p className="apv-subtitle">
                {[review.customerName, review.projectName].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <button type="button" className="apv-close" aria-label="Close" onClick={onClose} disabled={saving}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {loadError && <p className="apv-banner bad">{loadError}</p>}
        {!review && !loadError && <p className="apv-loading">Loading the request…</p>}

        {review && (
          <>
            <div className="apv-facts">
              {[
                ["Pump", review.pumpModel],
                ["Duty", review.duty],
                ["Liquid", review.media],
                [
                  "Sent by",
                  [review.steps[0]?.sentByName, fmtWhen(review.steps[0]?.sentAt ?? null)]
                    .filter(Boolean)
                    .join(" · "),
                ],
              ]
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label} className="apv-fact">
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
            </div>

            {review.steps.length === 0 ? (
              <p className="apv-loading">
                Nothing from this tag is waiting any more — its steps were changed and sent back to the engineer.
              </p>
            ) : (
              <div className="apv-body">
                <nav className="apv-rail" aria-label="Steps in this request">
                  {review.steps.map((s) => {
                    const draft = drafts[s.step]?.status;
                    const tone = isOpen(s)
                      ? draft === "Approved"
                        ? "ok"
                        : draft === "Rejected"
                          ? "bad"
                          : "sent"
                      : approvalStatusTone(s.status);
                    return (
                      <button
                        key={s.step}
                        type="button"
                        className={`apv-rail-item${s.step === activeStep ? " is-active" : ""}`}
                        onClick={() => setActiveStep(s.step)}
                      >
                        <span className={`apv-rail-num ${tone}`}>{s.step}</span>
                        <span className="apv-rail-text">
                          <span className="apv-rail-label">{s.label}</span>
                          <span className="apv-rail-status">
                            {isOpen(s) ? (draft ? `${draft} (not saved)` : "Awaiting decision") : s.status}
                          </span>
                        </span>
                        {triedSubmit && missingRemark(s) && <span className="apv-rail-flag" aria-label="Needs a remark">!</span>}
                      </button>
                    );
                  })}
                </nav>

                {active && (
                  <section className="apv-detail" aria-live="polite">
                    <div className="apv-detail-head">
                      <h3>
                        {active.step}. {active.label}
                      </h3>
                      <span className={`approval-pill ${approvalStatusTone(active.status)}`}>{active.status}</span>
                    </div>

                    {active.groups.length === 0 && (
                      <p className="apv-empty-step">Nothing has been filled in on this step.</p>
                    )}
                    {active.groups.map((g, i) => (
                      <div key={g.title ?? i} className={`apv-group${g.highlight ? " is-highlight" : ""}`}>
                        {g.title && <p className="apv-group-title">{g.title}</p>}
                        <dl className="apv-grid">
                          {g.items.map(([label, value]) => (
                            <div key={label} className="apv-field">
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}

                    {isOpen(active) ? (
                      <div className="apv-decide">
                        <p className="apv-decide-label">Your decision</p>
                        <div className="apv-choice" role="radiogroup" aria-label={`Decision for ${active.label}`}>
                          {(["Approved", "Rejected"] as const).map((status) => (
                            <button
                              key={status}
                              type="button"
                              role="radio"
                              aria-checked={drafts[active.step]?.status === status}
                              className={`apv-choice-btn ${status === "Approved" ? "ok" : "bad"}${
                                drafts[active.step]?.status === status ? " is-on" : ""
                              }`}
                              onClick={() =>
                                setDraft(active.step, {
                                  status: drafts[active.step]?.status === status ? null : status,
                                })
                              }
                            >
                              {status === "Approved" ? "Approve" : "Reject"}
                            </button>
                          ))}
                        </div>
                        <label className="apv-remarks">
                          <span>
                            Remarks{drafts[active.step]?.status === "Rejected" ? " (required to reject)" : " (optional)"}
                          </span>
                          <textarea
                            rows={3}
                            maxLength={1000}
                            value={drafts[active.step]?.remarks ?? ""}
                            placeholder={
                              drafts[active.step]?.status === "Rejected"
                                ? "What should the engineer change?"
                                : "Anything the engineer should know"
                            }
                            aria-invalid={triedSubmit && missingRemark(active)}
                            onChange={(e) => setDraft(active.step, { remarks: e.target.value })}
                          />
                        </label>
                        {triedSubmit && missingRemark(active) && (
                          <p className="apv-field-error">Add a remark so the engineer knows what to fix.</p>
                        )}
                      </div>
                    ) : (
                      <div className={`apv-decided ${approvalStatusTone(active.status)}`}>
                        <p>
                          <strong>{active.status}</strong>
                          {active.decidedByName ? ` by ${active.decidedByName}` : ""}
                          {active.decidedAt ? ` · ${fmtWhen(active.decidedAt)}` : ""}
                        </p>
                        {active.remarks && <p className="apv-decided-remarks">&ldquo;{active.remarks}&rdquo;</p>}
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}

            <footer className="apv-modal-foot">
              <div className="apv-foot-status">
                {saveError && <span className="apv-foot-error">{saveError}</span>}
                {!saveError && savedCount !== null && (
                  <span className="apv-foot-ok">
                    Saved {savedCount} decision{savedCount === 1 ? "" : "s"}. The engineer sees them on their Approval step.
                  </span>
                )}
                {!saveError && savedCount === null && openSteps.length > 0 && (
                  <span>
                    {chosen.length} of {openSteps.length} decided
                    {triedSubmit && chosen.length === 0 ? " — choose Approve or Reject first" : ""}
                  </span>
                )}
                {!saveError && savedCount === null && openSteps.length === 0 && review.steps.length > 0 && (
                  <span>Every step in this request has been decided.</span>
                )}
              </div>
              <div className="apv-foot-actions">
                {openSteps.length > 1 && (
                  <button
                    type="button"
                    className="apv-btn ghost"
                    onClick={approveAllRemaining}
                    disabled={saving || chosen.length === openSteps.length}
                  >
                    Approve all remaining
                  </button>
                )}
                {openSteps.length > 0 ? (
                  <button type="button" className="apv-btn primary" onClick={() => void submit()} disabled={saving}>
                    {saving ? "Saving…" : `Submit decision${chosen.length === 1 ? "" : "s"}`}
                  </button>
                ) : (
                  <button type="button" className="apv-btn primary" onClick={onClose}>
                    Close
                  </button>
                )}
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};

export default ApprovalReviewModal;
