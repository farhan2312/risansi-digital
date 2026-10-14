import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getOrderDeptStatus, getOrderDetail, listItemDetails, listTargetRevisions } from "@/lib/orders";
import { getCurrentUser } from "@/lib/session";
import { canViewAll } from "@/lib/roles";
import { roleSeesOrder } from "@/lib/dept-view";
import { OrderDetail } from "@/components/risansi/order-detail";

export const metadata: Metadata = {
  title: "Order | Risansi",
};

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Order Making works from its own page — the SO's pages show far more.
  if ((user.role === "order_making" || user.role === "order_making_so")) redirect("/risansi/departments/order-making");

  // Target dates keep their full history; the panel shows the current value
  // with every earlier one behind it. Read alongside the order itself — it is
  // only shown once the order has passed the checks below.
  // Central Visibility and Admin also get every EC's departments, for the
  // grid that opens each one in a pop-up.
  const central = canViewAll(user.role);
  const [detail, targetRevisions, gridItems, gridStatus] = await Promise.all([
    getOrderDetail(id),
    listTargetRevisions(id),
    central ? listItemDetails([id]) : null,
    central ? getOrderDeptStatus(id) : null,
  ]);
  if (!detail) notFound();
  if (
    !roleSeesOrder(user.role, {
      ...detail.order,
      ec_types: detail.items.map((i) => i.item_type),
    }, user.rep_names)
  ) {
    notFound();
  }

  return (
    <OrderDetail
      detail={detail}
      orderId={id}
      role={user.role}
      targetRevisions={targetRevisions}
      grid={gridItems ? { items: gridItems, status: gridStatus } : undefined}
    />
  );
}
