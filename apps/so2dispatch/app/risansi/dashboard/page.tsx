import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { DEPARTMENT_NAV } from "@/components/risansi/nav-config";
import { canSeeCentralDashboard, canViewAll, canViewDepartment, roleLabel } from "@/lib/roles";
import { listRemindersForRole } from "@/lib/reminders";
import { RemindersPanel } from "@/components/risansi/reminders-panel";
import { parseOrderListFilter, scopeToRep } from "@/lib/order-list-filter";
import { getSpareDashboard } from "@/lib/spare-dashboard";
import { OrderListFilterBar } from "@/components/risansi/order-list-filter-bar";
import { KpiStrip } from "@/components/risansi/kpi-strip";
import { SpareDashboardView } from "@/components/risansi/spare-dashboard/spare-dashboard";

export const metadata: Metadata = {
  title: "Dashboard | Risansi",
};

export const dynamic = "force-dynamic";

/**
 * The Spare dashboard: the Orders list's filters and cards over every Spare
 * SO, then where the open ones stand, how dispatch is going, how long things
 * take, and each Rep's book. Central Visibility, Admin, CRM, and Reps (their
 * own SOs). Order Making and the departments land on their own pages.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Order Making has no dashboard: its page is its work.
  if (user.role === "order_making" || user.role === "order_making_so") redirect("/risansi/departments/order-making");
  // Nor does any department account: it lands on its own page.
  if (!canViewAll(user.role)) {
    const own = DEPARTMENT_NAV.find((d) => d.table !== "orders" && canViewDepartment(user.role, d.table));
    if (own) redirect(own.href);
  }

  if (!canSeeCentralDashboard(user.role)) {
    const reminders = await listRemindersForRole(user.role);
    return (
      <div className="px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Welcome, {user.full_name}</h1>
          <p className="mt-1 text-sm text-muted">
            You&apos;re signed in as {roleLabel(user.role)}. Use the sidebar to open your department workspace.
          </p>
        </div>
        <RemindersPanel reminders={reminders} />
      </div>
    );
  }

  const params = await searchParams;
  // The Orders list's filters, pinned to Spare; a Rep sees only their own SOs.
  const filter = scopeToRep(
    { ...parseOrderListFilter((key) => params[key], { noDispatchTarget: true }), types: ["Spare"] },
    user
  );
  const data = await getSpareDashboard(filter);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Spare</p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Where every Spare SO stands, from planning to dispatch · as of {data.asOf} IST
          </p>
        </div>
        <Link
          href="/risansi/orders?type=spare"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-input-border bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background"
        >
          <ClipboardList className="h-4 w-4" />
          Open the Orders list
        </Link>
      </div>

      <OrderListFilterBar options={data.options} total={data.total} noDispatchTarget noTypeFilter />
      <KpiStrip cards={data.kpis} />

      <div className="mt-5">
        <SpareDashboardView data={data} />
      </div>
    </div>
  );
}
