import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { tryDecodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { workDenied } from "@/lib/enquiry-access";
import { enquiryNoWithVersion } from "@/lib/roles";

export const dynamic = "force-dynamic";

// PUT /api/commercial/reviewed {projectId, reviewed} — the Prices reviewed tick on
// a new version: prices copied from the version before can't all be checked
// automatically (Strainer, PRV and Other items aren't linked to the pump selection),
// so someone confirms them before Send to client. Audited.
export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const projectId = String(body.projectId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return error("'projectId' is required", 400);
  const noWork = await workDenied(req, { projectId });
  if (noWork) return noWork;
  const reviewed = body.reviewed === true;

  const [p] = await db.select({ code: projects.projectCode, version: projects.versionNo }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) return error("Enquiry not found", 404);

  const claims = await tryDecodeToken(req);
  const now = new Date();
  await db
    .update(projects)
    .set({ pricesReviewedAt: reviewed ? now : null, pricesReviewedBy: reviewed ? (claims?.sub ?? null) : null })
    .where(eq(projects.id, projectId));
  await logAudit(req, {
    action: "commercial.reviewed",
    entity: "projects",
    entityId: projectId,
    detail: `${enquiryNoWithVersion(p.code, p.version)}: prices ${reviewed ? "marked as reviewed" : "no longer marked as reviewed"}`,
  });
  return json({ pricesReviewedAt: reviewed ? now.toISOString() : null });
}
