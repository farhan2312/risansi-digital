import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { mayOpenPage } from "@/lib/view-pages";
import { canViewAll } from "@/lib/roles";
import { isTestSo, listOrderDeptStatuses, listOrdersForBilling, listOrdersPage, orderListKpiCards, parseQueueSort, pumpCardSql } from "@/lib/orders";
import { describeOrderListFilter, ordersKind, parseOrderListFilter, scopeToRep, withOrdersKind } from "@/lib/order-list-filter";
import { buildOrdersListPdf } from "@/lib/orders-list-pdf";
import { buildPlanningReportXlsx } from "@/lib/planning-report-xlsx";
import { ordersSheet } from "@/lib/orders-report-sheet";
import { listPumpSummaries } from "@/lib/pump-summary";
import { cardBaseGet } from "@/lib/kpis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Orders list's report — every SO the list's filter, search and sort
 * select, not just the page on screen. A PDF to open (?download=1 saves it);
 * ?format=xlsx the Excel, every column of the list but Chat, and ?format=json
 * the same sheet for the pop-up's Excel view.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canViewAll(user.role) || !mayOpenPage(user, "/risansi/orders")) {
    return new Response("Forbidden", { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const get = (key: string) => params.get(key) ?? undefined;
  // A Rep: their own SOs only.
  const filter = scopeToRep(withOrdersKind(parseOrderListFilter(get, { noDispatchTarget: true }), get("type")), user);
  // The cards as on the page: the filter bar as set, less the card clicked.
  filter.kpiFilter = parseOrderListFilter(cardBaseGet(get), { noDispatchTarget: true });
  const sort = parseQueueSort(get("sort"));
  // The Orders page's own cards, counted the same way, and the Pump card picked narrowing the list.
  const kind = ordersKind(get("type"));
  const result = await listOrdersPage({
    page: 1,
    filter,
    sort,
    all: true,
    kpis: orderListKpiCards(kind),
    extraRestrict: kind === "pump" ? pumpCardSql(get("pk")) : null,
  });
  // A test SO is left out of the report altogether.
  const testCount = result.rows.filter((r) => isTestSo(r.so_no)).length;
  result.rows = result.rows.filter((r) => !isTestSo(r.so_no));
  result.total -= testCount;
  const ids = result.rows.map((r) => r.id);
  // Spare: lot by lot, and each dispatch's slips, invoice, mode and docket.
  const spare = filter.types.length === 1 && filter.types[0] === "Spare";
  // Pump: every department on each SO, as the Pump view shows it.
  const pump = !spare && filter.types.length > 0 && filter.types.every((t) => /^(pump|rolb)$/i.test(t));
  const format = get("format");
  const sheet = format === "xlsx" || format === "json";
  const [statuses, billing, summaries] = await Promise.all([
    listOrderDeptStatuses(ids),
    // The sheet has the Packing Slips … Docket & LR columns on both views.
    spare || sheet ? listOrdersForBilling(ids) : Promise.resolve([]),
    pump ? listPumpSummaries(ids) : Promise.resolve({}),
  ]);
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  if (sheet) {
    const report = ordersSheet({
      rows: result.rows,
      statuses,
      docs: new Map(billing.map((b) => [b.id, { packing_slips: b.packing_slips ?? [], invoices: b.invoices ?? [] }])),
      pump: pump ? new Map(Object.entries(summaries)) : undefined,
      filterLine: describeOrderListFilter(filter),
    });
    if (format === "json") return Response.json(report, { headers: { "Cache-Control": "no-store" } });
    const xlsx = await buildPlanningReportXlsx(report);
    return new Response(xlsx as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${pump ? "pump" : "spare"}-orders-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // The PDF always goes Rep by Rep (A to Z, no Rep last), each Rep's SOs in
  // the list's own order — unless the list is already sorted by Rep.
  const repKey = (r: (typeof result.rows)[number]) => (r.reps ?? "").trim().toLowerCase();
  const byRepRows =
    sort === "rep" || sort === "-rep"
      ? result.rows
      : [...result.rows].sort((a, b) => {
          const x = repKey(a);
          const y = repKey(b);
          return x === y ? 0 : !x ? 1 : !y ? -1 : x.localeCompare(y);
        });
  const bytes = await buildOrdersListPdf(byRepRows, statuses, describeOrderListFilter(filter), {
    capped: result.rows.length < result.total,
    total: result.total,
    spare: spare ? new Map(billing.map((b) => [b.id, b])) : undefined,
    byRep: true,
    pump: pump ? new Map(Object.entries(summaries)) : undefined,
    kpis: result.kpis,
  });

  return new Response(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${get("download") === "1" ? "attachment" : "inline"}; filename="orders-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
