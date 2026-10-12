import { and, eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { enquiryTags } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

// Guard: refuse to delete the last tag on an enquiry - a project must always
// have at least one tag, otherwise the wizard has nothing to key on.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const [existing] = await db
    .select({ projectId: enquiryTags.projectId })
    .from(enquiryTags)
    .where(eq(enquiryTags.id, id))
    .limit(1);
  if (!existing) return error("Tag not found", 404);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(enquiryTags)
    .where(eq(enquiryTags.projectId, existing.projectId));
  if (count <= 1) {
    return error("Can't delete the last tag on an enquiry - add another first", 409);
  }

  await db.delete(enquiryTags).where(eq(enquiryTags.id, id));
  return json({ ok: true });
}
