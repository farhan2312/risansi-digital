"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// Only for the ringing keyframes (notif-ring / notif-pulse / notif-badge).
import "./NotificationBell.css";
import { Bell } from "lucide-react";
import {
  getBugNotifications,
  markBugNotificationsRead,
  type BugNotification,
} from "../../services/bugReportService";

// Polls the caller's own unread bug-report status-change notifications and
// shows them in a small dropdown — the "notify the reporter when their
// report's status changes" bell. Scoped to the current user's own reports
// only (see /api/bug-reports/notifications); there's no admin-wide feed here.
const POLL_MS = 60_000;

const NotificationBell = () => {
  const router = useRouter();
  const [items, setItems] = useState<BugNotification[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    getBugNotifications()
      .then((res) => setItems(res.items))
      .catch(() => {
        // Best-effort — a failed poll just leaves the last-known badge count.
      });
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Badge and ringing: unread only. Read ones stay in the list for a day.
  const unreadCount = items.filter((n) => n.unread).length;

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    // Mark read on open, not on every poll - the items stay listed (as read)
    // for at least a day; only the badge and the ringing stop.
    if (next && unreadCount > 0) {
      // No ids: clears BOTH feeds - the reporter flags and the admin watermark.
      // Passing ids would only clear reports the caller filed, leaving the
      // "new bug" badge stuck on.
      markBugNotificationsRead()
        .then(() => setItems((cur) => cur.map((n) => ({ ...n, unread: false }))))
        .catch(() => {
          // Leave the badge as-is if the clear failed — better to re-show a
          // notification than silently drop it.
        });
    }
  };

  // Status dots by meaning: open = danger, clarification = warning, in progress = info, resolved = success.
  const dot = (n: BugNotification) =>
    n.kind === "assigned"
      ? "bg-primary"
      : (({ open: "bg-destructive", "need clarification": "bg-warning", "in progress": "bg-info", resolved: "bg-success", closed: "bg-success" }) as Record<string, string>)[
          n.status.toLowerCase()
        ] ?? "bg-muted-foreground";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={handleToggle}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={open}
        // Unread: the bell keeps ringing in red until it is opened (keyframes in NotificationBell.css).
        className={`relative inline-flex size-8 items-center justify-center rounded-md border shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 ${
          unreadCount > 0
            ? "animate-[notif-pulse_1.6s_ease-out_infinite] border-destructive/60 bg-destructive/10 text-destructive motion-reduce:animate-none"
            : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Bell className={`size-4 ${unreadCount > 0 ? "origin-[50%_10%] animate-[notif-ring_1.6s_ease-in-out_infinite] motion-reduce:animate-none" : ""}`} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] animate-[notif-badge_1.6s_ease-in-out_infinite] rounded-full bg-destructive px-1 text-center text-[10px] leading-[18px] font-semibold text-white ring-2 ring-card motion-reduce:animate-none">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-[calc(100%+6px)] right-0 z-[1100] w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_12px_32px_rgba(15,23,42,0.16)]">
          <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3.5 py-2.5">
            <span className="text-[12.5px] font-semibold text-foreground">Notifications</span>
            {items.length > 0 && <span className="text-[11px] text-muted-foreground">Last day</span>}
          </div>
          {items.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-[12.5px] text-muted-foreground">No assignments, bug reports or updates in the last day.</p>
          ) : (
            <ul className="max-h-[360px] divide-y divide-border overflow-y-auto">
              {items.map((n) => (
                <li
                  key={`${n.kind}-${n.id}`}
                  onClick={
                    n.kind === "assigned"
                      ? () => {
                          setOpen(false);
                          router.push("/projects");
                        }
                      : undefined
                  }
                  className={`flex gap-2.5 px-3.5 py-2.5 ${n.kind === "assigned" ? "cursor-pointer hover:bg-muted/60" : ""} ${n.unread ? "" : "opacity-60"}`}
                  title={n.kind === "assigned" ? "Open Enquiries" : undefined}
                >
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot(n)}`} />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-foreground">
                      {n.unread && <span className="mr-1.5 inline-block rounded-full bg-destructive px-1.5 align-[1px] text-[9.5px] leading-[15px] font-semibold text-white">New</span>}
                      {n.title}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">
                      {n.kind === "assigned" ? (
                        <>
                          Enquiry assigned to you
                          {n.reportedByName ? <> by <b>{n.reportedByName}</b></> : null}
                        </>
                      ) : n.kind === "new" ? (
                        <>
                          New bug report
                          {n.reportedByName ? <> from <b>{n.reportedByName}</b></> : null}
                        </>
                      ) : (
                        <>
                          Status changed to <b>{n.status}</b>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
