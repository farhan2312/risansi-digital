import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { mayOpenPage } from "@/lib/view-pages";
import { canViewDepartment } from "@/lib/roles";
import { listItemsForPurchasePage, parseQueueSort } from "@/lib/orders";
import { parseQuery } from "@/lib/pagination";
import { describeOrderListFilter, parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { parsePendencyFilter } from "@/lib/pendency";
import { pendencyFilterSql } from "@/lib/pendency-db";
import {
  boiMatches,
  ecMatchesPurchaseFilter,
  ecPurchaseState,
  parsePurchaseFilter,
  purchaseFilterActive,
  purchaseFilterSql,
  soPurchaseState,
} from "@/lib/purchase-filter";
import { buildReportPdf } from "@/lib/dept-report-pdf";
import { buildPlanningReportXlsx } from "@/lib/planning-report-xlsx";
import { boiLines, boiReport, boiSheet } from "@/lib/boi-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABLE = "order_purchase" as const;

/**
 * Purchase's BOI view as a report: every bought-out item the queue's filters,
 * search and sort select (every SO, not the page on screen), with every
 * column of the BOI view. A PDF to open (?download=1 saves it); ?format=xlsx
 * the Excel, ?format=json the same sheet for the pop-up's Excel view.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Not authorized", { status: 401 });
  if (!canViewDepartment(user.role, TABLE) || !mayOpenPage(user, "/risansi/departments/purchase")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  // As the Purchase page reads them: its filter bar, its own filters, pendency and search.
  const filter = scopeToRep(parseDeptFilter(get, "purchase"), user);
  const purchaseFilter = parsePurchaseFilter(get);
  const search = parseQuery(get("q"));
  const queue = await listItemsForPurchasePage({
    extraRestrict: `${purchaseFilterSql(purchaseFilter)} AND ${pendencyFilterSql("purchase", parsePendencyFilter(get, "purchase"))}`,
    page: 1,
    search,
    sort: parseQueueSort(get("sort")),
    filter,
    all: true,
  });
  let rows = queue.rows as unknown as Record<string, unknown>[];
  // Each SO's and EC's state from all its items, then only the ECs and items that match — as the page.
  {
    const byOrder = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) byOrder.set(String(r.order_id), [...(byOrder.get(String(r.order_id)) ?? []), r]);
    for (const [, ecs] of byOrder) {
      const pumps = ecs.filter((r) => String(r.item_type ?? "").trim().toLowerCase() !== "spare");
      const so = soPurchaseState(pumps);
      for (const r of ecs) Object.assign(r, { pur_so_state: so, pur_ec_state: ecPurchaseState(r) });
    }
  }
  if (purchaseFilterActive(purchaseFilter)) {
    rows = rows.filter((r) => ecMatchesPurchaseFilter(r, purchaseFilter));
    if (purchaseFilter.item.length || purchaseFilter.boi.length || purchaseFilter.vendor.length) {
      for (const r of rows) r.boi_items = ((r.boi_items ?? []) as Record<string, unknown>[]).filter((b) => boiMatches(b, purchaseFilter));
    }
  }

  const lines = boiLines(rows, get("sort") ?? null);
  const filterLine = [describeOrderListFilter(filter), search && `Search: ${search}`].filter(Boolean).join("  ·  ");
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const format = get("format");
  if (format === "xlsx" || format === "json") {
    const sheet = boiSheet(lines, filterLine);
    if (format === "json") return NextResponse.json(sheet, { headers: { "Cache-Control": "no-store" } });
    const xlsx = await buildPlanningReportXlsx(sheet);
    return new NextResponse(xlsx as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="purchase-boi-report-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const bytes = await buildReportPdf(boiReport(lines, filterLine));
  return new NextResponse(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${get("download") === "1" ? "attachment" : "inline"}; filename="purchase-boi-report-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
