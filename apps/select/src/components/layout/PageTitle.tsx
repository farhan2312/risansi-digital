"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

// The page's heading and description sit in the top bar (user, 2026-11-13: in place
// of the breadcrumb, to free the page's own space). A page sets them with
// usePageTitle(); one that doesn't shows its route's default below.

type Title = { title: ReactNode; description?: ReactNode } | null;

// Two contexts: pages take only the (stable) setter, so a new title never re-renders
// the page that set it; the top bar reads the value.
const ValueCtx = createContext<Title>(null);
const SetCtx = createContext<(t: Title) => void>(() => {});

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [value, set] = useState<Title>(null);
  return (
    <SetCtx.Provider value={set}>
      <ValueCtx.Provider value={value}>{children}</ValueCtx.Provider>
    </SetCtx.Provider>
  );
}

/** Sets the top bar's heading while this page is shown. Strings keep it cheap:
 *  it re-sets only when the text changes. */
export function usePageTitle(title: ReactNode, description?: ReactNode) {
  const set = useContext(SetCtx);
  const key = typeof title === "string" && (description === undefined || typeof description === "string") ? `${title}\u0000${description ?? ""}` : null;
  useEffect(() => {
    set({ title, description });
    // ReactNode titles re-set on every render; string ones only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, key === null ? undefined : [key]);
  useEffect(() => () => set(null), [set]);
}

// Path -> heading and description, for the pages that set none (mirrors the sidebar's labels).
const DEFAULTS: Record<string, { title: string; description: string }> = {
  "/dashboard": { title: "Dashboard", description: "Enquiries, tags and approvals at a glance" },
  "/projects": { title: "Enquiries", description: "Create, open and manage pump-selection enquiries · expand an enquiry to work on its tags" },
  "/pump-selection": { title: "Pump Selection", description: "Step through the selection for the tag you opened" },
  "/pump-details": { title: "Pump Details", description: "" },
  "/selection-summary": { title: "Reports", description: "Selection summaries and documents" },
  "/head-calculator": { title: "Head Calculator", description: "Work out the total head for a pump selection" },
  "/commercial": { title: "Commercial Summary", description: "P&A and BOI prices for every tag" },
  "/client-prices": { title: "Client Quoted Prices", description: "Prices quoted to clients before" },
  "/usd-inr": { title: "USD to INR", description: "The rate used to quote in USD" },
  "/my-bug-reports": { title: "My Bug Reports", description: "Reports you filed and where each one stands" },
  "/pump-docs": { title: "Pump Docs", description: "Saved documents of the pump enquiries sent to operation" },
  "/spare-docs": { title: "Spare Docs", description: "Saved documents of the spare enquiries sent to operation" },
  "/client-operation-docs": { title: "Client Operation Docs", description: "Saved documents of the enquiries sent to operation" },
  "/approvals": { title: "Approvals", description: "Steps waiting for your review" },
  "/admin/pump-model-master": { title: "Pump Model Master", description: "Every (model, head-point) row from the pump model master" },
  "/admin/pulley-master": { title: "Pulley Master", description: "Every (model, motor RPM) row from the pulley/motor master" },
  "/admin/gearbox-master": { title: "Gearbox Master", description: "PBL, PTL and Top Gear master rows" },
  "/admin/motor-master": { title: "Motor Master", description: "Motor prices across Siemens / ABB / CGL / Havells (IE2, 1500 RPM)" },
  "/admin/boi-master": { title: "BOI Master", description: "Bought-out item prices" },
  "/admin/users": { title: "Users & Access", description: "Accounts are managed at Risansi Digital" },
  "/admin/audit": { title: "Audit Log", description: "Full activity trail · who signed in, from where, and everything they did" },
  "/admin/bug-tracker": { title: "Bug Tracker", description: "Reports filed from the Report a Bug button across the portal" },
};

const fallbackTitle = (pathname: string): string =>
  (pathname.split("/").filter(Boolean).pop() ?? "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** The top bar's left side: the page heading over its description. */
export function TopBarTitle() {
  const value = useContext(ValueCtx);
  const pathname = usePathname() ?? "";
  const d = DEFAULTS[pathname];
  const title = value?.title ?? d?.title ?? fallbackTitle(pathname);
  const description = value ? value.description : d?.description;
  return (
    <div className="min-w-0 flex-1 pr-4">
      <h1 className="truncate text-[16px] leading-tight font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? <p className="mt-0.5 truncate text-[12px] leading-tight text-muted-foreground max-[860px]:hidden">{description}</p> : null}
    </div>
  );
}
