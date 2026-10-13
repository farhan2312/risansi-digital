import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canViewAll } from "@/lib/roles";
import { listOrderDeptStatuses, listOrdersPage, parseQueueSort } from "@/lib/orders";
import { describeOrderListFilter, parseOrderListFilter, scopeToRep } from "@/lib/order-list-filter";
import { buildOrdersListPdf } from "@/lib/orders-list-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Orders list as one PDF — every SO the list's filter, search and sort
 * select, not just the page on screen. Opens in the browser, or saves with
 * ?download=1.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canViewAll(user.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const get = (key: string) => params.get(key) ?? undefined;
  // A Rep: their own SOs only.
  const filter = scopeToRep(parseOrderListFilter(get, { noDispatchTarget: true }), user);
  const result = await listOrdersPage({ page: 1, filter, sort: parseQueueSort(get("sort")), all: true });
  const statuses = await listOrderDeptStatuses(result.rows.map((r) => r.id));

  const bytes = await buildOrdersListPdf(result.rows, statuses, describeOrderListFilter(filter), {
    capped: result.rows.length < result.total,
    total: result.total,
  });

  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Response(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${get("download") === "1" ? "attachment" : "inline"}; filename="orders-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
