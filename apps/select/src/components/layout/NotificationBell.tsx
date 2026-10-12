"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "./NotificationBell.css";
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

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    // Mark read on open, not on every poll — so the badge count is stable
    // while the user is looking at it, then clears once they've seen it.
    if (next && items.length > 0) {
      // No ids: clears BOTH feeds - the reporter flags and the admin watermark.
      // Passing ids would only clear reports the caller filed, leaving the
      // "new bug" badge stuck on.
      markBugNotificationsRead()
        .then(() => setItems([]))
        .catch(() => {
          // Leave the badge as-is if the clear failed — better to re-show a
          // notification than silently drop it.
        });
    }
  };

  return (
    <div className="notif-bell-root" ref={rootRef}>
      <button
        type="button"
        className="notif-bell-btn"
        onClick={handleToggle}
        aria-label={items.length > 0 ? `${items.length} unread notifications` : "Notifications"}
      >
        🔔
        {items.length > 0 && <span className="notif-bell-badge">{items.length}</span>}
      </button>

      {open && (
        <div className="notif-bell-dropdown">
          <div className="notif-bell-dropdown-header">Notifications</div>
          {items.length === 0 ? (
            <p className="notif-bell-empty">No new bug reports or updates.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <span className={`notif-status-dot status-${n.status.replace(/\s+/g, "-").toLowerCase()}`} />
                  <div>
                    <div className="notif-item-title">{n.title}</div>
                    <div className="notif-item-status">
                      {n.kind === "new" ? (
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
