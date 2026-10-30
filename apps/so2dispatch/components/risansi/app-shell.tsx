"use client";

import { useEffect, useMemo, useRef, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useUrlTableBusy } from "./url-table";
import { Bell, ChevronRight, PlayCircle, RotateCw, ZoomOut } from "lucide-react";
import { ReportBugTrigger } from "./report-bug";
import { DiscussionBell } from "./discussion-bell";
import { isCrm } from "@/lib/roles";
import { Sidebar } from "./sidebar";
import { RoleSwitcher } from "./role-switcher";
import { BottomNav } from "./bottom-nav";

// SharePoint-hosted demo walkthrough. Opens in a new tab; noopener/noreferrer
// so we don't hand the target a window.opener reference or leak Referer.
const DEMO_VIDEO_URL =
  "https://risansi-my.sharepoint.com/personal/asad_risansi_com/_layouts/15/stream.aspx?id=%2Fpersonal%2Fasad%5Frisansi%5Fcom%2FDocuments%2FSOdispatchDemo%2FSODispatch%2Emp4&nav=eyJyZWZlcnJhbEluZm8iOnsicmVmZXJyYWxBcHAiOiJPbmVEcml2ZUZvckJ1c2luZXNzIiwicmVmZXJyYWxBcHBQbGF0Zm9ybSI6IldlYiIsInJlZmVycmFsTW9kZSI6InZpZXciLCJyZWZlcnJhbFZpZXciOiJNeUZpbGVzTGlua0NvcHkifX0&ga=1&referrer=StreamWebApp%2EWeb&referrerScenario=AddressBarCopied%2Eview%2E4d270a1e%2Ddb24%2D4b77%2Da8f7%2D3e728102fe28";

/** `roles`: every department they may work as (the switcher shows for more than one). */
type ShellUser = { name: string; email: string; role: string; roles?: string[] };

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
  "/risansi/dispatch-plan": { label: "Dispatch Plan" },
  "/risansi/departments/billing": { label: "Proforma Invoice", parent: "Departments" },
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
  const loading = useUrlTableBusy() || refreshing;
  const crumbs = useMemo(() => crumbsFor(pathname ?? ""), [pathname]);
  const showBugBell = user.role === "admin";
  // On mobile the breadcrumb's last segment doubles as the page title.
  const mobileTitle = crumbs.length > 0 ? crumbs[crumbs.length - 1].label : "Risansi";
  const headerRef = useRef<HTMLElement>(null);
  useStickyTableHeads(headerRef);

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
        <header ref={headerRef} className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-card-border bg-surface px-4">
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
            {/* The queues are wide: a smaller browser zoom shows whole rows. Desktop only. */}
            <span className="hidden items-center gap-1.5 rounded-lg bg-primary/[0.08] px-2.5 py-1 text-xs font-medium text-primary xl:inline-flex">
              <ZoomOut className="h-3.5 w-3.5" aria-hidden />
              Use browser zoom below 75% for a better view
            </span>
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
            {/* Below lg, where the sidebar is hidden: the department switcher here. */}
            <span className="lg:hidden">
              <RoleSwitcher role={user.role} roles={user.roles ?? []} variant="header" />
            </span>
            <ReportBugTrigger />
            {/* CRM only reads: no chat. */}
            {!isCrm(user.role) && (
              <DiscussionBell
                role={user.role}
                initialUnread={discussionUnread}
              />
            )}
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
        {/* While a filter, search or page loads: a bar along the top, and the
            tables and cards greyed and held still until the new rows are in. */}
        <main
          data-url-loading={loading ? "1" : undefined}
          aria-busy={loading || undefined}
          className={`relative min-w-0 flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0 [&_table]:transition-[opacity,filter] [&_[data-url-dim]]:transition-[opacity,filter] ${
            loading
              ? "[&_table]:pointer-events-none [&_table]:opacity-45 [&_table]:grayscale [&_[data-url-dim]]:pointer-events-none [&_[data-url-dim]]:opacity-45 [&_[data-url-dim]]:grayscale"
              : ""
          }`}
        >
          {loading && (
            <div className="pointer-events-none sticky top-0 z-30 -mb-[3px] h-[3px] overflow-hidden bg-primary/15">
              <div className="h-full w-full animate-pulse bg-primary" />
            </div>
          )}
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

/**
 * Every queue table marked `data-sticky-head` keeps its header row in view:
 * once the table's top passes under the top bar, the header row follows the
 * page down, just below the bar, until the table ends.
 *
 * Done by moving the header rather than with CSS `position: sticky`: each
 * table sits in its own horizontal scroller (they are wider than the screen),
 * and sticky only works against the nearest scroller — which would have meant
 * giving each table a vertical scroll of its own. This way the page scrolls as
 * it always has, and the header still scrolls sideways with its table.
 */
function useStickyTableHeads(headerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const update = () => {
      const top = headerRef.current?.getBoundingClientRect().bottom ?? 0;
      document.querySelectorAll<HTMLElement>("[data-sticky-head]").forEach((box) => {
        const table = box.querySelector<HTMLElement>(":scope > table");
        const head = table?.querySelector<HTMLElement>(":scope > thead");
        if (!table || !head) return;
        const rect = table.getBoundingClientRect();
        // How far the header has to come down to sit under the bar — never
        // above its own place, and never past the table's last rows.
        const shift = Math.max(0, Math.min(top - rect.top, rect.height - head.offsetHeight * 2));
        head.style.transform = shift > 0 ? `translateY(${shift}px)` : "";
        if (shift > 0) head.dataset.stuck = "1";
        else delete head.dataset.stuck;
      });
    };
    // Run straight away on every scroll: a handful of tables, cheap to place,
    // and it keeps the header from lagging a frame behind the page.
    const schedule = update;
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Rows load and pages change without a scroll; keep up with those too.
    const watch = new MutationObserver(schedule);
    watch.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      watch.disconnect();
    };
  }, [headerRef]);
}
