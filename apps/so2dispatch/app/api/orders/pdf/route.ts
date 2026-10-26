import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canViewAll } from "@/lib/roles";
import { listOrderDeptStatuses, listOrdersForBilling, listOrdersPage, parseQueueSort } from "@/lib/orders";
import { describeOrderListFilter, parseOrderListFilter, scopeToRep, withOrdersKind } from "@/lib/order-list-filter";
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
  const filter = scopeToRep(withOrdersKind(parseOrderListFilter(get, { noDispatchTarget: true }), get("type")), user);
  const result = await listOrdersPage({ page: 1, filter, sort: parseQueueSort(get("sort")), all: true });
  const ids = result.rows.map((r) => r.id);
  // Spare: lot by lot, and each dispatch's slips, invoice, mode and docket.
  const spare = filter.types.length === 1 && filter.types[0] === "Spare";
  const [statuses, billing] = await Promise.all([
    listOrderDeptStatuses(ids),
    spare ? listOrdersForBilling(ids) : Promise.resolve([]),
  ]);

  const bytes = await buildOrdersListPdf(result.rows, statuses, describeOrderListFilter(filter), {
    capped: result.rows.length < result.total,
    total: result.total,
    spare: spare ? new Map(billing.map((b) => [b.id, b])) : undefined,
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
