import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { DEPARTMENT_NAV } from "@/components/risansi/nav-config";
import { canSeeCentralDashboard, canViewAll, canViewDepartment, roleLabel } from "@/lib/roles";
import { listRemindersForRole } from "@/lib/reminders";
import { RemindersPanel } from "@/components/risansi/reminders-panel";
import { ordersKind, parseOrderListFilter, scopeToRep, withOrdersKind } from "@/lib/order-list-filter";
import { getSpareDashboard } from "@/lib/spare-dashboard";
import { getPumpDashboard } from "@/lib/pump-dashboard";
import { OrderListFilterBar } from "@/components/risansi/order-list-filter-bar";
import { KpiStrip } from "@/components/risansi/kpi-strip";
import { SpareDashboardView } from "@/components/risansi/spare-dashboard/spare-dashboard";
import { PumpDashboardView } from "@/components/risansi/spare-dashboard/pump-dashboard";

export const metadata: Metadata = {
  title: "Dashboard | Risansi",
};

export const dynamic = "force-dynamic";

/**
 * The dashboard, Spare or Pump as its toggle says: the Orders list's filters
 * and cards over every SO of that kind, then where they stand, how dispatch
 * is going, each Rep's book — and on Pump, every department's progress. Central Visibility, Admin, CRM, and Reps (their
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
  // Spare or Pump, as the toggle says (Spare when it says nothing).
  const kind = ordersKind(params.type);
  // The Orders list's filters, pinned to that kind; a Rep sees only their own SOs.
  const filter = scopeToRep(withOrdersKind(parseOrderListFilter((key) => params[key], { noDispatchTarget: true }), params.type), user);
  // On Pump, the card picked narrows the SOs, as on the Orders list.
  const data = kind === "pump" ? await getPumpDashboard(filter, params.pk ?? null) : await getSpareDashboard(filter);
  const kindLabel = kind === "pump" ? "Pump" : "Spare";

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{kindLabel}</p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            {kind === "pump"
              ? "Where every pump SO stands, department by department, from drawing to dispatch"
              : "Where every Spare SO stands, from planning to dispatch"}{" "}
            · as of {data.asOf} IST
          </p>
        </div>
        <Link
          href={kind === "pump" ? "/risansi/orders?type=pump" : "/risansi/orders?type=spare"}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-input-border bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background"
        >
          <ClipboardList className="h-4 w-4" />
          Open the Orders list
        </Link>
      </div>

      <OrderListFilterBar options={data.options} total={data.total} noDispatchTarget noTypeFilter noChats kindToggle={kind} />
      <KpiStrip cards={data.kpis} panels />

      <div className="mt-5">
        {"depts" in data ? <PumpDashboardView data={data} /> : <SpareDashboardView data={data} />}
      </div>
    </div>
  );
}
