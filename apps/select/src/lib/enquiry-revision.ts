// Enquiry versions (user, 2026-11-03): V0 is the enquiry as created; when the
// client asks for changes after it is Completed, the User-Master makes the next
// version - a full copy with a revised enquiry date, assigned to a worker. Each
// version is its own `projects` row, so every tag, price and document keeps
// working unchanged, and the older version stays exactly as it was (view only,
// see versionLocked). Server-only.
//
//   Copied:      client details, order type, tags with their wizard steps and
//                uploaded files, tag prices, remarks, currency, sheet edits,
//                quotation numbers (the client version carries on from them).
//   Starts anew: enquiry date, assignee, status, completion date, approvals,
//                confirmed tag reports, the Selection Summary, the data sheets'
//                send to operation and the quotations' send to the client.
//   Stays put:   sent quotation versions (frozen on the older version; shown
//                across versions as one history).
// A version is always Technical and Commercial (user, 2026-11-05).
import { asc, eq, getTableName } from "drizzle-orm";

import { boiBasisFor } from "./commercial";
import { loadCommercialSummary } from "./commercial-server";

import { db } from "./db";
import { commercialTagPrice, enquiryTags, projects, quotation, quotationVersion } from "./db/schema";
import { IST_OFFSET_MS } from "./ist";
import { buildSnapshot, freezeLiveInternal } from "./quotation-server";
import { WIZARD_TABLES, copyTagRows } from "./tag-copy";
import { REVIEW_CLEARED } from "./enquiry-filters-server";

type ProjectRow = typeof projects.$inferSelect;

/** Refused by a concurrent change: the route answers it with this status. */
export class RevisionError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** The sheet edits are keyed by tag id, so they have to follow the new tags. */
function withNewTagIds<T>(config: T, tagIds: Map<string, string>): T {
  let text = JSON.stringify(config);
  for (const [from, to] of tagIds) text = text.replaceAll(from, to);
  return JSON.parse(text) as T;
}

export async function createRevision(
  source: ProjectRow,
  input: { enquiryDate: string; assignedTo: string; note: string | null; createdBy: string },
): Promise<ProjectRow> {
  const version = source.versionNo + 1;
  const now = new Date();
  const quoteDate = new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

  // Built before the transaction: these read through their own connection.
  const sourceQuotes = await db.select().from(quotation).where(eq(quotation.projectId, source.id));
  const snapshots = await Promise.all(sourceQuotes.map((q) => buildSnapshot(source.id, q.driveGroup)));
  const sourceSummary = await loadCommercialSummary(source.id);

  return db.transaction(async (tx) => {
    // The lock stops two revisions of the same version being made at once.
    const [current] = await tx.select({ isLatest: projects.isLatest }).from(projects).where(eq(projects.id, source.id)).for("update");
    if (!current?.isLatest) throw new RevisionError("A newer version of this enquiry already exists.", 409);
    await tx.update(projects).set({ isLatest: false, assigneeUnread: false, updatedAt: now }).where(eq(projects.id, source.id));

    const { id: _sourceId, ...carried } = source;
    const [created] = await tx
      .insert(projects)
      .values({
        ...carried,
        versionNo: version,
        commercialVersionNo: source.commercialVersionNo + 1,
        versionKind: "both",
        rootProjectId: source.rootProjectId ?? source.id,
        isLatest: true,
        revisionNote: input.note,
        enquiryDate: input.enquiryDate,
        status: "In Progress",
        technicalStatusOverride: null,
        completedOn: null,
        sentToOperationAt: null,
        commercialStatusOverride: null,
        commercialCompletedOn: null,
        sentToClientAt: null,
        pricesReviewedAt: null,
        pricesReviewedBy: null,
        ...REVIEW_CLEARED,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        assignedTo: input.assignedTo,
        assignedBy: input.createdBy,
        assignedAt: now,
        // Their bell tells them, unless the master kept it.
        assigneeUnread: input.assignedTo !== input.createdBy,
        assigneeSeenAt: null,
        reportDocument: null,
        reportFilename: null,
        reportGeneratedAt: null,
        reportSummary: null,
      })
      .returning();

    const tags = await tx
      .select({ id: enquiryTags.id, name: enquiryTags.name, status: enquiryTags.status, createdAt: enquiryTags.createdAt })
      .from(enquiryTags)
      .where(eq(enquiryTags.projectId, source.id))
      .orderBy(asc(enquiryTags.createdAt));
    const tables = [...WIZARD_TABLES, getTableName(commercialTagPrice)];
    const tagIds = new Map<string, string>();
    for (const tag of tags) {
      // Same rule as copying a tag: the copy has the inputs but no report, so
      // it can't be Completed; an untouched tag stays Pending.
      const [copy] = await tx
        .insert(enquiryTags)
        .values({
          projectId: created.id,
          name: tag.name,
          status: tag.status === "Pending" ? "Pending" : "In Progress",
          createdAt: tag.createdAt,
        })
        .returning({ id: enquiryTags.id });
      tagIds.set(tag.id, copy.id);
      await copyTagRows(tx, tables, tag.id, created.id, copy.id);
      // Compared with this version's selection from here on; a change still
      // waiting for an answer on the older version keeps waiting here.
      const sourceTag = sourceSummary?.tags.find((t) => t.tagId === tag.id);
      if (sourceTag) {
        const [priced] = await tx.select({ basis: commercialTagPrice.boiBasis }).from(commercialTagPrice).where(eq(commercialTagPrice.tagId, copy.id));
        if (priced) {
          await tx
            .update(commercialTagPrice)
            .set({ boiBasis: { ...boiBasisFor(sourceTag), ...priced.basis }, boiRemoved: [] })
            .where(eq(commercialTagPrice.tagId, copy.id));
        }
      }
    }
    const [revised] = await tx
      .update(projects)
      .set({
        techDocConfig: withNewTagIds(source.techDocConfig, tagIds),
        commercialOfferConfig: withNewTagIds(source.commercialOfferConfig, tagIds),
      })
      .where(eq(projects.id, created.id))
      .returning();

    // Same quotation number on the new version. The older version's live
    // internal version freezes as it is, and the next one starts live here; its
    // stored snapshot is refreshed from the new prices when it freezes.
    for (const [i, q] of sourceQuotes.entries()) {
      const { id: _quoteId, ...quote } = q;
      const [copy] = await tx
        .insert(quotation)
        .values({
          ...quote,
          projectId: created.id,
          quoteDate,
          internalVersion: q.internalVersion + 1,
          createdBy: input.createdBy,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: quotation.id });
      await freezeLiveInternal(tx, q.id, snapshots[i]);
      await tx.insert(quotationVersion).values({
        quotationId: copy.id,
        track: "internal",
        version: q.internalVersion + 1,
        reason: `Enquiry revised to V${version}`,
        note: input.note,
        tsmName: q.tsmName,
        tsmInitials: q.tsmInitials,
        snapshot: snapshots[i],
        createdBy: input.createdBy,
      });
    }
    return revised;
  });
}
