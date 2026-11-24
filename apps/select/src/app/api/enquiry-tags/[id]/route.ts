import { and, eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { enquiryTags } from "@/lib/db/schema";
import { workDenied } from "@/lib/enquiry-access";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const noWork = await workDenied(req, { tagId: id }, "technical");
  if (noWork) return noWork;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const nameRaw = typeof body.name === "string" ? body.name.trim() : "";
  if (!nameRaw) return error("'name' is required", 400);
  if (nameRaw.length > 100) return error("'name' must be 100 characters or fewer", 400);

  const [row] = await db
    .update(enquiryTags)
    .set({ name: nameRaw, updatedAt: new Date() })
    .where(eq(enquiryTags.id, id))
    .returning();
  if (!row) return error("Tag not found", 404);

  return json({
    id: row.id,
    project_id: row.projectId,
    name: row.name,
    created_at: row.createdAt ? row.createdAt.toISOString() : null,
    updated_at: row.updatedAt ? row.updatedAt.toISOString() : null,
  });
}

// Any tag can be deleted, the last one too (user, 2026-11-19): an enquiry may have
// no tags - they are added by hand - and then shows as Pending.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const noWork = await workDenied(req, { tagId: id }, "technical");
  if (noWork) return noWork;

  const [existing] = await db
    .select({ projectId: enquiryTags.projectId })
    .from(enquiryTags)
    .where(eq(enquiryTags.id, id))
    .limit(1);
  if (!existing) return error("Tag not found", 404);

  await db.delete(enquiryTags).where(eq(enquiryTags.id, id));
  return json({ ok: true });
}
