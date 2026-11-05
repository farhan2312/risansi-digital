import { and, desc, eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { tryDecodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects, quotation, quotationVersion } from "@/lib/db/schema";
import { SPARE_GROUP, formatInr, quotationNumber, sendToClientBlock, type QuotationSnapshot } from "@/lib/commercial";
import { normalizeSpareQuote, spareQuoteProblem } from "@/lib/spare-quote";
import { loadCommercialSummary, projectDriveGroups } from "@/lib/commercial-server";
import { buildSnapshot, freezeLiveInternal, loadQuotation } from "@/lib/quotation-server";
import { sameTechDocSheet } from "@/lib/tech-doc";
import { workDenied } from "@/lib/enquiry-access";
import { REVIEW_CLEARED } from "@/lib/enquiry-filters-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/quotations/[id]/send — "Save Version Vn", on a pump's quotation and a
// spare's. It makes the CLIENT version numbered as the enquiry's
// Commercial version (Enquiry V1 = Client V1, gaps where a version wasn't sent), with
// a frozen copy of the prices. What is sent is the live internal version, which
// freezes with it. A pump has one client version per enquiry version: sending again
// (only once the prices or documents have changed) overwrites it and the internal
// version it names, so mistakes can be corrected; the audit trail keeps the old total.
// A spare goes once per enquiry version. Nothing is e-mailed. When every drive group
// in use has gone from this version of the enquiry,
// the commercial step is done (projects.sent_to_client_at, lib/enquiry-filters-server.ts).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return error("Invalid quotation id", 400);
  const noWork = await workDenied(req, { quotationId: id });
  if (noWork) return noWork;
  const [current] = await db.select().from(quotation).where(eq(quotation.id, id)).limit(1);
  if (!current) return error("Quotation not found", 404);

  const [snapshot, groups] = await Promise.all([buildSnapshot(current.projectId, current.driveGroup), projectDriveGroups(current.projectId)]);
  const spare = current.driveGroup === SPARE_GROUP;
  if (spare) {
    const [row] = await db.select({ quote: projects.spareQuote }).from(projects).where(eq(projects.id, current.projectId)).limit(1);
    const problem = spareQuoteProblem(normalizeSpareQuote(row?.quote));
    if (problem) return error(problem, 409);
  } else if (snapshot.tags.length === 0) return error("This enquiry has no tags to quote.", 400);
  const summary = await loadCommercialSummary(current.projectId);
  const blocked = summary && sendToClientBlock(summary, current.driveGroup);
  if (blocked) return error(blocked, 409);

  const claims = await tryDecodeToken(req);
  const createdBy = claims?.sub && UUID.test(claims.sub) ? claims.sub : null;

  const result = await db.transaction(async (tx) => {
    const [q] = await tx.select().from(quotation).where(eq(quotation.id, id)).for("update");
    // A pump's send in this enquiry version, if there was one.
    const [earlier] = spare
      ? []
      : await tx
          .select({ id: quotationVersion.id, version: quotationVersion.version, snapshot: quotationVersion.snapshot })
          .from(quotationVersion)
          .where(and(eq(quotationVersion.quotationId, id), eq(quotationVersion.track, "client")))
          .orderBy(desc(quotationVersion.version))
          .limit(1);
    if (earlier && sameTechDocSheet(earlier.snapshot, snapshot)) return "unchanged" as const;
    const frozen = await freezeLiveInternal(tx, id, snapshot);
    if (frozen === null && spare) return null;
    // Nothing live: a pump's was frozen by its send (or a newer version was made, then deleted).
    const internal = frozen ?? q.internalVersion;
    const reason = `Saved (internal V${internal})`;
    // The client version is the enquiry's Commercial version: Enquiry V1 = Client V1.
    const [enquiry] = await tx.select({ version: projects.commercialVersionNo }).from(projects).where(eq(projects.id, current.projectId));
    const v = enquiry.version;
    await tx.update(quotation).set({ clientVersion: v, updatedAt: sql`now()` }).where(eq(quotation.id, id));
    if (earlier) {
      // Overwrites what was sent, and the internal version it was sent as.
      if (frozen === null) {
        await tx
          .update(quotationVersion)
          .set({ snapshot })
          .where(and(eq(quotationVersion.quotationId, id), eq(quotationVersion.track, "internal"), eq(quotationVersion.version, internal)));
      }
      const now = new Date();
      await tx
        .update(quotationVersion)
        .set({ version: v, snapshot, reason, tsmName: q.tsmName, tsmInitials: q.tsmInitials, frozenAt: now, createdAt: now, createdBy })
        .where(eq(quotationVersion.id, earlier.id));
    } else {
      await tx.insert(quotationVersion).values({
        quotationId: id,
        track: "client",
        version: v,
        reason,
        tsmName: q.tsmName,
        tsmInitials: q.tsmInitials,
        snapshot,
        frozenAt: new Date(),
        createdBy,
      });
    }
    await tx.update(projects).set(REVIEW_CLEARED).where(eq(projects.id, current.projectId));
    const sent = await tx
      .selectDistinct({ group: quotation.driveGroup })
      .from(quotation)
      .innerJoin(quotationVersion, eq(quotationVersion.quotationId, quotation.id))
      .where(and(eq(quotation.projectId, current.projectId), eq(quotationVersion.track, "client")));
    const needed: string[] = spare ? [SPARE_GROUP] : groups;
    if (needed.every((g) => sent.some((s) => s.group === g))) {
      // The first time sets the completion date; saving again keeps it. A status
      // changed by hand to not done, or to Not Quoted, gives way to the save.
      await tx
        .update(projects)
        .set({
          sentToClientAt: sql`coalesce(${projects.sentToClientAt}, now())`,
          commercialStatusOverride: sql`nullif(nullif(nullif(${projects.commercialStatusOverride}, 'Pending'), 'In Progress'), 'Not Quoted')`,
        })
        .where(eq(projects.id, current.projectId));
    }
    return { v, internal, replacedTotal: earlier ? (earlier.snapshot as QuotationSnapshot).grandTotal : null };
  });
  if (result === "unchanged") return error("Nothing has changed since this quotation was last saved.", 409);
  if (!result) return error("This version of the quotation is already saved. For changes, create a new version.", 409);

  await logAudit(req, {
    action: "quotation.send",
    entity: "quotation",
    entityId: id,
    detail: `Quotation ${quotationNumber(current, true)} ${result.replacedTotal === null ? "saved" : "saved again"} — client V${result.v} (internal V${result.internal}), grand total ${formatInr(
      snapshot.grandTotal,
    )}${result.replacedTotal === null ? "" : `, replacing ${formatInr(result.replacedTotal)}`}`,
  });
  return json(await loadQuotation(current.projectId, current.driveGroup));
}
