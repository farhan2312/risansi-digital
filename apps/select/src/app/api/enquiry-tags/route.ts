import { and, asc, eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  enquiryTags,
  generalInfoInput,
  operatingConditionsInput,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Tags scoped to one enquiry. Each tag is an independent pump-selection run
// under the same project - its own wizard, own MOC, own drive picks. The list
// endpoint left-joins general_info_input + operating_conditions_input so the
// projects list can render "Liquid" (from general_info_input.media) and
// "Pump Type" (from operating_conditions_input.pump_type) without a second
// round-trip per tag.

interface TagRow {
  id: string;
  project_id: string;
  name: string;
  /** Pending / In Progress / Completed - flipped by the wizard as the user
   *  progresses through this tag's own steps. */
  status: string;
  liquid: string | null;
  pump_type: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return error("'projectId' query param is required", 400);

  const rows = await db
    .select({
      id: enquiryTags.id,
      projectId: enquiryTags.projectId,
      name: enquiryTags.name,
      status: enquiryTags.status,
      liquid: generalInfoInput.media,
      pumpType: operatingConditionsInput.pumpType,
      createdAt: enquiryTags.createdAt,
      updatedAt: enquiryTags.updatedAt,
    })
    .from(enquiryTags)
    .leftJoin(generalInfoInput, eq(generalInfoInput.tagId, enquiryTags.id))
    .leftJoin(operatingConditionsInput, eq(operatingConditionsInput.tagId, enquiryTags.id))
    .where(eq(enquiryTags.projectId, projectId))
    .orderBy(asc(enquiryTags.createdAt));

  const out: TagRow[] = rows.map((r) => ({
    id: r.id,
    project_id: r.projectId,
    name: r.name,
    status: r.status,
    liquid: r.liquid ?? null,
    pump_type: r.pumpType ?? null,
    created_at: r.createdAt ? r.createdAt.toISOString() : null,
    updated_at: r.updatedAt ? r.updatedAt.toISOString() : null,
  }));
  return json(out);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const nameRaw = typeof body.name === "string" ? body.name.trim() : "";
  if (!projectId) return error("'projectId' is required", 400);
  if (!nameRaw) return error("'name' is required", 400);
  if (nameRaw.length > 100) return error("'name' must be 100 characters or fewer", 400);

  const [row] = await db
    .insert(enquiryTags)
    .values({ projectId, name: nameRaw })
    .returning();

  await logAudit(req, {
    action: "tag.create",
    entity: "enquiry_tags",
    entityId: row.id,
    detail: `Added tag ${row.name}`,
  });

  return json(
    {
      id: row.id,
      project_id: row.projectId,
      name: row.name,
      status: row.status,
      liquid: null,
      pump_type: null,
      created_at: row.createdAt ? row.createdAt.toISOString() : null,
      updated_at: row.updatedAt ? row.updatedAt.toISOString() : null,
    } satisfies TagRow,
    201,
  );
}
