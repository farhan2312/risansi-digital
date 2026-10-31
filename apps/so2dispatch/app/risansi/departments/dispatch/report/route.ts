import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canViewDepartment } from "@/lib/roles";
import { listOrdersForBillingPage, parseQueueSort } from "@/lib/orders";
import { parseQuery } from "@/lib/pagination";
import { describeOrderListFilter, parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { buildDispatchReportPdf } from "@/lib/dept-report-pdf";
import { buildPlanningReportXlsx } from "@/lib/planning-report-xlsx";
import { dispatchSheet } from "@/lib/dispatch-report-sheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABLE = "order_dispatch" as const;

/**
 * Dispatch's report — every SO the queue's filter, search and sort select,
 * not just the page on screen. A PDF to open (?download=1 saves it);
 * ?format=xlsx the Excel, ?format=json the same sheet for the pop-up's Excel view.
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
  const rows = queue.rows as unknown as Record<string, unknown>[];
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const format = get("format");
  if (format === "xlsx" || format === "json") {
    const sheet = dispatchSheet(rows, filterLine);
    if (format === "json") return NextResponse.json(sheet, { headers: { "Cache-Control": "no-store" } });
    const xlsx = await buildPlanningReportXlsx(sheet);
    return new NextResponse(xlsx as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="dispatch-report-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const bytes = await buildDispatchReportPdf(rows, filterLine);

  return new NextResponse(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${get("download") === "1" ? "attachment" : "inline"}; filename="dispatch-report-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
