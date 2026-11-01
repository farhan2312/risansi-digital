// 360° View: the pages an account with that role sees. Admin ticks them on
// Users & Access (user_view_pages, by href); the sidebar shows only those and
// every other page sends them to the first of theirs. Plain module, so the
// sidebar can read it too.

import { isView360 } from "@/lib/roles";

/** Every page that can be picked, in the sidebar's order. */
export const VIEW_PAGES: { href: string; label: string }[] = [
  { href: "/risansi/dashboard", label: "Dashboard" },
  { href: "/risansi/orders", label: "Orders" },
  { href: "/risansi/dispatch-plan", label: "Dispatch Plan" },
  { href: "/risansi/departments/order-making", label: "Order Making" },
  { href: "/risansi/departments/billing", label: "Proforma Invoice" },
  { href: "/risansi/departments/accounts", label: "Accounts" },
  { href: "/risansi/departments/drawing", label: "Drawing" },
  { href: "/risansi/departments/planning", label: "Planning" },
  { href: "/risansi/departments/purchase", label: "Purchase" },
  { href: "/risansi/departments/qc", label: "Quality" },
  { href: "/risansi/departments/assembly-dispatch", label: "Assembly & Packing" },
  { href: "/risansi/departments/dispatch", label: "Dispatch" },
];

export const VIEW_PAGE_HREFS = VIEW_PAGES.map((p) => p.href);

/** Where nobody with no pages yet is sent: a page saying so. */
export const NO_PAGES_HREF = "/risansi/no-pages";

type Viewer = { role: string; view_pages?: readonly string[] };

/** Whether this page is open to them: always, but for 360° View only the pages picked. */
export function mayOpenPage(user: Viewer, href: string): boolean {
  return !isView360(user.role) || (user.view_pages ?? []).includes(href);
}

/** A 360° View account's first page, in the sidebar's order — or the page saying none is picked. */
export function homeFor(user: Viewer): string {
  return VIEW_PAGES.find((p) => (user.view_pages ?? []).includes(p.href))?.href ?? NO_PAGES_HREF;
}
