import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canAccessOrderMaking, isOrderMakingSo } from "@/lib/roles";
import { listOrdersForOrderMaking } from "@/lib/orders";
import { parseQuery } from "@/lib/pagination";
import { isOrderMakingFiltered, parseOrderMakingFilter } from "@/lib/order-making-filter";
import { buildOrderMakingWorkbook } from "@/lib/order-making-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Order Making's list as an Excel sheet: the same filters and search as the
 * page, every page of it, one row per EC. An Order Making SO member gets only
 * the SOs assigned to them, as on the page.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessOrderMaking(user.role)) return new Response("Forbidden", { status: 403 });

  const params = req.nextUrl.searchParams;
  const filter = parseOrderMakingFilter((key) => params.get(key) ?? undefined);
  const soMember = isOrderMakingSo(user.role);
  const search = parseQuery(params.get("q") ?? undefined);
  const { rows } = await listOrdersForOrderMaking({
    page: 1,
    all: true,
    search,
    filter: soMember ? { ...filter, assignees: [] } : filter,
    assigneeScope: soMember ? user.id : undefined,
  });

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const filtered = isOrderMakingFiltered(filter) || !!search;
  const scope = `${filtered ? "filtered view" : "all SOs"}${search ? ` matching "${search}"` : ""} · ${rows.length} SOs · ${today}`;
  const buffer = await buildOrderMakingWorkbook(rows, scope).xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="order-making${filtered ? "-filtered" : ""}-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
