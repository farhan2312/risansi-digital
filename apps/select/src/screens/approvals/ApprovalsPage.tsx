"use client";

import { useCallback, useEffect, useState } from "react";

import "./ApprovalsPage.css";
import "../../components/pump-selection/approval/ApprovalStep.css";
import EmptyState from "../../components/ui/EmptyState";
import PageHeader from "../../components/ui/PageHeader";
import {
  approvalStatusTone,
  type ApprovalInbox,
  type ApprovalInboxView,
} from "../../lib/approval";
import { listApprovalInbox } from "../../services/approvalService";
import ApprovalReviewModal from "./ApprovalReviewModal";

const VIEWS: { key: ApprovalInboxView; label: string }[] = [
  { key: "awaiting", label: "Awaiting decision" },
  { key: "decided", label: "Decided" },
  { key: "all", label: "All" },
];

/** Step pill colours by approval tone (see approvalStatusTone). */
const STEP_TONE: Record<string, string> = {
  ok: "bg-[var(--pos-soft)] text-pos",
  bad: "bg-[var(--neg-soft)] text-neg",
  sent: "bg-[var(--warn-soft)] text-warn",
  pending: "bg-sunk text-fg-3",
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
    <div className="mx-auto max-w-[1600px] px-4 pt-5 pb-10 sm:px-6">
      <PageHeader
        icon={<ShieldGlyph />}
        title="Approvals"
        subtitle="Steps engineers have sent for your approval · open a request to review each step and decide"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-line bg-paper p-0.5" role="tablist">
            {VIEWS.map((v) => {
              const active = view === v.key;
              return (
                <button
                  key={v.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setView(v.key)}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors ${
                    active ? "bg-accent text-white" : "text-fg-3 hover:bg-elev hover:text-fg"
                  }`}
                >
                  {v.label}
                  {inbox && (
                    <span
                      className={`rounded-full px-1.5 py-px font-mono text-[11px] ${
                        active ? "bg-white/25 text-white" : "bg-sunk text-fg-2"
                      }`}
                    >
                      {inbox.counts[v.key]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {inbox && inbox.counts.awaiting > 0 && (
            <span className="ml-auto inline-flex items-center gap-2 rounded-lg bg-[var(--warn-soft)] px-3 py-1.5 text-[12.5px] font-semibold text-warn">
              <span className="h-2 w-2 animate-pulse rounded-full bg-warn" />
              {inbox.counts.awaiting} request{inbox.counts.awaiting === 1 ? "" : "s"} waiting for a decision
            </span>
          )}
        </div>
      </PageHeader>

      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-paper shadow-[0_1px_2px_rgba(10,22,40,0.04),0_8px_24px_rgba(10,22,40,0.04)]">
        {loading && (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[76px] animate-pulse rounded-lg bg-elev" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="m-4 rounded-lg bg-[var(--neg-soft)] px-4 py-3 text-[13px] font-medium text-neg">{error}</div>
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
          <ul className="divide-y divide-line">
            {items.map((item) => {
              const decided = item.steps.filter((s) => s.status === "Approved" || s.status === "Rejected").length;
              return (
                <li key={item.tagId}>
                  <button
                    type="button"
                    onClick={() => setOpenTag(item.tagId)}
                    className="group flex w-full flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 text-left transition-colors hover:bg-elev"
                  >
                    <span className={`h-10 w-1 shrink-0 rounded-full ${item.awaiting > 0 ? "bg-warn" : "bg-pos"}`} aria-hidden />
                    <span className="min-w-[240px] flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] font-bold text-title">{item.enquiryCode}</span>
                        <span className="text-[13px] font-semibold text-fg">· {item.tagName}</span>
                        {item.awaiting > 0 ? (
                          <span className="rounded-full bg-[var(--warn-soft)] px-2 py-0.5 text-[11px] font-semibold text-warn">
                            {item.awaiting} to decide
                          </span>
                        ) : (
                          <span className="rounded-full bg-[var(--pos-soft)] px-2 py-0.5 text-[11px] font-semibold text-pos">
                            All decided
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-fg-3">
                        {[item.customerName, item.pumpModel && `Model ${item.pumpModel}`].filter(Boolean).join(" · ") || item.projectName}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {item.steps.map((s) => (
                          <span
                            key={s.step}
                            title={`${s.label}: ${s.status}`}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              STEP_TONE[approvalStatusTone(s.status)]
                            }`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {s.step}. {s.label}
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-4">
                      <span className="text-right">
                        <span className="block text-[12.5px] font-medium text-fg-2">{item.sentByName ?? "—"}</span>
                        <span className="block font-mono text-[11.5px] text-fg-3">{fmtWhen(item.sentAt)}</span>
                        <span className="block text-[11px] text-fg-3">
                          {decided}/{item.steps.length} decided
                        </span>
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition ${
                          item.awaiting > 0
                            ? "bg-accent text-white group-hover:-translate-y-px group-hover:shadow-[0_4px_12px_color-mix(in_srgb,var(--brand-blue)_30%,transparent)]"
                            : "border border-line text-fg-2 group-hover:border-accent group-hover:text-accent"
                        }`}
                      >
                        {item.awaiting > 0 ? "Review" : "View"} →
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {openTag && (
        <ApprovalReviewModal
          tagId={openTag}
          onClose={() => setOpenTag(null)}
          onDecided={() => void load(view, true)}
        />
      )}
    </div>
  );
};

export default ApprovalsPage;
