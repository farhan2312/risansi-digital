import {
  Bug,
  FilePlus2,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  LayoutDashboard,
  Package,
  PenTool,
  Receipt,
  ScrollText,
  ChartPie,
  ShieldCheck,
  PackageCheck,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { OrderTable } from "@/lib/order-schema";

/**
 * Shared navigation definitions. The desktop sidebar and the mobile bottom
 * nav both read from here so a route only ever needs adding in one place.
 */
export type NavItem = { label: string; href: string; icon: LucideIcon };
export type DeptNavItem = NavItem & { table: OrderTable };

export const PRIMARY_NAV: NavItem[] = [
  { label: "Dashboard", href: "/risansi/dashboard", icon: LayoutDashboard },
  { label: "Orders", href: "/risansi/orders", icon: ClipboardList },
];

export const DEPARTMENT_NAV: DeptNavItem[] = [
  {
    // First in the flow: the SO is created here, with its client and PO.
    label: "Order Making",
    href: "/risansi/departments/order-making",
    icon: FilePlus2,
    table: "orders",
  },
  {
    label: "Billing & Operations",
    href: "/risansi/departments/billing",
    icon: Receipt,
    table: "order_billing",
  },
  {
    label: "Accounts",
    href: "/risansi/departments/accounts",
    icon: Wallet,
    table: "order_accounts",
  },
  {
    label: "Drawing",
    href: "/risansi/departments/drawing",
    icon: PenTool,
    table: "order_drawing",
  },
  {
    label: "Planning",
    href: "/risansi/departments/planning",
    icon: CalendarClock,
    table: "order_planning",
  },
  {
    label: "Purchase",
    href: "/risansi/departments/purchase",
    icon: Package,
    table: "order_purchase",
  },
  {
    label: "Quality",
    href: "/risansi/departments/qc",
    icon: ClipboardCheck,
    table: "order_qc",
  },
  {
    label: "Assembly & Packing",
    href: "/risansi/departments/assembly-dispatch",
    icon: Truck,
    table: "order_assembly_dispatch",
  },
  {
    // Last in the flow: what Assembly & Packing has packed goes out here.
    label: "Dispatch",
    href: "/risansi/departments/dispatch",
    icon: PackageCheck,
    table: "order_dispatch",
  },
];

export const ADMIN_NAV: NavItem[] = [
  {
    label: "User Access Control",
    href: "/risansi/user-access-control",
    icon: ShieldCheck,
  },
  { label: "Audit Log", href: "/risansi/audit-log", icon: ScrollText },
  { label: "Reports", href: "/risansi/reports", icon: ChartPie },
  { label: "Bug Tracker", href: "/risansi/bug-reports", icon: Bug },
];

// All nav destinations — used to resolve the single active item by longest
// matching prefix.
export const NAV_HREFS: string[] = [
  ...PRIMARY_NAV.map((i) => i.href),
  ...DEPARTMENT_NAV.map((i) => i.href),
  "/risansi/notifications",
  "/risansi/messages",
  "/risansi/escalations",
  "/risansi/dispatched",
  "/risansi/settings",
  ...ADMIN_NAV.map((i) => i.href),
];

/**
 * The nav href that is the longest matching prefix of `pathname`, so only the
 * most specific destination highlights (e.g. an EC detail page keeps its
 * parent Orders entry active).
 */
export function activeNavHref(pathname: string): string {
  return NAV_HREFS.filter(
    (h) => pathname === h || pathname.startsWith(h + "/")
  ).reduce((best, h) => (h.length > best.length ? h : best), "");
}
