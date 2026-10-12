import { and, asc, eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { describeTag, logAudit, wizardStepLabel } from "@/lib/audit";
import { changedFields, describeChanges } from "@/lib/wizard-audit";
import {
  APPROVAL_STEPS_BY_TABLE,
  APPROVAL_STEP_LABELS,
  approvalStepsForChange,
} from "@/lib/approval";
import { resetApprovals } from "@/lib/approval-server";
import { normalizeHeadCalc } from "@/lib/head-calc-store";
import {
  enquiryTags,
  generalInfoInput,
  fluidPropertiesInput,
  operatingConditionsInput,
  mocSealingInput,
  motorDriveInput,
  driveDirectInput,
  driveVbeltInput,
  driveGearedInput,
  pumpModelQtyInput,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// One generic route family for all 9 wizard autosave tables, keyed by the
// [table] URL segment - same pattern as /api/gearbox-master/[table]. Each
// table now has a unique tagId (one row per tag; one project can hold N
// tags), so GET/PUT/DELETE key by tagId. `projectId` is still accepted as a
// fallback, resolving to the project's oldest tag (its backfilled "Default")
// so legacy callers and bookmarks keep working while the client is migrated.
const TABLES = {
  "general-info": generalInfoInput,
  "fluid-properties": fluidPropertiesInput,
  "operating-conditions": operatingConditionsInput,
  "moc-sealing": mocSealingInput,
  "motor-drive": motorDriveInput,
  "drive-direct": driveDirectInput,
  "drive-vbelt": driveVbeltInput,
  "drive-geared": driveGearedInput,
  "pump-model-qty": pumpModelQtyInput,
} as const;

type TableKey = keyof typeof TABLES;

// The three mutually-exclusive drive-system tables — a tag has one drive
// system, so at most one of these ever holds a row for a given tag.
const DRIVE_TABLE_KEYS: TableKey[] = ["drive-direct", "drive-vbelt", "drive-geared"];

// Fields the wizard actually sends per table — anything else in the request
// body is ignored rather than trusted straight into the insert/update.
const FIELDS: Record<TableKey, readonly string[]> = {
  "general-info": [
    "capacity", "capacityUnit", "head", "headUnit", "media",
    "sg", "rpmRange", "selectedModel", "selectedHead", "modelConfirmed",
    "wizardStep", "wizardMaxStep",
    "headCalc",
  ],
  "fluid-properties": [
    "viscosity", "viscosityUnit", "viscosityRange", "viscosityCp",
    // Line sizes (inches), defaulted from the viscosity band but user-editable.
    "suctionSize", "dischargeSize", "recommendedSize",
    "sizeRemarks",
    "solidPercentage", "solidSize", "solidSizeMax", "solidSizeMode", "solidType",
    // Temperature + pH are entered on the Fluid step, so they persist here.
    "ph", "temperature", "temperatureRaw", "temperatureUnit",
    // Single-or-range support (see fluid-inputs.ts): mode flags + max bounds.
    "phMax", "phMode",
    "viscosityMax", "viscosityCpMax", "viscosityMode",
    "temperatureMax", "temperatureMaxRaw", "temperatureMode",
  ],
  "operating-conditions": [
    "pumpType", "agBk", "agBkRemarks", "bearingHousing", "suctionHousing", "jointType",
    "negativeSuction", "negativeSuctionSize", "negativeSuctionUnit",
    // Connections + flange standards (moved from Fluid Properties, 2026-10-10).
    "suctionConnection", "suctionFlangeStd", "endConnection", "dischargeFlangeStd",
  ],
  "moc-sealing": [
    "sealingType", "sealingSubType", "glandPackingType", "glandPackingMake",
    "mechSealMoc", "mechSealFace", "mechSealMake", "sealingRemarks",
    // Legacy free-text client-requirements is intentionally omitted from the
    // writable list: the form now uploads a file. Metadata columns for that
    // upload (filename/mime/uploadedAt) live here so restore can rebuild the
    // "attached" state without pulling the bytes.
    "clientRequirementsFilename",
    "clientRequirementsMime",
    "clientRequirementsUploadedAt",
    "mocAiBearingHousing", "mocAiBearingHousingRemarks",
    "mocAiBasePlate", "mocAiBasePlateRemarks",
    "mocAiMountingPlate", "mocAiMountingPlateRemarks",
    "mocAiTieRod", "mocAiTieRodRemarks",
    "mocAiNutBolt", "mocAiNutBoltRemarks",
    "mocAiPumpHousing", "mocAiPumpHousingRemarks",
    "mocAiRotor", "mocAiRotorRemarks",
    "mocAiShaft", "mocAiShaftRemarks",
    "mocAiStatorRubber", "mocAiStatorRubberRemarks",
    "mocAiStatorSleeve", "mocAiStatorSleeveRemarks",
    "mocAiProvider",
    "mocAiSuggestedBearingHousing", "mocAiSuggestedBasePlate",
    "mocAiSuggestedMountingPlate",
    "mocAiSuggestedTieRod", "mocAiSuggestedNutBolt", "mocAiSuggestedPumpHousing",
    "mocAiSuggestedRotor", "mocAiSuggestedShaft", "mocAiSuggestedStatorRubber",
    "mocAiSuggestedStatorSleeve",
    "mocAiSuggestedSummary", "mocAiSuggestedAlternatives",
    "mocAiSuggestedSealRecommendation", "mocAiSuggestedSealMoc", "mocAiSuggestedSealRationale",
    "mocAiGeneratedAt",
  ],
  "motor-drive": [
    "driveMotorKw", "driveMotorKwRemarks", "driveSystem", "motorRPM",
    "driveMotorSpeed", "driveMotorMake", "driveMotorMounting", "driveStdNonStd",
    "driveMotorEfficiency", "driveMotorProtection", "driveMotorFrequency",
    "driveMotorVoltage",
    "driveMotorProtectionPct", "driveMotorFrequencyPct", "driveMotorVoltagePct",
    "driveMotorFrameSize", "driveMotorLpPrice", "driveMotorFinalPrice",
    "driveMotorPriceUplifted",
    "driveMotorConfirmed",
    "driveStarterType", "drivePowerSupply",
    "vfdRequired", "vfdStdHz", "vfdMinHz", "vfdMaxHz",
  ],
  // No fields today — the table exists for structural symmetry (see
  // schema.ts). PUT still succeeds, it just creates/touches an empty row.
  "drive-direct": [],
  "drive-vbelt": [
    "driveVbeltGroove", "drivePumpPulley", "driveMotorPulley", "driveVbeltRpm",
    "driveCenterDistance", "driveVbeltNo", "vbeltConfirmed", "vbeltRpmManual",
  ],
  "drive-geared": [
    "gearBoxType", "gearedConfigType", "gbConstructionType", "gearBoxMounting",
    "driveCoupling", "couplingType", "couplingMake", "asfRange", "gearboxSource", "gearboxModel",
    "gearboxOutputRpm", "gearboxServiceFactor", "gearboxRatePerNos", "gearboxConfirmed",
    "gearboxRpmManual",
  ],
  "pump-model-qty": [
    "productCode", "pumpFamily", "quantity",
    // Code-builder parts (lib/pump-code.ts) — null when picked from the list.
    "codeSeries", "codeSubCategory", "codeSize", "codeStage", "codeModel",
    "codeMoc", "codeRubber", "codeSealing", "codeSubSealing", "codeHousing",
  ],
};

// Columns backed by a Drizzle `timestamp` — Drizzle calls .toISOString() on the
// value, but ISO strings from JSON need coercing back to a Date first.
const TIMESTAMP_FIELDS = new Set<string>([
  "mocAiGeneratedAt",
  "clientRequirementsUploadedAt",
]);

function coerceTimestamp(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && v.trim() !== "") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** "RIL/EN/26-27/1331 · Tag-1 — Saved Fluid Properties" for the audit trail;
 *  falls back to the bare action when the tag can't be resolved. */
async function tagDetail(tagId: string, what: string): Promise<string> {
  const where = await describeTag(tagId);
  return where ? `${where} — ${what}` : what;
}

function resolveTableKey(key: string): TableKey | null {
  return Object.prototype.hasOwnProperty.call(TABLES, key) ? (key as TableKey) : null;
}

function pickFields(tableKey: TableKey, body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of FIELDS[tableKey]) {
    if (key in body) {
      out[key] = TIMESTAMP_FIELDS.has(key)
        ? coerceTimestamp(body[key])
        : key === "headCalc"
          ? normalizeHeadCalc(body[key])
          : body[key];
    }
  }
  return out;
}

// Resolve the tag_id + project_id the request refers to. Accepts `tagId` OR
// `projectId` (the latter picks the project's oldest tag, which is the
// backfilled "Default"). Callers post-migration always send tagId; the
// projectId fallback exists so an older client that hasn't been updated yet
// still hits its Default tag automatically. Returns null when either the
// identifier is missing or it doesn't resolve to a tag.
async function resolveTagContext(
  tagId: string | null,
  projectId: string | null,
): Promise<{ tagId: string; projectId: string } | null> {
  if (tagId) {
    const [row] = await db
      .select({ id: enquiryTags.id, projectId: enquiryTags.projectId })
      .from(enquiryTags)
      .where(eq(enquiryTags.id, tagId))
      .limit(1);
    if (!row) return null;
    return { tagId: row.id, projectId: row.projectId };
  }
  if (projectId) {
    const [row] = await db
      .select({ id: enquiryTags.id, projectId: enquiryTags.projectId })
      .from(enquiryTags)
      .where(eq(enquiryTags.projectId, projectId))
      .orderBy(asc(enquiryTags.createdAt))
      .limit(1);
    if (!row) return null;
    return { tagId: row.id, projectId: row.projectId };
  }
  return null;
}

// Autosaved wizard state for a tag, one table per wizard step (see schema.ts
// for the full split rationale). No auth gate here - same as the projects
// route, this is a small internal tool with no per-user ownership concept;
// the /pump-selection page itself is already gated by middleware.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table: tableParam } = await params;
  const tableKey = resolveTableKey(tableParam);
  if (!tableKey) return error(`Unknown wizard-input table "${tableParam}"`, 400);
  const table = TABLES[tableKey];

  const url = new URL(req.url);
  const ctx = await resolveTagContext(
    url.searchParams.get("tagId"),
    url.searchParams.get("projectId"),
  );
  if (!ctx) {
    return error(
      "'tagId' (or 'projectId' as fallback) is required and must resolve to a tag",
      400,
    );
  }

  const [row] = await db
    .select()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(eq((table as any).tagId, ctx.tagId))
    .limit(1);

  if (!row) {
    return error("No saved input found for this tag", 404);
  }
  // Bytea columns must never travel through this JSON restore path - they
  // have their own binary endpoints. Keeps page loads small and avoids
  // base64-inside-JSON overhead. The metadata columns (filename, mime,
  // uploadedAt) come through unchanged.
  for (const k of ["document", "clientRequirementsFile"] as const) {
    if (k in (row as Record<string, unknown>)) {
      delete (row as Record<string, unknown>)[k];
    }
  }
  return json(row);
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table: tableParam } = await params;
  const tableKey = resolveTableKey(tableParam);
  if (!tableKey) return error(`Unknown wizard-input table "${tableParam}"`, 400);
  const table = TABLES[tableKey];

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const tagIdIn = typeof body.tagId === "string" ? body.tagId : null;
  const projectIdIn = typeof body.projectId === "string" ? body.projectId : null;
  const ctx = await resolveTagContext(tagIdIn, projectIdIn);
  if (!ctx) {
    return error(
      "'tagId' (or 'projectId' as fallback) is required and must resolve to a tag",
      400,
    );
  }

  const values = pickFields(tableKey, body);

  // A save is audited only when a field the user controls actually changed
  // (see lib/wizard-audit.ts) - every step is re-saved on each Next/Previous,
  // so read what's stored before overwriting it.
  //
  // Only the columns being compared are read. A bare select() would also pull
  // moc_sealing_input's two bytea columns - the generated MOC PDF and the
  // uploaded client-requirements file, up to ~0.5 MB - on every MOC save,
  // just to be ignored.
  const sentKeys = Object.keys(values);
  let previous: Record<string, unknown> | undefined;
  if (sentKeys.length > 0) {
    const columns = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sentKeys.map((k) => [k, (table as any)[k]]),
    );
    [previous] = await db
      .select(columns)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from(table as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where(eq((table as any).tagId, ctx.tagId))
      .limit(1);
  }
  const changes = changedFields(previous, values);

  const result = await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(table as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values({ projectId: ctx.projectId, tagId: ctx.tagId, ...values } as any)
    .onConflictDoUpdate({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      target: (table as any).tagId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [row] = result as any[];

  // Drive uniqueness holds PER TAG: a tag has exactly one drive system, so
  // writing one drive-* table clears the other two FOR THIS TAG only. Other
  // tags on the same project keep their own drive rows.
  if (DRIVE_TABLE_KEYS.includes(tableKey)) {
    for (const otherKey of DRIVE_TABLE_KEYS) {
      if (otherKey === tableKey) continue;
      const otherTable = TABLES[otherKey];
      await db
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .delete(otherTable as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where(eq((otherTable as any).tagId, ctx.tagId));
    }
  }

  // Tag lifecycle: the first general-info save with real content flips a
  // still-Pending TAG to In Progress. Never downgrades a tag that's already
  // further along (e.g. "Completed"). Status lives per tag now - a project
  // with multiple tags can have some Completed and others still In Progress.
  if (
    tableKey === "general-info" &&
    Object.values(values).some((v) => v !== "" && v != null)
  ) {
    await db
      .update(enquiryTags)
      .set({ status: "In Progress", updatedAt: new Date() })
      .where(and(eq(enquiryTags.id, ctx.tagId), eq(enquiryTags.status, "Pending")));
  }

  // A save that changed nothing - the step re-sent unchanged on navigation -
  // is persisted above but not audited.
  if (changes.length > 0) {
    await logAudit(req, {
      action: "wizard.save",
      entity: tableKey,
      entityId: ctx.tagId,
      // Names the enquiry + tag AND what changed, so the trail says what was
      // actually worked on rather than just that a save happened.
      detail: await tagDetail(
        ctx.tagId,
        `Updated ${wizardStepLabel(tableKey)}: ${describeChanges(changes)}`,
      ),
    });

    // An approval must match what the selection head saw: a real change to a
    // step that was sent or decided sends it back to Pending (still ticked).
    const affected = approvalStepsForChange(tableKey, changes.map((c) => c.key));
    await auditApprovalReset(req, ctx.tagId, await resetApprovals(ctx.tagId, affected));
  }

  return json(row);
}

/** Records steps whose approval a change just reset. */
async function auditApprovalReset(req: Request, tagId: string, steps: number[]) {
  if (steps.length === 0) return;
  await logAudit(req, {
    action: "approval.reset",
    entity: "step_approval",
    entityId: tagId,
    detail: await tagDetail(
      tagId,
      `Approval reset to Pending after a change: ${steps
        .map((s) => APPROVAL_STEP_LABELS[s] ?? `step ${s}`)
        .join(", ")}`,
    ),
  });
}

// DELETE the row for one wizard-input table, scoped to a tag. Idempotent -
// deleting a row that's already gone returns ok. Used by the Drive Details
// step's Clear button.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ table: string }> },
) {
  const { table: tableParam } = await params;
  const tableKey = resolveTableKey(tableParam);
  if (!tableKey) return error(`Unknown wizard-input table "${tableParam}"`, 400);
  const table = TABLES[tableKey];

  const url = new URL(req.url);
  const ctx = await resolveTagContext(
    url.searchParams.get("tagId"),
    url.searchParams.get("projectId"),
  );
  if (!ctx) {
    return error(
      "'tagId' (or 'projectId' as fallback) is required and must resolve to a tag",
      400,
    );
  }

  await db
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .delete(table as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(eq((table as any).tagId, ctx.tagId));

  await logAudit(req, {
    action: "wizard.clear",
    entity: tableKey,
    entityId: ctx.tagId,
    detail: await tagDetail(ctx.tagId, `Cleared ${wizardStepLabel(tableKey)}`),
  });

  // Clearing a step's data is a change to it, like any other.
  await auditApprovalReset(
    req,
    ctx.tagId,
    await resetApprovals(ctx.tagId, APPROVAL_STEPS_BY_TABLE[tableKey] ?? []),
  );

  return json({ ok: true });
}
