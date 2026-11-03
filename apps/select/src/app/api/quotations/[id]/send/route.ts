import { and, eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { tryDecodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects, quotation, quotationVersion } from "@/lib/db/schema";
import { SPARE_GROUP, formatInr, quotationNumber, sendToClientBlock } from "@/lib/commercial";
import { normalizeSpareQuote, spareQuoteProblem } from "@/lib/spare-quote";
import { loadCommercialSummary, projectDriveGroups } from "@/lib/commercial-server";
import { buildSnapshot, freezeLiveInternal, loadQuotation } from "@/lib/quotation-server";
import { workDenied } from "@/lib/enquiry-access";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/quotations/[id]/send — records that the quotation was sent to the
// client: the next CLIENT version (V0 the first time) with a frozen copy of the
// prices. What is sent is the live internal version, which freezes with it (its
// number doesn't change). Needs a live internal version: after a send, further
// changes start a new internal version first. Nothing is e-mailed. When every
// drive group in use has gone from this version of the enquiry, the commercial
// step is done (projects.sent_to_client_at, lib/enquiry-filters-server.ts).
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
    const internal = await freezeLiveInternal(tx, id, snapshot);
    if (internal === null) return null;
    const v = q.clientVersion === null ? 0 : q.clientVersion + 1;
    await tx.update(quotation).set({ clientVersion: v, updatedAt: sql`now()` }).where(eq(quotation.id, id));
    await tx.insert(quotationVersion).values({
      quotationId: id,
      track: "client",
      version: v,
      reason: `Sent to client (internal V${internal})`,
      tsmName: q.tsmName,
      tsmInitials: q.tsmInitials,
      snapshot,
      frozenAt: new Date(),
      createdBy,
    });
    const sent = await tx
      .selectDistinct({ group: quotation.driveGroup })
      .from(quotation)
      .innerJoin(quotationVersion, eq(quotationVersion.quotationId, quotation.id))
      .where(and(eq(quotation.projectId, current.projectId), eq(quotationVersion.track, "client")));
    const needed: string[] = spare ? [SPARE_GROUP] : groups;
    if (needed.every((g) => sent.some((s) => s.group === g))) {
      // The first time sets the completion date; sending again keeps it. A status
      // changed by hand to not done gives way to the send.
      await tx
        .update(projects)
        .set({
          sentToClientAt: sql`coalesce(${projects.sentToClientAt}, now())`,
          commercialStatusOverride: sql`nullif(nullif(${projects.commercialStatusOverride}, 'Pending'), 'In Progress')`,
        })
        .where(eq(projects.id, current.projectId));
    }
    return { v, internal };
  });
  if (!result) {
    return error("The latest internal version was already sent. Start a new internal version for further changes.", 409);
  }

  await logAudit(req, {
    action: "quotation.send",
    entity: "quotation",
    entityId: id,
    detail: `Quotation ${quotationNumber(current, true)} sent to client — client V${result.v} (internal V${result.internal}), grand total ${formatInr(
      snapshot.grandTotal,
    )}`,
  });
  return json(await loadQuotation(current.projectId, current.driveGroup));
}
