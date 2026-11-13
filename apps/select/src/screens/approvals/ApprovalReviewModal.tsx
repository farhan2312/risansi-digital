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
import { Check, X } from "lucide-react";
// shadcn/ui (user, 2026-11-13: the new look, branch select-shadcn).
import { Badge } from "@/components/shadcn/badge";
import { Button } from "@/components/shadcn/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { Alert, Field, Textarea } from "@/components/shadcn/field";

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

/** By approval tone (approvalStatusTone, or a draft's): the rail's step number, the
 *  status badge and the box a decided step shows. */
const STEP_NUM: Record<string, string> = {
  ok: "bg-success text-white",
  bad: "bg-destructive text-white",
  sent: "bg-warning/15 text-warning ring-1 ring-warning/30 ring-inset",
  pending: "bg-muted text-muted-foreground ring-1 ring-border ring-inset",
};
const TONE_BADGE: Record<string, "success" | "danger" | "warning" | "neutral"> = { ok: "success", bad: "danger", sent: "warning", pending: "neutral" };
const DECIDED_BOX: Record<string, string> = {
  ok: "border-success/30 bg-success/8 text-success",
  bad: "border-destructive/30 bg-destructive/8 text-destructive",
  sent: "border-warning/30 bg-warning/10 text-warning",
  pending: "border-border bg-muted/50 text-muted-foreground",
};

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

  // Escape closes through the Dialog (onOpenChange), unless a save is in flight.

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
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent
        size="xl"
        hideClose
        className="max-w-[940px]"
        aria-labelledby="apv-modal-title"
        // A click outside closes it, as before - but not while saving.
        onInteractOutside={(e) => saving && e.preventDefault()}
      >
        <DialogHeader className="pr-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10.5px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Approval request</p>
              <DialogTitle id="apv-modal-title" className="mt-0.5">
                {review ? `${review.enquiryCode} · ${review.tagName}` : "Loading…"}
              </DialogTitle>
              {review ? (
                <DialogDescription className="mt-0.5">{[review.customerName, review.projectName].filter(Boolean).join(" · ")}</DialogDescription>
              ) : (
                <DialogDescription className="sr-only">Approval request</DialogDescription>
              )}
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose} disabled={saving}>
              <X />
            </Button>
          </div>
        </DialogHeader>

        {loadError && (
          <Alert className="mx-5 mt-4">
            {loadError}
          </Alert>
        )}
        {!review && !loadError && <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">Loading the request…</p>}

        {review && (
          <>
            <div className="flex shrink-0 flex-wrap gap-x-6 gap-y-2 border-b border-border bg-muted/40 px-5 py-2.5">
              {[
                ["Pump", review.pumpModel],
                ["Duty", review.duty],
                ["Liquid", review.media],
                ["Sent by", [review.steps[0]?.sentByName, fmtWhen(review.steps[0]?.sentAt ?? null)].filter(Boolean).join(" · ")],
              ]
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <span className="block text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
                    <strong className="block truncate text-[12.5px] font-medium text-foreground">{value}</strong>
                  </div>
                ))}
            </div>

            {review.steps.length === 0 ? (
              <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">
                Nothing from this tag is waiting any more — its steps were changed and sent back to the engineer.
              </p>
            ) : (
              // Rail beside the detail; below 720px a row of steps over the detail, scrolling as one.
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto min-[720px]:grid min-[720px]:grid-cols-[240px_minmax(0,1fr)] min-[720px]:overflow-hidden">
                <nav
                  className="flex flex-none gap-1 overflow-x-auto border-b border-border p-2.5 min-[720px]:flex-col min-[720px]:overflow-x-visible min-[720px]:overflow-y-auto min-[720px]:border-r min-[720px]:border-b-0"
                  aria-label="Steps in this request"
                >
                  {review.steps.map((s) => {
                    const draft = drafts[s.step]?.status;
                    const tone = isOpen(s) ? (draft === "Approved" ? "ok" : draft === "Rejected" ? "bad" : "sent") : approvalStatusTone(s.status);
                    const on = s.step === activeStep;
                    return (
                      <button
                        key={s.step}
                        type="button"
                        className={`flex flex-none items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 min-[720px]:w-full ${
                          on ? "bg-primary/8 ring-1 ring-primary/20 ring-inset" : "hover:bg-muted"
                        }`}
                        onClick={() => setActiveStep(s.step)}
                      >
                        <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${STEP_NUM[tone] ?? STEP_NUM.pending}`}>{s.step}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-[12.5px] ${on ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>{s.label}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {isOpen(s) ? (draft ? `${draft} (not saved)` : "Awaiting decision") : s.status}
                          </span>
                        </span>
                        {triedSubmit && missingRemark(s) && (
                          <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-destructive text-[11px] font-bold text-white" aria-label="Needs a remark">
                            !
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>

                {active && (
                  <section className="min-w-0 p-5 min-[720px]:overflow-y-auto" aria-live="polite">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[14px] font-semibold text-foreground">
                        {active.step}. {active.label}
                      </h3>
                      <Badge tone={TONE_BADGE[approvalStatusTone(active.status)] ?? "neutral"} dot>
                        {active.status}
                      </Badge>
                    </div>

                    {active.groups.length === 0 && <p className="rounded-md bg-muted/60 px-3 py-4 text-center text-[12.5px] text-muted-foreground">Nothing has been filled in on this step.</p>}
                    {active.groups.map((g, i) => (
                      <div
                        key={g.title ?? i}
                        className={`mb-3 rounded-md border p-3 ${g.highlight ? "border-success/40 bg-success/8" : "border-border bg-card"}`}
                      >
                        {g.title && (
                          <p className={`mb-2 text-[11px] font-medium tracking-wide uppercase ${g.highlight ? "text-success" : "text-muted-foreground"}`}>{g.title}</p>
                        )}
                        <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-[18px] gap-y-2.5">
                          {g.items.map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <dt className="text-[11px] text-muted-foreground">{label}</dt>
                              <dd className="m-0 text-[12.5px] font-medium [overflow-wrap:anywhere] text-foreground">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}

                    {isOpen(active) ? (
                      <div className="mt-4 rounded-md border border-border bg-muted/40 p-3.5">
                        <p className="mb-2 text-[12px] font-semibold text-foreground">Your decision</p>
                        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Decision for ${active.label}`}>
                          {(["Approved", "Rejected"] as const).map((status) => {
                            const on = drafts[active.step]?.status === status;
                            return (
                              <button
                                key={status}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3.5 text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 [&_svg]:size-3.5 ${
                                  status === "Approved"
                                    ? on
                                      ? "border-success bg-success text-white"
                                      : "border-success/40 bg-card text-success hover:bg-success/10"
                                    : on
                                      ? "border-destructive bg-destructive text-white"
                                      : "border-destructive/40 bg-card text-destructive hover:bg-destructive/10"
                                }`}
                                onClick={() => setDraft(active.step, { status: drafts[active.step]?.status === status ? null : status })}
                              >
                                {status === "Approved" ? <Check /> : <X />}
                                {status === "Approved" ? "Approve" : "Reject"}
                              </button>
                            );
                          })}
                        </div>
                        <Field
                          className="mt-3"
                          label={`Remarks${drafts[active.step]?.status === "Rejected" ? " (required to reject)" : " (optional)"}`}
                          error={triedSubmit && missingRemark(active) ? "Add a remark so the engineer knows what to fix." : undefined}
                        >
                          <Textarea
                            rows={3}
                            maxLength={1000}
                            value={drafts[active.step]?.remarks ?? ""}
                            placeholder={drafts[active.step]?.status === "Rejected" ? "What should the engineer change?" : "Anything the engineer should know"}
                            aria-invalid={triedSubmit && missingRemark(active)}
                            className={triedSubmit && missingRemark(active) ? "border-destructive" : ""}
                            onChange={(e) => setDraft(active.step, { remarks: e.target.value })}
                          />
                        </Field>
                      </div>
                    ) : (
                      <div className={`mt-4 rounded-md border px-3.5 py-3 text-[12.5px] ${DECIDED_BOX[approvalStatusTone(active.status)] ?? DECIDED_BOX.pending}`}>
                        <p>
                          <strong className="font-semibold">{active.status}</strong>
                          {active.decidedByName ? ` by ${active.decidedByName}` : ""}
                          {active.decidedAt ? ` · ${fmtWhen(active.decidedAt)}` : ""}
                        </p>
                        {active.remarks && <p className="mt-1 text-foreground italic">&ldquo;{active.remarks}&rdquo;</p>}
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}

            <DialogFooter className="justify-between">
              <div className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
                {saveError && <span className="font-medium text-destructive">{saveError}</span>}
                {!saveError && savedCount !== null && (
                  <span className="font-medium text-success">
                    Saved {savedCount} decision{savedCount === 1 ? "" : "s"}. The engineer sees them on their Approval step.
                  </span>
                )}
                {!saveError && savedCount === null && openSteps.length > 0 && (
                  <span>
                    {chosen.length} of {openSteps.length} decided
                    {triedSubmit && chosen.length === 0 ? " — choose Approve or Reject first" : ""}
                  </span>
                )}
                {!saveError && savedCount === null && openSteps.length === 0 && review.steps.length > 0 && <span>Every step in this request has been decided.</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {openSteps.length > 1 && (
                  <Button variant="outline" onClick={approveAllRemaining} disabled={saving || chosen.length === openSteps.length}>
                    Approve all remaining
                  </Button>
                )}
                {openSteps.length > 0 ? (
                  <Button onClick={() => void submit()} disabled={saving}>
                    {saving ? "Saving…" : `Submit decision${chosen.length === 1 ? "" : "s"}`}
                  </Button>
                ) : (
                  <Button onClick={onClose}>Close</Button>
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ApprovalReviewModal;
