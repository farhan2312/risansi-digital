"use client";

import { usePathname } from "next/navigation";
import "./Breadcrumb.css";

// Path -> readable label, mirrors the Sidebar's nav labels so the breadcrumb
// and the sidebar always agree on what a page is called.
const LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/projects": "Enquiries",
  "/pump-selection": "Pump Selection",
  "/pump-details": "Pump Details",
  "/selection-summary": "Reports",
  "/head-calculator": "Head Calculator",
  "/commercial": "Commercial Summary",
  "/client-prices": "Client Quoted Prices",
  "/my-bug-reports": "My Bug Reports",
  "/admin/pump-model-master": "Pump Model Master",
  "/admin/pulley-master": "Pulley Master",
  "/admin/gearbox-master": "Gearbox Master",
  "/admin/motor-master": "Motor Master",
  "/admin/boi-master": "BOI Master",
  "/admin/users": "Users & Access",
  "/admin/audit": "Audit Log",
  "/admin/bug-tracker": "Bug Tracker",
};

// Falls back to a title-cased version of the last path segment for any route
// not in the map above (e.g. a future admin page added without updating this
// list), so the breadcrumb never just goes blank.
const fallbackLabel = (pathname: string): string => {
  const last = pathname.split("/").filter(Boolean).pop() ?? "";
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

// Slim "Brand > Current Page" trail on the left of the top bar — this app's
// equivalent of the reference design's "Central Admin > Hierarchy". Two
// levels only (brand root + current page); /admin/* pages don't get a third
// "Admin" crumb since the sidebar's "Admin" group label already conveys that.
const Breadcrumb = () => {
  const pathname = usePathname() ?? "";
  const label = LABELS[pathname] ?? fallbackLabel(pathname);

  return (
    <div className="breadcrumb">
      <span className="breadcrumb-root">Risansi Portal</span>
      {label && (
        <>
          <span className="breadcrumb-sep">›</span>
          <span className="breadcrumb-current">{label}</span>
        </>
      )}
    </div>
  );
};

export default Breadcrumb;
