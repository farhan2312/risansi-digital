import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Wallet } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import {
  canEditSection,
  canViewDepartment,
} from "@/lib/roles";
import { listOrdersForSectionPage,
  parseQueueSort,
  resolveFocusOrderId,
  listDeptCompletions,
  listOrderListOptions,
} from "@/lib/orders";
import { parsePage, parseQuery } from "@/lib/pagination";
import { parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { cardBaseGet } from "@/lib/kpis";
import {
  PAYMENT_TERMS_CONTEXT_FIELDS,
  SECTION_BY_TABLE,
} from "@/lib/order-schema";
import { unreadByOrder } from "@/lib/order-messages";
import { DepartmentWorkspace } from "@/components/risansi/department-workspace";
import { deptKpiCards } from "@/lib/orders";
import { DEPT_VIEWS } from "@/lib/dept-view";
import { homeFor, mayOpenPage } from "@/lib/view-pages";
import { PageHeading } from "@/components/risansi/page-heading";
import { VIEW_MODE_COOKIE, viewModeOf } from "@/lib/view-mode";

export const metadata: Metadata = {
  title: "Accounts | Risansi",
};

export const dynamic = "force-dynamic";

const TABLE = "order_accounts" as const;

export default async function AccountsWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewDepartment(user.role, TABLE)) redirect("/risansi/dashboard");
  // 360° View: only the pages picked for them.
  if (!mayOpenPage(user, "/risansi/departments/accounts")) redirect(homeFor(user));

  const params = await searchParams;
  const { edit, thread, page, q } = params;
  // This department's own filter bar, with the department pinned.
  // A Rep sees only their own SOs.
  const filter = scopeToRep(parseDeptFilter((key) => params[key], "accounts"), user);
  // The cards count over the filter bar as set, less the card clicked.
  filter.kpiFilter = parseDeptFilter(cardBaseGet((key) => params[key]), "accounts");
  // A notification links to an EC (item id) or an SO; either way the queue
  // must open on the page that holds it.
  // Which SO a notification link should open on. Without a link this is
  // immediate; everything else below loads side by side.
  const focusOrderId = await resolveFocusOrderId(thread ?? edit);
  const section = SECTION_BY_TABLE.get(TABLE)!;
  const [queue, filterOptions] = await Promise.all([
    listOrdersForSectionPage(
      TABLE,
      PAYMENT_TERMS_CONTEXT_FIELDS.map((f) => ({ column: f.column, type: f.type })),
      { page: parsePage(page), search: parseQuery(q), focusOrderId, filter, sort: parseQueueSort(params.sort), kpis: deptKpiCards("accounts", [], DEPT_VIEWS.accounts.hasTarget) }
    ),
    listOrderListOptions(filter),
  ]);

  // Unread discussion messages per SO, for the row badge. Rows are ECs in
  // the item-scope workspaces (order_id) and SOs in the SO-scope ones (id).
  // This department's sign-offs for the SOs on this page, for the Complete
  // column. Rows are ECs in the item-scope workspaces and SOs in the others,
  // so the order id comes from whichever the row carries.
  // The rows' sign-offs and unread messages both hang off the queue's SOs and
  // not off each other, so they load together.
  const orderIds = [...new Set(queue.rows.map((o) => String(o.order_id ?? o.id)))];
  const [completions, unreadThreads] = await Promise.all([
    listDeptCompletions(orderIds),
    unreadByOrder(orderIds, user),
  ]);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <PageHeading
        icon={<Wallet />}
        title="Accounts"
        description={<>Update payment status and amount received. Payment Terms is set by Central Visibility. Use &ldquo;View PIs&rdquo; on any order to see the PIs Billing has created.</>}
      />

      <DepartmentWorkspace
        split={viewModeOf((await cookies()).get(VIEW_MODE_COOKIE)?.value) === "split"}
        canEdit={canEditSection(user.role, TABLE)}
        completions={completions}
        openThreadId={thread}
        focusOrderId={focusOrderId ?? undefined}
        role={user.role}
        unreadThreads={unreadThreads}
        table={TABLE}
        fields={section.fields}
        queue={queue}
        kpis={queue.kpis}
        filterOptions={filterOptions}
        readonlyFields={PAYMENT_TERMS_CONTEXT_FIELDS}
        openOrderId={edit}
      />
    </div>
  );
}
