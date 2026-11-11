import { eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { formatInr } from "@/lib/commercial";
import { db } from "@/lib/db";
import { productPump, projects } from "@/lib/db/schema";
import { viewDenied, workDenied } from "@/lib/enquiry-access";
import { normalizeSpareDocEdits, normalizeSpareQuote, quoteTotal } from "@/lib/spare-quote";
import { termsMarketOf } from "@/lib/spare-terms";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
// As the product code list keeps them (product-pumps route): upper case, no spaces.
const CODE_RE = /^[A-Z0-9][A-Z0-9.\-/]{2,99}$/;

/** Model codes typed on a spare quotation that the product code list doesn't have
 *  yet are added to it, with no pump type (user, 2026-11-11). Returns those added. */
async function addTypedCodes(codes: string[]): Promise<string[]> {
  const wanted = [...new Set(codes.map((c) => c.trim().toUpperCase().replace(/\s+/g, "")).filter((c) => CODE_RE.test(c)))];
  if (!wanted.length) return [];
  const have = await db
    .select({ code: sql<string>`upper(${productPump.productCode})` })
    .from(productPump)
    .where(sql`upper(${productPump.productCode}) in (${sql.join(wanted.map((c) => sql`${c}`), sql`, `)})`);
  const known = new Set(have.map((h) => h.code));
  const fresh = wanted.filter((c) => !known.has(c));
  if (!fresh.length) return [];
  const rows = await db
    .insert(productPump)
    .values(fresh.map((productCode) => ({ productCode, pumpType: "" })))
    .onConflictDoNothing()
    .returning({ productCode: productPump.productCode });
  return rows.map((r) => r.productCode);
}

const load = (projectId: string) =>
  db
    .select({
      code: projects.projectCode,
      name: projects.name,
      enquiryDate: projects.enquiryDate,
      orderType: projects.orderType,
      quote: projects.spareQuote,
      sentAt: projects.sentToClientAt,
      docEdits: projects.spareDocEdits,
      market: projects.clientMarketType,
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
    quote: normalizeSpareQuote(p.quote, termsMarketOf(p.market)),
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
  // Saved versions stay editable: Save Version again replaces the saved copy (user, 2026-11-11).

  const quote = normalizeSpareQuote(body.quote);
  if (quote.models.some((m) => !m.productCode)) return error("Every model needs its code.", 400);
  if (JSON.stringify(normalizeSpareQuote(p.quote, quote.termsMarket)) === JSON.stringify(quote)) return json({ quote, changed: false });

  await db.update(projects).set({ spareQuote: quote, updatedAt: new Date() }).where(eq(projects.id, projectId));
  await logAudit(req, {
    action: "spare_quote.update",
    entity: "projects",
    entityId: projectId,
    detail: `${p.code}: spare quotation saved - ${quote.models.length} model(s), ${quote.models.reduce(
      (s, m) => s + m.lines.length,
      0,
    )} part(s), total ${formatInr(quoteTotal(quote))}`,
  });
  const added = await addTypedCodes(quote.models.map((m) => m.productCode));
  if (added.length) {
    await logAudit(req, {
      action: "product_pump.add",
      entity: "product_pump",
      entityId: added[0],
      detail: `Added pump product code${added.length > 1 ? "s" : ""} ${added.join(", ").slice(0, 400)} (no pump type) from spare quotation ${p.code}`,
    });
  }
  return json({ quote, changed: true });
}
