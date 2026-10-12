import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { DRIVE_GROUPS } from "@/lib/commercial";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { normalizeTechDocConfig, normalizeTechDocConfigs } from "@/lib/tech-doc";
import { loadTechDocData } from "@/lib/tech-doc-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/enquiry-document?projectId=… — the enquiry's Technical Data Sheet
// data (lib/tech-doc-server.ts loadTechDocData).
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!UUID.test(projectId)) return error("'projectId' query param is required", 400);
  const data = await loadTechDocData(projectId);
  if (!data) return error("Enquiry not found", 404);
  return json(data);
}

// PUT /api/enquiry-document {projectId, group, config} — saves ONE drive
// group's sheet customisation (optional rows added, rows removed, renamed
// labels, edited values, manual rows); the other groups' sheets are kept.
// Stored as {groups: {GM: …, VB: …}}; cleaned by normalizeTechDocConfig.
export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const projectId = String(body.projectId ?? "");
  const group = String(body.group ?? "");
  const sheetKeys = [...DRIVE_GROUPS, "NONE"];
  if (!UUID.test(projectId)) return error("'projectId' is required", 400);
  if (!sheetKeys.includes(group)) return error("'group' must be GM, GB, VB, DD or NONE", 400);
  const config = normalizeTechDocConfig(body.config);
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ config: projects.techDocConfig })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (!row) return false;
    const all = normalizeTechDocConfigs(row.config, sheetKeys);
    all[group] = config;
    await tx
      .update(projects)
      .set({ techDocConfig: { groups: all } as unknown as Record<string, unknown> })
      .where(eq(projects.id, projectId));
    return true;
  });
  if (!saved) return error("Enquiry not found", 404);
  return json({ config });
}
