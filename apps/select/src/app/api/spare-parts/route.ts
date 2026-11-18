import { and, asc, eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { sparePartListItems } from "@/lib/db/schema";
import { canEditSpareParts } from "@/lib/roles";
import { OTHER_PART_SECTION, sparePartInput, sparePartListFrom, type SparePart } from "@/lib/spare-parts";

export const dynamic = "force-dynamic";

const asPart = (r: typeof sparePartListItems.$inferSelect): SparePart => ({ id: r.id, section: r.section, part_no: r.partNo, part_name: r.partName });

// GET /api/spare-parts?list=PCP|MMP|OTHER — a spare parts list, in its order (the
// parts added later, under Others, after it).
export async function GET(req: Request) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  const list = sparePartListFrom(new URL(req.url).searchParams.get("list"));
  if (!list) return error("'list' must be PCP, MMP or OTHER", 400);
  const rows = await db
    .select()
    .from(sparePartListItems)
    .where(eq(sparePartListItems.list, list))
    .orderBy(asc(sparePartListItems.seq), asc(sql`lower(${sparePartListItems.partName})`));
  return json(rows.map(asPart));
}

// POST /api/spare-parts {list, partNo, partName} — a part named under Others joins the
// list, for everyone to tick next time. Already there (any case): that one stands.
export async function POST(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  if (!canEditSpareParts(claims.role)) return error("Not available for your role.", 403);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const list = sparePartListFrom(body.list);
  if (!list) return error("'list' must be PCP, MMP or OTHER", 400);
  const input = sparePartInput(body);
  if (typeof input === "string") return error(input, 400);

  const same = and(
    eq(sparePartListItems.list, list),
    sql`lower(btrim(${sparePartListItems.partName})) = lower(${input.partName})`,
    sql`lower(btrim(${sparePartListItems.partNo})) = lower(${input.partNo})`,
  );
  const [had] = await db.select().from(sparePartListItems).where(same).limit(1);
  if (had) return json(asPart(had));
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${sparePartListItems.seq}), -1)::int + 1` })
    .from(sparePartListItems)
    .where(eq(sparePartListItems.list, list));
  const who = /^[0-9a-f-]{36}$/i.test(claims.sub) ? claims.sub : null;
  const [row] = await db
    .insert(sparePartListItems)
    .values({ list, section: OTHER_PART_SECTION, partNo: input.partNo, partName: input.partName, seq: next, updatedBy: who })
    .onConflictDoNothing()
    .returning();
  // Added at the same moment by someone else: theirs stands.
  const saved = row ?? (await db.select().from(sparePartListItems).where(same).limit(1))[0];
  if (!saved) return error("Couldn't add the part.", 500);
  if (row) {
    await logAudit(req, {
      action: "spare_part.added",
      entity: "spare_part_list_items",
      entityId: row.id,
      detail: `${list}: ${[input.partNo, input.partName].filter(Boolean).join(" ")}`,
    });
  }
  return json(asPart(saved));
}
