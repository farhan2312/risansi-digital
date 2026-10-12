import { desc } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpTestReports } from "@/lib/db/schema";
import { modelDisplayLabel, normalizeModelKey } from "@/lib/modelKey";
import { isReportCategoryKey } from "@/lib/reportCategory";
import { enrichReports } from "@/lib/reportEnrichment";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** Report Archive, grouped by physical pump (same normalizeModelKey match
 * the per-pump dashboard and Report Compilation use) and server-paginated
 * 50 pumps/page -- NOT a plain SQL LIMIT/OFFSET, since which reports belong
 * to which page depends on grouping by a normalized key and on each
 * report's computed requirement status (enrichReports), neither of which
 * is a plain column. Every report is still fetched once here (same cost
 * the old unbounded/500-capped flat list already had), grouped and
 * filtered in memory, and only the current page's ~50 pump groups --
 * including their own full report lists -- cross the wire, instead of up
 * to 500 raw report rows regardless of how many distinct pumps that
 * spanned. */
export async function GET(req: Request) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim().toLowerCase() ?? "";
  // Overview drill-down: only reports whose test date (created date when
  // there is none -- same fallback the dashboard's Reports filed card uses)
  // falls inside the range.
  const dayParam = (key: string) => {
    const v = searchParams.get(key);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };
  const fromDay = dayParam("from");
  const toDay = dayParam("to");
  const rawPage = Number(searchParams.get("page"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rows = await db.select().from(pumpTestReports).orderBy(desc(pumpTestReports.createdAt));
  const enrichedAll = await enrichReports(rows);
  const reportDay = (r: (typeof enrichedAll)[number]) => r.test_date ?? r.created_at?.toISOString().slice(0, 10) ?? "";
  // Every report carries the category it states for itself (its remarks /
  // EC number -- see lib/reportCategory.ts), shown in the archive and used
  // by the Overview's "Reports by category" card and this ?category= filter.
  const categoryParam = searchParams.get("category");
  const categoryFilter = isReportCategoryKey(categoryParam) ? categoryParam : null;
  // Overview's "Requirement results" Met/Missed links: only reports that actually had a rated target
  // to judge (has_target), split on whether every judged field was met.
  const reportResultParam = searchParams.get("report_result");
  const reportResultFilter = reportResultParam === "green" || reportResultParam === "red" ? reportResultParam : null;
  const enriched = enrichedAll
    .filter(
      (r) =>
        (!fromDay || reportDay(r) >= fromDay) &&
        (!toDay || reportDay(r) <= toDay) &&
        (!categoryFilter || r.report_category === categoryFilter) &&
        (!reportResultFilter ||
          (r.has_target && (reportResultFilter === "red" ? r.requirement_unmet_fields.length > 0 : r.requirement_unmet_fields.length === 0)))
    );

  const groups = new Map<string, typeof enriched>();
  for (const r of enriched) {
    const key = normalizeModelKey(r.model);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  // created_at is still a raw Date here (this runs before the response ever
  // hits JSON serialization) -- normalize to the same "YYYY-MM-DD" shape
  // test_date already uses so the two compare/sort correctly together.
  const createdDateOf = (r: (typeof enriched)[number]) => r.created_at?.toISOString().slice(0, 10) ?? "";

  const allGroups = [...groups.values()]
    .map((reports) => {
      const dates = reports.map((r) => r.test_date ?? createdDateOf(r));
      return {
        model: modelDisplayLabel(reports),
        report_count: reports.length,
        total_points: reports.reduce((sum, r) => sum + r.pointCount, 0),
        latest_test_date: dates.sort().at(-1) ?? "-",
        has_observation: reports.some((r) => (r.report_format ?? "observation") === "observation"),
        has_viscosity_chart: reports.some((r) => r.report_format === "viscosity-chart"),
        reports: [...reports].sort((a, b) =>
          (b.test_date ?? createdDateOf(b)).localeCompare(a.test_date ?? createdDateOf(a))
        ),
      };
    })
    .filter(
      (g) =>
        !search ||
        g.model.toLowerCase().includes(search) ||
        g.reports.some((r) => r.ec_no?.toLowerCase().includes(search))
    )
    .sort((a, b) => a.model.localeCompare(b.model));

  const offset = (page - 1) * PAGE_SIZE;
  return json({
    entries: allGroups.slice(offset, offset + PAGE_SIZE),
    total: allGroups.length,
    // Reports (not pumps) across every page, so a range link's "N reports" matches the dashboard card.
    total_reports: allGroups.reduce((sum, g) => sum + g.report_count, 0),
    page,
    page_size: PAGE_SIZE,
  });
}
