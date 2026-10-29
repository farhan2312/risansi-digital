import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isCentral } from "@/lib/roles";
import { listOrderGapSheet } from "@/lib/order-gaps";
import { buildGapWorkbook } from "@/lib/gap-export";

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
  // ?scope=so: every SO with its SO No., not only the open ones.
  const everySo = params.get("scope") === "so";
  const sheet = await listOrderGapSheet({ search, type, everySo });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const scope = `${everySo ? "Every SO with an SO No." : `${type ?? "All"} SOs`}${search ? ` matching "${search}"` : ""} · ${today}`;
  const buffer = await buildGapWorkbook(sheet, scope).xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="details-not-filled-${(type ?? "all").toLowerCase()}-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
