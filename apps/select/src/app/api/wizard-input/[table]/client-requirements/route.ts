import { asc, eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { resetApprovals } from "@/lib/approval-server";
import { describeTag, logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enquiryTags, mocSealingInput } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Binary storage for the client-supplied requirements file (image or PDF)
// used by the MOC AI request. Kept off the generic JSON [table] endpoint for
// the same reason as /document: raw bytes don't belong in that contract.
// Only "moc-sealing" has these columns; other table keys 404. Keyed by tag.

const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

const MAX_BYTES = 5 * 1024 * 1024;

function guardMocSealing(tableParam: string) {
  return tableParam === "moc-sealing"
    ? null
    : error(`Table "${tableParam}" has no client-requirements file`, 400);
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
      file: mocSealingInput.clientRequirementsFile,
      filename: mocSealingInput.clientRequirementsFilename,
      mime: mocSealingInput.clientRequirementsMime,
    })
    .from(mocSealingInput)
    .where(eq(mocSealingInput.tagId, ctx.tagId))
    .limit(1);

  if (!row || !row.file) {
    return error("No client-requirements file for this tag", 404);
  }

  const filename = (row.filename || "client-requirements").replace(/"/g, "");
  const mime = row.mime || "application/octet-stream";
  return new Response(new Uint8Array(row.file), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": String(row.file.length),
    },
  });
}

// Upload/replace the client-requirements file. Body is the raw bytes with
// filename + mime supplied as query params (same shape as /document).
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

  const filename = url.searchParams.get("filename");
  if (!filename) return error("'filename' query param is required", 400);

  const mime = (url.searchParams.get("mime") || "").toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) {
    return error(
      `Unsupported file type "${mime}". Allowed: ${[...ALLOWED_MIMES].join(", ")}`,
      400,
    );
  }

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) return error("Request body is empty", 400);
  if (bytes.length > MAX_BYTES) {
    return error(`File exceeds ${MAX_BYTES / (1024 * 1024)} MB limit`, 413);
  }

  const uploadedAt = new Date();
  const result = await db
    .insert(mocSealingInput)
    .values({
      projectId: ctx.projectId,
      tagId: ctx.tagId,
      clientRequirementsFile: bytes,
      clientRequirementsFilename: filename,
      clientRequirementsMime: mime,
      clientRequirementsUploadedAt: uploadedAt,
    })
    .onConflictDoUpdate({
      target: mocSealingInput.tagId,
      set: {
        clientRequirementsFile: bytes,
        clientRequirementsFilename: filename,
        clientRequirementsMime: mime,
        clientRequirementsUploadedAt: uploadedAt,
        updatedAt: new Date(),
      },
    })
    .returning({
      clientRequirementsFilename: mocSealingInput.clientRequirementsFilename,
      clientRequirementsMime: mocSealingInput.clientRequirementsMime,
      clientRequirementsUploadedAt: mocSealingInput.clientRequirementsUploadedAt,
    });
  const [row] = result;

  // A new client-requirements file changes what the MOC step says.
  await resetMocApproval(req, ctx.tagId);

  return json(row, 201);
}

/** Sends MOC's approval back to Pending after its attached file changed —
 *  the same rule as a field change on the step (see /api/wizard-input). */
async function resetMocApproval(req: Request, tagId: string) {
  const reset = await resetApprovals(tagId, [4]);
  if (reset.length === 0) return;
  const where = await describeTag(tagId);
  await logAudit(req, {
    action: "approval.reset",
    entity: "step_approval",
    entityId: tagId,
    detail: `${where ? `${where} — ` : ""}Approval reset to Pending after a change: MOC & Elastomer (client requirements file)`,
  });
}

export async function DELETE(
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

  await db
    .update(mocSealingInput)
    .set({
      clientRequirementsFile: null,
      clientRequirementsFilename: null,
      clientRequirementsMime: null,
      clientRequirementsUploadedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(mocSealingInput.tagId, ctx.tagId));

  await resetMocApproval(req, ctx.tagId);

  return json({ ok: true });
}
