import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  getAuditStats,
  listAuditEventsPage,
  listAuditUsersPage,
} from "@/lib/audit";
import { parsePage, parseQuery } from "@/lib/pagination";
import {
  auditWindow,
  parseAuditDate,
  AUDIT_CATEGORY_BY_TAB,
  AUDIT_TABS,
  DEFAULT_AUDIT_TAB,
} from "@/lib/audit-range";
import { getAuditOverview } from "@/lib/audit-overview";
import { AuditLogView } from "@/components/risansi/audit-log-view";

export const metadata: Metadata = {
  title: "Audit Log | Risansi",
};

export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    tab?: string;
    range?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/risansi/dashboard");

  const { page, q, tab, range, from, to } = await searchParams;
  const activeTab = AUDIT_TABS.some((t) => t.key === tab) ? tab! : DEFAULT_AUDIT_TAB;
  const activeRange = range ?? "7d";
  // A custom From/To replaces the preset; either end may be left open.
  const fromDate = parseAuditDate(from);
  const toDate = parseAuditDate(to);
  const period = auditWindow(activeRange, fromDate, toDate);
  const search = parseQuery(q);
  const current = parsePage(page);

  // Overview and by-user are aggregates; the others are event lists. Only the
  // one on screen is queried.
  const isEventTab = activeTab !== "by_user" && activeTab !== "overview";
  const [stats, overview, users, events] = await Promise.all([
    getAuditStats(),
    activeTab === "overview" ? getAuditOverview(period) : null,
    activeTab === "by_user"
      ? listAuditUsersPage({ page: current, window: period, search })
      : null,
    !isEventTab
      ? null
      : listAuditEventsPage({
          page: current,
          category: AUDIT_CATEGORY_BY_TAB[activeTab] ?? null,
          window: period,
          search,
        }),
  ]);

  return (
    <AuditLogView
      stats={stats}
      tab={activeTab}
      range={activeRange}
      from={fromDate}
      to={toDate}
      overview={overview}
      users={users}
      events={events}
    />
  );
}
