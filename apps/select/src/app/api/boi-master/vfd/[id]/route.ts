import { eq, getTableName } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { parseVfdBody, vfdLabel } from "@/lib/boi-vfd";
import { db } from "@/lib/db";
import { boiVfd } from "@/lib/db/schema";
import { auditMasterChange } from "@/lib/master-audit";
import { forgetBoiMasters } from "@/lib/commercial-server";

export const dynamic = "force-dynamic";

// PATCH / DELETE /api/boi-master/vfd/[id] — edit or remove a VFD row. Admin only.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function guardAdmin(req: Request): Response | null {
  try {
    requireAdmin(req);
    return null;
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid row id", 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const parsed = parseVfdBody(body, false);
  if ("error" in parsed) return error(parsed.error, 400);
  if (Object.keys(parsed.values).length === 0) return error("No editable fields provided", 400);

  const [before] = await db.select().from(boiVfd).where(eq(boiVfd.id, id)).limit(1);
  if (!before) return error("Row not found", 404);

  try {
    const [updated] = await db
      .update(boiVfd)
      .set({ ...parsed.values, updatedAt: new Date() })
      .where(eq(boiVfd.id, id))
      .returning();
    forgetBoiMasters();
    await auditMasterChange(req, {
      master: "BOI Master",
      table: getTableName(boiVfd),
      op: "update",
      id,
      label: vfdLabel(updated),
      before,
      after: updated,
    });
    return json(updated);
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") return error("A VFD with this drive description already exists.", 409);
    throw e;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid row id", 400);

  const [deleted] = await db.delete(boiVfd).where(eq(boiVfd.id, id)).returning();
  if (!deleted) return error("Row not found", 404);
  forgetBoiMasters();
  await auditMasterChange(req, {
    master: "BOI Master",
    table: getTableName(boiVfd),
    op: "delete",
    id,
    label: vfdLabel(deleted),
  });
  return json({ id: deleted.id, deleted: true });
}
