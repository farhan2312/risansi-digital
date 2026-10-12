import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// PUT /api/commercial/remarks {projectId, remarks} — the one remarks note for
// the whole Commercial Summary (projects.commercial_remarks). Audited.
export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const projectId = String(body.projectId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return error("'projectId' is required", 400);
  const remarks = typeof body.remarks === "string" ? body.remarks.trim().slice(0, 2000) : "";

  const [p] = await db
    .select({ code: projects.projectCode, remarks: projects.commercialRemarks })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!p) return error("Enquiry not found", 404);
  if ((p.remarks ?? "") === remarks) return json({ ok: true, changed: false });

  await db.update(projects).set({ commercialRemarks: remarks || null }).where(eq(projects.id, projectId));
  await logAudit(req, {
    action: "commercial.remarks",
    entity: "projects",
    entityId: projectId,
    detail: `${p.code}: Commercial Summary remarks ${remarks ? "updated" : "cleared"}`,
  });
  return json({ ok: true, changed: true });
}
