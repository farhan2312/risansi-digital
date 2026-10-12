"use client";

import { useState, type ReactNode } from "react";
import Sidebar from "../components/layout/Sidebar";
import TopBar from "../components/layout/TopBar";
import BottomNav from "../components/layout/BottomNav";
import "./DashboardLayout.css";

const DashboardLayout = ({ children }: { children: ReactNode }) => {
  // Bumped by the top bar's Refresh button. Keying <main> on it remounts the
  // page below, so every page re-runs its data fetches without a full browser
  // reload — the sidebar, top bar and session stay as they are.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="dashboard-layout">
      {/* Sidebar on desktop, bottom bar on mobile — both are always rendered
          and swapped purely by CSS media queries, so there's no breakpoint
          state in JS to get out of sync (and no hydration mismatch). */}
      <Sidebar />

      <div className="dashboard-content">
        <TopBar onRefresh={() => setRefreshKey((k) => k + 1)} />
        <main key={refreshKey} className="dashboard-main">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
};

export default DashboardLayout;
