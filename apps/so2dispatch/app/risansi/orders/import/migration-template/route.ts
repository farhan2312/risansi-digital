import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canImportOrders } from "@/lib/roles";
import { buildMigrationTemplate } from "@/lib/migration-template";

export const dynamic = "force-dynamic";

/**
 * The full data-migration workbook — every sheet and column the system holds,
 * empty, with dropdowns and checks. Built from the live schema on each
 * request, so it never lags a field that was added since.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !canImportOrders(user.role)) {
    return new NextResponse("Not authorized", { status: 403 });
  }

  const buffer = await buildMigrationTemplate().xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="data_migration_template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
