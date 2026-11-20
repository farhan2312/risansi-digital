import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canViewDepartment } from "@/lib/roles";
import { mayOpenPage } from "@/lib/view-pages";
import { loadPiReport } from "@/lib/pi-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proforma Invoice's list as an Excel sheet: the same filters and search as
 * the page, every page of it, one row per PI.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canViewDepartment(user.role, "order_billing") || !mayOpenPage(user, "/risansi/departments/billing")) {
    return new Response("Forbidden", { status: 403 });
  }
  const params = req.nextUrl.searchParams;
  const { wb, filtered, today } = await loadPiReport(user, (key) => params.get(key) ?? undefined, [...params.keys()].some((k) => k !== "sort" && !!params.get(k)));
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="proforma-invoice${filtered ? "-filtered" : ""}-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
