import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canImportOrders } from "@/lib/roles";
import { TEMPLATE_HEADERS } from "@/lib/order-import-headers";

export const dynamic = "force-dynamic";

/** Empty daily-import workbook — just the header row, styled and sized. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !canImportOrders(user.role)) {
    return new NextResponse("Not authorized", { status: 403 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Risansi SO to Dispatch";
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow([...TEMPLATE_HEADERS]);

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.height = 20;
  ws.columns = TEMPLATE_HEADERS.map((h) => ({ width: Math.max(14, h.length + 4) }));
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="daily_import_template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
