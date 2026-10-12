import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { error } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { bugReports } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { id } = await params;
  const [report] = await db.select().from(bugReports).where(eq(bugReports.id, id)).limit(1);
  if (!report || !report.screenshotData) return error("Screenshot not found", 404);

  const bytes = report.screenshotData;
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": report.screenshotMimeType ?? "application/octet-stream",
      "Content-Length": String(report.screenshotFileSize ?? bytes.byteLength),
      "Content-Disposition": `inline; filename="${encodeURIComponent(report.screenshotFileName ?? "screenshot")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
