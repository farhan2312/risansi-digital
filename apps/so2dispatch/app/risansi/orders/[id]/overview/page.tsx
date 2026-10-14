import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  getOrderDeptStatus,
  getOrderDetail,
  listDeptCompletions,
  listItemDetails,
  listTargetRevisions,
} from "@/lib/orders";
import { getCurrentUser } from "@/lib/session";
import { roleSeesOrder } from "@/lib/dept-view";
import { OrderOverview } from "@/components/risansi/order-overview";

export const metadata: Metadata = {
  title: "Order overview | Risansi",
};

export const dynamic = "force-dynamic";

export default async function OrderOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Order Making works from its own page — the SO's pages show far more.
  if ((user.role === "order_making" || user.role === "order_making_so")) redirect("/risansi/departments/order-making");
  // Planning works from its own queue and the SO page, not the whole-order view.
  if (user.role === "planning") redirect(`/risansi/orders/${id}`);

  // Independent reads, so they go together: the SO itself, every EC with each
  // department's row and child lists, the derived status, the sign-offs and
  // the target dates' history. The database is remote, so the round trips are what cost.
  const [detail, items, status, completions, targetRevisions] = await Promise.all([
    getOrderDetail(id),
    listItemDetails([id]),
    getOrderDeptStatus(id),
    listDeptCompletions([id]),
    listTargetRevisions(id),
  ]);
  if (!detail) notFound();
  // A department that has nothing to do with this order cannot reach it by
  // URL either — the same rule that keeps it off their queue and dashboard.
  if (
    !roleSeesOrder(user.role, {
      ...detail.order,
      ec_types: detail.items.map((i) => i.item_type),
    }, user.rep_names)
  ) {
    notFound();
  }

  return (
    <OrderOverview
      orderId={id}
      detail={detail}
      items={items}
      status={status}
      completions={completions}
      role={user.role}
      targetRevisions={targetRevisions}
    />
  );
}
