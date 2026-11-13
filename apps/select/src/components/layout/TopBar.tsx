"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bug, RefreshCw } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { TopBarTitle } from "./PageTitle";
import NotificationBell from "./NotificationBell";
import ReportBugModal from "../bug-report/ReportBugModal";

// Slim app-wide top bar: Refresh, "Report a Bug" (any logged-in user) + the
// notification bell (a reporter's own status-change updates). Sits above
// every dashboard page's content, next to the sidebar.
const TopBar = ({ onRefresh }: { onRefresh: () => void }) => {
  const pathname = usePathname();
  const router = useRouter();
  const [reportOpen, setReportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Reloads the page's data in place: the layout remounts the page (its
  // client-side fetches run again) and router.refresh() re-renders any server
  // components. No full browser reload, so scroll, sidebar and session stay.
  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    onRefresh();
    router.refresh();
    // Just long enough for the spin to register as feedback.
    window.setTimeout(() => setRefreshing(false), 700);
  };

  return (
    <>
      {/* shadcn look (user, 2026-11-13): the page heading on the left, the actions on the right. */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-6 max-[860px]:h-[52px] max-[860px]:px-3.5">
        <TopBarTitle />
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh"
            title="Reload this page's data"
            className="max-[860px]:w-8 max-[860px]:px-0"
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} />
            <span className="max-[860px]:hidden">Refresh</span>
          </Button>
          <Button variant="outline" onClick={() => setReportOpen(true)} aria-label="Report a Bug" className="max-[860px]:w-8 max-[860px]:px-0">
            <Bug />
            <span className="max-[860px]:hidden">Report a Bug</span>
          </Button>
          <NotificationBell />
        </div>
      </div>

      <ReportBugModal
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        page={pathname ?? ""}
      />
    </>
  );
};

export default TopBar;
