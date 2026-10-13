import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canViewAll } from "@/lib/roles";
import { listOrderExports, listOrderIdsMatching } from "@/lib/orders";
import { buildOrdersWorkbook } from "@/lib/order-export";
import {
  describeOrderListFilter,
  isOrderListFiltered,
  parseOrderListFilter,
  scopeToRep,
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
  const filter = scopeToRep(parseOrderListFilter((key) => params.get(key) ?? undefined, { noDispatchTarget: true }), user);
  const filtered = isOrderListFiltered(filter);
  const ids = filtered ? await listOrderIdsMatching(filter) : undefined;

  const orders = await listOrderExports(ids);
  const scope = describeOrderListFilter(filter);
  const buffer = await buildOrdersWorkbook(orders, scope).xlsx.writeBuffer();

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
