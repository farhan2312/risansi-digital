import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getAuditReport } from "@/lib/audit";
import { buildAuditReportPdf } from "@/lib/audit-report-pdf";
import { parseQuery } from "@/lib/pagination";
import {
  AUDIT_CATEGORY_BY_TAB,
  AUDIT_RANGES,
  AUDIT_TABS,
  auditWindow,
  DEFAULT_AUDIT_TAB,
  parseAuditDate,
} from "@/lib/audit-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function day(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The period in words, as the person picked it. */
function describePeriod(range: string, from: string | null, to: string | null): string {
  if (from && to) {
    const [lo, hi] = from > to ? [to, from] : [from, to];
    return lo === hi ? day(lo) : `${day(lo)} – ${day(hi)}`;
  }
  if (from) return `From ${day(from)}`;
  if (to) return `Up to ${day(to)}`;
  const preset = AUDIT_RANGES.find((r) => r.key === range);
  if (!preset || range === "all") return "All time";
  return preset.key === "today" ? "Today" : `Last ${preset.label}`;
}

/**
 * The audit log as a PDF, for exactly what the screen is filtered to: the same
 * tab, period and search. Admin only, like the page itself.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Not signed in", { status: 401 });
  if (user.role !== "admin") return new NextResponse("Not authorized", { status: 403 });

  const p = req.nextUrl.searchParams;
  // Overview, like Usage by User, summarises every event in the period.
  const requested = p.get("tab") ?? DEFAULT_AUDIT_TAB;
  const tab = requested === "overview" ? "by_user" : requested;
  const range = p.get("range") ?? "7d";
  const from = parseAuditDate(p.get("from") ?? undefined);
  const to = parseAuditDate(p.get("to") ?? undefined);
  const search = parseQuery(p.get("q") ?? undefined);

  // The by-user tab is a summary over every event, so its report covers all
  // of them; the event tabs narrow to their own category.
  const category = tab === "by_user" ? null : (AUDIT_CATEGORY_BY_TAB[tab] ?? null);
  const scope =
    tab === "by_user"
      ? "All events"
      : (AUDIT_TABS.find((t) => t.key === tab)?.label ?? "All events");

  const report = await getAuditReport({
    category,
    window: auditWindow(range, from, to),
    search,
  });
  const bytes = await buildAuditReportPdf(report, {
    period: describePeriod(range, from, to),
    scope,
    search: search || null,
    generatedBy: `${user.full_name} (${user.email})`,
    // Order columns only where orders are the subject: the activity tab, and
    // the all-events report taken from Usage by User.
    showSubject: tab === "activity" || tab === "by_user",
  });

  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new NextResponse(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="audit-log-report-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
