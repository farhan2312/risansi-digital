import { and, desc, eq, sql } from "drizzle-orm";

import { error, json, isUniqueViolation } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { tryDecodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects, techDocVersion, users } from "@/lib/db/schema";
import { techDocGroups, techDocSheet, type TechDocGroup, type TechDocSheet, type TechDocVersion } from "@/lib/tech-doc";
import { loadTechDocData } from "@/lib/tech-doc-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

async function listVersions(projectId: string): Promise<TechDocVersion[]> {
  const rows = await db
    .select({ v: techDocVersion, by: users.name })
    .from(techDocVersion)
    .leftJoin(users, eq(users.id, techDocVersion.createdBy))
    .where(eq(techDocVersion.projectId, projectId))
    .orderBy(desc(techDocVersion.createdAt));
  return rows.map(({ v, by }) => ({
    id: v.id,
    group: v.driveGroup as TechDocGroup,
    version: v.version,
    note: v.note,
    createdAt: v.createdAt ? v.createdAt.toISOString() : null,
    createdByName: by ?? null,
    sheet: v.snapshot as TechDocSheet,
  }));
}

// GET /api/enquiry-document/versions?projectId=… — every sent version of the
// enquiry's Technical Data Sheets (all drive groups), newest first.
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!UUID.test(projectId)) return error("'projectId' query param is required", 400);
  return json(await listVersions(projectId));
}

// POST /api/enquiry-document/versions {projectId, group, note?} — "Send to
// client": freezes the group's sheet as it is now (built on the server from the
// current data + saved edits) as the next Client version. Audited.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const projectId = String(body.projectId ?? "");
  const group = String(body.group ?? "") as TechDocGroup;
  if (!UUID.test(projectId)) return error("'projectId' is required", 400);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";

  const data = await loadTechDocData(projectId);
  if (!data) return error("Enquiry not found", 404);
  if (!techDocGroups(data).includes(group)) return error("This enquiry has no confirmed tag on that drive system.", 400);
  const sheet = techDocSheet(data, group);
  if (sheet.tags.length === 0) return error("No confirmed tag on this sheet.", 400);

  const claims = tryDecodeToken(req);
  const createdBy = claims?.sub && UUID.test(claims.sub) ? claims.sub : null;
  let version = 0;
  try {
    version = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`techdoc:${projectId}:${group}`}))`);
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${techDocVersion.version}) + 1, 0)` })
        .from(techDocVersion)
        .where(and(eq(techDocVersion.projectId, projectId), eq(techDocVersion.driveGroup, group)));
      await tx.insert(techDocVersion).values({
        projectId,
        driveGroup: group,
        version: Number(next),
        note: note || null,
        snapshot: sheet as unknown as Record<string, unknown>,
        createdBy,
      });
      return Number(next);
    });
  } catch (err) {
    if (isUniqueViolation(err)) return error("Someone sent this sheet at the same moment — try again.", 409);
    throw err;
  }
  const [p] = await db.select({ code: projects.projectCode }).from(projects).where(eq(projects.id, projectId)).limit(1);
  await logAudit(req, {
    action: "tech_doc.send",
    entity: "tech_doc_version",
    entityId: projectId,
    detail: `${p?.code ?? "Enquiry"}: Technical Data Sheet${data.mixed && group !== "NONE" ? ` (${group})` : ""} sent to client as V${version}${note ? ` — ${note}` : ""}`,
  });
  return json(await listVersions(projectId), 201);
}
