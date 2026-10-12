import { eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { projects, quotation } from "@/lib/db/schema";
import { parseErpSerial, quotationNumber } from "@/lib/commercial";
import { loadQuotation, suggestedTsm, tsmById } from "@/lib/quotation-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// PATCH /api/quotations/[id] {tsmRepId} — sets the quotation's TSM. The TSM is
// LOCKED to the client's rep in sales: when the client has one, the only TSM
// accepted is that rep (used to follow the rep after sales reassigns the
// client); any TSM is accepted only when the client has no rep. Not a revision:
// no version is made (a new internal version comes from the TSM asking for
// changes — see ./internal-version). The region part of the number follows the
// TSM's initials.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return error("Invalid quotation id", 400);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const [current] = await db.select().from(quotation).where(eq(quotation.id, id)).limit(1);
  if (!current) return error("Quotation not found", 404);

  // {erpSerial}: the serial of this quotation in ERP, typed in by hand.
  if ("erpSerial" in body && !("tsmRepId" in body)) {
    const erpSerial = parseErpSerial(body.erpSerial);
    if (erpSerial === undefined) return error("ERP serial: letters, digits, - or / only (max 30).", 400);
    if ((current.erpSerial ?? null) !== erpSerial) {
      await db.update(quotation).set({ erpSerial, updatedAt: sql`now()` }).where(eq(quotation.id, id));
      await logAudit(req, {
        action: "quotation.erp_serial",
        entity: "quotation",
        entityId: id,
        detail: `Quotation ${quotationNumber(current, true)}: ERP serial ${current.erpSerial ?? "—"} → ${erpSerial ?? "—"}`,
      });
    }
    return json(await loadQuotation(current.projectId, current.driveGroup));
  }

  const tsmRepId = Number(body.tsmRepId);
  if (!Number.isInteger(tsmRepId)) return error("Select the TSM.", 400);

  const [p] = await db
    .select({ clientCode: projects.clientCode })
    .from(projects)
    .where(eq(projects.id, current.projectId))
    .limit(1);
  let clientTsm;
  try {
    clientTsm = await suggestedTsm(p?.clientCode ?? null);
  } catch {
    return error("Couldn't read the client's rep from the sales portal. Try again.", 502);
  }
  if (clientTsm && clientTsm.id !== tsmRepId) {
    return error(`The TSM is the client's rep in sales (${clientTsm.name}) and can't be changed here.`, 409);
  }
  const tsm = clientTsm ?? (await tsmById(tsmRepId));
  if (!tsm) return error("That TSM was not found in the sales user list.", 400);
  if (current.tsmRepId === tsm.id) return json(await loadQuotation(current.projectId, current.driveGroup));

  await db
    .update(quotation)
    .set({
      tsmRepId: tsm.id,
      tsmName: tsm.name,
      tsmInitials: tsm.initials,
      tsmZone: tsm.zone,
      regionCode: tsm.initials,
      updatedAt: sql`now()`,
    })
    .where(eq(quotation.id, id));

  await logAudit(req, {
    action: "quotation.tsm_change",
    entity: "quotation",
    entityId: id,
    detail: `Quotation ${quotationNumber(current, true)}: TSM ${current.tsmName ?? "—"} → ${tsm.name} (now ${quotationNumber(
      { ...current, regionCode: tsm.initials },
      true,
    )})`,
  });
  return json(await loadQuotation(current.projectId, current.driveGroup));
}
