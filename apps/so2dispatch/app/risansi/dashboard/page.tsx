import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { DEPARTMENT_NAV } from "@/components/risansi/nav-config";
import {
  canSeeCentralDashboard,
  canViewAll,
  canViewDepartment,
  isRep,
  departmentHrefForRole,
  roleLabel,
} from "@/lib/roles";
import { listDeptCompletions, listOrdersOverview } from "@/lib/orders";
import { deptViewForRole } from "@/lib/dept-view";
import { listRemindersForRole } from "@/lib/reminders";
import { DEPT_DASHBOARDS } from "@/components/risansi/dept-dashboards";
import { RemindersPanel } from "@/components/risansi/reminders-panel";
import { getDashboard } from "@/lib/dashboard";
import { CentralOverview } from "@/components/risansi/central-overview";
import { ordersKind } from "@/lib/order-list-filter";

export const metadata: Metadata = {
  title: "Dashboard | Risansi",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Order Making has no dashboard: its page is its work.
  if ((user.role === "order_making" || user.role === "order_making_so")) redirect("/risansi/departments/order-making");
  // Nor does any department account: it lands on its own page.
  if (!canViewAll(user.role)) {
    const own = DEPARTMENT_NAV.find((d) => d.table !== "orders" && canViewDepartment(user.role, d.table));
    if (own) redirect(own.href);
  }

  if (canSeeCentralDashboard(user.role)) {
    const params = await searchParams;
    // Spare or Pump: the one choice on the dashboard (Spare when the URL says
    // nothing). A Rep or Rep Manager: their reps' SOs only.
    const dashboard = await getDashboard(ordersKind(params.type), isRep(user.role) ? (user.rep_names ?? []) : null);
    return (
      <div className="px-4 py-6 sm:px-8 sm:py-8">
        <CentralOverview data={dashboard} />
      </div>
    );
  }

  // A department sees the same pipeline rows through its own dashboard: its
  // status vocabulary, its target date, its sign-offs.
  const view = deptViewForRole(user.role);
  const Dashboard = view ? DEPT_DASHBOARDS[view.key] : undefined;
  // The reminders and the department's rows don't depend on each other.
  const [reminders, rows] = await Promise.all([
    listRemindersForRole(user.role),
    view && Dashboard ? listOrdersOverview(view.key) : Promise.resolve([]),
  ]);

  if (!view || !Dashboard) {
    return (
      <div className="px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Welcome, {user.full_name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            You&apos;re signed in as {roleLabel(user.role)}. Use the sidebar to
            open your department workspace.
          </p>
        </div>
        <RemindersPanel reminders={reminders} />
      </div>
    );
  }

  // Its own orders only: an order this department has nothing to do with
  // (Purchase on a no-BOI order, Quality where QC is not needed) is off its
  // dashboard entirely, not shown as N/A.
  const completions = await listDeptCompletions([
    ...new Set(rows.map((r) => r.order_id)),
  ]);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {view.label} dashboard
        </h1>
        <p className="mt-1 text-sm text-muted">
          Welcome, {user.full_name} — every {view.perEc ? "EC" : "order"} on your
          plate, where it stands, and what is due next.
        </p>
      </div>

      <div className="mb-6">
        <RemindersPanel reminders={reminders} />
      </div>

      <Dashboard
        rows={rows}
        completions={completions}
        workspaceHref={departmentHrefForRole(user.role)}
      />
    </div>
  );
}
