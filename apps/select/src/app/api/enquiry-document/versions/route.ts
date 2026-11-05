import { and, desc, eq, sql } from "drizzle-orm";

import { error, json, isUniqueViolation } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { tryDecodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { enquiryTags, projects, quotation, techDocVersion, users } from "@/lib/db/schema";
import { sameTechDocSheet, techDocGroups, techDocSheet, type TechDocGroup, type TechDocSheet, type TechDocVersion } from "@/lib/tech-doc";
import { loadTechDocData } from "@/lib/tech-doc-server";
import { workDenied, viewDenied } from "@/lib/enquiry-access";
import { REVIEW_CLEARED } from "@/lib/enquiry-filters-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

async function listSends(projectId: string): Promise<TechDocVersion[]> {
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

// GET /api/enquiry-document/versions?projectId=… — every time the enquiry's
// Technical Data Sheets (all drive groups) were saved (Save Version), newest first.
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!UUID.test(projectId)) return error("'projectId' query param is required", 400);
  const notYours = await viewDenied(req, { projectId });
  if (notYours) return notYours;
  return json(await listSends(projectId));
}

// POST /api/enquiry-document/versions {projectId, group, note?} — "Save Version":
// records the group's sheet as it is now (built on the server from
// the current data + saved edits). Nothing is e-mailed. It can be saved again once the
// sheet has changed. When every sheet of the enquiry is saved, the technical
// step is done (projects.sent_to_operation_at, lib/enquiry-filters-server.ts).
// Audited.
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
  const noWork = await workDenied(req, { projectId });
  if (noWork) return noWork;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";

  const data = await loadTechDocData(projectId);
  if (!data) return error("Enquiry not found", 404);
  const groups = techDocGroups(data);
  if (!groups.includes(group)) return error("This enquiry has no confirmed tag on that drive system.", 400);
  const sheet = techDocSheet(data, group);
  if (sheet.tags.length === 0) return error("No confirmed tag on this sheet.", 400);

  const [tags, [quote]] = await Promise.all([
    db.select({ status: enquiryTags.status }).from(enquiryTags).where(eq(enquiryTags.projectId, projectId)),
    db.select({ id: quotation.id }).from(quotation).where(eq(quotation.projectId, projectId)).limit(1),
  ]);
  if (tags.some((t) => t.status !== "Completed")) return error("Complete every tag of the enquiry before saving the version.", 409);
  if (!quote) return error("Generate the quotation before saving the version.", 409);

  const claims = await tryDecodeToken(req);
  const createdBy = claims?.sub && UUID.test(claims.sub) ? claims.sub : null;
  const needed = groups.filter((g) => techDocSheet(data, g).tags.length > 0);
  let unchanged = false;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`techdoc:${projectId}:${group}`}))`);
      const here = and(eq(techDocVersion.projectId, projectId), eq(techDocVersion.driveGroup, group));
      const [last] = await tx
        .select({ snapshot: techDocVersion.snapshot })
        .from(techDocVersion)
        .where(here)
        .orderBy(desc(techDocVersion.version))
        .limit(1);
      if (last && sameTechDocSheet(last.snapshot, sheet)) {
        unchanged = true;
        return;
      }
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${techDocVersion.version}) + 1, 0)` })
        .from(techDocVersion)
        .where(here);
      await tx.insert(techDocVersion).values({
        projectId,
        driveGroup: group,
        version: Number(next),
        note: note || null,
        snapshot: sheet as unknown as Record<string, unknown>,
        createdBy,
      });
      await tx.update(projects).set(REVIEW_CLEARED).where(eq(projects.id, projectId));
      const sent = await tx.selectDistinct({ group: techDocVersion.driveGroup }).from(techDocVersion).where(eq(techDocVersion.projectId, projectId));
      if (needed.every((g) => sent.some((s) => s.group === g))) {
        // The first time sets the completion date; saving again after an edit
        // keeps it. A status changed by hand to not done, or to Not Quoted, gives way to the save.
        await tx
          .update(projects)
          .set({
            sentToOperationAt: sql`coalesce(${projects.sentToOperationAt}, now())`,
            technicalStatusOverride: sql`nullif(nullif(nullif(${projects.technicalStatusOverride}, 'Pending'), 'In Progress'), 'Not Quoted')`,
          })
          .where(eq(projects.id, projectId));
      }
    });
  } catch (err) {
    if (isUniqueViolation(err)) return error("Someone saved this sheet at the same moment — try again.", 409);
    throw err;
  }
  if (unchanged) return error("Nothing has changed on this sheet since it was last saved.", 409);

  const [p] = await db.select({ code: projects.projectCode }).from(projects).where(eq(projects.id, projectId)).limit(1);
  await logAudit(req, {
    action: "tech_doc.send",
    entity: "tech_doc_version",
    entityId: projectId,
    detail: `${p?.code ?? "Enquiry"}: Technical Data Sheet${data.mixed && group !== "NONE" ? ` (${group})` : ""} saved as V${data.versionNo}${note ? ` — ${note}` : ""}`,
  });
  return json(await listSends(projectId), 201);
}
