"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronRight, PlayCircle, RotateCw } from "lucide-react";
import { ReportBugTrigger } from "./report-bug";
import { DiscussionBell } from "./discussion-bell";
import { Sidebar } from "./sidebar";
import { BottomNav } from "./bottom-nav";

// SharePoint-hosted demo walkthrough. Opens in a new tab; noopener/noreferrer
// so we don't hand the target a window.opener reference or leak Referer.
const DEMO_VIDEO_URL =
  "https://risansi-my.sharepoint.com/personal/asad_risansi_com/_layouts/15/stream.aspx?id=%2Fpersonal%2Fasad%5Frisansi%5Fcom%2FDocuments%2FSOdispatchDemo%2FSODispatch%2Emp4&nav=eyJyZWZlcnJhbEluZm8iOnsicmVmZXJyYWxBcHAiOiJPbmVEcml2ZUZvckJ1c2luZXNzIiwicmVmZXJyYWxBcHBQbGF0Zm9ybSI6IldlYiIsInJlZmVycmFsTW9kZSI6InZpZXciLCJyZWZlcnJhbFZpZXciOiJNeUZpbGVzTGlua0NvcHkifX0&ga=1&referrer=StreamWebApp%2EWeb&referrerScenario=AddressBarCopied%2Eview%2E4d270a1e%2Ddb24%2D4b77%2Da8f7%2D3e728102fe28";

type ShellUser = { name: string; email: string; role: string };

// Route-segment → friendly label + optional parent (for two-level breadcrumbs
// like "Central Admin > Bug Tracker"). Segments not in the map get a
// Title-Cased fallback derived from the segment itself.
type Crumb = { label: string; parent?: string };
const ROUTE_LABELS: Record<string, Crumb> = {
  "/risansi/dashboard": { label: "Dashboard" },
  "/risansi/orders": { label: "Orders" },
  "/risansi/notifications": { label: "Notifications" },
  "/risansi/messages": { label: "Messages" },
  "/risansi/escalations": { label: "Payment Holds" },
  "/risansi/dispatched": { label: "Dispatched" },
  "/risansi/departments/billing": { label: "Billing & Operations", parent: "Departments" },
  "/risansi/departments/accounts": { label: "Accounts", parent: "Departments" },
  "/risansi/departments/drawing": { label: "Drawing", parent: "Departments" },
  "/risansi/departments/planning": { label: "Planning", parent: "Departments" },
  "/risansi/departments/purchase": { label: "Purchase", parent: "Departments" },
  "/risansi/departments/qc": { label: "Quality", parent: "Departments" },
  "/risansi/departments/assembly-dispatch": { label: "Assembly & Packing", parent: "Departments" },
  "/risansi/departments/dispatch": { label: "Dispatch", parent: "Departments" },
  "/risansi/user-access-control": { label: "User Access Control", parent: "Central Admin" },
  "/risansi/audit-log": { label: "Audit Log", parent: "Central Admin" },
  "/risansi/reports": { label: "Reports", parent: "Central Admin" },
  "/risansi/bug-reports": { label: "Bug Reports" },
  "/risansi/settings": { label: "USD to INR" },
};

function crumbsFor(pathname: string): { label: string; href?: string }[] {
  // Longest matching prefix wins so nested routes (e.g. /risansi/orders/{id})
  // still show the parent's crumb.
  let best: string | null = null;
  for (const key of Object.keys(ROUTE_LABELS)) {
    if (pathname === key || pathname.startsWith(key + "/")) {
      if (!best || key.length > best.length) best = key;
    }
  }
  if (!best) return [];
  const meta = ROUTE_LABELS[best];
  const out: { label: string; href?: string }[] = [];
  if (meta.parent) out.push({ label: meta.parent });
  out.push({ label: meta.label, href: best });
  return out;
}

export function AppShell({
  user,
  alertCount,
  reminderCount,
  notifUnread,
  openBugCount,
  discussionUnread,
  children,
}: {
  user: ShellUser;
  alertCount: number;
  reminderCount: number;
  notifUnread: number;
  openBugCount: number;
  // Unread SO-discussion messages — its own icon, not the bug bell.
  discussionUnread: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // router.refresh() re-runs the server components for the current route,
  // so the page picks up other people's saves without a full reload.
  const [refreshing, startRefresh] = useTransition();
  const crumbs = useMemo(() => crumbsFor(pathname ?? ""), [pathname]);
  const showBugBell = user.role === "admin";
  // On mobile the breadcrumb's last segment doubles as the page title.
  const mobileTitle = crumbs.length > 0 ? crumbs[crumbs.length - 1].label : "Risansi";

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        user={user}
        alertCount={alertCount}
        reminderCount={reminderCount}
        notifUnread={notifUnread}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — mobile shows the current page title; desktop shows the
            breadcrumb on the left and Demo / Report a Bug / Bug bell on the
            right. */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-card-border bg-surface px-4">
          <span className="min-w-0 truncate font-display text-[15px] font-semibold text-foreground lg:hidden">
            {mobileTitle}
          </span>

          {crumbs.length > 0 && (
            <nav
              aria-label="Breadcrumb"
              className="hidden min-w-0 items-center gap-1.5 text-sm lg:flex"
            >
              {crumbs.map((c, i) => {
                const isLast = i === crumbs.length - 1;
                return (
                  <span key={i} className="flex min-w-0 items-center gap-1.5">
                    {i > 0 && (
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    {c.href && !isLast ? (
                      <Link
                        href={c.href}
                        className="truncate text-muted transition-colors hover:text-foreground"
                      >
                        {c.label}
                      </Link>
                    ) : (
                      <span
                        className={
                          isLast
                            ? "truncate font-semibold text-foreground"
                            : "truncate text-muted"
                        }
                        aria-current={isLast ? "page" : undefined}
                      >
                        {c.label}
                      </span>
                    )}
                  </span>
                );
              })}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => startRefresh(() => router.refresh())}
              disabled={refreshing}
              aria-label="Refresh this page"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-card-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:opacity-60"
            >
              <RotateCw
                className={`h-4 w-4 text-primary ${refreshing ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">
                {refreshing ? "Refreshing…" : "Refresh"}
              </span>
            </button>
            <a
              href={DEMO_VIDEO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-card-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-background"
            >
              <PlayCircle className="h-4 w-4 text-primary" />
              <span className="hidden sm:inline">Demo</span>
            </a>
            <ReportBugTrigger />
            <DiscussionBell
              role={user.role}
              initialUnread={discussionUnread}
            />
            {showBugBell && (
              <Link
                href="/risansi/bug-reports"
                aria-label={
                  openBugCount > 0
                    ? `Bug tracker — ${openBugCount} open`
                    : "Bug tracker"
                }
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-card-border bg-surface text-foreground transition-colors hover:bg-background"
              >
                <Bell className="h-4 w-4 text-amber-600" />
                {openBugCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
                    {openBugCount > 99 ? "99+" : openBugCount}
                  </span>
                )}
              </Link>
            )}
          </div>
        </header>

        {/* Bottom padding clears the fixed mobile nav (plus safe-area inset). */}
        <main className="min-w-0 flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>
      </div>

      <BottomNav
        user={user}
        alertCount={alertCount}
        reminderCount={reminderCount}
        notifUnread={notifUnread}
      />
    </div>
  );
}
