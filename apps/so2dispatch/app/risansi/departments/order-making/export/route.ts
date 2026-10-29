import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canAccessOrderMaking, isOrderMakingSo } from "@/lib/roles";
import { buildOrderMakingWorkbook, loadOrderMakingReport, orderMakingReport } from "@/lib/order-making-export";
import { buildOrderMakingReportPdf } from "@/lib/order-making-report-pdf";

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
  // SO Sent to Operation is Order Making PO's: an SO member does not see it.
  const omit = isOrderMakingSo(user.role) ? ["SO Sent to Operation"] : [];
  if (params.get("view")) {
    return Response.json({ scope, ...orderMakingReport(rows, omit) }, { headers: { "Cache-Control": "no-store" } });
  }
  // As a PDF, laid out as the on-page report: shown in its pop-up, or saved with download=1.
  if (params.get("pdf")) {
    const bytes = await buildOrderMakingReportPdf({ scope, ...orderMakingReport(rows, omit) });
    return new Response(bytes as unknown as ArrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${params.get("download") ? "attachment" : "inline"}; filename="order-making-report${filtered ? "-filtered" : ""}-${today}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const buffer = await buildOrderMakingWorkbook(rows, scope, omit).xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="order-making${filtered ? "-filtered" : ""}-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
