"use client";

import { useState } from "react";

import "./GeneralInformationStep.css";
import "./approval/ApprovalStep.css";
import Stepper from "./Stepper";
import { actions, btnGhost, btnPrimary } from "./formStyles";
import { useApproval } from "./approval/ApprovalContext";
import {
  APPROVABLE_STEPS,
  APPROVAL_STEP_LABELS,
  DEFAULT_APPROVAL_STATUS,
  approvalStatusTone,
  isLockedStatus,
} from "../../lib/approval";

type Props = {
  onNext: () => void;
  onPrevious: () => void;
  onStepClick?: (step: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData: any;
};

const formatSentAt = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

// Sending steps for approval is switched off for now. Flip to true to re-enable
// the Send Approval button (the rest of the approval flow is untouched).
const SEND_APPROVAL_ENABLED = false;

/**
 * Step 8 — Approval. The one place steps are chosen for approval: every
 * approvable step is listed with a tick box, and the ticked ones are sent
 * together. Sent steps are locked here and show their status as a read-only
 * badge on their own page (StepApprovalBadge).
 */

const ApprovalStep = ({ onNext, onPrevious, onStepClick, formData }: Props) => {
  const approval = useApproval();
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);

  // Awaiting a decision or approved: locked. A rejected step is handed back —
  // it can be fixed, unticked, or sent again.
  const isSent = (s: number) =>
    Boolean(approval?.selected(s)) &&
    isLockedStatus(approval?.statusOf(s) ?? DEFAULT_APPROVAL_STATUS);
  const selectedSteps = APPROVABLE_STEPS.filter((s) => approval?.selected(s));
  // Pending and Rejected rows move on send; anything awaiting or approved
  // stays as it is.
  const pendingCount = selectedSteps.filter((s) => !isSent(s)).length;

  // "Select all" covers the steps that can still change: sent ones are locked.
  const openSteps = APPROVABLE_STEPS.filter((s) => !isSent(s));
  const allOpenTicked = openSteps.length > 0 && openSteps.every((s) => approval?.selected(s));
  const someOpenTicked = openSteps.some((s) => approval?.selected(s));
  const canEdit = Boolean(approval?.tagId && approval.loaded) && !sending;

  const toggle = (s: number, selected: boolean) => {
    setSentCount(null);
    void approval?.toggle(s, selected);
  };
  const toggleAll = (selected: boolean) => {
    for (const s of openSteps) {
      if (Boolean(approval?.selected(s)) !== selected) toggle(s, selected);
    }
  };

  const handleSend = async () => {
    if (!SEND_APPROVAL_ENABLED) return;
    if (!approval || sending || pendingCount === 0) return;
    setSending(true);
    setSentCount(null);
    try {
      setSentCount(await approval.send());
    } catch {
      // The context stores the message; the banner below renders it.
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="step-container">
      <Stepper currentStep={9} maxStep={formData.wizardMaxStep} onStepClick={onStepClick} />

      <div className="step-card">
        <h2>Approval</h2>
        <p>
          Tick the steps to send for approval, then press <strong>Send Approval</strong>.
          Selection heads are emailed. Sent steps are locked, and their status shows on
          each step&apos;s own page. A rejected step can be fixed and sent again; changing
          a sent or approved step sends it back to Pending.
        </p>

        {!approval?.tagId && (
          <p className="approval-empty">
            No tag is open, so there is nothing to send for approval.
          </p>
        )}

        {approval?.tagId && !approval.loaded && (
          <p className="approval-empty">Loading approval selections…</p>
        )}

        {approval?.tagId && approval.loaded && (
          <div className="approval-table-wrap">
            <table className="approval-table">
              <thead>
                <tr>
                  <th className="approval-check-col">
                    <input
                      type="checkbox"
                      aria-label="Select all steps that haven't been sent"
                      title={
                        openSteps.length === 0
                          ? "Every step has already been sent"
                          : "Select all steps that haven't been sent"
                      }
                      checked={allOpenTicked}
                      ref={(el) => {
                        if (el) el.indeterminate = someOpenTicked && !allOpenTicked;
                      }}
                      disabled={!canEdit || openSteps.length === 0}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  </th>
                  <th>Step</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th aria-label="Open step" />
                </tr>
              </thead>
              <tbody>
                {APPROVABLE_STEPS.map((s) => {
                  const ticked = approval.selected(s);
                  const sent = isSent(s);
                  const status = approval.statusOf(s);
                  const inputId = `approval-step-${s}`;
                  return (
                    <tr key={s} className={ticked ? "is-ticked" : undefined}>
                      <td className="approval-check-col">
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={ticked}
                          disabled={!canEdit || sent}
                          title={
                            sent
                              ? `Already sent for approval (${status}) — it can't be withdrawn.`
                              : undefined
                          }
                          onChange={(e) => toggle(s, e.target.checked)}
                        />
                      </td>
                      <td>
                        <label htmlFor={inputId} className="approval-step-name">
                          {s}. {APPROVAL_STEP_LABELS[s]}
                        </label>
                      </td>
                      <td>
                        {ticked ? (
                          <span className={`approval-pill ${approvalStatusTone(status)}`}>
                            {status}
                          </span>
                        ) : (
                          <span className="approval-not-selected">Not selected</span>
                        )}
                        {ticked && (status === "Approved" || status === "Rejected") && (
                          <div className="approval-decision">
                            {approval.approvals[s]?.decidedByName && (
                              <span>by {approval.approvals[s]?.decidedByName}</span>
                            )}
                            {approval.approvals[s]?.remarks && (
                              <q className={status === "Rejected" ? "is-rejected" : undefined}>
                                {approval.approvals[s]?.remarks}
                              </q>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="mono">
                        {formatSentAt(approval.approvals[s]?.sentAt ?? null)}
                      </td>
                      <td className="approval-view-col">
                        <button
                          type="button"
                          className="approval-step-link"
                          onClick={() => onStepClick?.(s)}
                          title={`Go to ${APPROVAL_STEP_LABELS[s]}`}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {approval?.error && <div className="approval-banner bad">{approval.error}</div>}

        {sentCount !== null && !approval?.error && (
          <div className="approval-banner ok">
            Sent {sentCount} step{sentCount === 1 ? "" : "s"} for approval.
          </div>
        )}

        {selectedSteps.length > 0 && pendingCount === 0 && sentCount === null && (
          <div className="approval-banner ok">
            Everything selected has already been sent for approval.
          </div>
        )}

        <div className="approval-send-row">
          <button
            type="button"
            className={btnPrimary}
            onClick={() => void handleSend()}
            disabled={!SEND_APPROVAL_ENABLED || sending || pendingCount === 0}
            title={
              !SEND_APPROVAL_ENABLED
                ? "Sending for approval is turned off for now."
                : pendingCount === 0
                ? "Nothing new to send — tick a step above first."
                : undefined
            }
          >
            {sending
              ? "Sending…"
              : `Send Approval${pendingCount ? ` (${pendingCount})` : ""}`}
          </button>
        </div>

        <div className={actions}>
          <button className={btnGhost} onClick={onPrevious}>
            Previous
          </button>
          <button className={btnPrimary} onClick={onNext}>
            Get Report
          </button>
        </div>
      </div>
    </div>
  );
};

export default ApprovalStep;
