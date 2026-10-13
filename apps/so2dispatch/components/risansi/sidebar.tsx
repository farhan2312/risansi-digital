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
  KeyRound,
  LogOut,
} from "lucide-react";
import { logout } from "@/app/risansi/actions";
import {
  canViewAll,
  canViewDepartment,
  canAccessOrderMaking,
  canSeeEscalations,
  isCentral,
  reminderDeptForRole,
  reminderDeptForTable,
} from "@/lib/roles";
import {
  ADMIN_NAV,
  DEPARTMENT_NAV,
  PRIMARY_NAV,
  activeNavHref,
  type NavItem,
} from "./nav-config";
import { ThemeToggle } from "./theme-toggle";
import { ChangePasswordModal } from "./change-password-modal";

type SidebarUser = { name: string; email: string; role: string };

/**
 * Desktop navigation rail. Hidden below `lg`, where BottomNav takes over.
 */
export function Sidebar({
  user,
  alertCount = 0,
  reminderCount = 0,
  notifUnread = 0,
}: {
  user: SidebarUser;
  alertCount?: number;
  reminderCount?: number;
  notifUnread?: number;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const visibleDepartments = DEPARTMENT_NAV.filter((item) =>
    // Order Making's page is over the orders table itself.
    item.table === "orders"
      ? canAccessOrderMaking(user.role)
      : canViewDepartment(user.role, item.table)
  );

  // Department roles only need their own workspace, not the whole-order list.
  const visiblePrimaryNav = PRIMARY_NAV.filter(
    (item) => item.href !== "/risansi/orders" || canViewAll(user.role)
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
        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active
            ? "bg-sidebar-active text-white"
            : "text-sidebar-foreground hover:bg-sidebar-hover"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1">{item.label}</span>
        {badge > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar lg:flex">
      {/* brand */}
      <div className="flex items-center justify-between gap-2.5 px-5 py-5">
        <div className="flex w-45 items-center justify-center overflow-hidden rounded-xl bg-white p-1">
          <Image src={logo} alt="Risansi" width={140} height={100} />
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <div className="mb-6">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
            SO to Dispatch
          </p>
          <div className="space-y-1">
            {visiblePrimaryNav.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
            <NavLink
              item={{
                label: "Notifications",
                href: "/risansi/notifications",
                icon: Bell,
              }}
              badge={notifBadge}
            />
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

        {visibleDepartments.length > 0 && (
          <div className="mb-6">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
              Departments
            </p>
            <div className="space-y-1">
              {visibleDepartments.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  badge={
                    reminderDeptForTable(item.table) === myReminderDept
                      ? reminderCount
                      : 0
                  }
                />
              ))}
            </div>
          </div>
        )}

        {user.role === "admin" && (
          <div className="mb-6">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
              Admin
            </p>
            <div className="space-y-1">
              {ADMIN_NAV.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* profile */}
      <div className="relative border-t border-sidebar-border p-3">
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
              aria-hidden
            />
            <div className="absolute bottom-full left-3 right-3 z-20 mb-2 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar p-1.5 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setShowChangePassword(true);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-hover"
              >
                <KeyRound className="h-4 w-4" />
                Change password
              </button>

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
          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-sidebar-hover"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initials || "U"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">
              {user.name}
            </span>
            <span className="block truncate text-[11px] text-sidebar-muted">
              {user.email}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-muted" />
        </button>
      </div>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </aside>
  );
}
