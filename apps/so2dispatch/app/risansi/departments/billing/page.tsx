import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import {
  canEditChild,
  canViewDepartment,
} from "@/lib/roles";
import {
  listOrdersForBillingPage,
  parseQueueSort,
  resolveFocusOrderId,
  listDeptCompletions,
  listOrderListOptions,
} from "@/lib/orders";
import { parsePage, parseQuery } from "@/lib/pagination";
import { parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { unreadByOrder } from "@/lib/order-messages";
import { BillingWorkspace } from "@/components/risansi/billing-workspace";

export const metadata: Metadata = {
  title: "Billing & Operations | Risansi",
};

export const dynamic = "force-dynamic";

const TABLE = "order_billing" as const;

export default async function BillingWorkspacePage({
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
  const filter = scopeToRep(parseDeptFilter((key) => params[key], "billing"), user);
  // A notification links to an SO; open the page that holds it.
  // Which SO a notification link should open on. Without a link this is
  // immediate; everything else below loads side by side.
  const focusOrderId = await resolveFocusOrderId(thread ?? edit);
  const [queue, filterOptions] = await Promise.all([
    listOrdersForBillingPage({
      page: parsePage(page),
      search: parseQuery(q),
      focusOrderId,
      sort: parseQueueSort(params.sort),
      filter,
    }),
    listOrderListOptions(filter),
  ]);

  // Unread discussion messages per SO, for the row badge.
  // Billing's sign-offs for the SOs on this page.
  // Billing rows are SOs, so the row id is the order id.
  // The rows' sign-offs and unread messages both hang off the queue's SOs and
  // not off each other, so they load together.
  const orderIds = [...new Set(queue.rows.map((o) => String(o.id)))];
  const [completions, unreadThreads] = await Promise.all([
    listDeptCompletions(orderIds),
    unreadByOrder(orderIds, user),
  ]);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Receipt className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Billing &amp; Operations
          </h1>
          <p className="text-sm text-muted">
            Add one or more PIs per SO and fill their document fields (PI
            No./Date/Value). Challan orders are not listed here — Dispatch
            files their challans. Payment fields are filled by Accounts.
          </p>
        </div>
      </div>

      <BillingWorkspace
        completions={completions}
        openThreadId={thread}
        focusOrderId={focusOrderId ?? undefined}
        role={user.role}
        unreadThreads={unreadThreads}
        queue={queue}
        filterOptions={filterOptions}
        canEdit={canEditChild(user.role, "order_billing_docs")}
        openOrderId={edit}
      />
    </div>
  );
}
