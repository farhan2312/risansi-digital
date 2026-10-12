// Server-only: the enquiry's Technical Data Sheet data — header (client,
// enquiry, quotation per drive group), every CONFIRMED tag with its current
// wizard data + the confirmed pump's catalogue row at the picked head, and the
// sheet edits saved for the enquiry. Used by GET /api/enquiry-document and by
// the sheet's client versions (which freeze it).
import { and, asc, eq, getTableColumns, inArray, isNotNull } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import {
  driveDirectInput,
  driveGearedInput,
  driveVbeltInput,
  enquiryTags,
  fluidPropertiesInput,
  generalInfoInput,
  mocSealingInput,
  motorDriveInput,
  operatingConditionsInput,
  projects,
  pumpModelMaster,
  pumpModelQtyInput,
  quotation,
} from "@/lib/db/schema";
import { DRIVE_GROUPS, erpQuotationNumber, quotationNumber } from "@/lib/commercial";
import { projectDriveGroups } from "@/lib/commercial-server";
import { dotDate, normalizeTechDocConfigs, type TechDocData, type TechDocForm, type TechDocPump } from "@/lib/tech-doc";

// Every wizard table a tag's data lives in. Their columns merge into one flat
// object (the wizard's formData shape), which lib/tech-doc reads.
const WIZARD_TABLES = [
  generalInfoInput,
  fluidPropertiesInput,
  operatingConditionsInput,
  mocSealingInput,
  motorDriveInput,
  driveDirectInput,
  driveVbeltInput,
  driveGearedInput,
  pumpModelQtyInput,
] as const;

// Uploaded files / generated PDFs — never loaded for the sheet.
const SKIP = new Set(["clientRequirementsFile", "document", "id", "projectId", "createdAt", "updatedAt"]);

/** A table's columns minus the binary / bookkeeping ones (tagId kept to key rows). */
function sheetColumns(table: PgTable): Record<string, AnyPgColumn> {
  const out: Record<string, AnyPgColumn> = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) if (!SKIP.has(key)) out[key] = col as AnyPgColumn;
  return out;
}

/** The enquiry's sheet data, or null when the enquiry doesn't exist. */
export async function loadTechDocData(projectId: string): Promise<TechDocData | null> {
  const [p] = await db
    .select({
      code: projects.projectCode,
      name: projects.name,
      enquiryDate: projects.enquiryDate,
      config: projects.techDocConfig,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!p) return null;

  // One quotation per drive group; the group code follows the serial only
  // when the enquiry mixes drives (judged on all its tags, not just confirmed).
  const [quotes, groupsUsed] = await Promise.all([
    db.select().from(quotation).where(eq(quotation.projectId, projectId)),
    projectDriveGroups(projectId),
  ]);
  const mixed = groupsUsed.length > 1;

  // Confirmed tags only (final report generated), in creation order.
  const tagRows = await db
    .select({ id: enquiryTags.id, name: enquiryTags.name })
    .from(enquiryTags)
    .where(and(eq(enquiryTags.projectId, projectId), isNotNull(enquiryTags.reportGeneratedAt)))
    .orderBy(asc(enquiryTags.createdAt));
  const ids = tagRows.map((t) => t.id);

  const forms = new Map<string, TechDocForm>(ids.map((id) => [id, {}]));
  if (ids.length > 0) {
    const perTable = await Promise.all(
      WIZARD_TABLES.map((table) =>
        db
          .select(sheetColumns(table))
          .from(table)
          .where(inArray((table as unknown as { tagId: AnyPgColumn }).tagId, ids)),
      ),
    );
    for (const rows of perTable) {
      for (const row of rows as Record<string, unknown>[]) {
        const form = forms.get(String(row.tagId));
        if (!form) continue;
        for (const [k, v] of Object.entries(row)) {
          if (k === "tagId" || v === null || v === undefined) continue;
          form[k] = v as TechDocForm[string];
        }
      }
    }
  }

  // The confirmed model's catalogue row at the picked head (stage, VOLE, ME).
  const models = [...new Set([...forms.values()].map((f) => String(f.selectedModel ?? "")).filter(Boolean))];
  const pumpRows = models.length
    ? await db
        .select({
          model: pumpModelMaster.model,
          headMwc: pumpModelMaster.headMwc,
          stage: pumpModelMaster.stage,
          voleMin: pumpModelMaster.voleMin,
          voleMax: pumpModelMaster.voleMax,
          mechEff: pumpModelMaster.mechEff,
        })
        .from(pumpModelMaster)
        .where(inArray(pumpModelMaster.model, models))
    : [];
  const pumpFor = (f: TechDocForm): TechDocPump | null => {
    const rows = pumpRows.filter((r) => r.model === f.selectedModel);
    if (rows.length === 0) return null;
    const head = Number(f.selectedHead);
    const at = rows.find((r) => Number(r.headMwc) === head) ?? rows[0];
    return { stage: at.stage, voleMin: at.voleMin, voleMax: at.voleMax, mechEff: at.mechEff };
  };

  const data: TechDocData = {
    projectCode: p.code,
    clientName: p.name,
    enquiry: [p.code, p.enquiryDate ? `Dt. ${dotDate(p.enquiryDate)}` : ""].filter(Boolean).join(", "),
    tags: tagRows.map((t) => {
      const form = forms.get(t.id) ?? {};
      return { tagId: t.id, tagName: t.name, form, pump: pumpFor(form) };
    }),
    mixed,
    erpNumbers: Object.fromEntries(
      quotes.flatMap((q) => {
        const erp = erpQuotationNumber(q, mixed);
        return erp ? [[q.driveGroup, `${erp}, Dt. ${dotDate(q.quoteDate)}`]] : [];
      }),
    ),
    quotations: Object.fromEntries(
      quotes.map((q) => [q.driveGroup, `${quotationNumber(q, mixed)}, Dt. ${dotDate(q.quoteDate)}`]),
    ),
    configs: normalizeTechDocConfigs(p.config, [...DRIVE_GROUPS, "NONE"]),
  };
  return data;
}
