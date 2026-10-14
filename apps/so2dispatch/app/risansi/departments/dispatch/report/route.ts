import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canViewDepartment } from "@/lib/roles";
import { listOrdersForBillingPage, parseQueueSort } from "@/lib/orders";
import { parseQuery } from "@/lib/pagination";
import { describeOrderListFilter, parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { buildDispatchReportPdf } from "@/lib/dept-report-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABLE = "order_dispatch" as const;

/**
 * Dispatch's queue as one PDF — every SO the queue's filter, search and sort
 * select, not just the page on screen. Opens in the browser, or saves with
 * ?download=1.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Not authorized", { status: 401 });
  if (!canViewDepartment(user.role, TABLE)) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  const filter = scopeToRep(parseDeptFilter(get, "dispatch"), user);
  const search = parseQuery(get("q"));
  const queue = await listOrdersForBillingPage({
    page: 1,
    search,
    filter,
    sort: parseQueueSort(get("sort")),
    onlyPacked: true,
    all: true,
  });
  const filterLine = [describeOrderListFilter(filter), search && `Search: ${search}`].filter(Boolean).join("  ·  ");
  const bytes = await buildDispatchReportPdf(queue.rows as unknown as Record<string, unknown>[], filterLine);

  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new NextResponse(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${get("download") === "1" ? "attachment" : "inline"}; filename="dispatch-report-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
