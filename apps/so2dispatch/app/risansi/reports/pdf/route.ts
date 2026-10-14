import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { loadSparesReport } from "@/lib/spares-report";
import { parseSparesReportFilter } from "@/lib/spares-report-filter";
import { buildSparesReportPdf } from "@/lib/spares-report-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The Spares report as one PDF — the same filter as the page. Opens in the
 * browser, or saves with ?download=1.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Not authorized", { status: 401 });
  if (user.role !== "admin") return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const filter = parseSparesReportFilter((key) => url.searchParams.get(key));
  const bytes = await buildSparesReportPdf(await loadSparesReport(filter));

  const download = url.searchParams.get("download") === "1";
  return new NextResponse(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="spares-report-${filter.from}-to-${filter.to}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
