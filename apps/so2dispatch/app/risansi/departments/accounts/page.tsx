import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
import {
  PAYMENT_TERMS_CONTEXT_FIELDS,
  SECTION_BY_TABLE,
} from "@/lib/order-schema";
import { unreadByOrder } from "@/lib/order-messages";
import { DepartmentWorkspace } from "@/components/risansi/department-workspace";

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

  const params = await searchParams;
  const { edit, thread, page, q } = params;
  // This department's own filter bar, with the department pinned.
  // A Rep sees only their own SOs.
  const filter = scopeToRep(parseDeptFilter((key) => params[key], "accounts"), user);
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
      { page: parsePage(page), search: parseQuery(q), focusOrderId, filter, sort: parseQueueSort(params.sort) }
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
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Wallet className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Accounts
          </h1>
          <p className="text-sm text-muted">
            Update payment status and amount received. Payment Terms is set by
            Central Visibility. Use &ldquo;View PIs&rdquo; on any order to see
            the PIs Billing has created.
          </p>
        </div>
      </div>

      <DepartmentWorkspace
        canEdit={canEditSection(user.role, TABLE)}
        completions={completions}
        openThreadId={thread}
        focusOrderId={focusOrderId ?? undefined}
        role={user.role}
        unreadThreads={unreadThreads}
        table={TABLE}
        fields={section.fields}
        queue={queue}
        filterOptions={filterOptions}
        readonlyFields={PAYMENT_TERMS_CONTEXT_FIELDS}
        openOrderId={edit}
      />
    </div>
  );
}
