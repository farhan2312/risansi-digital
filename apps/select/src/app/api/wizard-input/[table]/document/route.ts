import { asc, eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { enquiryTags, mocSealingInput } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Binary storage for the generated MOC PDF report - split out of the generic
// [table] route (which is JSON-only) since raw bytes don't belong in that
// contract. Only "moc-sealing" has a document column today; other table
// keys 404 here rather than pretending to support this. Keyed by tag (a tag
// is one pump-selection run) - `projectId` is still accepted as a fallback
// that resolves to the project's oldest tag, so a legacy caller still lands
// on its Default tag automatically.
function guardMocSealing(tableParam: string) {
  return tableParam === "moc-sealing" ? null : error(`Table "${tableParam}" has no document`, 400);
}

async function resolveTagContext(
  tagId: string | null,
  projectId: string | null,
): Promise<{ tagId: string; projectId: string } | null> {
  if (tagId) {
    const [row] = await db
      .select({ id: enquiryTags.id, projectId: enquiryTags.projectId })
      .from(enquiryTags)
      .where(eq(enquiryTags.id, tagId))
      .limit(1);
    if (!row) return null;
    return { tagId: row.id, projectId: row.projectId };
  }
  if (projectId) {
    const [row] = await db
      .select({ id: enquiryTags.id, projectId: enquiryTags.projectId })
      .from(enquiryTags)
      .where(eq(enquiryTags.projectId, projectId))
      .orderBy(asc(enquiryTags.createdAt))
      .limit(1);
    if (!row) return null;
    return { tagId: row.id, projectId: row.projectId };
  }
  return null;
}

// Fetches the saved MOC PDF report's raw bytes, for direct download.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table: tableParam } = await params;
  const denied = guardMocSealing(tableParam);
  if (denied) return denied;

  const url = new URL(req.url);
  const ctx = await resolveTagContext(
    url.searchParams.get("tagId"),
    url.searchParams.get("projectId"),
  );
  if (!ctx) return error("'tagId' (or 'projectId' as fallback) is required", 400);

  const [row] = await db
    .select({
      document: mocSealingInput.document,
      documentFilename: mocSealingInput.documentFilename,
    })
    .from(mocSealingInput)
    .where(eq(mocSealingInput.tagId, ctx.tagId))
    .limit(1);

  if (!row || !row.document) {
    return error("No saved document for this tag", 404);
  }

  const filename = row.documentFilename || "MOC-Report.pdf";
  return new Response(new Uint8Array(row.document), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Content-Length": String(row.document.length),
    },
  });
}

// Uploads the generated MOC PDF report's raw bytes (Content-Type:
// application/pdf body, not JSON) and upserts it into moc_sealing_input for
// the given tag. The row may not exist yet if this is the first save for the
// tag - the upsert handles that.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table: tableParam } = await params;
  const denied = guardMocSealing(tableParam);
  if (denied) return denied;

  const url = new URL(req.url);
  const ctx = await resolveTagContext(
    url.searchParams.get("tagId"),
    url.searchParams.get("projectId"),
  );
  if (!ctx) return error("'tagId' (or 'projectId' as fallback) is required", 400);

  const filename = url.searchParams.get("filename") || "MOC-Report.pdf";

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) return error("Request body is empty", 400);

  const result = await db
    .insert(mocSealingInput)
    .values({
      projectId: ctx.projectId,
      tagId: ctx.tagId,
      document: bytes,
      documentFilename: filename,
      documentGeneratedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: mocSealingInput.tagId,
      set: {
        document: bytes,
        documentFilename: filename,
        documentGeneratedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning({
      id: mocSealingInput.id,
      documentFilename: mocSealingInput.documentFilename,
      documentGeneratedAt: mocSealingInput.documentGeneratedAt,
    });
  const [row] = result;

  return json(row, 201);
}
