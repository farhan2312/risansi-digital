import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { workDenied } from "@/lib/enquiry-access";
import { normalizeSpareDocEdits } from "@/lib/spare-quote";

export const dynamic = "force-dynamic";

// PUT /api/spare-quote/doc {projectId, edits} — the spare quotation document's row
// edits (lib/spare-quote-doc.ts). Document only: the saved quote doesn't change.
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

  const [p] = await db
    .select({ code: projects.projectCode, orderType: projects.orderType, sentAt: projects.sentToClientAt, was: projects.spareDocEdits })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!p) return error("Enquiry not found", 404);
  if (p.orderType !== "spare") return error("This enquiry is not a spare order.", 400);
  if (p.sentAt) return error("This quotation's version is saved. To change it, create a new version.", 409);

  const edits = normalizeSpareDocEdits(body.edits);
  if (JSON.stringify(normalizeSpareDocEdits(p.was)) === JSON.stringify(edits)) return json({ edits, changed: false });
  await db.update(projects).set({ spareDocEdits: edits, updatedAt: new Date() }).where(eq(projects.id, projectId));
  await logAudit(req, {
    action: "spare_quote.doc",
    entity: "projects",
    entityId: projectId,
    detail: `${p.code}: spare quotation document edited`,
  });
  return json({ edits, changed: true });
}
