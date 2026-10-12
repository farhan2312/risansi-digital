/**
 * What a selection head sees for each step sent for approval: the step's
 * saved values, labelled and formatted the way the Selection Summary shows
 * them. Used by the review popup (via /api/approvals/[tagId]) and by the
 * request email's one-line highlights, so both describe a step identically.
 *
 * Pure (no DB, no DOM): takes the tag's merged wizard values, one flat object
 * built from every wizard-input table (see loadTagForm in approval-server.ts).
 */
import type { ApprovalStatus } from "./approval";
import { phDisplay, solidSizeDisplay, temperatureDisplay, viscosityDisplay } from "./fluid-inputs";
import { mechSealDescription } from "./mech-seal";
import { PUMP_SUPPORT_LABEL, pumpSupportComponentName } from "./pump-support";
import { frequencyText, voltageText } from "./rating-plate";
import { RPM_BANDS } from "./rpm-bands";
import { gearboxRateItems, upliftedPriceLabel } from "./motor-price";

/** The tag's wizard values, every field as a string ("" when unset). */
export type ApprovalForm = Record<string, string>;

export type DetailItem = [label: string, value: string];

export interface DetailGroup {
  /** Omitted for a step with a single, untitled group. */
  title?: string;
  items: DetailItem[];
  /** The one real selection in the group (V-belt / gearbox / motor pick) —
   *  shown in the confirmed green, as on the Summary step. */
  highlight?: boolean;
}

/** One sent step in the review popup (GET /api/approvals/[tagId]). */
export interface ApprovalReviewStep {
  step: number;
  label: string;
  status: ApprovalStatus;
  sentAt: string | null;
  sentByName: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  remarks: string | null;
  groups: DetailGroup[];
}

/** Everything the review popup shows for one tag. */
export interface ApprovalReview {
  tagId: string;
  tagName: string;
  enquiryCode: string;
  projectName: string;
  customerName: string | null;
  pumpModel: string;
  duty: string;
  media: string;
  steps: ApprovalReviewStep[];
}

const RPM_RANGE_LABELS: Record<string, string> = Object.fromEntries(
  RPM_BANDS.map((b) => [b.key, b.label]),
);

const withRemarks = (value: string, remarks?: string): string =>
  value ? (remarks ? `${value} (${remarks})` : value) : "";

const withUnit = (value: string, unit: string): string => (value ? `${value} ${unit}`.trim() : "");

const withPct = (value: string, pct: string): string =>
  value ? (pct ? `${value} (+${pct}%)` : value) : "";

/** Drops empty rows and empty groups, so a step shows only what was filled. */
const clean = (groups: DetailGroup[]): DetailGroup[] =>
  groups
    .map((g) => ({ ...g, items: g.items.filter(([, v]) => v.trim() !== "") }))
    .filter((g) => g.items.length > 0);

export function approvalStepGroups(step: number, f: ApprovalForm): DetailGroup[] {
  switch (step) {
    case 1:
      return clean([
        {
          items: [
            ["Liquid / Application", f.media],
            ["Capacity", withUnit(f.capacity, f.capacityUnit)],
            ["Head", withUnit(f.head, f.headUnit)],
            ["Specific Gravity", f.sg],
            ["RPM Range", f.rpmRange ? RPM_RANGE_LABELS[f.rpmRange] ?? f.rpmRange : ""],
            ["Pump Model", f.selectedModel],
            ["Selected Head", withUnit(f.selectedHead, "MWC")],
          ],
        },
      ]);
    case 2: {
      const size = solidSizeDisplay(f);
      return clean([
        {
          title: "Fluid",
          items: [
            ["Viscosity", viscosityDisplay(f)],
            ["Viscosity Range", f.viscosityRange ? `${f.viscosityRange} cP` : ""],
            ["pH", phDisplay(f)],
            ["Temperature", temperatureDisplay(f)],
            ["Solids", f.solidPercentage ? `${f.solidPercentage}%` : ""],
            ["Particle Size", size ? `${size} mm${f.solidType ? ` (${f.solidType})` : ""}` : ""],
          ],
        },
        {
          title: "Line sizes",
          items: [
            ["Suction Size", f.suctionSize ? `${f.suctionSize}"` : ""],
            ["Discharge Size", f.dischargeSize ? `${f.dischargeSize}"` : ""],
            ["Suction / Discharge Size Remarks", f.sizeRemarks],
            ["Recommended Size", f.recommendedSize ? `${f.recommendedSize}"` : ""],
          ],
        },
      ]);
    }
    case 3:
      return clean([
        {
          items: [
            ["Type of Pump", f.pumpType],
            ["AG / BK", withRemarks(f.agBk, f.agBkRemarks)],
            [PUMP_SUPPORT_LABEL, f.bearingHousing],
            ["Suction Housing", f.suctionHousing],
            ["Joint Type", f.jointType],
            ["Suction Connection", f.suctionConnection],
            ["Suction Flange Std", f.suctionFlangeStd],
            ["End Connection (Discharge)", f.endConnection],
            ["Discharge Flange Std", f.dischargeFlangeStd],
            ["Negative Suction", f.negativeSuction],
            ["Negative Suction Size", withUnit(f.negativeSuctionSize, f.negativeSuctionUnit || "mt")],
          ],
        },
      ]);
    case 4:
      return clean([
        {
          title: "Wettable parts",
          items: [
            ["Pump Housing", withRemarks(f.mocAiPumpHousing, f.mocAiPumpHousingRemarks)],
            ["Rotor", withRemarks(f.mocAiRotor, f.mocAiRotorRemarks)],
            ["Shaft", withRemarks(f.mocAiShaft, f.mocAiShaftRemarks)],
          ],
        },
        {
          title: "Non-wettable parts",
          items: [
            [
              pumpSupportComponentName(f.bearingHousing),
              withRemarks(f.mocAiBearingHousing, f.mocAiBearingHousingRemarks),
            ],
            ["Base Plate", withRemarks(f.mocAiBasePlate, f.mocAiBasePlateRemarks)],
            ["Mounting Plate", withRemarks(f.mocAiMountingPlate, f.mocAiMountingPlateRemarks)],
            ["Tie Rod", withRemarks(f.mocAiTieRod, f.mocAiTieRodRemarks)],
            ["Nut & Bolt", withRemarks(f.mocAiNutBolt, f.mocAiNutBoltRemarks)],
          ],
        },
        {
          title: "Elastomer",
          items: [
            ["Rubber Stator", withRemarks(f.mocAiStatorRubber, f.mocAiStatorRubberRemarks)],
            ["Stator Sleeve", withRemarks(f.mocAiStatorSleeve, f.mocAiStatorSleeveRemarks)],
          ],
        },
        {
          title: "Client requirements",
          items: [["Attached file", f.clientRequirementsFilename]],
        },
      ]);
    case 5:
      return clean([
        {
          items: [
            ["Sealing Type", f.sealingType],
            ["Mechanical Seal Type", f.sealingSubType],
            ["Seal Description", mechSealDescription(f.sealingSubType)],
            ["Seal MOC", f.mechSealMoc],
            ["Seal Face", f.mechSealFace],
            ["Seal Make", f.mechSealMake],
            ["Gland Packing Type", f.glandPackingType],
            ["Gland Packing Make", f.glandPackingMake],
            ["Remarks", f.sealingRemarks],
          ],
        },
      ]);
    case 6:
      return clean([
        {
          items: [["Drive Motor Rating", withRemarks(withUnit(f.driveMotorKw, "kW"), f.driveMotorKwRemarks)]],
        },
      ]);
    case 7: {
      const isVBelt = f.driveSystem === "V-Belt Drive";
      const isGeared = f.driveSystem === "Geared Motor Drive/Gear Box + Motor";
      const isNonStd = f.driveStdNonStd === "Non-Standard";
      return clean([
        {
          title: "Drive",
          items: [
            ["Drive System", f.driveSystem],
            ["Motor RPM", f.motorRPM],
            ...(isGeared
              ? ([
                  ["Configuration", f.gearedConfigType],
                  ["Gear Box Shaft Type", f.gearBoxType],
                  ["GB Type", f.gbConstructionType],
                  ["Gear Box Mounting", f.gearBoxMounting],
                  ["Coupling", f.driveCoupling],
                  ["Coupling Type", f.couplingType],
                  ["Coupling Make", f.couplingMake],
                  ["ASF Range", f.asfRange],
                ] as DetailItem[])
              : []),
          ],
        },
        {
          title: "Motor",
          items: [
            ["Drive Motor Speed", withUnit(f.driveMotorSpeed, "RPM")],
            ["Drive Motor Make", f.driveMotorMake],
            ["Motor Mounting", f.driveMotorMounting],
            ["Std / Non-Std", f.driveStdNonStd],
            ["Efficiency", f.driveMotorEfficiency],
            ["Protection", isNonStd ? withPct(f.driveMotorProtection, f.driveMotorProtectionPct) : f.driveMotorProtection],
            [
              "Frequency",
              isNonStd
                ? withPct(frequencyText(f.driveMotorFrequency), f.driveMotorFrequencyPct)
                : frequencyText(f.driveMotorFrequency),
            ],
            [
              "Voltage",
              isNonStd
                ? withPct(voltageText(f.driveMotorVoltage), f.driveMotorVoltagePct)
                : voltageText(f.driveMotorVoltage),
            ],
            ["Starter Type", f.driveStarterType],
            ["Power Supply", f.drivePowerSupply],
            ["VFD Required", f.vfdRequired],
            [
              "VFD Hz Range",
              f.vfdRequired === "Yes" && f.vfdMinHz && f.vfdMaxHz
                ? `${f.vfdMinHz}–${f.vfdMaxHz} Hz${f.vfdStdHz ? ` (std ${f.vfdStdHz} Hz)` : ""}`
                : "",
            ],
          ],
        },
        isVBelt
          ? {
              title: "Selected V-Belt option",
              highlight: true,
              items: [
                ["V-Belt Groove", f.driveVbeltGroove],
                ["Pump Pulley", f.drivePumpPulley],
                ["Motor Pulley", f.driveMotorPulley],
                ["Achieved Pump RPM", f.vbeltRpmManual && f.driveVbeltRpm ? `${f.driveVbeltRpm} (entered manually)` : f.driveVbeltRpm],
                ["Centre Distance", f.driveCenterDistance],
                ["V-Belt No.", f.driveVbeltNo],
              ],
            }
          : {
              title: "Selected gearbox",
              highlight: true,
              items: isGeared
                ? [
                    ["Gearbox Source", f.gearboxSource],
                    ["Gearbox Model", f.gearboxModel],
                    ["Gearbox Output RPM", f.gearboxRpmManual && f.gearboxOutputRpm ? `${f.gearboxOutputRpm} (entered manually)` : f.gearboxOutputRpm],
                    ["Gearbox Service Factor", f.gearboxServiceFactor],
                    ...gearboxRateItems(f),
                  ]
                : [],
            },
        {
          title: "Selected motor",
          highlight: true,
          items: [
            ["Motor Frame Size", f.driveMotorFrameSize],
            ["Motor Rating", withUnit(f.driveMotorKw, "kW")],
            ["LP Price", f.driveMotorLpPrice],
            ["Final Price", f.driveMotorFinalPrice],
            [upliftedPriceLabel(f) ?? "Final Non-Standard Price", upliftedPriceLabel(f) ? f.driveMotorPriceUplifted : ""],
          ],
        },
      ]);
    }
    default:
      return [];
  }
}

/** Longer values (a seal description, a remark) don't fit a one-line summary;
 *  the popup shows them in full. */
const HIGHLIGHT_MAX_CHARS = 40;

/** A step's first few short fields on one line, for the request email:
 *  "Viscosity: 2000 cP · pH: 4 · Temperature: 45 °C". */
export function approvalStepHighlights(step: number, f: ApprovalForm, max = 3): string {
  const items = approvalStepGroups(step, f)
    .flatMap((g) => g.items)
    .filter(([, v]) => v.length <= HIGHLIGHT_MAX_CHARS);
  const shown = items.slice(0, max).map(([label, value]) => `${label}: ${value}`).join(" · ");
  return items.length > max ? `${shown} …` : shown;
}
