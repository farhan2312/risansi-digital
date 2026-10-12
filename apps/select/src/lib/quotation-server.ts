// Server-only helpers for the quotation (v1).
//
// The quotation lives entirely in this app's DB. Market Intell (the sales
// portal) is only READ — through miQuery, which is read-only — to list the
// possible TSMs and to suggest the client's primary rep. Nothing is written
// there.
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { isMarketIntellConfigured, miQuery } from "@/lib/db/market-intell";
import { projects, quotation, quotationVersion, users } from "@/lib/db/schema";
import { normalizeOfferConfigs } from "@/lib/commercial-offer";
import { loadCommercialSummary, projectDriveGroups } from "@/lib/commercial-server";
import {
  type QuotationInfo,
  type QuotationSnapshot,
  type QuotationTrack,
  type TsmOption,
  erpQuotationNumber,
  quotationNumber,
  subTotal,
  unitTotal,
} from "@/lib/commercial";

type MiUserRow = { id: number; name: string; initials: string | null; zone: string | null; role: string };

/** "Madhav R Kulkarni" → "MRK" — only when sales has no initials for the user. */
const initialsFromName = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("")
    .slice(0, 5);

const toOption = (u: MiUserRow): TsmOption => ({
  id: u.id,
  name: u.name,
  initials: (u.initials || initialsFromName(u.name)).toUpperCase(),
  zone: u.zone,
  role: u.role,
});

/** Active sales reps and managers — the people who can be a quotation's TSM. */
export async function listTsmOptions(): Promise<TsmOption[]> {
  if (!isMarketIntellConfigured()) return [];
  const rows = await miQuery<MiUserRow>(
    `SELECT id, name, initials, zone, role
       FROM users
      WHERE is_active AND role IN ('rep', 'manager')
      ORDER BY zone NULLS LAST, name`,
  );
  return rows.map(toOption);
}

export async function tsmById(id: number): Promise<TsmOption | null> {
  if (!isMarketIntellConfigured()) return null;
  const [row] = await miQuery<MiUserRow>(
    `SELECT id, name, initials, zone, role FROM users WHERE id = $1`,
    [id],
  );
  return row ? toOption(row) : null;
}

/** The client's primary rep in sales, as the default TSM (null if none). */
export async function suggestedTsm(clientCode: string | null): Promise<TsmOption | null> {
  if (!clientCode || !isMarketIntellConfigured()) return null;
  const [row] = await miQuery<MiUserRow>(
    `SELECT u.id, u.name, u.initials, u.zone, u.role
       FROM clients c
       JOIN users u ON u.id = c.primary_rep_id
      WHERE c.code = $1 AND c.deleted_at IS NULL
      LIMIT 1`,
    [clientCode],
  );
  return row ? toOption(row) : null;
}

/** Frozen copy of one drive group's prices (only that group's tags), stored
 *  with every version of that group's quotation. */
export async function buildSnapshot(projectId: string, driveGroup: string): Promise<QuotationSnapshot> {
  const [summary, [p]] = await Promise.all([
    loadCommercialSummary(projectId),
    db.select({ offer: projects.commercialOfferConfig }).from(projects).where(eq(projects.id, projectId)).limit(1),
  ]);
  const tags = (summary?.tags ?? []).filter((t) => t.driveGroup === driveGroup).map((t) => ({
    tagId: t.tagId,
    tagName: t.tagName,
    productCode: t.productCode,
    model: t.model,
    tech: t.tech,
    quantity: t.quantity,
    prices: t.prices,
    unit: unitTotal(t.prices),
    sub: subTotal(t.prices, t.quantity),
  }));
  // The Commercial Offer sheet edits travel with the version, so a frozen
  // version keeps the sheet exactly as it was.
  const offer = normalizeOfferConfigs(p?.offer, [driveGroup])[driveGroup];
  return {
    tags,
    grandTotal: tags.reduce((s, t) => s + t.sub, 0),
    offer,
    ...(summary?.project.remarks ? { remarks: summary.project.remarks } : {}),
  };
}

/** One drive group's quotation for the enquiry, with its version history
 *  (newest first), or null. */
export async function loadQuotation(projectId: string, driveGroup: string): Promise<QuotationInfo | null> {
  const [q] = await db
    .select()
    .from(quotation)
    .where(and(eq(quotation.projectId, projectId), eq(quotation.driveGroup, driveGroup)))
    .limit(1);
  if (!q) return null;
  // The rest at once: drive groups, versions and the live snapshot (used
  // only when a version is still live, but built alongside to save a round trip).
  const [groups, versions, snapshot] = await Promise.all([
    projectDriveGroups(projectId),
    db
      .select({ v: quotationVersion, createdByName: users.name })
      .from(quotationVersion)
      .leftJoin(users, eq(users.id, quotationVersion.createdBy))
      .where(eq(quotationVersion.quotationId, q.id))
      .orderBy(asc(quotationVersion.createdAt)),
    buildSnapshot(projectId, driveGroup),
  ]);
  const mixed = groups.length > 1;
  // The live internal version shows the current saved prices, not its stored copy.
  const liveSnapshot = versions.some(({ v }) => v.frozenAt === null) ? snapshot : null;
  return {
    id: q.id,
    driveGroup: q.driveGroup,
    number: quotationNumber(q, mixed),
    erpSerial: q.erpSerial,
    erpNumber: erpQuotationNumber(q, mixed),
    productType: q.productType,
    quoteDate: q.quoteDate,
    finYear: q.finYear,
    serial: q.serial,
    regionCode: q.regionCode,
    tsmRepId: q.tsmRepId,
    tsmName: q.tsmName,
    tsmInitials: q.tsmInitials,
    tsmZone: q.tsmZone,
    clientCode: q.clientCode,
    clientName: q.clientName,
    internalVersion: q.internalVersion,
    clientVersion: q.clientVersion,
    versions: versions
      .map(({ v, createdByName }) => ({
        id: v.id,
        track: v.track as QuotationTrack,
        version: v.version,
        reason: v.reason,
        requestedBy: v.requestedBy,
        note: v.note,
        tsmName: v.tsmName,
        tsmInitials: v.tsmInitials,
        snapshot: v.frozenAt === null && liveSnapshot ? liveSnapshot : (v.snapshot as QuotationSnapshot),
        live: v.frozenAt === null,
        createdAt: v.createdAt ? v.createdAt.toISOString() : null,
        createdByName: createdByName ?? null,
      }))
      .reverse(),
  };
}

/** Freezes the quotation's live internal version (if any) with the current
 *  prices. Returns its version number, or null when nothing was live. Call
 *  inside the transaction that starts the next version / records a send. */
export async function freezeLiveInternal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  quotationId: string,
  snapshot: QuotationSnapshot,
): Promise<number | null> {
  const rows: { version: number }[] = await tx
    .update(quotationVersion)
    .set({ snapshot, frozenAt: new Date() })
    .where(
      and(
        eq(quotationVersion.quotationId, quotationId),
        eq(quotationVersion.track, "internal"),
        isNull(quotationVersion.frozenAt),
      ),
    )
    .returning({ version: quotationVersion.version });
  return rows[0]?.version ?? null;
}
