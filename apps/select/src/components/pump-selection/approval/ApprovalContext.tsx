"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  DEFAULT_APPROVAL_STATUS,
  type ApprovalStatus,
  type StepApproval,
} from "../../../lib/approval";
import {
  listStepApprovals,
  sendStepApprovals,
  setStepApproval,
} from "../../../services/approvalService";

/**
 * Approval state for the open tag, shared by every wizard step.
 *
 * Steps are ticked and sent on the Approval step; each step's header shows a
 * read-only status badge (see StepApprovalBadge). Both read from here rather
 * than each fetching on their own, so a send on the Approval step shows on
 * every step's badge without a round-trip.
 */

type ApprovalContextValue = {
  /** Approval row per step number. Steps never ticked are absent. */
  approvals: Record<number, StepApproval>;
  /** True once the initial fetch has settled (success or failure). */
  loaded: boolean;
  /** Null when there is no tag open — the badges hide themselves then, and
   *  the Approval step has nothing to save against. */
  tagId: string | null;
  selected: (step: number) => boolean;
  statusOf: (step: number) => ApprovalStatus;
  /** Toggle one step. Optimistic: the box flips immediately and rolls back if
   *  the save fails, so a tick never looks saved when it isn't. */
  toggle: (step: number, selected: boolean) => Promise<void>;
  /** Send every ticked, still-Pending step. Resolves with how many moved. */
  send: () => Promise<number>;
  /** Last error from a toggle or send, for the UI to surface. */
  error: string | null;
  clearError: () => void;
};

const ApprovalContext = createContext<ApprovalContextValue | null>(null);

const byStep = (rows: StepApproval[]): Record<number, StepApproval> =>
  Object.fromEntries(rows.map((r) => [r.step, r]));

export const ApprovalProvider = ({
  tagId,
  refreshKey = 0,
  children,
}: {
  tagId?: string | null;
  /** Bumped after the wizard saves a step: a real change can send a step's
   *  approval back to Pending on the server, so re-read quietly (no loading
   *  flash) to keep the badges and the Approval list honest. */
  refreshKey?: number;
  children: React.ReactNode;
}) => {
  const [approvals, setApprovals] = useState<Record<number, StepApproval>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tagId) {
      setApprovals({});
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    listStepApprovals(tagId)
      .then((rows) => {
        if (cancelled) return;
        setApprovals(byStep(rows));
      })
      .catch(() => {
        // A failed load leaves every step un-ticked rather than blocking the
        // wizard — approval is a side channel, not a gate on doing the work.
        if (!cancelled) setApprovals({});
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tagId]);

  useEffect(() => {
    if (!tagId || refreshKey === 0) return;
    let cancelled = false;
    listStepApprovals(tagId)
      .then((rows) => {
        if (!cancelled) setApprovals(byStep(rows));
      })
      .catch(() => {
        // Keep what's shown; the next refresh or reload will catch up.
      });
    return () => {
      cancelled = true;
    };
  }, [tagId, refreshKey]);

  const toggle = useCallback(
    async (step: number, selected: boolean) => {
      if (!tagId) return;
      setError(null);
      const previous = approvals[step];
      // Optimistic: reflect the tick straight away. An un-tick also drops back
      // to Pending, mirroring what the server does to the row.
      setApprovals((current) => ({
        ...current,
        [step]: {
          step,
          selected,
          status: selected
            ? previous?.status ?? DEFAULT_APPROVAL_STATUS
            : DEFAULT_APPROVAL_STATUS,
          sentAt: selected ? previous?.sentAt ?? null : null,
          decidedAt: previous?.decidedAt ?? null,
          remarks: previous?.remarks ?? null,
        },
      }));
      try {
        const saved = await setStepApproval(tagId, step, selected);
        setApprovals((current) => ({ ...current, [step]: saved }));
      } catch (e) {
        setError(
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "Couldn't save the approval selection. Check your connection.",
        );
        setApprovals((current) => {
          const next = { ...current };
          if (previous) next[step] = previous;
          else delete next[step];
          return next;
        });
      }
    },
    [approvals, tagId],
  );

  const send = useCallback(async () => {
    if (!tagId) return 0;
    setError(null);
    try {
      const res = await sendStepApprovals(tagId);
      setApprovals(byStep(res.approvals));
      return res.sent;
    } catch (e) {
      const message =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Couldn't send for approval. Check your connection and try again.";
      setError(message);
      throw e;
    }
  }, [tagId]);

  const value = useMemo<ApprovalContextValue>(
    () => ({
      approvals,
      loaded,
      tagId: tagId ?? null,
      selected: (step) => approvals[step]?.selected === true,
      statusOf: (step) => approvals[step]?.status ?? DEFAULT_APPROVAL_STATUS,
      toggle,
      send,
      error,
      clearError: () => setError(null),
    }),
    [approvals, loaded, tagId, toggle, send, error],
  );

  return <ApprovalContext.Provider value={value}>{children}</ApprovalContext.Provider>;
};

/** Null outside a provider — the toggle renders nothing rather than throwing,
 * so a step component stays usable anywhere it might be mounted. */
export const useApproval = (): ApprovalContextValue | null => useContext(ApprovalContext);
