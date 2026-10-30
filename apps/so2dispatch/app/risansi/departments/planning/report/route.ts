import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canViewDepartment } from "@/lib/roles";
import { listItemsForSectionPage, listReadyLotHistories, parseQueueSort } from "@/lib/orders";
import { parseQuery } from "@/lib/pagination";
import { describeOrderListFilter, parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { PLANNING_CONTEXT_FIELDS } from "@/lib/order-schema";
import { buildPlanningReportPdf } from "@/lib/planning-report-pdf";
import { buildPlanningReportXlsx } from "@/lib/planning-report-xlsx";
import { pumpSheet, spareSheet } from "@/lib/planning-report-sheet";
import { listPumpSummaries } from "@/lib/pump-summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABLE = "order_planning" as const;

/**
 * Planning's report — every SO the queue's filter, search and sort select,
 * not just the page on screen; Spare or Pump, as the page's switch. A PDF to
 * open (?download=1 saves it); ?format=xlsx the Excel, ?format=json the same
 * sheet for the pop-up's Excel view.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Not authorized", { status: 401 });
  if (!canViewDepartment(user.role, TABLE)) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  // Spare or Pump, as the page has it: each its own report.
  const kind: "spare" | "pump" = /pump/i.test(get("type") ?? "") ? "pump" : "spare";
  const filter = scopeToRep(
    { ...parseDeptFilter(get, "planning"), types: kind === "pump" ? ["Pump", "ROLB"] : ["Spare"] },
    user
  );
  const search = parseQuery(get("q"));

  const queue = await listItemsForSectionPage(
    TABLE,
    PLANNING_CONTEXT_FIELDS.map((f) => ({
      column: f.column,
      type: f.type,
      from: f.from ?? ("orders" as const),
    })),
    { page: 1, search, filter, sort: parseQueueSort(get("sort")), all: true }
  );

  const filterLine = [describeOrderListFilter(filter), search && `Search: ${search}`]
    .filter(Boolean)
    .join("  ·  ");
  // How each SO's readiness date moved, for the Date moved column.
  const histories = await listReadyLotHistories([...new Set(queue.rows.map((r) => String(r.order_id)))]);
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const format = get("format");
  if (format === "xlsx" || format === "json") {
    const orderIds = [...new Set(queue.rows.map((r) => String(r.order_id)))];
    const sheet =
      kind === "pump"
        ? pumpSheet(queue.rows, filterLine, histories, await listPumpSummaries(orderIds))
        : spareSheet(queue.rows, filterLine, histories);
    if (format === "json") return NextResponse.json(sheet, { headers: { "Cache-Control": "no-store" } });
    const xlsx = await buildPlanningReportXlsx(sheet);
    return new NextResponse(xlsx as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${kind}-planning-report-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const bytes = await buildPlanningReportPdf(queue.rows, filterLine, histories, kind);

  const download = get("download") === "1";
  return new NextResponse(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${kind}-planning-report-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
