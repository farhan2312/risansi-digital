import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getItemDetail } from "@/lib/orders";
import { getCurrentUser } from "@/lib/session";
import { roleSeesOrder } from "@/lib/dept-view";
import { ItemDetail } from "@/components/risansi/item-detail";
import { HoldBanner } from "@/components/risansi/hold-badge";

export const metadata: Metadata = {
  title: "EC | Risansi",
};

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const { id, itemId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Order Making works from its own page — the SO's pages show far more.
  if ((user.role === "order_making" || user.role === "order_making_so")) redirect("/risansi/departments/order-making");

  const detail = await getItemDetail(itemId);
  if (!detail || String(detail.order.id) !== id) notFound();
  if (!roleSeesOrder(user.role, { ...detail.order, ec_types: [detail.item.item_type] }, user.rep_name)) {
    notFound();
  }

  return (
    <>
      {/* Held by Central Visibility: everyone sees why. */}
      <div className="px-4 pt-6 sm:px-8">
        <HoldBanner order={detail.order} />
      </div>
      <ItemDetail detail={detail} orderId={id} itemId={itemId} role={user.role} />
    </>
  );
}
