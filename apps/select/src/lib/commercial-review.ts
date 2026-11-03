// Keeping a tag's prices in step with its pump selection (user, 2026-11-03).
// Server-only.
//   - An item the selection no longer has is removed by itself, with a note.
//   - An item whose make or model changed is flagged on the Commercial page
//     (priceChangesFor, lib/commercial.ts), and Send to client waits for an answer.
// commercial_tag_price.boi_basis records what each price was for.
import { eq } from "drizzle-orm";

import { db } from "./db";
import { commercialTagPrice, projects } from "./db/schema";
import { type BoiKey, type BoiRemoved, boiBasisFor, formatInr } from "./commercial";
import { loadCommercialSummary } from "./commercial-server";

/** Records what the tag's prices are for, the first time the selection changes
 *  after they were saved. Call before writing the change. */
export async function ensureBoiBasis(projectId: string, tagId: string): Promise<void> {
  const [row] = await db.select({ basis: commercialTagPrice.boiBasis }).from(commercialTagPrice).where(eq(commercialTagPrice.tagId, tagId)).limit(1);
  if (!row || Object.keys(row.basis ?? {}).length > 0) return;
  const summary = await loadCommercialSummary(projectId);
  const tag = summary?.tags.find((t) => t.tagId === tagId);
  if (tag) await db.update(commercialTagPrice).set({ boiBasis: boiBasisFor(tag) }).where(eq(commercialTagPrice.tagId, tagId));
}

const REMOVABLE = {
  gearboxPrice: { label: "Gearbox", price: "gearboxPrice", model: null },
  mechSealPrice: { label: "Mechanical Seal", price: "mechSealPrice", model: "mechSealModel" },
} as const;

/** Which item a wizard save has just taken out of the selection. Only a change
 *  counts: a seal priced on purpose on gland packing ("Price anyway") stays. */
function itemLeaving(
  tableKey: string,
  previous: Record<string, unknown> | undefined,
  values: Record<string, unknown>,
): { key: keyof typeof REMOVABLE; reason: string } | null {
  if (tableKey === "motor-drive" && "driveSystem" in values) {
    const was = String(previous?.driveSystem ?? "");
    const now = String(values.driveSystem ?? "");
    if (was.startsWith("Geared") && !now.startsWith("Geared")) {
      return { key: "gearboxPrice", reason: `the drive is now ${now || "not selected"}` };
    }
  }
  if (tableKey === "moc-sealing" && "sealingType" in values) {
    const now = String(values.sealingType ?? "");
    if (previous?.sealingType === "Mechanical Seal" && now !== "Mechanical Seal") {
      return { key: "mechSealPrice", reason: `the sealing is now ${now || "not selected"}` };
    }
  }
  return null;
}

/** Removes an item the wizard save took out of the selection. Returns what to
 *  audit, or null when nothing was removed. */
export async function removeBoiNoLongerInSelection(
  projectId: string,
  tagId: string,
  tableKey: string,
  previous: Record<string, unknown> | undefined,
  values: Record<string, unknown>,
): Promise<string | null> {
  const leaving = itemLeaving(tableKey, previous, values);
  if (!leaving) return null;
  // A Technical only version leaves the commercial side alone: the line is flagged
  // on the Commercial page instead (priceChangesFor), with Remove price.
  const [p] = await db.select({ kind: projects.versionKind }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (p?.kind === "technical") return null;
  const [row] = await db.select().from(commercialTagPrice).where(eq(commercialTagPrice.tagId, tagId)).limit(1);
  const item = REMOVABLE[leaving.key];
  const price = row?.[item.price];
  if (!row || price === null || price === undefined) return null;

  const adjust = { ...(row.boiAdjust ?? {}) };
  delete adjust[leaving.key as BoiKey];
  const basis = { ...(row.boiBasis ?? {}) };
  delete basis[leaving.key];
  const note: BoiRemoved = { key: leaving.key, label: item.label, price: Number(price), reason: leaving.reason, at: new Date().toISOString() };
  await db
    .update(commercialTagPrice)
    .set({
      [item.price]: null,
      ...(item.model ? { [item.model]: null } : {}),
      boiAdjust: adjust,
      boiBasis: basis,
      boiRemoved: [...(row.boiRemoved ?? []).filter((n) => n.key !== leaving.key), note],
      updatedAt: new Date(),
    })
    .where(eq(commercialTagPrice.tagId, tagId));
  return `${item.label} price ${formatInr(note.price)} removed: ${leaving.reason}`;
}
