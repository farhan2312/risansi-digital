import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { describeTag, logAudit } from "@/lib/audit";
import { enquiryTags } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fetches the saved final Selection Summary PDF for a tag. Reports are now
// per-tag (a project can carry multiple tags, each with its own wizard and
// its own final report), so this replaces the old /api/projects/[id]/report
// route for anything the current client writes.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid tag id", 400);

  const [row] = await db
    .select({
      reportDocument: enquiryTags.reportDocument,
      reportFilename: enquiryTags.reportFilename,
    })
    .from(enquiryTags)
    .where(eq(enquiryTags.id, id))
    .limit(1);

  if (!row || !row.reportDocument) {
    return error("No saved report for this tag", 404);
  }

  const filename = row.reportFilename || "Selection-Summary.pdf";
  return new Response(new Uint8Array(row.reportDocument), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Content-Length": String(row.reportDocument.length),
    },
  });
}

// Uploads the final Selection Summary PDF for a tag - called from "Confirm
// Pump Selection" on the last wizard step. Also flips the tag's status to
// "Completed" (generating the final report is a stronger signal than just
// touching a field, so this is unconditional).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid tag id", 400);

  const filename = new URL(req.url).searchParams.get("filename") || "Selection-Summary.pdf";

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) return error("Request body is empty", 400);

  const [updated] = await db
    .update(enquiryTags)
    .set({
      reportDocument: bytes,
      reportFilename: filename,
      reportGeneratedAt: new Date(),
      status: "Completed",
      updatedAt: new Date(),
    })
    .where(eq(enquiryTags.id, id))
    .returning({
      id: enquiryTags.id,
      reportFilename: enquiryTags.reportFilename,
      reportGeneratedAt: enquiryTags.reportGeneratedAt,
    });

  if (!updated) return error("Tag not found", 404);

  await logAudit(req, {
    action: "report.generate",
    entity: "enquiry_tags",
    entityId: id,
    detail: `${(await describeTag(id)) ?? "Tag"} — generated Selection Summary report`,
  });

  return json(updated, 201);
}
