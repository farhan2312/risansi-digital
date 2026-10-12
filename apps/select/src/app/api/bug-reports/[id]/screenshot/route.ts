import { eq } from "drizzle-orm";

import { error } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { bugReportSelection } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fetches a report's screenshot as raw bytes — split out of the JSON list/get
// routes so the binary doesn't have to round-trip as base64 in a big JSON
// payload (same pattern as the MOC PDF document route). Viewable by a
// system_admin (Bug Tracker) or by the reporter themselves.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let claims;
  try {
    claims = decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid report id", 400);

  const [row] = await db
    .select({
      screenshotData: bugReportSelection.screenshotData,
      screenshotMimeType: bugReportSelection.screenshotMimeType,
      screenshotFileName: bugReportSelection.screenshotFileName,
      reportedBy: bugReportSelection.reportedBy,
    })
    .from(bugReportSelection)
    .where(eq(bugReportSelection.id, id))
    .limit(1);

  if (!row || !row.screenshotData) return error("No screenshot for this report", 404);

  const isOwner = row.reportedBy && row.reportedBy === claims.sub;
  const isAdmin = claims.role === "system_admin";
  if (!isOwner && !isAdmin) return error("Forbidden", 403);

  const filename = row.screenshotFileName || "screenshot.png";
  return new Response(new Uint8Array(row.screenshotData), {
    status: 200,
    headers: {
      "Content-Type": row.screenshotMimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      "Content-Length": String(row.screenshotData.length),
    },
  });
}
