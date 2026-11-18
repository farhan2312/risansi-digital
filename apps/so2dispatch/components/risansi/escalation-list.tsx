"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCheck, Loader2, OctagonAlert, PauseCircle } from "lucide-react";
import type { AlertRow } from "@/lib/alerts";
import { markEscalationsSeenAction, unmarkEscalationSeenAction } from "@/app/risansi/notifications/feed-actions";
import { useUrlTable } from "./url-table";

type Severity = "escalation" | "serious" | "warning";

function severityOf(alert: AlertRow): Severity {
  if (alert.type === "hold") return "escalation";
  if (alert.type === "ld_risk") return "serious";
  return (alert.days_overdue ?? 0) >= 7 ? "serious" : "warning";
}

function messageOf(alert: AlertRow): string {
  if (alert.type === "hold") return `Payment on hold by Accounts${alert.reason ? ` — ${alert.reason}` : ""}`;
  const days = alert.days_overdue ?? 0;
  if (alert.type === "ld_risk") return `Quality docs overdue by ${days} day(s) — LD risk`;
  // The one escalation now: not fully dispatched by the To Be Dispatch Date.
  return `Not dispatched — To Be Dispatch Date passed ${days} day${days === 1 ? "" : "s"} ago`;
}

const SEVERITY_STYLES: Record<Severity, { icon: typeof AlertTriangle; chip: string }> = {
  escalation: { icon: PauseCircle, chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  serious: { icon: OctagonAlert, chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  warning: { icon: AlertTriangle, chip: "bg-amber-50 text-amber-700 ring-amber-200" },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** The Escalations heading's controls: how many to see, Mark all as opened, and the opened ones shown or folded away. */
export function EscalationControls({ unseen, opened, showOpened }: { unseen: number; opened: number; showOpened: boolean }) {
  const router = useRouter();
  const { setParams } = useUrlTable();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending || unseen === 0}
        onClick={() =>
          start(async () => {
            await markEscalationsSeenAction(null);
            router.refresh();
          })
        }
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-input-border bg-surface px-3 text-sm font-semibold text-foreground transition-colors hover:bg-background disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
        Mark all as opened
      </button>
      {opened > 0 && (
        <button
          type="button"
          onClick={() => setParams({ eopened: showOpened ? null : "1", epage: null })}
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
        >
          {showOpened ? "Hide opened" : `Show opened (${opened})`}
        </button>
      )}
    </div>
  );
}

/**
 * The escalations, each with a tick for "opened" (opened ones fold away, so
 * only new ones need looking at). Open marks it opened and goes to the SO.
 */
export function EscalationList({
  alerts,
  hrefs,
  showClient,
}: {
  alerts: AlertRow[];
  /** Where each one's Open goes, by key. */
  hrefs: Record<string, string>;
  showClient: boolean;
}) {
  const router = useRouter();
  // Ticked here, before the server has answered.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [, start] = useTransition();
  const seenOf = (a: AlertRow) => ticked[a.key] ?? a.seen;
  const toggle = (a: AlertRow) => {
    const next = !seenOf(a);
    setTicked((t) => ({ ...t, [a.key]: next }));
    start(async () => {
      if (next) await markEscalationsSeenAction([a.key]);
      else await unmarkEscalationSeenAction(a.key);
      router.refresh();
    });
  };
  return (
    <ul className="divide-y divide-card-border">
      {alerts.map((alert) => {
        const style = SEVERITY_STYLES[severityOf(alert)];
        const Icon = style.icon;
        const seen = seenOf(alert);
        return (
          <li
            key={alert.key}
            className={`flex flex-col gap-3 px-5 py-4 transition-opacity sm:flex-row sm:items-center sm:justify-between ${seen ? "opacity-55" : ""}`}
          >
            <div className="flex min-w-0 items-start gap-3">
              <input
                type="checkbox"
                checked={seen}
                onChange={() => toggle(alert)}
                title={seen ? "Opened — untick to see it again" : "Mark as opened"}
                aria-label="Opened"
                className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-primary"
              />
              <span className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.chip}`}>
                <Icon className="h-3.5 w-3.5" />
                {alert.department}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {messageOf(alert)}
                  {seen && <span className="ml-2 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-semibold text-muted ring-1 ring-inset ring-card-border">Opened</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  #{alert.sl_no} · {alert.so_no ?? "—"}
                  {alert.ec_no ? ` · ${alert.ec_no}` : ""}
                  {showClient && alert.client_name ? ` · ${alert.client_name}` : ""}
                  {alert.due_date ? ` · To Be Dispatch ${formatDate(alert.due_date)}` : ""}
                  {alert.status ? ` · ${alert.status}` : ""}
                </p>
              </div>
            </div>
            <Link
              href={hrefs[alert.key] ?? "/risansi/orders"}
              // Opening it counts as opened.
              onClick={() => {
                if (!seen) markEscalationsSeenAction([alert.key]).catch(() => {});
              }}
              className="shrink-0 text-sm font-medium text-primary hover:text-primary-hover"
            >
              Open
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Oversight's Notifications page: the feed or the escalations, one at a time. */
export function NotificationViewToggle({ view, escalations }: { view: "notifications" | "escalations"; escalations: number }) {
  const { setParams, pending } = useUrlTable();
  const [asked, setAsked] = useState<string | null>(null);
  const shown = asked && pending ? asked : view;
  const btn = (v: "notifications" | "escalations", label: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={shown === v}
      onClick={() => {
        if (shown === v) return;
        setAsked(v);
        setParams({ view: v === "notifications" ? null : v });
      }}
      className={`inline-flex h-full items-center gap-1.5 rounded-md px-4 text-sm font-semibold transition-colors ${
        shown === v ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
      }`}
    >
      {label}
      {pending && asked === v && <Loader2 className="h-3 w-3 animate-spin" />}
    </button>
  );
  return (
    <div role="group" aria-label="Notifications or escalations" className="inline-flex h-10 items-center rounded-lg border border-input-border bg-surface p-0.5">
      {btn("notifications", "Notifications")}
      {btn(
        "escalations",
        <>
          Escalations
          {escalations > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">{escalations}</span>
          )}
        </>
      )}
    </div>
  );
}
