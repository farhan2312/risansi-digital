"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import logo from "@/assets/logo.png";
import {
  Bell,
  Bug,
  Settings,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  KeyRound,
  LogOut,
  MessagesSquare,
} from "lucide-react";
import { logout } from "@/app/risansi/actions";
import {
  canViewAll,
  canViewDepartment,
  canViewOrderMaking,
  canSeeDispatchPlan,
  canSeeEscalations,
  getsNotifications,
  isCentral,
  reminderDeptForRole,
  reminderDeptForTable,
} from "@/lib/roles";
import {
  ADMIN_NAV,
  DEPARTMENT_NAV,
  DISPATCH_PLAN_NAV,
  PRIMARY_NAV,
  activeNavHref,
  type NavItem,
} from "./nav-config";
import { mayOpenPage } from "@/lib/view-pages";
import { ThemeToggle } from "./theme-toggle";
import { ViewModeToggle } from "./view-mode-toggle";
import { RoleSwitcher } from "./role-switcher";
import { SIDEBAR_COOKIE } from "@/lib/view-mode";

type SidebarUser = { name: string; email: string; role: string; roles?: string[]; view_pages?: string[] };

/**
 * Desktop navigation rail. Hidden below `lg`, where BottomNav takes over.
 */
export function Sidebar({
  initialCollapsed = false,
  user,
  alertCount = 0,
  reminderCount = 0,
  notifUnread = 0,
  chatUnread = 0,
  onOpenChats,
}: {
  /** Collapsed to its icons, as the viewer last left it. */
  initialCollapsed?: boolean;
  user: SidebarUser;
  alertCount?: number;
  reminderCount?: number;
  notifUnread?: number;
  chatUnread?: number;
  /** Opens Discussion; absent for those with no chat. */
  onOpenChats?: () => void;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Collapsed: the icons alone (each named on hover), kept in a cookie.
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    setMenuOpen(false);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };

  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // 360° View: only the pages picked for them (mayOpenPage).
  const visibleDepartments = DEPARTMENT_NAV.filter(
    (item) =>
      // Order Making's page is over the orders table itself.
      (item.table === "orders" ? canViewOrderMaking(user.role) : canViewDepartment(user.role, item.table)) &&
      mayOpenPage(user, item.href)
  );

  // A department account: its own page, Notifications and its bug reports,
  // under one heading — no dashboard, no whole-order list.
  const deptAccount = !canViewAll(user.role) && visibleDepartments.length > 0;
  const visiblePrimaryNav = deptAccount ? [] : PRIMARY_NAV.filter((item) => mayOpenPage(user, item.href));
  const deptLink = (item: (typeof visibleDepartments)[number]) => (
    <NavLink
      key={item.href}
      item={item}
      badge={reminderDeptForTable(item.table) === myReminderDept ? reminderCount : 0}
    />
  );

  // The department this role gets deadline reminders for (badged in the nav).
  const myReminderDept = reminderDeptForRole(user.role);

  // Notifications badge: unread events, plus live escalations for oversight
  // roles (whose Notifications page also lists those escalations).
  const notifBadge =
    notifUnread + (canSeeEscalations(user.role) ? alertCount : 0);

  // Only the most specific matching destination highlights.
  const activeHref = activeNavHref(pathname ?? "");

  function NavLink({ item, badge = 0 }: { item: NavItem; badge?: number }) {
    const active = item.href === activeHref;
    const Icon = item.icon;
    return (
      <Link
        href={item.href}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={`relative flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-colors ${collapsed ? "justify-center px-0" : "px-3"} ${
          active
            ? "bg-sidebar-active text-white"
            : "text-sidebar-foreground hover:bg-sidebar-hover"
        }`}
      >
        <Icon className={collapsed ? "h-[18px] w-[18px] shrink-0" : "h-4 w-4 shrink-0"} />
        {collapsed ? (
          badge > 0 && <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-amber-500" aria-hidden />
        ) : (
          <span className="flex-1">{item.label}</span>
        )}
        {!collapsed && badge > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar transition-[width] duration-200 lg:flex ${collapsed ? "w-16" : "w-64"}`}
    >
      {/* brand, and the collapse toggle */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 px-2 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white font-display text-base font-bold text-primary" aria-label="Risansi">
            R
          </span>
          <button
            type="button"
            onClick={toggleCollapsed}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="rounded-lg p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-white"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <div className="flex w-40 items-center justify-center overflow-hidden rounded-xl bg-white p-1">
            <Image src={logo} alt="Risansi" width={140} height={100} />
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="rounded-lg p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-white"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* More than one department: which one they are working as, up top. */}
      {!collapsed && <RoleSwitcher role={user.role} roles={user.roles ?? []} variant="sidebar" />}

      {/* nav */}
      <nav className={`flex-1 overflow-y-auto py-2 ${collapsed ? "px-2" : "px-3"}`}>
        <div className="mb-6">
          {collapsed ? null : (
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
              SO to Dispatch
            </p>
          )}
          <div className="space-y-1">
            {deptAccount && visibleDepartments.map(deptLink)}
            {visiblePrimaryNav.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
            {/* After Orders: the pump SOs that can go out in the next two weeks. */}
            {canSeeDispatchPlan(user.role) && mayOpenPage(user, DISPATCH_PLAN_NAV.href) && <NavLink item={DISPATCH_PLAN_NAV} />}
            {getsNotifications(user.role) && (
              <NavLink
                item={{
                  label: "Notifications",
                  href: "/risansi/notifications",
                  icon: Bell,
                }}
                badge={notifBadge}
              />
            )}
            {onOpenChats && (
              <button
                type="button"
                onClick={onOpenChats}
                title={collapsed ? "Discussions" : undefined}
                aria-label={collapsed ? "Discussions" : undefined}
                className={`relative flex w-full items-center gap-2.5 rounded-lg py-2 text-left text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-hover ${collapsed ? "justify-center px-0" : "px-3"}`}
              >
                <MessagesSquare className={collapsed ? "h-[18px] w-[18px] shrink-0" : "h-4 w-4 shrink-0"} />
                {collapsed ? (
                  chatUnread > 0 && <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-rose-600" aria-hidden />
                ) : (
                  <span className="flex-1">Discussions</span>
                )}
                {!collapsed && chatUnread > 0 && (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-semibold text-white">
                    {chatUnread > 99 ? "99+" : chatUnread}
                  </span>
                )}
              </button>
            )}
            {/* The admin reaches the whole tracker under Admin; everyone else
                follows the reports they sent. */}
            {user.role !== "admin" && (
              <NavLink
                item={{ label: "My Bug Reports", href: "/risansi/bug-reports", icon: Bug }}
              />
            )}
            {/* Values the whole tracker works from, e.g. the USD → INR rate. */}
            {isCentral(user.role) && (
              <NavLink item={{ label: "USD to INR", href: "/risansi/settings", icon: Settings }} />
            )}
          </div>
        </div>

        {!deptAccount && visibleDepartments.length > 0 && (
          <div className="mb-6">
            {collapsed ? (
              <div className="mx-2 mb-2 border-t border-sidebar-border" />
            ) : (
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
                Departments
              </p>
            )}
            <div className="space-y-1">{visibleDepartments.map(deptLink)}</div>
          </div>
        )}

        {user.role === "admin" && (
          <div className="mb-6">
            {collapsed ? (
              <div className="mx-2 mb-2 border-t border-sidebar-border" />
            ) : (
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
                Admin
              </p>
            )}
            <div className="space-y-1">
              {ADMIN_NAV.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* profile */}
      <div className={`relative border-t border-sidebar-border ${collapsed ? "p-2" : "p-3"}`}>
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
              aria-hidden
            />
            <div
              className={`absolute z-20 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar p-1.5 shadow-xl ${
                collapsed ? "bottom-2 left-full ml-2 w-60" : "bottom-full left-3 right-3 mb-2"
              }`}
            >
              {/* Table view or Split view, for the Orders list. */}
              <ViewModeToggle />
              <div className="my-1 border-t border-sidebar-border" />
              {/* Passwords live at Risansi Digital (Phase 5, step 7). */}
              <a
                href="/change-password"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-hover"
              >
                <KeyRound className="h-4 w-4" />
                Change password
              </a>

              <div className="my-1 border-t border-sidebar-border" />
              <ThemeToggle />
              <div className="my-1 border-t border-sidebar-border" />

              <form action={logout}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-rose-300 transition-colors hover:bg-sidebar-hover"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </form>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          title={collapsed ? `${user.name} · ${user.email}` : undefined}
          className={`flex w-full items-center gap-3 rounded-xl py-2 text-left transition-colors hover:bg-sidebar-hover ${collapsed ? "justify-center px-0" : "px-2"}`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials || "U"}
          </span>
          {!collapsed && (
          <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">
              {user.name}
            </span>
            <span className="block truncate text-[11px] text-sidebar-muted">
              {user.email}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-muted" />
          </>
          )}
        </button>
      </div>
    </aside>
  );
}
