"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Bug,
  Settings,
  KeyRound,
  LogOut,
  MoreHorizontal,
  X,
  type LucideIcon,
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

type ShellUser = { name: string; email: string; role: string };

/**
 * Mobile bottom navigation. Replaces the sidebar below `lg`: four primary
 * destinations plus a "More" sheet carrying the department workspaces, admin
 * links and the profile actions that live in the sidebar footer on desktop.
 */
export function BottomNav({
  user,
  alertCount = 0,
  reminderCount = 0,
  notifUnread = 0,
}: {
  user: ShellUser;
  alertCount?: number;
  reminderCount?: number;
  notifUnread?: number;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  // Close the sheet on navigation.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Lock body scroll while the sheet is open so the sheet scrolls, not the page.
  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  const activeHref = activeNavHref(pathname ?? "");
  const myReminderDept = reminderDeptForRole(user.role);
  const notifBadge =
    notifUnread + (canSeeEscalations(user.role) ? alertCount : 0);

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

  // Four tabs at most: the primary destinations, then Notifications and
  // Messages. A department user (one primary item) gets their own workspace
  // promoted into the spare slot so it's one tap away.
  const tabs: { item: NavItem; badge: number }[] = [
    ...visiblePrimaryNav.map((item) => ({ item, badge: 0 })),
    ...(visiblePrimaryNav.length < 2 && visibleDepartments.length === 1
      ? [{ item: visibleDepartments[0] as NavItem, badge: reminderCount }]
      : []),
    {
      item: { label: "Alerts", href: "/risansi/notifications", icon: Bell },
      badge: notifBadge,
    },
  ].slice(0, 4);

  // Anything not already a tab goes in the More sheet.
  const tabHrefs = new Set(tabs.map((t) => t.item.href));
  const moreDepartments = visibleDepartments.filter(
    (d) => !tabHrefs.has(d.href)
  );
  // Badge the More button when something inside it needs attention.
  const moreBadge = moreDepartments.some(
    (d) => reminderDeptForTable(d.table) === myReminderDept && reminderCount > 0
  )
    ? reminderCount
    : 0;
  const moreActive = moreOpen || (activeHref !== "" && !tabHrefs.has(activeHref));

  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function Badge({ count }: { count: number }) {
    if (count <= 0) return null;
    return (
      <span className="absolute -right-2 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
        {count > 99 ? "99+" : count}
      </span>
    );
  }

  function SheetLink({ item, badge = 0 }: { item: NavItem; badge?: number }) {
    const Icon: LucideIcon = item.icon;
    const active = item.href === activeHref;
    return (
      <Link
        href={item.href}
        className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
          active
            ? "bg-sidebar-active text-white"
            : "text-sidebar-foreground hover:bg-sidebar-hover"
        }`}
      >
        <Icon className="h-5 w-5 shrink-0" />
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
    <>
      {/* ---- More sheet ---- */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-2xl bg-sidebar pb-[env(safe-area-inset-bottom)] shadow-2xl"
          >
            {/* grab handle + close */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-sidebar-border bg-sidebar px-4 pb-3 pt-3">
              <span className="text-sm font-semibold text-white">Menu</span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-sidebar-hover"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-3 py-3">
              {moreDepartments.length > 0 && (
                <div className="mb-4">
                  <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
                    Departments
                  </p>
                  <div className="space-y-1">
                    {moreDepartments.map((item) => (
                      <SheetLink
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

              {user.role !== "admin" && (
                <div className="mb-4">
                  <div className="space-y-1">
                    <SheetLink
                      item={{ label: "My Bug Reports", href: "/risansi/bug-reports", icon: Bug }}
                    />
                    {isCentral(user.role) && (
                      <SheetLink item={{ label: "USD to INR", href: "/risansi/settings", icon: Settings }} />
                    )}
                  </div>
                </div>
              )}

              {user.role === "admin" && (
                <div className="mb-4">
                  <div className="mb-2 space-y-1">
                    <SheetLink item={{ label: "USD to INR", href: "/risansi/settings", icon: Settings }} />
                  </div>
                  <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
                    Admin
                  </p>
                  <div className="space-y-1">
                    {ADMIN_NAV.map((item) => (
                      <SheetLink key={item.href} item={item} />
                    ))}
                  </div>
                </div>
              )}

              {/* account */}
              <div className="border-t border-sidebar-border pt-3">
                <div className="mb-2 flex items-center gap-3 px-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
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
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowChangePassword(true);
                    setMoreOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-hover"
                >
                  <KeyRound className="h-5 w-5" />
                  Change password
                </button>

                <div className="px-1 py-1">
                  <ThemeToggle />
                </div>

                <form action={logout}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-rose-300 transition-colors hover:bg-sidebar-hover"
                  >
                    <LogOut className="h-5 w-5" />
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- bottom bar ---- */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="flex items-stretch">
          {tabs.map(({ item, badge }) => {
            const Icon: LucideIcon = item.icon;
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[10px] font-medium transition-colors ${
                  active ? "text-white" : "text-sidebar-muted"
                }`}
              >
                <span className="relative">
                  <Icon
                    className={`h-[22px] w-[22px] ${active ? "text-white" : ""}`}
                  />
                  <Badge count={badge} />
                </span>
                <span className="w-full truncate text-center leading-tight">
                  {item.label}
                </span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[10px] font-medium transition-colors ${
              moreActive ? "text-white" : "text-sidebar-muted"
            }`}
          >
            <span className="relative">
              <MoreHorizontal className="h-[22px] w-[22px]" />
              <Badge count={moreBadge} />
            </span>
            <span className="w-full truncate text-center leading-tight">
              More
            </span>
          </button>
        </div>
      </nav>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </>
  );
}
