"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { setDeptCompleteAction } from "@/app/risansi/orders/actions";
import {
  describeDays,
  DEPT_LABELS,
  type DeptCompletion,
  type DeptKey,
} from "@/lib/dept-completion";
import { ConfirmDialog } from "./confirm-dialog";
import { SIGN_OFF_ENABLED } from "@/lib/dept-completion";

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * A department's sign-off on one SO or EC.
 *
 * Ticking it is a claim other people act on — Central stops chasing, the day
 * count is frozen — so it confirms first, and the dialog says what will be
 * recorded. Unticking confirms too, since reopening discards that number.
 */
/** The Complete control — nothing while sign-offs are switched off. */
export function DeptCompleteCheck(props: Parameters<typeof CompleteCheck>[0]) {
  return SIGN_OFF_ENABLED ? <CompleteCheck {...props} /> : null;
}

function CompleteCheck({
  scopeId,
  dept,
  label,
  completion,
  canEdit,
}: {
  scopeId: string;
  dept: DeptKey;
  // What the row is, for the confirmation: "EC/26/1/1385/39956".
  label: string;
  completion: DeptCompletion | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const took = completion ? describeDays(completion.days_taken) : null;
  const completing = !completion;

  async function apply() {
    setSaving(true);
    setError(null);
    const result = await setDeptCompleteAction(scopeId, dept, completing);
    setSaving(false);
    setAsking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (!canEdit) {
    // Everyone else still sees the outcome, just not the control.
    return completion ? (
      <span
        title={`Completed ${formatDate(completion.completed_on)}${took ? ` · ${took}` : ""}`}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"
      >
        <Check className="h-3.5 w-3.5" />
        Done
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  }

  return (
    <>
      <span className="inline-flex flex-col items-start gap-0.5">
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={!!completion}
            disabled={saving}
            onChange={() => {
              setError(null);
              setAsking(true);
            }}
            aria-label={`${DEPT_LABELS[dept]} complete for ${label}`}
            className="h-4 w-4 cursor-pointer rounded border-input-border accent-emerald-600 disabled:cursor-not-allowed"
          />
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : (
            <span
              className={`text-[11px] font-medium ${
                completion ? "text-emerald-700" : "text-muted-foreground"
              }`}
            >
              {completion ? "Done" : "Complete"}
            </span>
          )}
        </label>
        {completion && (
          <span className="text-[10px] text-muted-foreground">
            {formatDate(completion.completed_on)}
            {took ? ` · ${took}` : ""}
          </span>
        )}
        {error && (
          <span role="alert" className="text-[10px] text-danger">
            {error}
          </span>
        )}
      </span>

      <ConfirmDialog
        open={asking}
        busy={saving}
        tone={completing ? "primary" : "danger"}
        title={
          completing
            ? `Mark ${DEPT_LABELS[dept]} complete?`
            : `Reopen ${DEPT_LABELS[dept]}?`
        }
        message={
          completing
            ? `${label} will be recorded as finished by ${DEPT_LABELS[dept]}.`
            : `${label} goes back to in progress for ${DEPT_LABELS[dept]}.`
        }
        detail={
          completing ? (
            <>
              Today&apos;s date is recorded as the completion date, along with
              how long it took against the target this department was
              originally given. You can undo this later.
            </>
          ) : (
            <>
              The completion date
              {completion ? ` (${formatDate(completion.completed_on)}` : ""}
              {completion && took ? `, ${took}` : ""}
              {completion ? ")" : ""} will be discarded.
            </>
          )
        }
        confirmLabel={completing ? "Mark complete" : "Reopen"}
        onConfirm={apply}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}

/** Pick the sign-off for one row out of an SO's set. */
export function completionFor(
  completions: DeptCompletion[],
  dept: DeptKey,
  scopeId: string,
  perEc: boolean
): DeptCompletion | null {
  return (
    completions.find(
      (c) =>
        c.dept === dept &&
        (perEc ? c.item_id === scopeId : c.item_id === null)
    ) ?? null
  );
}
