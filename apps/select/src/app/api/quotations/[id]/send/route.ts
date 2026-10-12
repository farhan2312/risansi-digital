import { eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { tryDecodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { quotation, quotationVersion } from "@/lib/db/schema";
import { formatInr, quotationNumber } from "@/lib/commercial";
import { buildSnapshot, freezeLiveInternal, loadQuotation } from "@/lib/quotation-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/quotations/[id]/send — records that the quotation was sent to the
// client: the next CLIENT version (V0 the first time) with a frozen copy of the
// prices. What is sent is the live internal version, which freezes with it (its
// number doesn't change). Needs a live internal version: after a send, further
// changes start a new internal version first. Nothing is e-mailed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return error("Invalid quotation id", 400);
  const [current] = await db.select().from(quotation).where(eq(quotation.id, id)).limit(1);
  if (!current) return error("Quotation not found", 404);

  const snapshot = await buildSnapshot(current.projectId, current.driveGroup);
  if (snapshot.tags.length === 0) return error("This enquiry has no tags to quote.", 400);

  const claims = tryDecodeToken(req);
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
