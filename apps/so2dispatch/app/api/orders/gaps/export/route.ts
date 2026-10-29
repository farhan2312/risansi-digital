import type { NextRequest } from "next/server";
import type ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/session";
import { isCentral } from "@/lib/roles";
import { listOrderGapSheet } from "@/lib/order-gaps";
import { buildGapWorkbook, buildGapWorkbookSheets } from "@/lib/gap-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Details not filled as Excel, to fill in: All, Pump or Spare (?type=), and
 * the pop-up's search (?q=). Central Visibility's, as the pop-up is.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isCentral(user.role)) return new Response("Forbidden", { status: 403 });
  const params = req.nextUrl.searchParams;
  const typeRaw = params.get("type");
  const type = typeRaw === "Pump" || typeRaw === "Spare" ? typeRaw : null;
  const search = (params.get("q") ?? "").slice(0, 120);
  // ?scope=so: every SO with its SO No., not only the open ones — a sheet
  // each for Pump and Spare (their fields differ), or the one type asked for.
  const everySo = params.get("scope") === "so";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const matching = search ? ` matching "${search}"` : "";
  let buffer: ExcelJS.Buffer;
  if (everySo) {
    const types = type ? [type] : ["Pump", "Spare"];
    const sheets = await Promise.all(types.map((t) => listOrderGapSheet({ search, type: t, everySo })));
    buffer = await buildGapWorkbookSheets(
      types.map((t, i) => ({ name: `${t} SOs`, sheet: sheets[i], scope: `Every ${t} SO with an SO No.${matching} · ${today}` }))
    ).xlsx.writeBuffer();
  } else {
    const sheet = await listOrderGapSheet({ search, type });
    buffer = await buildGapWorkbook(sheet, `${type ?? "All"} SOs${matching} · ${today}`).xlsx.writeBuffer();
  }
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="details-not-filled-${(type ?? "all").toLowerCase()}-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
