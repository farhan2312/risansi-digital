"use client";

import { useCallback, useEffect, useState } from "react";

import EmptyState from "../../components/ui/EmptyState";
import PageHeader from "../../components/ui/PageHeader";
import {
  approvalStatusTone,
  type ApprovalInbox,
  type ApprovalInboxView,
} from "../../lib/approval";
import { listApprovalInbox } from "../../services/approvalService";
import ApprovalReviewModal from "./ApprovalReviewModal";
import { ArrowRight, CircleAlert } from "lucide-react";
// shadcn/ui (user, 2026-11-13: the new look, branch select-shadcn).
import { Badge } from "@/components/shadcn/badge";
import { buttonVariants } from "@/components/shadcn/button";
import { Card } from "@/components/shadcn/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";

const VIEWS: { key: ApprovalInboxView; label: string }[] = [
  { key: "awaiting", label: "Awaiting decision" },
  { key: "decided", label: "Decided" },
  { key: "all", label: "All" },
];

/** Step badge tone by approval tone (see approvalStatusTone). */
const STEP_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  ok: "success",
  bad: "danger",
  sent: "warning",
  pending: "neutral",
};

const ShieldGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.4 7 8.9 4.1-1.5 7-4.7 7-8.9V6l-7-2.5Z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  </svg>
);

const fmtWhen = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
};

/**
 * Selection head's inbox: every tag with steps sent for approval. Opening one
 * shows the review popup, where each step is approved or rejected. An email
 * link (?tag=<id>) opens that tag's popup straight away.
 */
const ApprovalsPage = () => {
  const [view, setView] = useState<ApprovalInboxView>("awaiting");
  const [inbox, setInbox] = useState<ApprovalInbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openTag, setOpenTag] = useState<string | null>(null);

  const load = useCallback(async (v: ApprovalInboxView, quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      setInbox(await listApprovalInbox(v));
    } catch {
      setError("Couldn't load approval requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(view);
  }, [view, load]);

  // Deep link from the request email. Read from window rather than
  // useSearchParams (which would need a Suspense boundary), then drop it so
  // closing the popup and refreshing doesn't reopen it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tag = params.get("tag");
    if (!tag) return;
    setOpenTag(tag);
    params.delete("tag");
    const q = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
  }, []);

  const items = inbox?.items ?? [];

  return (
    <div className="min-h-full bg-background">
    <div className="w-full px-4 pt-4 pb-10 sm:px-6 2xl:px-8">
      {/* The heading goes to the top bar (PageHeader with nothing else renders nothing). */}
      <PageHeader icon={<ShieldGlyph />} title="Approvals" subtitle="Steps engineers have sent for your approval · open a request to review each step and decide" />

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Tabs value={view} onValueChange={(v) => setView(v as ApprovalInboxView)}>
            <TabsList aria-label="Which requests">
              {VIEWS.map((v) => (
                <TabsTrigger key={v.key} value={v.key} className="gap-2">
                  {v.label}
                  {inbox && <span className="rounded-full bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground ring-1 ring-border ring-inset">{inbox.counts[v.key]}</span>}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {inbox && inbox.counts.awaiting > 0 && (
            <Badge tone="warning" className="ml-auto px-2.5 py-1 text-[12px]">
              <span className="size-2 animate-pulse rounded-full bg-current" aria-hidden="true" />
              {inbox.counts.awaiting} request{inbox.counts.awaiting === 1 ? "" : "s"} waiting for a decision
            </Badge>
          )}
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        {loading && (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[76px] animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="m-4 flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/8 px-4 py-2.5 text-[13px] font-medium text-destructive" role="alert">
            <CircleAlert className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <EmptyState
            compact
            icon="check"
            title={view === "awaiting" ? "Nothing waiting for your approval" : "No requests here yet"}
            description={
              view === "awaiting"
                ? "When an engineer sends steps for approval, they appear here and you get an email."
                : "Requests appear here once engineers send steps for approval."
            }
          />
        )}

        {!loading && !error && items.length > 0 && (
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const decided = item.steps.filter((s) => s.status === "Approved" || s.status === "Rejected").length;
              return (
                <li key={item.tagId}>
                  <button
                    type="button"
                    onClick={() => setOpenTag(item.tagId)}
                    className="group flex w-full flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
                  >
                    <span className={`h-10 w-[3px] shrink-0 rounded-full ${item.awaiting > 0 ? "bg-warning" : "bg-success"}`} aria-hidden />
                    <span className="min-w-[240px] flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12.5px] font-semibold text-primary">{item.enquiryCode}</span>
                        <span className="text-[13px] font-medium text-foreground">· {item.tagName}</span>
                        {item.awaiting > 0 ? (
                          <Badge tone="warning" dot>
                            {item.awaiting} to decide
                          </Badge>
                        ) : (
                          <Badge tone="success" dot>
                            All decided
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                        {[item.customerName, item.pumpModel && `Model ${item.pumpModel}`].filter(Boolean).join(" · ") || item.projectName}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {item.steps.map((s) => (
                          <Badge key={s.step} tone={STEP_TONE[approvalStatusTone(s.status)] ?? "neutral"} dot title={`${s.label}: ${s.status}`}>
                            {s.step}. {s.label}
                          </Badge>
                        ))}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-4">
                      <span className="text-right">
                        <span className="block text-[12.5px] font-medium text-foreground">{item.sentByName ?? "—"}</span>
                        <span className="block font-mono text-[11.5px] text-muted-foreground">{fmtWhen(item.sentAt)}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {decided}/{item.steps.length} decided
                        </span>
                      </span>
                      {/* Inside the row's button: styled as a button, not one itself. */}
                      <span className={buttonVariants({ variant: item.awaiting > 0 ? "default" : "outline", size: "sm" })}>
                        {item.awaiting > 0 ? "Review" : "View"} <ArrowRight />
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {openTag && <ApprovalReviewModal tagId={openTag} onClose={() => setOpenTag(null)} onDecided={() => void load(view, true)} />}
    </div>
    </div>
  );
};

export default ApprovalsPage;
