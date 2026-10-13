import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { listDelayLogs } from "@/lib/order-messages";
import { buildDelayLogPdf } from "@/lib/delay-log-pdf";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Not authorized", { status: 401 });

  const { id } = await params;
  // Same lane rule as the on-screen table — a department only ever exports its
  // own delays.
  const report = await listDelayLogs(id, user);
  const soLabel = report.so_no ?? `#${report.sl_no}`;
  const bytes = await buildDelayLogPdf(report);

  const filename = `delay-logs-${soLabel.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
  return new NextResponse(bytes as unknown as ArrayBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
