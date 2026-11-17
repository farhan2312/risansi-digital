import { and, eq, ne, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AuthError, decodeToken, type TokenClaims } from "@/lib/auth";
import { db } from "@/lib/db";
import { sparePartListItems } from "@/lib/db/schema";
import { canEditSpareParts } from "@/lib/roles";
import { sparePartInput } from "@/lib/spare-parts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

async function editor(req: Request): Promise<TokenClaims | Response> {
  try {
    const claims = await decodeToken(req);
    if (!canEditSpareParts(claims.role)) return error("Not available for your role.", 403);
    return claims;
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
}

const label = (r: { list: string; partNo: string; partName: string }) => `${r.list}: ${[r.partNo, r.partName].filter(Boolean).join(" ")}`;

// PATCH /api/spare-parts/[id] {partNo, partName} — correct a part of a spare parts list.
// Quotations that already have it keep it as it was named.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await editor(req);
  if (claims instanceof Response) return claims;
  const { id } = await params;
  if (!UUID.test(id)) return error("Part not found.", 404);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const input = sparePartInput(body);
  if (typeof input === "string") return error(input, 400);
  const [cur] = await db.select().from(sparePartListItems).where(eq(sparePartListItems.id, id)).limit(1);
  if (!cur) return error("Part not found.", 404);
  const [clash] = await db
    .select({ id: sparePartListItems.id })
    .from(sparePartListItems)
    .where(
      and(
        eq(sparePartListItems.list, cur.list),
        ne(sparePartListItems.id, id),
        sql`lower(btrim(${sparePartListItems.partName})) = lower(${input.partName})`,
        sql`lower(btrim(${sparePartListItems.partNo})) = lower(${input.partNo})`,
      ),
    )
    .limit(1);
  if (clash) return error("That part is already in the list.", 409);
  const [row] = await db
    .update(sparePartListItems)
    .set({ partNo: input.partNo, partName: input.partName, updatedBy: UUID.test(claims.sub) ? claims.sub : null, updatedAt: new Date() })
    .where(eq(sparePartListItems.id, id))
    .returning();
  if (!row) return error("Part not found.", 404);
  await logAudit(req, { action: "spare_part.updated", entity: "spare_part_list_items", entityId: id, detail: `${label(cur)} -> ${label(row)}` });
  return json({ id: row.id, section: row.section, part_no: row.partNo, part_name: row.partName });
}

// DELETE /api/spare-parts/[id] — take a part off its list. Quotations that have it keep it.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const claims = await editor(req);
  if (claims instanceof Response) return claims;
  const { id } = await params;
  if (!UUID.test(id)) return error("Part not found.", 404);
  const [row] = await db.delete(sparePartListItems).where(eq(sparePartListItems.id, id)).returning();
  if (!row) return error("Part not found.", 404);
  await logAudit(req, { action: "spare_part.deleted", entity: "spare_part_list_items", entityId: id, detail: label(row) });
  return json({ ok: true });
}
