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
//
// That is a "both" version. What a version moves follows the statuses (user,
// 2026-11-23; the route decides): only the side that is Completed moves, and when both
// are, the master can still pick one. Each side keeps its own number
// (technical_version_no, commercial_version_no); version_no counts the rows.
//   "technical": Technical +1. The Commercial side carries on - its status, date, the
//                save (sent_to_client_at, and the client version as a copy), the Prices
//                reviewed tick; the quotation keeps its date and versions, the live
//                internal version MOVES here. Prices don't change by themselves
//                (lib/commercial-review.ts flags them instead).
//   "commercial": Commercial +1. The Technical side is kept as it was and is view only
//                (enquiry-access technicalLocked): the tags keep their status and
//                reports, the approvals, the Selection Summary, the Technical status and
//                the Technical Data Sheet's saves come along.
import { and, asc, eq, getTableName, inArray, isNull } from "drizzle-orm";

import { boiBasisFor } from "./commercial";
import { loadCommercialSummary } from "./commercial-server";

import { db } from "./db";
import { commercialTagPrice, enquiryTags, projects, quotation, quotationVersion, stepApproval, techDocVersion } from "./db/schema";
import { IST_OFFSET_MS } from "./ist";
import { buildSnapshot, freezeLiveInternal } from "./quotation-server";
import { WIZARD_TABLES, copyTagRows } from "./tag-copy";
import { REVIEW_CLEARED } from "./enquiry-filters-server";

type ProjectRow = typeof projects.$inferSelect;

export type RevisionKind = "both" | "technical" | "commercial";
export const REVISION_KIND_LABEL: Record<RevisionKind, string> = {
  both: "Technical and Commercial",
  technical: "Technical only",
  commercial: "Commercial only",
};

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
  input: { enquiryDate: string; assignedTo: string; note: string | null; createdBy: string; kind: RevisionKind },
): Promise<ProjectRow> {
  const version = source.versionNo + 1;
  // A spare has one side: its version is always both.
  const kind: RevisionKind = source.orderType === "spare" ? "both" : input.kind;
  const technicalMoves = kind !== "commercial";
  const commercialMoves = kind !== "technical";
  const now = new Date();
  const quoteDate = new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

  // Built before the transaction: these read through their own connection.
  const sourceQuotes = await db.select().from(quotation).where(eq(quotation.projectId, source.id));
  const snapshots = await Promise.all(sourceQuotes.map((q) => buildSnapshot(source.id, q.driveGroup)));
  const sourceSummary = await loadCommercialSummary(source.id);
  // Technical only: what this Commercial version saved goes along as a copy (the older
  // version keeps its own), so the next save overwrites the copy.
  const clientSaves =
    commercialMoves || sourceQuotes.length === 0
      ? []
      : await db
          .select()
          .from(quotationVersion)
          .where(
            and(
              inArray(quotationVersion.quotationId, sourceQuotes.map((q) => q.id)),
              eq(quotationVersion.track, "client"),
              eq(quotationVersion.version, source.commercialVersionNo),
            ),
          );
  // Commercial only: the Technical side as it was.
  const techSaves = technicalMoves ? [] : await db.select().from(techDocVersion).where(eq(techDocVersion.projectId, source.id));
  const approvals = technicalMoves ? [] : await db.select().from(stepApproval).where(eq(stepApproval.projectId, source.id));

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
        technicalVersionNo: source.technicalVersionNo + (technicalMoves ? 1 : 0),
        commercialVersionNo: source.commercialVersionNo + (commercialMoves ? 1 : 0),
        versionKind: kind,
        rootProjectId: source.rootProjectId ?? source.id,
        isLatest: true,
        revisionNote: input.note,
        enquiryDate: input.enquiryDate,
        ...(technicalMoves
          ? {
              status: "In Progress",
              technicalStatusOverride: null,
              completedOn: null,
              sentToOperationAt: null,
              reportDocument: null,
              reportFilename: null,
              reportGeneratedAt: null,
              reportSummary: null,
            }
          : {}),
        ...(commercialMoves
          ? { commercialStatusOverride: null, commercialCompletedOn: null, sentToClientAt: null, pricesReviewedAt: null, pricesReviewedBy: null }
          : {}),
        // Review starts on the side that moved; both keeps the last picks.
        ...(kind === "both" ? {} : { operationDocs: [kind] }),
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
        // A new version's documents are new: SharePoint links are added again.
        docLinks: null,
      })
      .returning();

    const tags = await tx.select().from(enquiryTags).where(eq(enquiryTags.projectId, source.id)).orderBy(asc(enquiryTags.createdAt));
    const tables = [...WIZARD_TABLES, getTableName(commercialTagPrice)];
    const tagIds = new Map<string, string>();
    for (const tag of tags) {
      // Same rule as copying a tag: the copy has the inputs but no report, so
      // it can't be Completed; an untouched tag stays Pending. A Commercial only
      // version keeps the tag as it was, its report too.
      const [copy] = await tx
        .insert(enquiryTags)
        .values({
          projectId: created.id,
          name: tag.name,
          createdAt: tag.createdAt,
          ...(technicalMoves
            ? { status: tag.status === "Pending" ? "Pending" : "In Progress" }
            : {
                status: tag.status,
                reportDocument: tag.reportDocument,
                reportFilename: tag.reportFilename,
                reportGeneratedAt: tag.reportGeneratedAt,
                reportSummary: tag.reportSummary,
              }),
        })
        .returning({ id: enquiryTags.id });
      tagIds.set(tag.id, copy.id);
      await copyTagRows(tx, tables, tag.id, created.id, copy.id, !technicalMoves);
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
    for (const a of approvals) {
      const tagId = tagIds.get(a.tagId);
      if (!tagId) continue;
      const { id: _approvalId, ...approval } = a;
      await tx.insert(stepApproval).values({ ...approval, projectId: created.id, tagId });
    }
    for (const t of techSaves) {
      const { id: _saveId, ...save } = t;
      await tx.insert(techDocVersion).values({ ...save, projectId: created.id, snapshot: withNewTagIds(save.snapshot, tagIds) });
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
    // stored snapshot is refreshed from the new prices when it freezes. Technical
    // only: the quotation carries on as it was (see the top).
    for (const [i, q] of sourceQuotes.entries()) {
      const { id: _quoteId, ...quote } = q;
      const [copy] = await tx
        .insert(quotation)
        .values({
          ...quote,
          projectId: created.id,
          quoteDate: commercialMoves ? quoteDate : q.quoteDate,
          internalVersion: commercialMoves ? q.internalVersion + 1 : q.internalVersion,
          createdBy: input.createdBy,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: quotation.id });
      if (!commercialMoves) {
        await tx
          .update(quotationVersion)
          .set({ quotationId: copy.id })
          .where(and(eq(quotationVersion.quotationId, q.id), eq(quotationVersion.track, "internal"), isNull(quotationVersion.frozenAt)));
        for (const s of clientSaves.filter((c) => c.quotationId === q.id)) {
          const { id: _versionId, ...save } = s;
          await tx.insert(quotationVersion).values({ ...save, quotationId: copy.id, snapshot: withNewTagIds(save.snapshot, tagIds) });
        }
        continue;
      }
      await freezeLiveInternal(tx, q.id, snapshots[i]);
      await tx.insert(quotationVersion).values({
        quotationId: copy.id,
        track: "internal",
        version: q.internalVersion + 1,
        reason: `Enquiry revised to Commercial V${created.commercialVersionNo}`,
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
