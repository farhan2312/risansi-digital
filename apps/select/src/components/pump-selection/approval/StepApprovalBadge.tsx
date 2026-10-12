"use client";

import "./StepApprovalBadge.css";
import { approvalStatusTone, isApprovableStep } from "../../../lib/approval";
import { useApproval } from "./ApprovalContext";

/** How each sent status reads on the badge. */
const BADGE_TEXT: Record<string, string> = {
  "Awaiting Approval": "Awaiting approval",
  Approved: "Approved",
  Rejected: "Rejected",
};

/**
 * Read-only approval status for one wizard step, at the right-hand end of that
 * step's header banner. Steps are chosen and sent on the Approval step; this
 * only reports what happened to this one.
 *
 * Shown once the step has been sent. Renders nothing before that, when no tag
 * is open, or when the step isn't approvable, so it can sit in any step
 * header unconditionally.
 */
const StepApprovalBadge = ({ step }: { step: number }) => {
  const approval = useApproval();
  if (!approval || !approval.tagId || !isApprovableStep(step)) return null;

  const status = approval.statusOf(step);
  if (!approval.selected(step) || !BADGE_TEXT[status]) return null;

  return (
    <span
      className={`step-approval-badge ${approvalStatusTone(status)}`}
      title="Approval status for this step. Steps are chosen and sent on the Approval step."
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3.5 5 6v5.5c0 4.2 2.9 7.4 7 8.9 4.1-1.5 7-4.7 7-8.9V6l-7-2.5Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      {BADGE_TEXT[status]}
    </span>
  );
};

export default StepApprovalBadge;
