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

/** Who can ask for changes. The selection head is left out for now. */
const REQUESTERS = ["TSM"] as const;

// POST /api/quotations/[id]/internal-version {note, requestedBy?} — the TSM
// asked for changes. Used BEFORE making them: the live internal version is
// frozen with the prices as they are now (what the TSM reviewed), and the next
// INTERNAL version starts live with the request (note) — the changes saved
// from here on go into it. The client version is never touched here.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return error("Invalid quotation id", 400);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  if (!note) return error("Describe the changes the TSM asked for.", 400);
  const requestedBy = (REQUESTERS as readonly string[]).includes(String(body.requestedBy ?? "TSM"))
    ? String(body.requestedBy ?? "TSM")
    : null;
  if (!requestedBy) return error(`'requestedBy' must be one of: ${REQUESTERS.join(", ")}`, 400);

  const [current] = await db.select().from(quotation).where(eq(quotation.id, id)).limit(1);
  if (!current) return error("Quotation not found", 404);

  const claims = tryDecodeToken(req);
  const createdBy = claims?.sub && UUID.test(claims.sub) ? claims.sub : null;
  const snapshot = await buildSnapshot(current.projectId, current.driveGroup);

  const next = await db.transaction(async (tx) => {
    // Lock the row so two requests at once can't take the same version number.
    const [q] = await tx.select().from(quotation).where(eq(quotation.id, id)).for("update");
    const v = q.internalVersion + 1;
    await freezeLiveInternal(tx, id, snapshot);
    await tx.update(quotation).set({ internalVersion: v, updatedAt: sql`now()` }).where(eq(quotation.id, id));
    await tx.insert(quotationVersion).values({
      quotationId: id,
      track: "internal",
      version: v,
      reason: `Changes requested by ${requestedBy}`,
      requestedBy,
      note,
      tsmName: q.tsmName,
      tsmInitials: q.tsmInitials,
      snapshot,
      createdBy,
    });
    return v;
  });

  await logAudit(req, {
    action: "quotation.internal_version",
    entity: "quotation",
    entityId: id,
    detail: `Quotation ${quotationNumber(current, true)} — internal V${next}, changes requested by ${requestedBy}: ${note.slice(
      0,
      300,
    )} (V${next - 1} frozen at ${formatInr(snapshot.grandTotal)})`,
  });
  return json(await loadQuotation(current.projectId, current.driveGroup));
}
