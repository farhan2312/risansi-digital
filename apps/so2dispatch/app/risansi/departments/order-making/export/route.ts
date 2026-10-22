import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canAccessOrderMaking } from "@/lib/roles";
import { buildOrderMakingWorkbook, COLUMNS, loadOrderMakingReport, orderMakingReportLines } from "@/lib/order-making-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Order Making's list as an Excel sheet: the same filters and search as the
 * page, every page of it, one row per EC. With view=1, the same rows as JSON
 * for the pop-up that shows them before the download.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessOrderMaking(user.role)) return new Response("Forbidden", { status: 403 });

  const params = req.nextUrl.searchParams;
  const { rows, scope, filtered, today } = await loadOrderMakingReport(user, (key) => params.get(key) ?? undefined);
  if (params.get("view")) {
    return Response.json(
      { scope, columns: COLUMNS, lines: orderMakingReportLines(rows) },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  const buffer = await buildOrderMakingWorkbook(rows, scope).xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="order-making${filtered ? "-filtered" : ""}-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
