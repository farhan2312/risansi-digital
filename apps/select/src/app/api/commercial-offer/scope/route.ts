import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { DRIVE_GROUPS, isDriveGroup } from "@/lib/commercial";
import { MAX_SCOPE_LINE, normalizeOfferConfigs } from "@/lib/commercial-offer";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const line = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, MAX_SCOPE_LINE) : "");

// PUT /api/commercial-offer/scope {projectId, group, scopeText, outOfScopeText}
// The Scope of supply / Out of scope lines typed on a document ("" = from the
// scope pickers). Only these two fields of the group's offer config change,
// so the Technical Data Sheet can set them without touching the rest.
export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const projectId = String(body.projectId ?? "");
  const group = String(body.group ?? "");
  if (!UUID.test(projectId)) return error("'projectId' is required", 400);
  if (!isDriveGroup(group)) return error("'group' must be GM, GB, VB or DD", 400);
  const scopeText = line(body.scopeText);
  const outOfScopeText = line(body.outOfScopeText);

  const saved = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ config: projects.commercialOfferConfig })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (!row) return false;
    const all = normalizeOfferConfigs(row.config, [...DRIVE_GROUPS]);
    all[group] = { ...all[group], scopeText, outOfScopeText };
    await tx
      .update(projects)
      .set({ commercialOfferConfig: { groups: all } as unknown as Record<string, unknown> })
      .where(eq(projects.id, projectId));
    return true;
  });
  if (!saved) return error("Enquiry not found", 404);
  return json({ scopeText, outOfScopeText });
}
