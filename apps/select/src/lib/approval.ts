/**
 * Per-step approval: which wizard steps can be put up for approval, what the
 * statuses are, and how they read on screen.
 *
 * Shared by the client (the toggle on each step header, the Approval step's
 * table) and the server (/api/step-approvals), so the two can never disagree
 * about which step numbers are valid or which statuses exist.
 */

/** Wizard steps that can be sent for approval, in wizard order.
 *
 * Steps 1-7 only. Step 8 is the Approval step itself — it cannot approve
 * itself — and step 9 is the generated summary, which is output rather than a
 * decision anyone signs off. */
export const APPROVABLE_STEPS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Step number -> the label used on the Approval step and in the audit trail.
 * Matches the Stepper's own labels, spelled out where the stepper abbreviates
 * (the stepper has a few pixels per step; this table does not). */
export const APPROVAL_STEP_LABELS: Record<number, string> = {
  1: "General Information",
  2: "Fluid Properties",
  3: "Specifications",
  4: "MOC & Elastomer",
  5: "Sealing Details",
  6: "Motor Rating",
  7: "Drive Details",
};

export const isApprovableStep = (step: number): boolean =>
  (APPROVABLE_STEPS as readonly number[]).includes(step);

/** Lifecycle of one step's approval.
 *
 * Pending           - ticked for approval, not sent yet (the default). Also
 *                     where a sent or decided step returns when its data is
 *                     changed afterwards (see approvalStepsForChange).
 * Awaiting Approval - sent; a selection head has not decided.
 * Approved/Rejected - a selection head's decision (Approvals page). A
 *                     rejected step can be fixed and sent again.
 */
export const APPROVAL_STATUSES = [
  "Pending",
  "Awaiting Approval",
  "Approved",
  "Rejected",
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const isApprovalStatus = (value: string): value is ApprovalStatus =>
  (APPROVAL_STATUSES as readonly string[]).includes(value);

/** The status a freshly-ticked step starts in. */
export const DEFAULT_APPROVAL_STATUS: ApprovalStatus = "Pending";

/** What "Send Approval" moves a Pending step to. */
export const SENT_APPROVAL_STATUS: ApprovalStatus = "Awaiting Approval";

/** What a selection head can decide. */
export const DECISION_STATUSES = ["Approved", "Rejected"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export const isDecisionStatus = (value: string): value is DecisionStatus =>
  (DECISION_STATUSES as readonly string[]).includes(value);

/** Sent and not sent back: the engineer can't untick it, and Send skips it. */
export const isLockedStatus = (status: string): boolean =>
  status === SENT_APPROVAL_STATUS || status === "Approved";

/** What Send Approval moves to Awaiting Approval: never sent, or rejected and
 * being sent again after a fix. */
export const SENDABLE_STATUSES: readonly ApprovalStatus[] = ["Pending", "Rejected"];

/** Roles that can decide approvals. Selection heads are emailed; system
 * admins can also decide, as they can everything else. */
export const APPROVER_ROLES = ["selection_head", "system_admin"] as const;
export const canApprove = (role: string | null | undefined): boolean =>
  (APPROVER_ROLES as readonly string[]).includes(role ?? "");

/** One step's approval state as it travels over the wire. */
export type StepApproval = {
  step: number;
  selected: boolean;
  status: ApprovalStatus;
  sentAt: string | null;
  decidedAt: string | null;
  /** Who decided, for "Rejected by …" on the Approval step. */
  decidedByName?: string | null;
  remarks: string | null;
};

/** One tag on the selection head's Approvals page (GET /api/approvals). */
export interface ApprovalInboxItem {
  tagId: string;
  tagName: string;
  enquiryCode: string;
  projectName: string;
  customerName: string | null;
  pumpModel: string | null;
  sentByName: string | null;
  /** Most recent send for this tag. */
  sentAt: string | null;
  /** Steps still awaiting a decision. */
  awaiting: number;
  steps: { step: number; label: string; status: ApprovalStatus }[];
}

export type ApprovalInboxView = "awaiting" | "decided" | "all";

export interface ApprovalInbox {
  items: ApprovalInboxItem[];
  counts: Record<ApprovalInboxView, number>;
}

// --- Which step a saved change belongs to ---------------------------------

/** Fields of the shared moc-sealing table that belong to Sealing (step 5);
 * everything else in that table is MOC (step 4). */
const SEALING_FIELDS = new Set([
  "sealingType", "sealingSubType", "glandPackingType", "glandPackingMake",
  "mechSealMoc", "mechSealFace", "mechSealMake", "sealingRemarks",
]);

/** Fields of the shared motor-drive table that belong to Motor Rating
 * (step 6); everything else in that table is Drive (step 7). */
const MOTOR_RATING_FIELDS = new Set(["driveMotorKw", "driveMotorKwRemarks"]);

/** Wizard steps whose approval a change to these fields of a wizard-input
 * table invalidates. An approval must match what the selection head saw, so
 * a real change sends the step back to Pending. Tables not listed (the
 * Commercial page's pump-model-qty) are not approvable, so reset nothing. */
export function approvalStepsForChange(tableKey: string, changedKeys: string[]): number[] {
  const steps = new Set<number>();
  for (const key of changedKeys) {
    switch (tableKey) {
      case "general-info":
        steps.add(1);
        break;
      case "fluid-properties":
        steps.add(2);
        break;
      case "operating-conditions":
        steps.add(3);
        break;
      case "moc-sealing":
        steps.add(SEALING_FIELDS.has(key) ? 5 : 4);
        break;
      case "motor-drive":
        steps.add(MOTOR_RATING_FIELDS.has(key) ? 6 : 7);
        break;
      case "drive-direct":
      case "drive-vbelt":
      case "drive-geared":
        steps.add(7);
        break;
    }
  }
  return [...steps].sort((a, b) => a - b);
}

/** Every step a whole wizard-input table covers — for clearing the table. */
export const APPROVAL_STEPS_BY_TABLE: Record<string, number[]> = {
  "general-info": [1],
  "fluid-properties": [2],
  "operating-conditions": [3],
  "moc-sealing": [4, 5],
  "motor-drive": [6, 7],
  "drive-direct": [7],
  "drive-vbelt": [7],
  "drive-geared": [7],
};

/** CSS modifier for a status pill — keeps the colour mapping in one place
 * rather than repeated in each component that renders a status. */
export const approvalStatusTone = (status: ApprovalStatus): string => {
  if (status === "Approved") return "ok";
  if (status === "Rejected") return "bad";
  if (status === "Awaiting Approval") return "sent";
  return "pending";
};
