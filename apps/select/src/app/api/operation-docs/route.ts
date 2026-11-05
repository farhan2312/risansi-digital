import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { erpQuotationNumber, quotationNumber } from "@/lib/commercial";
import { projects, quotation, quotationVersion, techDocVersion, users } from "@/lib/db/schema";
import { canSeeOperationDocs } from "@/lib/roles";
import type { OperationDoc } from "@/lib/saved-docs";
import { dotDate } from "@/lib/tech-doc";

export const dynamic = "force-dynamic";

const reviewer = alias(users, "reviewer");
const sender = alias(users, "sender");
const mailer = alias(users, "mailer");

/** Per enquiry version, its quotations' lines as the saved documents print them: what was
 *  typed on the sheet when it was saved, else the ERP no. (else the portal's) and date. */
async function savedQuotationLines(projectIds: string[]): Promise<Map<string, string[]>> {
  const lines = new Map<string, string[]>();
  if (projectIds.length === 0) return lines;
  const quotes = await db.select().from(quotation).where(inArray(quotation.projectId, projectIds)).orderBy(asc(quotation.driveGroup));
  const saved = await db
    .select({ quotationId: quotationVersion.quotationId, typed: sql<string | null>`${quotationVersion.snapshot}->'offer'->>'erpText'` })
    .from(quotationVersion)
    .where(and(inArray(quotationVersion.quotationId, quotes.map((q) => q.id)), eq(quotationVersion.track, "client")))
    .orderBy(asc(quotationVersion.createdAt));
  for (const q of quotes) {
    const rows = saved.filter((s) => s.quotationId === q.id);
    if (rows.length === 0) continue;
    const mixed = quotes.filter((x) => x.projectId === q.projectId).length > 1;
    const line = rows.at(-1)!.typed || `${erpQuotationNumber(q, mixed) ?? quotationNumber(q, mixed)}, Dt. ${dotDate(q.quoteDate)}`;
    lines.set(q.projectId, [...(lines.get(q.projectId) ?? []), line]);
  }
  return lines;
}

// GET /api/operation-docs?type=pump|spare&mine=1 — the enquiry versions reviewed and sent
// to operation, newest send first, one row each. An older version stays here after a new
// one is made; only what was sent to operation shows.
// mine=1: the enquiries the caller created (V0's creator; a new version's differs).
export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  if (!canSeeOperationDocs(claims.role)) return error("Not available for your role.", 403);
  const params = new URL(req.url).searchParams;
  const type = params.get("type");
  const mine = params.get("mine") === "1";
  if (type !== "pump" && type !== "spare") return error("'type' must be pump or spare", 400);

  const rows = await db
    .select({
      id: projects.id,
      projectCode: projects.projectCode,
      enquiryDate: projects.enquiryDate,
      clientName: projects.name,
      clientCode: projects.clientCode,
      primaryRep: projects.clientPrimaryRep,
      secondaryReps: projects.clientSecondaryReps,
      zone: projects.clientZone,
      typedOnSpareDoc: sql<string | null>`${projects.spareDocEdits}->>'quotation'`,
      version: projects.versionNo,
      commercialVersion: projects.commercialVersionNo,
      reviewedAt: projects.reviewedAt,
      reviewedByName: reviewer.name,
      sentAt: projects.releasedToOperationAt,
      sentByName: sender.name,
      mailedAt: projects.mailedAt,
      mailedByName: mailer.name,
      // A pump other than PCP may have no Technical Data Sheet to save.
      hasTechnical: sql<boolean>`exists (select 1 from ${techDocVersion} s where s.project_id = ${projects.id})`,
    })
    .from(projects)
    .leftJoin(reviewer, eq(reviewer.id, projects.reviewedBy))
    .leftJoin(sender, eq(sender.id, projects.releasedToOperationBy))
    .leftJoin(mailer, eq(mailer.id, projects.mailedBy))
    .where(
      and(
        isNotNull(projects.releasedToOperationAt),
        eq(projects.orderType, type),
        mine ? sql`(select v0.created_by from projects v0 where v0.id = coalesce(${projects.rootProjectId}, ${projects.id})) = ${claims.sub}` : undefined,
      ),
    )
    .orderBy(desc(projects.releasedToOperationAt));

  const quotations = await savedQuotationLines(rows.map((r) => r.id));
  const list: OperationDoc[] = rows.map(({ version, commercialVersion, reviewedAt, sentAt, mailedAt, typedOnSpareDoc, ...r }) => ({
    ...r,
    quotations: typedOnSpareDoc ? [typedOnSpareDoc] : (quotations.get(r.id) ?? []),
    version: type === "spare" ? commercialVersion : version,
    reviewedAt: reviewedAt?.toISOString() ?? null,
    sentAt: sentAt!.toISOString(),
    mailedAt: mailedAt?.toISOString() ?? null,
  }));
  return json(list);
}
