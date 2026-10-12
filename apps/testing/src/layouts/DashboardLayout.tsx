"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import "./DashboardLayout.css";
import "@/styles/polish.css"; // shared visual polish for every signed-in screen
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import EditPasswordModal from "@/components/ui/EditPasswordModal";
import ReportBugModal from "@/components/ui/ReportBugModal";
import { getBugNotifications, getUnreadBugReportCount, listPendingUsers, markBugNotificationsRead } from "@/services/adminService";
import { logout as logoutRequest } from "@/services/authService";
import { recordPageView } from "@/services/auditService";
import { getTargetDateAlerts } from "@/services/testingService";
import { formatDate } from "@/lib/formUtils";
import type { BugNotification, TargetDateAlertItem } from "@/types/testing";

const PENDING_REQUESTS_POLL_MS = 30000;

const NAV_ITEMS: { href: string; label: string; hideFor?: string[] }[] = [
  { href: "/overview", label: "Dashboard" },
  { href: "/requisitions/new", label: "New Requisition" },
  { href: "/dashboard", label: "Testing Summary" },
  { href: "/pumps", label: "Report Compilation" },
  { href: "/reports", label: "Report Archive" },
  { href: "/performance", label: "VE & ME Performance" },
  { href: "/calendar", label: "Testing Calendar" },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "System Admin",
  "central-admin": "Central Admin",
  source: "Source Team",
  testing: "Testing Team",
};

interface Crumb {
  label: string;
  /** Omitted on the last crumb (the current page) -- everything before it
   * is a real link back up the page's own hierarchy, not just to Dashboard. */
  href?: string;
}

/** Full breadcrumb trail for the top bar, most-specific pattern checked
 * first (an edit/curve/report sub-route before its bare [id] parent) so
 * every route in the app resolves to something meaningful. Nested pages
 * (report/requisition sub-routes) get their immediate parent as a real
 * clickable link, not just "Risansi" -- previously the only clickable
 * crumb from anywhere was the Dashboard link itself. */
const pageTrail = (pathname: string): Crumb[] => {
  if (pathname === "/overview") return [{ label: "Dashboard" }];
  if (pathname === "/dashboard") return [{ label: "Testing Summary" }];
  if (pathname === "/pumps") return [{ label: "Report Compilation" }];
  if (pathname.startsWith("/pumps/")) {
    return [{ label: "Report Compilation", href: "/pumps" }, { label: "Pump Detail" }];
  }
  if (pathname === "/reports") return [{ label: "Report Archive" }];
  if (pathname === "/performance") return [{ label: "VE & ME Performance" }];
  if (pathname === "/calendar") return [{ label: "Testing Calendar" }];
  if (pathname === "/reports/new/observation") {
    return [{ label: "Report Archive", href: "/reports" }, { label: "New Observation Sheet" }];
  }
  if (pathname === "/reports/new/viscosity-chart") {
    return [{ label: "Report Archive", href: "/reports" }, { label: "New Viscosity Correction Chart" }];
  }
  if (pathname === "/reports/new") {
    return [{ label: "Report Archive", href: "/reports" }, { label: "New Report" }];
  }
  let m = pathname.match(/^\/reports\/([^/]+)\/edit$/);
  if (m) {
    return [
      { label: "Report Archive", href: "/reports" },
      { label: "Report Detail", href: `/reports/${m[1]}` },
      { label: "Edit Report" },
    ];
  }
  m = pathname.match(/^\/reports\/([^/]+)\/curve$/);
  if (m) {
    return [
      { label: "Report Archive", href: "/reports" },
      { label: "Report Detail", href: `/reports/${m[1]}` },
      { label: "Performance Curve" },
    ];
  }
  if (/^\/reports\/[^/]+$/.test(pathname)) {
    return [{ label: "Report Archive", href: "/reports" }, { label: "Report Detail" }];
  }
  if (pathname === "/requisitions/new") return [{ label: "New Requisition" }];
  m = pathname.match(/^\/requisitions\/([^/]+)\/edit$/);
  if (m) {
    return [
      { label: "Testing Summary", href: "/dashboard" },
      { label: "Requisition Detail", href: `/requisitions/${m[1]}` },
      { label: "Edit Requisition" },
    ];
  }
  m = pathname.match(/^\/requisitions\/([^/]+)\/report\/observation$/);
  if (m) {
    return [
      { label: "Testing Summary", href: "/dashboard" },
      { label: "Requisition Detail", href: `/requisitions/${m[1]}` },
      { label: "Fill Observation Sheet" },
    ];
  }
  m = pathname.match(/^\/requisitions\/([^/]+)\/report\/viscosity-chart$/);
  if (m) {
    return [
      { label: "Testing Summary", href: "/dashboard" },
      { label: "Requisition Detail", href: `/requisitions/${m[1]}` },
      { label: "Fill Viscosity Correction Chart" },
    ];
  }
  m = pathname.match(/^\/requisitions\/([^/]+)\/report$/);
  if (m) {
    return [
      { label: "Testing Summary", href: "/dashboard" },
      { label: "Requisition Detail", href: `/requisitions/${m[1]}` },
      { label: "Fill Test Report" },
    ];
  }
  if (/^\/requisitions\/[^/]+$/.test(pathname)) {
    return [{ label: "Testing Summary", href: "/dashboard" }, { label: "Requisition Detail" }];
  }
  if (pathname === "/admin/users") return [{ label: "Users & Access" }];
  if (pathname === "/admin/bug-reports") return [{ label: "Bug Reports" }];
  if (pathname === "/admin/audit-log") return [{ label: "Audit Log" }];
  if (pathname === "/admin/documentation") return [{ label: "Documentation" }];
  if (pathname === "/admin/action-registry") return [{ label: "Action Registry" }];
  return [{ label: "Pump Testing Portal" }];
};

const DashboardLayout = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAdmin, canAssignRetest, refresh, clear } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const role = user?.role ?? "testing";
  const navItems = NAV_ITEMS.filter((item) => !item.hideFor?.includes(role));
  // Derived directly from context on every render rather than mirrored into
  // local state -- there's nothing to go stale, since `user` is always the
  // latest verified /auth/me result.
  const mustChangePassword = user?.must_change_password ?? false;

  const [menuOpen, setMenuOpen] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [showReportBug, setShowReportBug] = useState(false);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [unreadBugCount, setUnreadBugCount] = useState(0);
  const [targetDateAlerts, setTargetDateAlerts] = useState<TargetDateAlertItem[]>([]);
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);
  const [isRefreshingAlerts, setIsRefreshingAlerts] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const alertsRef = useRef<HTMLDivElement>(null);
  // "Your bug report's status changed" notifications -- for whoever reported the bug, any role.
  const [bugNotes, setBugNotes] = useState<BugNotification[]>([]);
  const [bugNotesUnread, setBugNotesUnread] = useState(0);
  const [showBugNotes, setShowBugNotes] = useState(false);
  const bugNotesRef = useRef<HTMLDivElement>(null);

  // Polls for pending access requests so admins see a live badge on the nav
  // item without having to open the Access Requests page to find out.
  useEffect(() => {
    if (!isAdmin) return;

    let cancelled = false;
    const poll = () => {
      listPendingUsers()
        .then((rows) => {
          if (!cancelled) setPendingRequestCount(rows.length);
        })
        .catch(() => {});
    };

    poll();
    const interval = setInterval(poll, PENDING_REQUESTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAdmin]);

  // Same polling pattern, for the topbar notification bell -- counts bug
  // reports nobody's opened yet. Drops as reports get visited (see
  // GET /api/bug-reports/[id]), climbs as new ones come in.
  useEffect(() => {
    if (!isAdmin) return;

    let cancelled = false;
    const poll = () => {
      getUnreadBugReportCount()
        .then((count) => {
          if (!cancelled) setUnreadBugCount(count);
        })
        .catch(() => {});
    };

    poll();
    const interval = setInterval(poll, PENDING_REQUESTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAdmin]);

  // Same polling pattern again, for the target-date bell -- open to every
  // role (not just admins), since Responsible Person can be anyone on the
  // testing team. Naturally comes back empty for anyone whose name doesn't
  // match a requisition's Responsible Person.
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      getTargetDateAlerts()
        .then((result) => {
          if (!cancelled) setTargetDateAlerts(result.items);
        })
        .catch(() => {});
    };

    poll();
    const interval = setInterval(poll, PENDING_REQUESTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Same polling pattern, for the reporter's bug-report updates. Open to every role.
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      getBugNotifications()
        .then((result) => {
          if (cancelled) return;
          setBugNotes(result.items);
          setBugNotesUnread(result.unread);
        })
        .catch(() => {});
    };

    poll();
    const interval = setInterval(poll, PENDING_REQUESTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Opening the panel is what "seeing" them means: the badge clears at once, while the entries keep their
  // "new" highlight until the panel is closed.
  const toggleBugNotes = () => {
    const opening = !showBugNotes;
    setShowBugNotes(opening);
    if (opening && bugNotesUnread > 0) {
      setBugNotesUnread(0);
      markBugNotificationsRead().catch(() => {});
    }
    if (!opening) setBugNotes((items) => items.map((n) => ({ ...n, is_read: true })));
  };

  // Manual refresh for the notification icons -- the polls above already
  // catch up within 30s on their own, this just lets someone force it
  // immediately (e.g. right after raising or resolving something) rather
  // than wait out the interval.
  const handleRefreshAlerts = async () => {
    setIsRefreshingAlerts(true);
    try {
      const [alerts, bugCount] = await Promise.all([
        getTargetDateAlerts().catch(() => null),
        isAdmin ? getUnreadBugReportCount().catch(() => null) : Promise.resolve(null),
      ]);
      if (alerts) setTargetDateAlerts(alerts.items);
      if (bugCount !== null) setUnreadBugCount(bugCount);
    } finally {
      setIsRefreshingAlerts(false);
    }
  };

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (alertsRef.current && !alertsRef.current.contains(e.target as Node)) {
        setShowAlertsPanel(false);
      }
      if (bugNotesRef.current && !bugNotesRef.current.contains(e.target as Node)) {
        setShowBugNotes(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Records a page view on every route change, for the Audit Log's Usage &
  // Time tab -- fire-and-forget, never blocks navigation. Only fires once a
  // user is actually known (AuthGuard guarantees this by the time this
  // component is mounted, `user` is just defensive here).
  useEffect(() => {
    if (pathname && user) recordPageView(pathname);
  }, [pathname, user]);

  const handleLogout = async () => {
    await logoutRequest();
    clear();
    router.push("/");
  };

  const displayName = user?.name ?? user?.email ?? "Tester";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="testing-layout">
      <aside className="testing-sidebar">
        <div className="testing-sidebar-logo">
          <img src="/logo.png" alt="Risansi Industries" />
        </div>

        <nav className="testing-nav">
          <p className="testing-nav-group-label">Testing</p>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? "active" : ""}
            >
              {item.label}
            </Link>
          ))}

          {/* Lives in the Testing group, not Admin -- Action Registry entries
           * come out of Testing's own Assign Retest flow, and Central Admin
           * (who doesn't get the rest of the Admin section, see CLAUDE.md)
           * still needs a way in since they can Assign Retest too. */}
          {canAssignRetest && (
            <Link
              href="/admin/action-registry"
              className={pathname === "/admin/action-registry" ? "active" : ""}
            >
              Action Registry
            </Link>
          )}

          {isAdmin && (
            <>
              <p className="testing-nav-group-label">Admin</p>
              <Link
                href="/admin/users"
                className={pathname === "/admin/users" ? "active" : ""}
              >
                Users &amp; Access
                {pendingRequestCount > 0 && (
                  <span className="nav-badge">{pendingRequestCount}</span>
                )}
              </Link>
              <Link
                href="/admin/bug-reports"
                className={pathname === "/admin/bug-reports" ? "active" : ""}
              >
                Bug Reports
              </Link>
              <Link
                href="/admin/audit-log"
                className={pathname === "/admin/audit-log" ? "active" : ""}
              >
                Audit Log
              </Link>
              <Link
                href="/admin/documentation"
                className={pathname === "/admin/documentation" ? "active" : ""}
              >
                Documentation
              </Link>
            </>
          )}
        </nav>

        <div className="sidebar-profile" ref={menuRef}>
          {menuOpen && (
            <div className="sidebar-profile-menu">
              <div className="sidebar-profile-menu-header">
                <strong>{user?.name ?? "Tester"}</strong>
                <span>{user?.email ?? ""}</span>
              </div>

              <button type="button" className="sidebar-profile-menu-item" onClick={toggleTheme}>
                <span>{theme === "dark" ? "Dark mode" : "Light mode"}</span>
                <span className={`theme-switch ${theme === "dark" ? "on" : ""}`}>
                  <span className="theme-switch-knob" />
                </span>
              </button>

              <button
                type="button"
                className="sidebar-profile-menu-item"
                onClick={() => {
                  setShowEditPassword(true);
                  setMenuOpen(false);
                }}
              >
                Change Password
              </button>

              <button type="button" className="sidebar-profile-menu-item danger" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          )}

          <button type="button" className="sidebar-profile-trigger" onClick={() => setMenuOpen((v) => !v)}>
            <span className="sidebar-avatar">{initial}</span>
            <span className="sidebar-profile-text">
              <strong>{displayName}</strong>
              <span>{ROLE_LABELS[user?.role ?? "testing"] ?? "Tester"}</span>
            </span>
            <span className={`sidebar-chevron ${menuOpen ? "open" : ""}`}>&#9662;</span>
          </button>
        </div>
      </aside>

      <div className="testing-content">
        <div className="testing-topbar">
          <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
            <Link href="/overview">Risansi</Link>
            {pageTrail(pathname).map((crumb, i, trail) => (
              <Fragment key={crumb.href ?? crumb.label}>
                <span className="topbar-breadcrumb-sep">&rsaquo;</span>
                {crumb.href && i < trail.length - 1 ? (
                  <Link href={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span className="topbar-breadcrumb-current">{crumb.label}</span>
                )}
              </Fragment>
            ))}
          </nav>
          <div className="topbar-actions">
          <button
  type="button"
  className="topbar-report-bug-btn"
  onClick={handleRefreshAlerts}
  disabled={isRefreshingAlerts}
  aria-label="Refresh notifications"
  title="Refresh notifications"
>
  <span
    className={`topbar-refresh-icon ${
      isRefreshingAlerts ? "spinning" : ""
    }`}
  >
    ↻
  </span>

  <span className="topbar-refresh-text pl-1">
    {isRefreshingAlerts ? "Refreshing..." : "Refresh"}
  </span>
</button>
            <div className="topbar-alerts-wrap" ref={alertsRef}>
              <button
                type="button"
                className="topbar-bell-btn"
                onClick={() => setShowAlertsPanel((v) => !v)}
                aria-label={`Target date alerts${targetDateAlerts.length > 0 ? ` (${targetDateAlerts.length})` : ""}`}
                title="Requisitions approaching their target date"
              >
                ⏰
                {targetDateAlerts.length > 0 && (
                  <span className="topbar-bell-badge">
                    {targetDateAlerts.length > 99 ? "99+" : targetDateAlerts.length}
                  </span>
                )}
              </button>
              {showAlertsPanel && (
                <div className="topbar-alerts-panel">
                  <div className="topbar-alerts-panel-header">Approaching target date</div>
                  {targetDateAlerts.length === 0 ? (
                    <p className="topbar-alerts-empty">Nothing due in the next 5 days.</p>
                  ) : (
                    <ul className="topbar-alerts-list">
                      {targetDateAlerts.map((item) => (
                        <li key={item.id}>
                          <Link href={`/requisitions/${item.requisition_no ?? item.id}`} onClick={() => setShowAlertsPanel(false)}>
                            <span className="topbar-alerts-model">{item.model}</span>
                            <span className="topbar-alerts-meta">
                              {item.status} &middot; due {formatDate(item.target_date)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="topbar-alerts-wrap" ref={bugNotesRef}>
              <button
                type="button"
                className="topbar-bell-btn"
                onClick={toggleBugNotes}
                aria-label={`Updates on your bug reports${bugNotesUnread > 0 ? ` (${bugNotesUnread} new)` : ""}`}
                title="Updates on the bugs you reported"
              >
                📬
                {bugNotesUnread > 0 && <span className="topbar-bell-badge">{bugNotesUnread > 99 ? "99+" : bugNotesUnread}</span>}
              </button>
              {showBugNotes && (
                <div className="topbar-alerts-panel">
                  <div className="topbar-alerts-panel-header">Your bug reports</div>
                  {bugNotes.length === 0 ? (
                    <p className="topbar-alerts-empty">No updates on your bug reports yet.</p>
                  ) : (
                    <ul className="topbar-alerts-list">
                      {bugNotes.map((n) => (
                        <li key={n.id} className={n.is_read ? "" : "topbar-note-new"}>
                          <div className="topbar-note">
                            <span className="topbar-alerts-model">{n.bug_title}</span>
                            <span className="topbar-alerts-meta">
                              {n.old_status ? `${n.old_status} → ` : "Now "}
                              <strong>{n.new_status}</strong>
                              {n.changed_by_name ? ` · by ${n.changed_by_name}` : ""} ·{" "}
                              {new Date(n.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <button type="button" className="topbar-report-bug-btn" onClick={() => setShowReportBug(true)}>
              🐛 Report a Bug
            </button>
            {isAdmin && (
              <button
                type="button"
                className="topbar-bell-btn"
                onClick={() => router.push("/admin/bug-reports")}
                aria-label={`Bug report notifications${unreadBugCount > 0 ? ` (${unreadBugCount} unread)` : ""}`}
                title="Bug report notifications"
              >
                🔔
                {unreadBugCount > 0 && (
                  <span className="topbar-bell-badge">{unreadBugCount > 99 ? "99+" : unreadBugCount}</span>
                )}
              </button>
            )}
          </div>
        </div>
        <main className="testing-main">{children}</main>
      </div>

      {showReportBug && <ReportBugModal onClose={() => setShowReportBug(false)} />}

      {mustChangePassword ? (
        <EditPasswordModal mandatory onClose={() => {}} onSuccess={() => refresh()} />
      ) : (
        showEditPassword && <EditPasswordModal onClose={() => setShowEditPassword(false)} />
      )}
    </div>
  );
};

export default DashboardLayout;
