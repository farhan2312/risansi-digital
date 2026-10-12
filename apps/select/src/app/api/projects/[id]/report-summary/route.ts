import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Structured snapshot of the confirmed report's content (same data used to
// build the PDF) — lets the Reports list show a read-only summary on click
// without re-parsing the PDF or re-deriving live (possibly since-edited)
// wizard state.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);

  const [row] = await db
    .select({ reportSummary: projects.reportSummary })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (!row || !row.reportSummary) {
    return error("No saved report summary for this project", 404);
  }
  return json(row.reportSummary);
}

// Saves the summary snapshot — called right after uploading the PDF itself
// (see reportsService.uploadFinalReport / saveReportSummary), same
// "Confirm Pump Selection" action.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const [updated] = await db
    .update(projects)
    .set({ reportSummary: body, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning({ id: projects.id });

  if (!updated) return error("Project not found", 404);

  return json({ id: updated.id, saved: true });
}
