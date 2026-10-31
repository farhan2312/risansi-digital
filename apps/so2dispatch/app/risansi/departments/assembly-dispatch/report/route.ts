import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canViewDepartment } from "@/lib/roles";
import { listItemsForSectionPage, parseQueueSort } from "@/lib/orders";
import { parseQuery } from "@/lib/pagination";
import { describeOrderListFilter, parseDeptFilter, scopeToRep } from "@/lib/order-list-filter";
import { ASSEMBLY_CONTEXT_FIELDS } from "@/lib/order-schema";
import { pickStageStatuses, pumpViewRestrict } from "@/lib/assembly";
import { buildAssemblyReportPdf } from "@/lib/dept-report-pdf";
import { buildPlanningReportXlsx } from "@/lib/planning-report-xlsx";
import { assemblyPumpSheet, assemblySpareSheet } from "@/lib/assembly-report-sheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABLE = "order_assembly_dispatch" as const;

/**
 * Assembly & Packing's report — every SO the queue's filter, search and sort
 * select, not just the page on screen; Spare or Pump, as the page's switch.
 * A PDF to open (?download=1 saves it); ?format=xlsx the Excel, ?format=json
 * the same sheet for the pop-up's Excel view.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Not authorized", { status: 401 });
  if (!canViewDepartment(user.role, TABLE)) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  // Spare or Pump, as the page has it: each its own report, as Planning's.
  const kind: "spare" | "pump" = /pump/i.test(get("type") ?? "") ? "pump" : "spare";
  const filter = scopeToRep(
    { ...parseDeptFilter(get, "assembly"), types: kind === "pump" ? ["Pump", "ROLB"] : ["Spare"] },
    user
  );
  const search = parseQuery(get("q"));
  const queue = await listItemsForSectionPage(
    TABLE,
    ASSEMBLY_CONTEXT_FIELDS.map((f) => ({ column: f.column, type: f.type, from: f.from ?? ("orders" as const) })),
    {
      page: 1,
      search,
      filter,
      sort: parseQueueSort(get("sort")),
      all: true,
      // The Pump view's SOs, at the assembly and packing statuses picked.
      extraRestrict:
        kind === "pump" ? pumpViewRestrict(pickStageStatuses(get, "assembly"), pickStageStatuses(get, "packing")) : undefined,
    }
  );
  const filterLine = [describeOrderListFilter(filter), search && `Search: ${search}`].filter(Boolean).join("  ·  ");
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  const format = get("format");
  if (format === "xlsx" || format === "json") {
    const sheet = kind === "pump" ? assemblyPumpSheet(queue.rows, filterLine) : assemblySpareSheet(queue.rows, filterLine);
    if (format === "json") return NextResponse.json(sheet, { headers: { "Cache-Control": "no-store" } });
    const xlsx = await buildPlanningReportXlsx(sheet);
    return new NextResponse(xlsx as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${kind}-assembly-packing-report-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const bytes = await buildAssemblyReportPdf(
    queue.rows,
    filterLine,
    kind === "pump" ? "Pump assembly & packing report" : "Spare assembly & packing report"
  );
  return new NextResponse(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${get("download") === "1" ? "attachment" : "inline"}; filename="${kind}-assembly-packing-report-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
