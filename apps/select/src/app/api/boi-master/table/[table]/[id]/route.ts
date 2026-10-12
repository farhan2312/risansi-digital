import { eq, getTableName } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { parseBoiBody } from "@/lib/boi-master";
import { boiTable } from "@/lib/boi-tables";
import { BOI_DB } from "@/lib/boi-tables-server";
import { db } from "@/lib/db";
import { auditMasterChange } from "@/lib/master-audit";
import { forgetBoiMasters } from "@/lib/commercial-server";

export const dynamic = "force-dynamic";

// PATCH / DELETE /api/boi-master/table/[table]/[id] — edit or remove a row of
// a BOI Master table (drp-probe | drp-panel | shaft-dia). Admin only.

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

export async function PATCH(req: Request, { params }: { params: Promise<{ table: string; id: string }> }) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  const { table, id } = await params;
  const def = boiTable(table);
  if (!def) return error(`Unknown BOI table "${table}"`, 400);
  if (!UUID_RE.test(id)) return error("Invalid row id", 400);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const parsed = parseBoiBody(def.fields, body, false);
  if ("error" in parsed) return error(parsed.error, 400);
  if (Object.keys(parsed.values).length === 0) return error("No editable fields provided", 400);

  const t = BOI_DB[def.key];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [before] = (await db.select().from(t as any).where(eq(t.id, id)).limit(1)) as any[];
  if (!before) return error("Row not found", 404);
  try {
    const [updated] = (await db
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(t as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set({ ...parsed.values, updatedAt: new Date() } as any)
      .where(eq(t.id, id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .returning()) as any[];
    forgetBoiMasters();
    await auditMasterChange(req, {
      master: `BOI Master · ${def.title}`,
      table: getTableName(t),
      op: "update",
      id,
      label: def.label(updated),
      before,
      after: updated,
    });
    return json(updated);
  } catch (e) {
    if ((e as { code?: string })?.code === "23505") return error("That row already exists.", 409);
    throw e;
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ table: string; id: string }> }) {
  const denied = guardAdmin(req);
  if (denied) return denied;
  const { table, id } = await params;
  const def = boiTable(table);
  if (!def) return error(`Unknown BOI table "${table}"`, 400);
  if (!UUID_RE.test(id)) return error("Invalid row id", 400);

  const t = BOI_DB[def.key];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deleted] = (await db.delete(t as any).where(eq(t.id, id)).returning()) as any[];
  if (!deleted) return error("Row not found", 404);
  forgetBoiMasters();
  await auditMasterChange(req, {
    master: `BOI Master · ${def.title}`,
    table: getTableName(t),
    op: "delete",
    id,
    label: def.label(deleted),
  });
  return json({ id: deleted.id, deleted: true });
}
