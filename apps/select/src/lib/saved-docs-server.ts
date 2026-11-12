// Loads what lib/saved-docs.ts describes: frozen copies only, never the live prices
// or sheet edits. A spare's quote and document edits are read from its saved copy
// (older copies didn't keep them: then live).
// Server-only.
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { SPARE_GROUP, erpQuotationNumber, quotationNumber, type DriveGroup, type QuotationSnapshot } from "./commercial";
import { isGearedGroup, normalizeOfferConfig } from "./commercial-offer";
import { projectDriveGroups } from "./commercial-server";
import { db } from "./db";
import { projects, quotation, quotationVersion, techDocVersion } from "./db/schema";
import type { SavedDocs, SavedGroupDocs } from "./saved-docs";
import { normalizeSpareDocEdits, normalizeSpareQuote } from "./spare-quote";
import { termsMarketOf } from "./spare-terms";
import { dotDate, visibleTags, type TechDocGroup, type TechDocSheet } from "./tech-doc";
import { docClientName } from "@/lib/client-place";

export async function loadSavedDocs(projectId: string): Promise<SavedDocs | null> {
  const [p] = await db
    .select({
      code: projects.projectCode,
      name: projects.name,
      clientCode: projects.clientCode,
      enquiryDate: projects.enquiryDate,
      orderType: projects.orderType,
      market: projects.clientMarketType,
      quote: projects.spareQuote,
      docEdits: projects.spareDocEdits,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!p) return null;

  const quotes = await db.select().from(quotation).where(eq(quotation.projectId, projectId));
  const clientRows = quotes.length
    ? await db
        .select({ quotationId: quotationVersion.quotationId, version: quotationVersion.version, snapshot: quotationVersion.snapshot })
        .from(quotationVersion)
        .where(and(inArray(quotationVersion.quotationId, quotes.map((q) => q.id)), eq(quotationVersion.track, "client")))
        .orderBy(asc(quotationVersion.createdAt))
    : [];
  const savedOn = (quotationId: string) => clientRows.filter((v) => v.quotationId === quotationId).at(-1) ?? null;
  const enquiry = [p.code, p.enquiryDate ? `Dt. ${dotDate(p.enquiryDate)}` : ""].filter(Boolean).join(", ");
  // The Client Name box: with the city and country from sales.
  const clientName = await docClientName(p.name, p.clientCode);

  if (p.orderType === "spare") {
    const q = quotes.find((x) => x.driveGroup === SPARE_GROUP);
    // As saved: the copy in the version (older ones didn't keep it - then the live quote).
    const kept = q ? (savedOn(q.id)?.snapshot as QuotationSnapshot | undefined)?.spare : undefined;
    return {
      orderType: "spare",
      groups: [],
      spare:
        q && savedOn(q.id)
          ? {
              projectCode: p.code,
              quote: normalizeSpareQuote(kept?.quote ?? p.quote, termsMarketOf(p.market)),
              edits: normalizeSpareDocEdits(kept?.quote ? kept.edits : p.docEdits),
              header: {
                clientName,
                enquiry,
                quotation: `${erpQuotationNumber(q, false) ?? quotationNumber(q, false)}, Dt. ${dotDate(q.quoteDate)}`,
                hidden: [],
              },
            }
          : null,
    };
  }

  const [driveGroups, sheets] = await Promise.all([
    projectDriveGroups(projectId),
    db
      .select({ group: techDocVersion.driveGroup, snapshot: techDocVersion.snapshot })
      .from(techDocVersion)
      .where(eq(techDocVersion.projectId, projectId))
      .orderBy(desc(techDocVersion.version)),
  ]);
  const mixed = driveGroups.length > 1;
  // Newest first, so this is the sheet as last saved.
  const sheetOf = (group: string): TechDocSheet | null => {
    const sheet = sheets.find((s) => s.group === group)?.snapshot as TechDocSheet | undefined;
    if (!sheet) return null;
    // Sheets saved by older code froze "RIL/EN/26-27/1 V1, Dt. ..."; no version on the enquiry here.
    const line = sheet.header.enquiry ?? "";
    const enquiryLine = line.startsWith(`${p.code} V`) ? p.code + line.slice(p.code.length).replace(/^ Vd+/, "") : line;
    return { ...sheet, header: { ...sheet.header, enquiry: enquiryLine } };
  };

  const groups: SavedGroupDocs[] = driveGroups.map((group: DriveGroup) => {
    const q = quotes.find((x) => x.driveGroup === group);
    const saved = q ? savedOn(q.id) : null;
    if (!q || !saved) return { group, tech: sheetOf(group), offer: null };
    const snapshot = saved.snapshot as QuotationSnapshot;
    const config = normalizeOfferConfig(snapshot.offer);
    const tags = snapshot.tags.map((t) => ({
      tagId: t.tagId ?? t.tagName,
      tagName: t.tagName,
      tech: t.tech,
      pumpModel: t.productCode ?? t.model,
      prices: t.prices,
      quantity: t.quantity,
      unit: t.unit,
      sub: t.sub,
    }));
    const erp = erpQuotationNumber(q, mixed);
    return {
      group,
      tech: sheetOf(group),
      offer: {
        projectCode: p.code,
        header: {
          clientName,
          enquiry: config.enquiryText || enquiry,
          quotation: config.erpText || (erp ? `${erp}, Dt. ${dotDate(q.quoteDate)}` : ""),
          hidden: config.headerHidden ?? [],
        },
        tags: visibleTags(tags, config),
        config,
        geared: isGearedGroup(group),
        driveGroup: group,
        group: mixed ? group : undefined,
        versionLabel: `Client V${saved.version}`,
        fx: snapshot.fx,
      },
    };
  });
  // A sheet saved for tags with no drive system has no quotation.
  for (const s of sheets) {
    if (!groups.some((g) => g.group === s.group)) groups.push({ group: s.group as TechDocGroup, tech: sheetOf(s.group), offer: null });
  }
  return { orderType: "pump", groups, spare: null };
}
