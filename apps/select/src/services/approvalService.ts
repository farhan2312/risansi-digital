import apiClient from "./apiClient";
import type {
  ApprovalInbox,
  ApprovalInboxView,
  DecisionStatus,
  StepApproval,
} from "../lib/approval";
import type { ApprovalReview } from "../lib/approval-details";

// --- Engineer: ticking and sending steps (Approval step) --------------------

/** Every approval row for a tag. Steps never ticked have no row yet, so the
 * list is sparse — callers fill the gaps with the Pending default. */
export const listStepApprovals = async (tagId: string): Promise<StepApproval[]> => {
  const { data } = await apiClient.get<StepApproval[]>("/step-approvals", {
    params: { tagId },
  });
  return data;
};

/** Tick or untick one step for approval. */
export const setStepApproval = async (
  tagId: string,
  step: number,
  selected: boolean,
): Promise<StepApproval> => {
  const { data } = await apiClient.put<StepApproval>("/step-approvals", {
    tagId,
    step,
    selected,
  });
  return data;
};

/** Send every ticked step that is Pending (or Rejected and being sent again).
 * Returns how many moved plus the tag's full, updated approval list. */
export const sendStepApprovals = async (
  tagId: string,
): Promise<{ sent: number; approvals: StepApproval[] }> => {
  const { data } = await apiClient.post<{ sent: number; approvals: StepApproval[] }>(
    "/step-approvals",
    { tagId },
  );
  return data;
};

// --- Selection head: reviewing and deciding (Approvals page) ----------------

export const listApprovalInbox = async (view: ApprovalInboxView): Promise<ApprovalInbox> => {
  const { data } = await apiClient.get<ApprovalInbox>("/approvals", { params: { view } });
  return data;
};

export const getApprovalReview = async (tagId: string): Promise<ApprovalReview> => {
  const { data } = await apiClient.get<ApprovalReview>(`/approvals/${encodeURIComponent(tagId)}`);
  return data;
};

export type ApprovalDecision = { step: number; status: DecisionStatus; remarks: string };

export const decideApprovals = async (
  tagId: string,
  decisions: ApprovalDecision[],
): Promise<ApprovalReview> => {
  const { data } = await apiClient.post<ApprovalReview>(
    `/approvals/${encodeURIComponent(tagId)}`,
    { decisions },
  );
  return data;
};
