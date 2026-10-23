import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canViewAll } from "@/lib/roles";
import { listOrderExports, listOrderIdsMatching } from "@/lib/orders";
import { buildOrdersWorkbook } from "@/lib/order-export";
import { buildSpareWorkbook } from "@/lib/spare-export";
import {
  describeOrderListFilter,
  isOrderListFiltered,
  parseOrderListFilter,
  scopeToRep,
  withOrdersKind,
} from "@/lib/order-list-filter";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canViewAll(user.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  // The same filter the orders list uses. With none, this exports everything;
  // with any, exactly the SOs behind the caller's filtered view — resolved
  // here rather than posted as ids, since the table only holds the page on
  // screen.
  const params = req.nextUrl.searchParams;
  // A Rep exports only their own SOs.
  // …of the kind the toggle shows, Spare or Pump.
  const filter = scopeToRep(
    withOrdersKind(parseOrderListFilter((key) => params.get(key) ?? undefined, { noDispatchTarget: true }), params.get("type")),
    user
  );
  const filtered = isOrderListFiltered(filter) || filter.types.length > 0;
  const ids = filtered ? await listOrderIdsMatching(filter) : undefined;

  const orders = await listOrderExports(ids);
  const scope = describeOrderListFilter(filter);
  // Spare: its own sheets, as Spare is worked now (lots, per-PI payment); Pump as before.
  const spare = filter.types.length === 1 && filter.types[0] === "Spare";
  const buffer = await (spare ? buildSpareWorkbook(orders, scope) : buildOrdersWorkbook(orders, scope)).xlsx.writeBuffer();

  const today = new Date().toISOString().slice(0, 10);
  const filename = `orders-export${filtered ? "-filtered" : ""}-${today}.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
