// Server-only: builds an enquiry's Commercial Summary from the wizard tables
// and the saved prices. Shared by GET /api/commercial and the quotation
// version snapshots, so both always show the same numbers.
import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  boiDrpPanel,
  boiDrpProbe,
  boiMechSeal,
  boiVfd,
  commercialTagPrice,
  pumpShaftDia,
  driveGearedInput,
  enquiryTags,
  generalInfoInput,
  motorDriveInput,
  projects,
  pumpModelQtyInput,
  operatingConditionsInput,
  driveVbeltInput,
  fluidPropertiesInput,
  mocSealingInput,
  users,
} from "@/lib/db/schema";
import {
  type CommercialReference,
  type CommercialSummary,
  type CommercialTag,
  type DriveGroup,
  type VfdMasterRow,
  drpOptionFor,
  mechSealOptionFor,
  type MechSealRow,
  driveGroupOf,
  emptyPrices,
  groupsIn,
  parseQuantity,
  vfdOptionsFor,
} from "@/lib/commercial";
import { VFD_YES } from "@/lib/recheck-calc";
import { gearboxUpliftedRate } from "@/lib/motor-price";
import { partsFromFields } from "@/lib/pump-code";
import { finalPumpRpm } from "@/lib/recheck-calc";
import { partsFromProductCode } from "@/lib/pa-price";

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// BOI Master tables the summary matches tags against — small and rarely
// edited, so kept in memory for a minute (one round trip and connection fewer
// per page open). Any BOI Master write calls forgetBoiMasters().
const BOI_MASTER_TTL_MS = 60_000;
const boiCache = globalThis as unknown as {
  __pumpBoiMasters?: { at: number; p: Promise<BoiMasters> };
};
type BoiMasters = Awaited<ReturnType<typeof readBoiMasters>>;
// One after another on purpose: they then share one connection, where in
// parallel each would open its own (~0.5 s apiece to Azure when the pool is cold).
async function readBoiMasters() {
  const vfd = await db.select().from(boiVfd);
  const shafts = await db.select().from(pumpShaftDia);
  const probes = await db.select().from(boiDrpProbe);
  const panels = await db.select().from(boiDrpPanel).orderBy(asc(boiDrpPanel.srNo));
  const seals = await db.select().from(boiMechSeal);
  return [vfd, shafts, probes, panels, seals] as const;
}
function boiMasters(): Promise<BoiMasters> {
  const c = boiCache.__pumpBoiMasters;
  if (c && Date.now() - c.at < BOI_MASTER_TTL_MS) return c.p;
  const p = readBoiMasters();
  boiCache.__pumpBoiMasters = { at: Date.now(), p };
  p.catch(() => {
    if (boiCache.__pumpBoiMasters?.p === p) boiCache.__pumpBoiMasters = undefined;
  });
  return p;
}
/** Drop the cached BOI Master tables (after a BOI Master add / edit / delete). */
export function forgetBoiMasters(): void {
  boiCache.__pumpBoiMasters = undefined;
}

/** The enquiry's Commercial Summary, or null when the enquiry doesn't exist. */
export async function loadCommercialSummary(projectId: string): Promise<CommercialSummary | null> {
  // Every query at once — each is a round trip to the DB, and none needs another's result.
  const projectQ = db
    .select({
      id: projects.id,
      code: projects.projectCode,
      name: projects.name,
      customerName: projects.customerName,
      clientCode: projects.clientCode,
      remarks: projects.commercialRemarks,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const rowsQ = db
    .select({
      tagId: enquiryTags.id,
      tagName: enquiryTags.name,
      status: enquiryTags.status,
      model: generalInfoInput.selectedModel,
      modelConfirmed: generalInfoInput.modelConfirmed,
      media: generalInfoInput.media,
      pumpType: operatingConditionsInput.pumpType,
      motorRpm: motorDriveInput.motorRPM,
      vbeltRpm: driveVbeltInput.driveVbeltRpm,
      vbeltRpmManual: driveVbeltInput.vbeltRpmManual,
      gbRpmManual: driveGearedInput.gearboxRpmManual,
      quantity: pumpModelQtyInput.quantity,
      productCode: pumpModelQtyInput.productCode,
      qty: pumpModelQtyInput,
      suctionSize: fluidPropertiesInput.suctionSize,
      dischargeSize: fluidPropertiesInput.dischargeSize,
      recommendedSize: fluidPropertiesInput.recommendedSize,
      negativeSuction: operatingConditionsInput.negativeSuction,
      negativeSuctionSize: operatingConditionsInput.negativeSuctionSize,
      negativeSuctionUnit: operatingConditionsInput.negativeSuctionUnit,
      basePlate: mocSealingInput.mocAiBasePlate,
      statorRubber: mocSealingInput.mocAiStatorRubber,
      sealingType: mocSealingInput.sealingType,
      sealingSubType: mocSealingInput.sealingSubType,
      mechSealMake: mocSealingInput.mechSealMake,
      mechSealMoc: mocSealingInput.mechSealMoc,
      mechSealFace: mocSealingInput.mechSealFace,
      driveSystem: motorDriveInput.driveSystem,
      motorMake: motorDriveInput.driveMotorMake,
      motorKw: motorDriveInput.driveMotorKw,
      motorFrame: motorDriveInput.driveMotorFrameSize,
      motorFinal: motorDriveInput.driveMotorFinalPrice,
      motorUplifted: motorDriveInput.driveMotorPriceUplifted,
      motorConfirmed: motorDriveInput.driveMotorConfirmed,
      vfdRequired: motorDriveInput.vfdRequired,
      gearedConfig: driveGearedInput.gearedConfigType,
      gbSource: driveGearedInput.gearboxSource,
      gbModel: driveGearedInput.gearboxModel,
      gbRpm: driveGearedInput.gearboxOutputRpm,
      gbRate: driveGearedInput.gearboxRatePerNos,
      gbMounting: driveGearedInput.gearBoxMounting,
      gbConfirmed: driveGearedInput.gearboxConfirmed,
      price: commercialTagPrice,
      updatedByName: users.name,
    })
    .from(enquiryTags)
    .leftJoin(generalInfoInput, eq(generalInfoInput.tagId, enquiryTags.id))
    .leftJoin(pumpModelQtyInput, eq(pumpModelQtyInput.tagId, enquiryTags.id))
    .leftJoin(fluidPropertiesInput, eq(fluidPropertiesInput.tagId, enquiryTags.id))
    .leftJoin(mocSealingInput, eq(mocSealingInput.tagId, enquiryTags.id))
    .leftJoin(motorDriveInput, eq(motorDriveInput.tagId, enquiryTags.id))
    .leftJoin(driveGearedInput, eq(driveGearedInput.tagId, enquiryTags.id))
    .leftJoin(operatingConditionsInput, eq(operatingConditionsInput.tagId, enquiryTags.id))
    .leftJoin(driveVbeltInput, eq(driveVbeltInput.tagId, enquiryTags.id))
    .leftJoin(commercialTagPrice, eq(commercialTagPrice.tagId, enquiryTags.id))
    .leftJoin(users, eq(users.id, commercialTagPrice.updatedBy))
    .where(eq(enquiryTags.projectId, projectId))
    .orderBy(asc(enquiryTags.createdAt));

  // BOI Master tables — small, read once and matched per tag.
  const [[project], rows, [vfdMaster, drpShafts, drpProbes, drpPanels, sealMaster]] = await Promise.all([
    projectQ,
    rowsQ,
    boiMasters(),
  ]);
  if (!project) return null;

  const vfdRows: VfdMasterRow[] = vfdMaster.map((v) => ({
    driveDescription: v.driveDescription,
    make: v.make,
    series: v.series,
    frame: v.frame,
    pnKw: num(v.pnKw),
    pldKw: num(v.pldKw),
    phdKw: num(v.phdKw),
    listPrice: num(v.listPrice),
    discountPct: num(v.discountPct),
    bopExtra: num(v.bopExtra),
  }));

  // BOI Master DRP: shaft dia per model, probe sizes, the (single) panel.
  const shafts = drpShafts.map((s) => ({ model: s.model, shaftDia: num(s.shaftDia) }));
  const probes = drpProbes.map((p) => ({ description: p.description, sizeMm: Number(p.sizeMm), ratePerNos: num(p.ratePerNos) }));
  const panel = drpPanels[0] ? { description: drpPanels[0].description, ratePerNos: num(drpPanels[0].ratePerNos) } : null;

  const sealRows: MechSealRow[] = sealMaster.map((m) => ({
    make: m.make,
    series: m.series,
    drawingNo: m.drawingNo,
    shaftSizeMm: Number(m.shaftSizeMm),
    type: m.type,
    material304: m.material304,
    price304: num(m.price304),
    material316: m.material316,
    price316: num(m.price316),
  }));
  const shaftOf = (model: string | null) =>
    model ? (shafts.find((s) => s.model.trim().toUpperCase() === model.trim().toUpperCase())?.shaftDia ?? null) : null;

  const tags: CommercialTag[] = rows.map((r) => {
    const drp = drpOptionFor(r.model || null, shafts, probes, panel);
    const vfdRequired = r.vfdRequired === VFD_YES;
    const motorKw = num(r.motorKw);
    // The wizard's motor pick, for every drive configuration — "Geared Motor"
    // tags pick a motor on the Drive step too (all of them have one saved).
    const motorRef: CommercialReference | null =
      r.motorMake
        ? {
            label: [r.motorMake, r.motorKw ? `${r.motorKw} kW` : null, r.motorFrame ? `Frame ${r.motorFrame}` : null]
              .filter(Boolean)
              .join(" · "),
            price: num(r.motorUplifted) ?? num(r.motorFinal),
            confirmed: !!r.motorConfirmed,
          }
        : null;
    const gearboxRef: CommercialReference | null = r.gbModel
      ? {
          label: [r.gbSource, r.gbModel, r.gbRpm ? `${r.gbRpm} RPM` : null].filter(Boolean).join(" · "),
          price: gearboxUpliftedRate(r.gbRate, r.gbMounting),
          confirmed: !!r.gbConfirmed,
        }
      : null;
    const p = r.price;
    return {
      tagId: r.tagId,
      tagName: r.tagName,
      status: r.status,
      model: r.model || null,
      modelConfirmed: !!r.modelConfirmed,
      media: r.media || null,
      driveSystem: r.driveSystem || null,
      driveGroup: driveGroupOf(r.driveSystem, r.gearedConfig),
      quantity: parseQuantity(r.quantity),
      productCode: r.productCode || null,
      codeParts: r.qty ? partsFromFields(r.qty) : null,
      // Same values as the Technical Data Sheet's rows (lib/tech-doc).
      tech: {
        liquid: r.media || "",
        pumpType: r.pumpType || "",
        pumpSpeed: (() => {
          const rpm = finalPumpRpm({
            driveSystem: r.driveSystem ?? undefined,
            driveVbeltRpm: r.vbeltRpm ?? undefined,
            vbeltRpmManual: r.vbeltRpmManual ?? undefined,
            gearboxOutputRpm: r.gbRpm ?? undefined,
            gearboxRpmManual: r.gbRpmManual ?? undefined,
            motorRPM: r.motorRpm ?? undefined,
          } as never).raw;
          return rpm ? `${rpm} RPM` : "";
        })(),
        motorKw: r.motorKw ? `${r.motorKw} kW` : "",
      },
      paHints: {
        basePlate: r.basePlate || null,
        recommendedSize: r.recommendedSize || null,
        dischargeSize: r.dischargeSize || null,
        pumpType: r.pumpType || null,
        negativeDepth: r.negativeSuction === "Yes" ? r.negativeSuctionSize || null : null,
        negativeDepthUnit: r.negativeSuction === "Yes" ? r.negativeSuctionUnit || null : null,
      },
      codeHints: {
        model: r.model || null,
        suctionSize: r.suctionSize || null,
        statorRubber: r.statorRubber || null,
        sealingType: r.sealingType || null,
        sealingSubType: r.sealingSubType || null,
      },
      motorRef,
      gearboxRef,
      vfdRequired,
      motorKw,
      // Offered for every tag with a motor kW — the VFD BOI does not depend on
      // the Drive step's VFD Required answer (user, 2026-10-03).
      vfdOptions: vfdOptionsFor(vfdRows, motorKw),
      drpOption: drp.option,
      drpNote: drp.note,
      ...(() => {
        // Auger pumps (sub-category AG / BAG on the product code) take the
        // "AUGAR" seal row where the list has one.
        const parts = r.qty ? partsFromFields(r.qty) : null;
        const sub = parts ? parts.subCategory : partsFromProductCode(r.productCode || null).subCategory;
        const ms = mechSealOptionFor(
          { sealingType: r.sealingType || null, type: r.sealingSubType || null, make: r.mechSealMake || null, moc: r.mechSealMoc || null, face: r.mechSealFace || null },
          shaftOf(r.model || null),
          sub === "AG" || sub === "BAG",
          sealRows,
        );
        return { mechSealOption: ms.option, mechSealNote: ms.note };
      })(),
      prices: p
        ? {
            paPrice: num(p.paPrice),
            motorPrice: num(p.motorPrice),
            gearboxPrice: num(p.gearboxPrice),
            vfdPrice: num(p.vfdPrice),
            mechSealPrice: num(p.mechSealPrice),
            mechSealModel: p.mechSealModel || null,
            vfdModel: p.vfdModel || null,
            drpModel: p.drpModel || null,
            paBasis: p.paBasis || null,
            strainerPrice: num(p.strainerPrice),
            prvPrice: num(p.prvPrice),
            drpPrice: num(p.drpPrice),
            others: Array.isArray(p.others) ? p.others : [],
            remarks: p.remarks ?? "",
            adjust: (p.boiAdjust ?? {}) as CommercialTag["prices"]["adjust"],
          }
        : emptyPrices(),
      updatedAt: p?.updatedAt ? p.updatedAt.toISOString() : null,
      updatedByName: p ? (r.updatedByName ?? null) : null,
    };
  });

  return { project: { ...project, remarks: project.remarks ?? "" }, tags };
}

/** Each tag's drive group (null = no drive system yet), keyed by tag id. */
export async function tagDriveGroups(projectId: string): Promise<Map<string, DriveGroup | null>> {
  const rows = await db
    .select({ tagId: enquiryTags.id, driveSystem: motorDriveInput.driveSystem, gearedConfig: driveGearedInput.gearedConfigType })
    .from(enquiryTags)
    .leftJoin(motorDriveInput, eq(motorDriveInput.tagId, enquiryTags.id))
    .leftJoin(driveGearedInput, eq(driveGearedInput.tagId, enquiryTags.id))
    .where(eq(enquiryTags.projectId, projectId));
  return new Map(rows.map((r) => [r.tagId, driveGroupOf(r.driveSystem, r.gearedConfig)]));
}

/** The drive groups the enquiry's tags use; more than one = "mixed", which
 *  puts the group code after the quotation serial. */
export async function projectDriveGroups(projectId: string): Promise<DriveGroup[]> {
  return groupsIn([...(await tagDriveGroups(projectId)).values()]);
}
