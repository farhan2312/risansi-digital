import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canViewAll } from "@/lib/roles";
import { listOrderExports, listOrderIdsMatching } from "@/lib/orders";
import { buildOneClickWorkbook, buildOneSheet, hideOneColumns } from "@/lib/one-click-export";
import { buildSpareOneSheet } from "@/lib/spare-export";
import { listOneClickStatuses } from "@/lib/one-click-status";
import {
  describeOrderListFilter,
  isOrderListFiltered,
  parseOrderListFilter,
  scopeToRep,
  withOrdersKind,
} from "@/lib/order-list-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many rows the pop-up's preview carries; the download has them all. */
const PREVIEW_ROWS = 200;

/**
 * One Click: everything the Export workbook has, on one sheet — the same
 * filter as the Orders list (and as Export). With view=1, the first rows as
 * JSON for the pop-up that shows them before the download.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canViewAll(user.role)) return new Response("Forbidden", { status: 403 });

  const params = req.nextUrl.searchParams;
  const filter = scopeToRep(
    withOrdersKind(parseOrderListFilter((key) => params.get(key) ?? undefined, { noDispatchTarget: true }), params.get("type")),
    user
  );
  const filtered = isOrderListFiltered(filter) || filter.types.length > 0;
  const ids = filtered ? await listOrderIdsMatching(filter) : undefined;
  // Spare: a row per SO, as Spare is worked now (lots, per-PI payment); Pump keeps the EC rows.
  const spare = filter.types.length === 1 && filter.types[0] === "Spare";
  const orders = await listOrderExports(ids);
  // Each department's status, at the head of its columns.
  const statuses = await listOneClickStatuses(orders.map((o) => String(o.order.id)), spare);
  const sheet = spare ? buildSpareOneSheet(orders, statuses) : buildOneSheet(orders, statuses);
  const scope = describeOrderListFilter(filter);

  if (params.get("view")) {
    const text = (v: unknown) =>
      v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "number" ? v : String(v);
    return Response.json(
      { scope, groups: sheet.groups, total: sheet.rows.length, rowLabel: sheet.rowLabel ?? "one per EC", rows: sheet.rows.slice(0, PREVIEW_ROWS).map((r) => r.map(text)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // The columns hidden in the pop-up stay out of the file.
  const hidden = new Set(
    (params.get("hide") ?? "")
      .split(",")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 0)
  );
  const buffer = await buildOneClickWorkbook(hidden.size ? hideOneColumns(sheet, hidden) : sheet, scope).xlsx.writeBuffer();
  const today = new Date().toISOString().slice(0, 10);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="orders-one-sheet${filtered ? "-filtered" : ""}-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
