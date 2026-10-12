import { and, eq, isNotNull, sql } from "drizzle-orm";

import { error, isUniqueViolation, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { tryDecodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects, quotation, quotationVersion } from "@/lib/db/schema";
import { finYearOf, isDriveGroup, parseErpSerial, quotationNumber } from "@/lib/commercial";
import { projectDriveGroups } from "@/lib/commercial-server";
import { buildSnapshot, loadQuotation, suggestedTsm, tsmById } from "@/lib/quotation-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** Today in India (the quotation date), yyyy-mm-dd. */
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

// GET /api/quotations?projectId=…&group=GM — one drive group's quotation (or
// null), plus the client's rep in sales (`clientTsm`). One quotation per
// enquiry AND drive group. The TSM is LOCKED to the client's rep; only when
// the client has none (or no client code) is it picked by hand.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const projectId = params.get("projectId") ?? "";
  const group = params.get("group") ?? "";
  if (!UUID.test(projectId)) return error("'projectId' query param is required", 400);
  if (!isDriveGroup(group)) return error("'group' must be GM, GB, VB or DD", 400);
  // The quotation loads alongside the enquiry → client rep lookup.
  const [p, q] = await Promise.all([
    db
      .select({ clientCode: projects.clientCode })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .then(async ([row]) => (row ? { clientTsm: await suggestedTsm(row.clientCode).catch(() => null) } : null)),
    loadQuotation(projectId, group),
  ]);
  if (!p) return error("Enquiry not found", 404);
  return json({ quotation: q, clientTsm: p.clientTsm });
}

// POST /api/quotations {projectId, group, tsmRepId?} — creates one drive
// group's quotation for the enquiry: date = today, FY from it, region = the TSM's initials, internal
// V0 (with a snapshot of the prices), client version not sent yet. Serial =
// the enquiry's serial if another drive group already has one, else the next
// from quotation_serial_seq (6000, 6001, …). TSM = the client's rep in sales (tsmRepId is ignored then);
// tsmRepId is only used when the client has no rep.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const projectId = String(body.projectId ?? "");
  const group = String(body.group ?? "");
  if (!UUID.test(projectId)) return error("'projectId' is required", 400);
  if (!isDriveGroup(group)) return error("'group' must be GM, GB, VB or DD", 400);
  const erpSerial = parseErpSerial(body.erpSerial);
  if (erpSerial === undefined) return error("ERP serial: letters, digits, - or / only (max 30).", 400);

  const [p] = await db
    .select({ code: projects.projectCode, name: projects.name, clientCode: projects.clientCode })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!p) return error("Enquiry not found", 404);
  const groups = await projectDriveGroups(projectId);
  if (!groups.includes(group)) return error("This enquiry has no tag on that drive system.", 400);

  let tsm;
  try {
    tsm = await suggestedTsm(p.clientCode);
  } catch {
    return error("Couldn't read the client's rep from the sales portal. Try again.", 502);
  }
  if (!tsm) {
    const tsmRepId = Number(body.tsmRepId);
    if (!Number.isInteger(tsmRepId)) return error("This client has no rep in sales — select the TSM.", 400);
    tsm = await tsmById(tsmRepId);
    if (!tsm) return error("That TSM was not found in the sales user list.", 400);
  }

  const claims = tryDecodeToken(req);
  const createdBy = claims?.sub && UUID.test(claims.sub) ? claims.sub : null;
  const quoteDate = todayIst();
  const snapshot = await buildSnapshot(projectId, group);

  try {
    const created = await db.transaction(async (tx) => {
      // One serial per enquiry: its drive groups share it (they differ by the
      // /GM… suffix). The lock stops two groups created at once from each
      // taking a new number.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId}))`);
      const [existing] = await tx
        .select({ serial: quotation.serial })
        .from(quotation)
        .where(and(eq(quotation.projectId, projectId), isNotNull(quotation.serial)))
        .limit(1);
      const serial =
        existing?.serial ??
        Number(
          (await tx.execute<{ n: string }>(sql`select nextval('quotation_serial_seq')::text as n`)).rows[0].n,
        );
      const [q] = await tx
        .insert(quotation)
        .values({
          projectId,
          driveGroup: group,
          productType: "PCP",
          quoteDate,
          finYear: finYearOf(quoteDate),
          serial,
          erpSerial,
          regionCode: tsm.initials,
          tsmRepId: tsm.id,
          tsmName: tsm.name,
          tsmInitials: tsm.initials,
          tsmZone: tsm.zone,
          clientCode: p.clientCode,
          clientName: p.name,
          internalVersion: 0,
          createdBy,
        })
        .returning();
      await tx.insert(quotationVersion).values({
        quotationId: q.id,
        track: "internal",
        version: 0,
        reason: "Quotation created",
        tsmName: tsm.name,
        tsmInitials: tsm.initials,
        snapshot,
        createdBy,
      });
      return q;
    });
    await logAudit(req, {
      action: "quotation.create",
      entity: "quotation",
      entityId: created.id,
      detail: `Created quotation ${quotationNumber(created, groups.length > 1)} for ${p.code} (TSM ${tsm.name}) — internal V0`,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return error("This drive group already has a quotation.", 409);
    throw err;
  }
  return json(await loadQuotation(projectId, group), 201);
}
