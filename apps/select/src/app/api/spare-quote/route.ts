import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { formatInr } from "@/lib/commercial";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { viewDenied, workDenied } from "@/lib/enquiry-access";
import { enquiryNoWithVersion } from "@/lib/roles";
import { normalizeSpareDocEdits, normalizeSpareQuote, quoteTotal } from "@/lib/spare-quote";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

const load = (projectId: string) =>
  db
    .select({
      code: projects.projectCode,
      version: projects.versionNo,
      name: projects.name,
      enquiryDate: projects.enquiryDate,
      orderType: projects.orderType,
      quote: projects.spareQuote,
      sentAt: projects.sentToClientAt,
      docEdits: projects.spareDocEdits,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

// GET /api/spare-quote?projectId=… — a spare enquiry's quotation lines
// (lib/spare-quote.ts) and what its document's header needs.
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!UUID.test(projectId)) return error("'projectId' query param is required", 400);
  const notYours = await viewDenied(req, { projectId });
  if (notYours) return notYours;
  const [p] = await load(projectId);
  if (!p) return error("Enquiry not found", 404);
  return json({
    quote: normalizeSpareQuote(p.quote),
    docEdits: normalizeSpareDocEdits(p.docEdits),
    enquiryNo: p.code,
    enquiryDate: p.enquiryDate,
    clientName: p.name,
  });
}

// PUT /api/spare-quote {projectId, quote} — saves it whole. Audited.
export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const projectId = String(body.projectId ?? "");
  if (!UUID.test(projectId)) return error("'projectId' is required", 400);
  const noWork = await workDenied(req, { projectId });
  if (noWork) return noWork;
  const [p] = await load(projectId);
  if (!p) return error("Enquiry not found", 404);
  if (p.orderType !== "spare") return error("This enquiry is not a spare order.", 400);
  if (p.sentAt) return error("This quotation was sent to the client. To change it, create a new version.", 409);

  const quote = normalizeSpareQuote(body.quote);
  if (quote.models.some((m) => !m.productCode)) return error("Every model needs its code.", 400);
  if (JSON.stringify(normalizeSpareQuote(p.quote)) === JSON.stringify(quote)) return json({ quote, changed: false });

  await db.update(projects).set({ spareQuote: quote, updatedAt: new Date() }).where(eq(projects.id, projectId));
  await logAudit(req, {
    action: "spare_quote.update",
    entity: "projects",
    entityId: projectId,
    detail: `${enquiryNoWithVersion(p.code, p.version)}: spare quotation saved - ${quote.models.length} model(s), ${quote.models.reduce(
      (s, m) => s + m.lines.length,
      0,
    )} part(s), total ${formatInr(quoteTotal(quote))}`,
  });
  return json({ quote, changed: true });
}
