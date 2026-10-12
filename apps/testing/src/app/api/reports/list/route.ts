import { desc } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpTestReports } from "@/lib/db/schema";
import { normalizeModelKey } from "@/lib/modelKey";
import { isReportCategoryKey } from "@/lib/reportCategory";
import { enrichReports } from "@/lib/reportEnrichment";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Flat, report-level pagination (50/page) -- unlike GET /api/reports/grouped, which paginates by
 * PUMP (so one expanded pump group can hold far more than 50 reports, e.g. EC Based alone has 300+),
 * this pages through individual reports 50 at a time. Used wherever the point is a straight list of
 * reports rather than a pump-by-pump breakdown -- currently the Overview's "Requirement results"
 * Met/Missed drill-down. Same from/to/category/report_result filters as the grouped route, same
 * has_target rule (a report with no rated target counts as neither met nor missed).
 */
export async function GET(req: Request) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const dayParam = (key: string) => {
    const v = searchParams.get(key);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };
  const fromDay = dayParam("from");
  const toDay = dayParam("to");
  const categoryParam = searchParams.get("category");
  const categoryFilter = isReportCategoryKey(categoryParam) ? categoryParam : null;
  const reportResultParam = searchParams.get("report_result");
  const reportResultFilter = reportResultParam === "green" || reportResultParam === "red" ? reportResultParam : null;
  const modelParam = searchParams.get("model")?.trim();
  const modelKey = modelParam ? normalizeModelKey(modelParam) : null;
  // A report carries no status; "finished testing" reports count as Closed, so any other status has none.
  const statusParam = searchParams.get("status");
  const rawPage = Number(searchParams.get("page"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rows = await db.select().from(pumpTestReports).orderBy(desc(pumpTestReports.createdAt));
  const enrichedAll = await enrichReports(rows);
  const reportDay = (r: (typeof enrichedAll)[number]) => r.test_date ?? r.created_at?.toISOString().slice(0, 10) ?? "";

  const enriched = enrichedAll
    .filter(
      (r) =>
        (!fromDay || reportDay(r) >= fromDay) &&
        (!toDay || reportDay(r) <= toDay) &&
        (!categoryFilter || r.report_category === categoryFilter) &&
        (!modelKey || normalizeModelKey(r.model) === modelKey) &&
        (!statusParam || statusParam === "Closed") &&
        (!reportResultFilter ||
          (r.has_target && (reportResultFilter === "red" ? r.requirement_unmet_fields.length > 0 : r.requirement_unmet_fields.length === 0)))
    )
    .sort((a, b) => reportDay(b).localeCompare(reportDay(a)));

  const offset = (page - 1) * PAGE_SIZE;
  return json({
    entries: enriched.slice(offset, offset + PAGE_SIZE),
    total: enriched.length,
    page,
    page_size: PAGE_SIZE,
  });
}
