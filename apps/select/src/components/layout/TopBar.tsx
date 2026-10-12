"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import "./TopBar.css";
import Breadcrumb from "./Breadcrumb";
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
      <div className="topbar">
        <Breadcrumb />
        <div className="topbar-actions">
          <button
            type="button"
            className="topbar-report-btn"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh"
            title="Reload this page's data"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-[15px] w-[15px] ${refreshing ? "animate-spin" : ""}`}
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            <span className="topbar-report-label">Refresh</span>
          </button>
          <button
            type="button"
            className="topbar-report-btn"
            onClick={() => setReportOpen(true)}
            aria-label="Report a Bug"
          >
            <span aria-hidden="true">🐞</span>
            <span className="topbar-report-label">Report a Bug</span>
          </button>
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
