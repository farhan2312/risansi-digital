import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { mayOpenPage } from "@/lib/view-pages";
import { canViewDepartment } from "@/lib/roles";
import { listOrdersForBillingPage, parseQueueSort } from "@/lib/orders";
import { parseQuery } from "@/lib/pagination";
import { describeOrderListFilter, parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { parsePendencyFilter } from "@/lib/pendency";
import { listPendency, pendencyFilterSql } from "@/lib/pendency-db";
import { buildPiReportPdf, type PiPendency } from "@/lib/dept-report-pdf";
import { buildPlanningReportXlsx } from "@/lib/planning-report-xlsx";
import { piSheet } from "@/lib/pi-report-sheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABLE = "order_billing" as const;

/**
 * Proforma Invoice's report — every SO the queue's filter, pendency filter,
 * search and sort select, not just the page on screen. A PDF to open
 * (?download=1 saves it); ?format=xlsx the Excel, ?format=json the same sheet
 * for the pop-up's Excel view.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Not authorized", { status: 401 });
  if (!canViewDepartment(user.role, TABLE) || !mayOpenPage(user, "/risansi/departments/billing")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  const filter = scopeToRep(parseDeptFilter(get, "billing"), user);
  const search = parseQuery(get("q"));
  const reasons = parsePendencyFilter(get, "billing");
  const queue = await listOrdersForBillingPage({
    page: 1,
    search,
    filter,
    sort: parseQueueSort(get("sort")),
    extraRestrict: pendencyFilterSql("billing", reasons),
    all: true,
  });
  const rows = queue.rows as unknown as Record<string, unknown>[];
  const all = await listPendency(rows.map((o) => String(o.id)), "billing");
  // Only a pendency still standing.
  const pendency: Record<string, PiPendency> = Object.fromEntries(
    Object.entries(all)
      .filter(([, p]) => !p.clearedAt)
      .map(([id, p]) => [id, { reason: p.reason, remarks: p.remarks }])
  );
  const filterLine = [
    describeOrderListFilter(filter),
    reasons.length ? `Pendency: ${reasons.join(", ")}` : "",
    search ? `Search: ${search}` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const format = get("format");
  if (format === "xlsx" || format === "json") {
    const sheet = piSheet(rows, pendency, filterLine);
    if (format === "json") return NextResponse.json(sheet, { headers: { "Cache-Control": "no-store" } });
    const xlsx = await buildPlanningReportXlsx(sheet);
    return new NextResponse(xlsx as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="proforma-invoice-report-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const bytes = await buildPiReportPdf(rows, pendency, filterLine);
  return new NextResponse(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${get("download") === "1" ? "attachment" : "inline"}; filename="proforma-invoice-report-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
