import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bug } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { listBugReports } from "@/lib/bug-reports";
import { BugReportsView } from "@/components/risansi/bug-reports-view";

export const metadata: Metadata = {
  title: "Bug Reports | Risansi",
};

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The admin runs the tracker: every report, and moving them along. Everyone
 * else sees the reports they sent themselves and where each one stands, read
 * only — they are told on the bell when one moves.
 */
export default async function BugReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const isAdmin = user.role === "admin";
  const rows = await listBugReports({ reporterId: isAdmin ? null : user.id });
  // A notification links to its report; open it if it is one this user sees.
  const { report } = await searchParams;
  const openId = report && UUID_RE.test(report) && rows.some((r) => r.id === report) ? report : null;

  return (
    // Board on a wide screen: exactly the window below the top bar (h-14), so
    // the board scrolls within its columns rather than the page scrolling
    // around it. The list scrolls with the page as usual, 20 to a page.
    <div className="px-4 py-6 sm:px-8 sm:py-8 xl:has-[[data-board-fit]]:flex xl:has-[[data-board-fit]]:h-[calc(100dvh-3.5rem)] xl:has-[[data-board-fit]]:flex-col xl:has-[[data-board-fit]]:overflow-hidden">
      <div className="mb-6 flex shrink-0 items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Bug className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {isAdmin ? "Bug Tracker" : "My Bug Reports"}
          </h1>
          <p className="text-sm text-muted">
            {isAdmin
              ? `User-submitted bugs and feature requests — ${rows.length} ${
                  rows.length === 1 ? "report" : "reports"
                }.`
              : `What you have reported, and where each one stands — ${rows.length} ${
                  rows.length === 1 ? "report" : "reports"
                }. You are notified when a status changes.`}
          </p>
        </div>
      </div>

      <BugReportsView rows={rows} readOnly={!isAdmin} initialOpenId={openId} />
    </div>
  );
}
