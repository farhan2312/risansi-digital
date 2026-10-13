"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { isCentral } from "@/lib/roles";
import type { ItemDetail as ItemDetailData } from "@/lib/orders";
import { OrderStatusPanel } from "./order-status-panel";
import { ItemSections } from "./item-sections";

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function ItemDetail({
  detail,
  orderId,
  itemId,
  role,
}: {
  detail: ItemDetailData;
  orderId: string;
  itemId: string;
  role: string;
}) {
  const order = detail.order;
  const item = detail.item;
  const central = isCentral(role);
  const soLabel = str(order.so_no) || `#${str(order.sl_no) || "—"}`;
  const ecLabel = str(item.ec_no) || "EC";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <Link
        href={`/risansi/orders/${orderId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to SO {soLabel}
      </Link>

      {/* The order's status, read here too: an EC of a cancelled or diverted
          order takes no further work. Set from the SO page. */}
      <OrderStatusPanel orderId={orderId} order={order} role={central ? "view" : role} />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
          EC · {ecLabel}
        </span>
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
          {str(item.item_type) || "Item"}
          {str(item.pump_type) ? ` · ${str(item.pump_type)}` : ""}
          {str(item.model_no) ? ` — ${str(item.model_no)}` : ""}
        </h1>
        <span className="text-sm text-muted">SO {soLabel}</span>
      </div>

      <ItemSections detail={detail} orderId={orderId} itemId={itemId} role={role} />
    </div>
  );
}
