import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canAccessOrderMaking, canAssignSo, canCreateOrders, isOrderMakingSo } from "@/lib/roles";
import { listSoMembers, parseAssignPeriod, soMemberSummary } from "@/lib/so-assignment";
import { listOrderListOptions, listOrdersForOrderMaking } from "@/lib/orders";
import { parsePage, parseQuery } from "@/lib/pagination";
import { parseOrderMakingFilter } from "@/lib/order-making-filter";
import { unreadByOrder } from "@/lib/order-messages";
import { OrderMakingWorkspace } from "@/components/risansi/order-making-workspace";

export const metadata: Metadata = {
  title: "Order Making | Risansi",
};

export const dynamic = "force-dynamic";

/**
 * Order Making: where an SO starts. Order Making PO creates SOs with their
 * client and purchase order details and assigns each SO's Sales Order details
 * to an Order Making SO member, who fills them on this same page (seeing only
 * the SOs assigned to them). Once those are in, Central Visibility is told
 * and fills in the rest.
 */
export default async function OrderMakingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessOrderMaking(user.role)) redirect("/risansi/dashboard");

  const params = await searchParams;
  const filter = parseOrderMakingFilter((key) => params[key]);
  // An Order Making SO member works only on the SOs assigned to them.
  const soMember = isOrderMakingSo(user.role);
  const canAssign = canAssignSo(user.role);
  // The assignment cards: today's by default, or all time.
  const period = parseAssignPeriod(params.period);
  const [queue, options, members, summary] = await Promise.all([
    listOrdersForOrderMaking({
      page: parsePage(params.page),
      withKpis: true,
      search: parseQuery(params.q),
      filter: soMember ? { ...filter, assignees: [] } : filter,
      assigneeScope: soMember ? user.id : undefined,
    }),
    listOrderListOptions(),
    canAssign ? listSoMembers() : Promise.resolve([]),
    canAssign ? soMemberSummary(period) : Promise.resolve(null),
  ]);
  const canCreate = canCreateOrders(user.role);
  // Unread discussion messages per SO, for the chat badge.
  const unreadThreads = await unreadByOrder(queue.rows.map((r) => r.id), user);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <OrderMakingWorkspace
        heading={
          <div className="flex min-w-0 flex-1 basis-[28rem] items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <FilePlus2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Order Making</h1>
              <p className="text-sm text-muted">
                {soMember
                  ? "The SOs assigned to you — fill each one's SO details: SO No., date, value, currency and quantity. Central Visibility is told once they are in."
                  : "Create SOs with their client and purchase order details and assign each one's SO details to an Order Making SO member. Central Visibility is told once the SO details are in."}
              </p>
            </div>
          </div>
        }
        queue={queue}
        kpis={queue.kpis}
        filter={filter}
        options={options}
        canEdit={canCreate || soMember}
        canCreate={canCreate}
        mode={soMember ? "so" : "po"}
        canAssign={canAssign}
        period={period}
        members={members}
        summary={summary}
        role={user.role}
        unreadThreads={unreadThreads}
      />
    </div>
  );
}
