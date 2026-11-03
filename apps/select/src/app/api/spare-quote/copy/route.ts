import { eq, inArray } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { viewDenied, workDenied } from "@/lib/enquiry-access";
import { enquiryNoWithVersion } from "@/lib/roles";
import { normalizeSpareQuote } from "@/lib/spare-quote";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/spare-quote/copy {sourceProjectId, targetProjectId} — adds a spare
// enquiry's models and parts, with quantities and prices, to another spare enquiry.
// The reference PO and the quotation belong to the enquiry, so they stay. Audited.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const sourceId = String(body.sourceProjectId ?? "");
  const targetId = String(body.targetProjectId ?? "");
  if (!UUID.test(sourceId) || !UUID.test(targetId)) return error("'sourceProjectId' and 'targetProjectId' are required", 400);
  if (sourceId === targetId) return error("Pick a different enquiry to copy into.", 400);
  const notYours = await viewDenied(req, { projectId: sourceId });
  if (notYours) return notYours;
  const noWork = await workDenied(req, { projectId: targetId });
  if (noWork) return noWork;

  const rows = await db
    .select({ id: projects.id, code: projects.projectCode, version: projects.versionNo, orderType: projects.orderType, quote: projects.spareQuote, sentAt: projects.sentToClientAt })
    .from(projects)
    .where(inArray(projects.id, [sourceId, targetId]));
  const source = rows.find((r) => r.id === sourceId);
  const target = rows.find((r) => r.id === targetId);
  if (!source || !target) return error("Enquiry not found", 404);
  if (source.orderType !== "spare" || target.orderType !== "spare") return error("Both enquiries must be spare orders.", 400);

  if (target.sentAt) return error("That enquiry's quotation was already sent to the client.", 409);

  const from = normalizeSpareQuote(source.quote);
  if (from.models.length === 0) return error("This enquiry has no models to copy yet.", 400);
  const into = normalizeSpareQuote(target.quote);
  const quote = { ...into, models: [...into.models, ...from.models.map((m) => ({ ...m, id: crypto.randomUUID() }))] };
  await db.update(projects).set({ spareQuote: quote, updatedAt: new Date() }).where(eq(projects.id, targetId));

  await logAudit(req, {
    action: "spare_quote.copy",
    entity: "projects",
    entityId: targetId,
    detail: `${enquiryNoWithVersion(target.code, target.version)}: copied ${from.models.length} model(s) and their parts from ${enquiryNoWithVersion(source.code, source.version)}`,
  });
  return json({ ok: true, models: from.models.length });
}
