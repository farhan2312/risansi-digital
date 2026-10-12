"use client";

import "./GeneralInformationStep.css";
import Stepper from "./Stepper";
import { useEffect, useState } from "react";
import PdfPreviewModal from "../ui/PdfPreviewModal";
import { gearboxRateItems, upliftedPriceLabel } from "../../lib/motor-price";
import { getRecommendations } from "../../services/recommendationService";
import { SIZE_COLUMN_BY_RANGE, sizeOverride } from "../../lib/suction-discharge-size";
import { sealingShort } from "../../lib/sealing";
import { AG_BK_NOT_REQUIRED } from "./OperatingConditionsStep";
import { RPM_BANDS } from "../../lib/rpm-bands";
import {
  PUMP_SUPPORT_LABEL,
  pumpSupportComponentName,
} from "../../lib/pump-support";
import {
  phDisplay,
  solidSizeDisplay,
  temperatureDisplay,
  viscosityDisplay,
} from "../../lib/fluid-inputs";
import {
  downloadRecheckPdf,
  downloadSelectionSummaryPdf,
  type SelectionSummaryPdfSection,
} from "../../lib/selection-summary-pdf";
import { computeRecheck, finalPumpRpm, recheckTables } from "../../lib/recheck-calc";
import { mechSealDescription } from "./SealingDetailsStep";
import { frequencyText, voltageText } from "../../lib/rating-plate";
import { getReportSummary, saveReportSummary, uploadFinalReport } from "../../services/reportsService";
import { downloadSelectionSummaryExcel } from "../../lib/selection-summary-excel";
import { useCurrentUser } from "../../contexts/CurrentUserContext";
import { getMotorRating, type MotorRating } from "../../services/motorRatingService";
import type {
  PumpRecommendation,
  PumpSelectionFormData,
} from "../../data/Recommendations";

type Props = {
  onPrevious: () => void;
  formData: PumpSelectionFormData;
  selectedPump: number | null;
  setSelectedPump: React.Dispatch<React.SetStateAction<number | null>>;
  onStepClick?: (step: number) => void;
  /** Open project's id + display info — needed to upload the generated
   * report so it's saved on the project (see handleConfirmSelection). */
  projectId?: string;
  /** The tag being edited. Kept for parity with other steps; not used yet. */
  tagId?: string;
  projectCode?: string;
  projectName?: string;
  customerName?: string;
  /** The tag's name - used in the Recheck PDF file name. */
  tagName?: string;
};

// Combines a manual material selection with its open-remarks note into one
// summary line, e.g. "SS304 (verify with client spec)".
// Line sizes are always inches. Prefer what the user entered on the Fluid
// step; fall back to the size derived from the confirmed model / viscosity
// band for drafts saved before those fields existed.
const sizeText = (entered: string | undefined, derived: number | null): string => {
  const value = (entered ?? "").trim() || (derived !== null ? String(derived) : "");
  return value ? `${value}"` : "";
};

// "30–60 Hz (std 50 Hz)" — empty unless the motor is on a VFD with a range.
const vfdRangeText = (f: {
  vfdRequired?: string;
  vfdMinHz?: string;
  vfdMaxHz?: string;
  vfdStdHz?: string;
}): string => {
  if (f.vfdRequired !== "Yes" || !f.vfdMinHz || !f.vfdMaxHz) return "";
  return `${f.vfdMinHz}–${f.vfdMaxHz} Hz${f.vfdStdHz ? ` (std ${f.vfdStdHz} Hz)` : ""}`;
};

const withRemarks = (value?: string, remarks?: string): string | undefined => {
  if (!value) return undefined;
  return remarks ? `${value} (${remarks})` : value;
};

// Derived from the single band table in recommendation-engine.ts, so a label
// here can never disagree with the bounds screening uses.
const RPM_RANGE_LABELS: Record<string, string> = Object.fromEntries(
  RPM_BANDS.map((b) => [b.key, b.label]),
);

type FieldItem = [string, string | undefined];

// One labeled value pair, filtered to only the ones with a real value —
// used inside every report section box below.
const FieldGrid = ({ items, tone = "default" }: { items: FieldItem[]; tone?: "default" | "pos" }) => {
  const filled = items.filter(([, v]) => v && String(v).trim() !== "");
  if (filled.length === 0) return null;
  const labelClass = tone === "pos" ? "text-[var(--pos-strong)]/75" : "text-fg-3";
  const valueClass = tone === "pos" ? "text-[var(--pos-strong)]" : "text-fg";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {filled.map(([label, value]) => (
        <div key={label} className="flex flex-col">
          <span className={`text-[11px] uppercase tracking-wide ${labelClass}`}>{label}</span>
          <strong className={`text-[13.5px] font-semibold ${valueClass}`}>{value}</strong>
        </div>
      ))}
    </div>
  );
};

// Only used to decide whether to render a Section at all (Section itself
// re-filters via FieldGrid) — avoids an empty bordered box for a step the
// user hasn't touched.
const hasAny = (items: FieldItem[]) => items.some(([, v]) => v && String(v).trim() !== "");

// One step's box: label header + its field grid. Renders nothing if every
// field in `items` is empty, so untouched steps don't leave a hollow box.
const Section = ({
  title,
  items,
  children,
}: {
  title: string;
  items?: FieldItem[];
  children?: React.ReactNode;
}) => {
  if (items && !hasAny(items) && !children) return null;
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-line bg-paper">
      <div className="border-b border-line bg-elev px-4 py-2.5">
        <span className="section-label">{title}</span>
      </div>
      <div className="p-4">
        {items && <FieldGrid items={items} />}
        {children}
      </div>
    </div>
  );
};

// Read-only summary step: the pump model was already picked + confirmed after
// the Fluid step, so this just reviews the confirmed model and every spec
// configured along the way. No re-picking here.
const RecommendationStep = ({
  onPrevious,
  formData,
  onStepClick,
  projectId,
  tagId,
  projectCode,
  projectName,
  customerName,
  tagName,
}: Props) => {
  const { user } = useCurrentUser();
  const [recommendations, setRecommendations] = useState<PumpRecommendation[]>([]);
  const [inputEcho, setInputEcho] = useState<{ capacity: string; head: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getRecommendations(formData)
      .then((result) => {
        if (!cancelled) {
          setRecommendations(result.recommendations);
          setInputEcho(result.input);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "Couldn't load the pump summary. Please check your connection and try again."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Values are computed at the INPUT duty head (the engine's duty-point row),
  // not the head card the user clicked — motor rating / drive / report all key
  // off the entered head, so the summary matches them.
  const confirmedPump =
    recommendations.find((p) => p.model === formData.selectedModel) || null;

  // The confirmed model's own per-viscosity size (null when the model has no
  // size for this range - then only what was entered is shown). Lifted out of
  // the card's render so the PDF export below can reuse the exact same value.
  const cardSize = confirmedPump
    ? (() => {
        const col = SIZE_COLUMN_BY_RANGE[formData.viscosityRange as string];
        return col ? confirmedPump[col] ?? null : null;
      })()
    : null;

  // --- Field groups, one per wizard step, in wizard order ------------------

  // These two lists mirror what each wizard step actually collects — see
  // GeneralInformationStep / FluidPropertiesStep. Temperature and pH belong to
  // the Fluid step (they were moved there), not General Information.
  // --- Quotation-format field groups (single liquid), mirroring the Risansi
  // technical-quotation layout: Liquid Parameters, Material of Construction,
  // Sealing Type, Pump Details, Drive Systems.

  const liquidParametersItems: FieldItem[] = [
    ["Liquid / Application", formData.media],
    ["Type of Pump", formData.pumpType],
    ["Pump Model", confirmedPump ? confirmedPump.model : ""],
    ["Capacity", formData.capacity ? `${formData.capacity} ${formData.capacityUnit || ""}`.trim() : ""],
    ["Head", formData.head ? `${formData.head} ${formData.headUnit || ""}`.trim() : ""],
    ["Specific Gravity", formData.sg],
    ["pH", phDisplay(formData)],
    ["Temperature", temperatureDisplay(formData)],
    ["Viscosity", viscosityDisplay(formData)],
    ["Viscosity Range", formData.viscosityRange ? `${formData.viscosityRange} cP` : ""],
    ["Suction Connection", formData.suctionConnection],
    ["Suction Flange Std", formData.suctionFlangeStd],
    ["End Connection (Discharge)", formData.endConnection],
    ["Discharge Flange Std", formData.dischargeFlangeStd],
    ["Solids", formData.solidPercentage ? `${formData.solidPercentage}%` : ""],
    [
      "Particle Size",
      solidSizeDisplay(formData)
        ? `${solidSizeDisplay(formData)} mm${formData.solidType ? ` (${formData.solidType})` : ""}`
        : "",
    ],
    ["AG / BK", withRemarks(formData.agBk, formData.agBkRemarks)],
    ["RPM Range", formData.rpmRange ? RPM_RANGE_LABELS[formData.rpmRange] ?? formData.rpmRange : ""],
  ];

  const materialOfConstructionItems: FieldItem[] = [
    [
      pumpSupportComponentName(formData.bearingHousing),
      withRemarks(formData.mocAiBearingHousing, formData.mocAiBearingHousingRemarks),
    ],
    ["Pump Housing", withRemarks(formData.mocAiPumpHousing, formData.mocAiPumpHousingRemarks)],
    ["Shaft", withRemarks(formData.mocAiShaft, formData.mocAiShaftRemarks)],
    ["Rotor", withRemarks(formData.mocAiRotor, formData.mocAiRotorRemarks)],
    ["Rubber Stator", withRemarks(formData.mocAiStatorRubber, formData.mocAiStatorRubberRemarks)],
    ["Stator Sleeve", withRemarks(formData.mocAiStatorSleeve, formData.mocAiStatorSleeveRemarks)],
    // Only one plate applies per pump type; FieldGrid drops the empty one.
    ["Base Plate", withRemarks(formData.mocAiBasePlate, formData.mocAiBasePlateRemarks)],
    ["Mounting Plate", withRemarks(formData.mocAiMountingPlate, formData.mocAiMountingPlateRemarks)],
    ["Tie Rod", withRemarks(formData.mocAiTieRod, formData.mocAiTieRodRemarks)],
    ["Nut & Bolt", withRemarks(formData.mocAiNutBolt, formData.mocAiNutBoltRemarks)],
  ];

  const pumpDetailsItems: FieldItem[] = confirmedPump
    ? [
        // Entered on the Fluid step (pre-filled from the recommendation, then
        // editable), so the user's own value wins over the derived one. One
        // remark explains an override of either size.
        ["Suction Size", sizeText(formData.suctionSize, cardSize)],
        ["Discharge Size", sizeText(formData.dischargeSize, cardSize)],
        ["Suction / Discharge Size Remarks", formData.sizeRemarks],
        ["Pump Speed (RPM)", confirmedPump.rpmRange],
        ["Pump Stage", confirmedPump.stage != null ? String(confirmedPump.stage) : ""],
        [
          "VOLE Min–Max",
          confirmedPump.voleMin != null && confirmedPump.voleMax != null
            ? `${confirmedPump.voleMin}–${confirmedPump.voleMax}%`
            : "",
        ],
        ["Mechanical Efficiency", confirmedPump.mechEff != null ? `${confirmedPump.mechEff}%` : ""],
        [PUMP_SUPPORT_LABEL, formData.bearingHousing],
        ["Suction Housing", formData.suctionHousing],
        ["Joint Type", formData.jointType],
        // "Yes — 1.5 mt" / "No". Empty (and dropped by FieldGrid) on older
        // tags saved before the Yes/No question existed.
        [
          "Negative Suction",
          formData.negativeSuction === "Yes"
            ? `Yes${formData.negativeSuctionSize ? ` — ${formData.negativeSuctionSize} ${formData.negativeSuctionUnit || "mt"}` : ""}`
            : formData.negativeSuction ?? "",
        ],
      ]
    : [];

  const sealingItems: FieldItem[] = [
    ["Sealing Type", formData.sealingType],
    // Mechanical Seal detail (empty rows are dropped by FieldGrid, so only the
    // fields relevant to the chosen arrangement show).
    ["Mechanical Seal Type", formData.sealingSubType],
    // Derived from the seal type (not stored) - same source the Sealing step's
    // description box uses, so the summary and PDF read identically.
    ["Seal Description", mechSealDescription(formData.sealingSubType)],
    ["Seal MOC", formData.mechSealMoc],
    ["Seal Face", formData.mechSealFace],
    ["Seal Make", formData.mechSealMake],
    // Gland Packing detail.
    ["Gland Packing Type", formData.glandPackingType],
    ["Gland Packing Make", formData.glandPackingMake],
  ];

  // A rating other than the calculated one carries its justification with it.
  const motorRatingText = withRemarks(
    formData.driveMotorKw ? `${formData.driveMotorKw} kW` : "",
    formData.driveMotorKwRemarks,
  );

  const motorRatingItems: FieldItem[] = [["Drive Motor Rating", motorRatingText]];

  const driveCommonItems: FieldItem[] = [
    ["Drive System", formData.driveSystem],
    ["Motor RPM", formData.motorRPM],
    ["Drive Motor Rating", motorRatingText],
  ];

  const isVBelt = formData.driveSystem === "V-Belt Drive";
  const isGeared = formData.driveSystem === "Geared Motor Drive/Gear Box + Motor";

  // The specific option actually picked on the Drive step — highlighted in
  // the report's positive/confirmed green, same convention as the MOC AI
  // recommendation cells, so the one real selection stands out from the
  // surrounding read-only spec fields.
  const vbeltSelectedItems: FieldItem[] = [
    ["V-Belt Groove", formData.driveVbeltGroove],
    ["Pump Pulley", formData.drivePumpPulley],
    ["Motor Pulley", formData.driveMotorPulley],
    ["Achieved Pump RPM", formData.driveVbeltRpm],
    ["Centre Distance", formData.driveCenterDistance],
    ["V-Belt No.", formData.driveVbeltNo],
  ];
  // Non-Standard pairs each rating-plate field with a % price uplift; for
  // Standard those percentages don't apply, so they're folded in only when set.
  const withPct = (value: unknown, pctValue: unknown): string => {
    const v = value ? String(value) : "";
    const p = pctValue ? String(pctValue) : "";
    if (!v) return "";
    return p ? `${v} (+${p}%)` : v;
  };
  const isNonStd = formData.driveStdNonStd === "Non-Standard";
  const vbeltInputItems: FieldItem[] = [
    ["Drive Motor Speed", formData.driveMotorSpeed ? `${formData.driveMotorSpeed} RPM` : ""],
    ["Drive Motor Make", formData.driveMotorMake],
    ["Motor Mounting", formData.driveMotorMounting],
    ["Std / Non-Std", formData.driveStdNonStd],
    // Efficiency has no % uplift — it selects the motor type, not the price.
    ["Efficiency", formData.driveMotorEfficiency],
    [
      "Protection",
      isNonStd
        ? withPct(formData.driveMotorProtection, formData.driveMotorProtectionPct)
        : formData.driveMotorProtection,
    ],
    [
      "Frequency",
      isNonStd
        ? withPct(frequencyText(formData.driveMotorFrequency), formData.driveMotorFrequencyPct)
        : frequencyText(formData.driveMotorFrequency),
    ],
    [
      "Voltage",
      isNonStd
        ? withPct(voltageText(formData.driveMotorVoltage), formData.driveMotorVoltagePct)
        : voltageText(formData.driveMotorVoltage),
    ],
    ["Starter Type", formData.driveStarterType],
    ["Power Supply", formData.drivePowerSupply],
    ["VFD Required", formData.vfdRequired],
    ["VFD Hz Range", vfdRangeText(formData)],
  ];

  // The motor actually picked from the motor master — surfaced in its own
  // highlighted box, mirroring the "Selected V-Belt / Gearbox Option" design
  // so the two confirmed selections read the same way.
  const motorSelectedItems: FieldItem[] = [
    ["Motor Make", formData.driveMotorMake],
    ["Motor Frame Size", formData.driveMotorFrameSize],
    ["Motor Rating (kW)", formData.driveMotorKw],
    ["Motor Type", formData.driveMotorEfficiency],
    ["LP Price", formData.driveMotorLpPrice],
    ["Final Price", formData.driveMotorFinalPrice],
    // A Standard foot-mounted motor has no uplift, so the uplifted figure
    // would just repeat Final Price — the row appears only for Non-Standard
    // and/or a flange mounting (lib/motor-price.ts).
    ...(upliftedPriceLabel(formData)
      ? ([[upliftedPriceLabel(formData)!, formData.driveMotorPriceUplifted]] as FieldItem[])
      : []),
  ];

  const gearedSelectedItems: FieldItem[] = [
    ["Gearbox Source", formData.gearboxSource],
    ["Gearbox Model", formData.gearboxModel],
    ["Gearbox Output RPM", formData.gearboxOutputRpm],
    ["Gearbox Service Factor", formData.gearboxServiceFactor],
    ...gearboxRateItems(formData),
  ];
  const gearedInputItems: FieldItem[] = [
    ["Configuration", formData.gearedConfigType],
    ["Gear Box Shaft Type", formData.gearBoxType],
    ["GB Type", formData.gbConstructionType],
    ["Gear Box Mounting", formData.gearBoxMounting],
    ["Coupling", formData.driveCoupling],
    // Only populated when a real coupling is present; FieldGrid drops empties.
    ["Coupling Type", formData.couplingType],
    ["Coupling Make", formData.couplingMake],
    ["ASF Range", formData.asfRange],
  ];

  const driveSelectedItems = isVBelt ? vbeltSelectedItems : isGeared ? gearedSelectedItems : [];
  // The motor/rating-plate inputs (vbeltInputItems) apply to every drive
  // system now — not just V-Belt — so they always show, with the geared-only
  // gearbox configuration fields appended when that drive type is chosen.
  const driveInputItems: FieldItem[] = isGeared
    ? [...gearedInputItems, ...vbeltInputItems]
    : vbeltInputItems;
  const driveHasAnything =
    hasAny(driveCommonItems) ||
    hasAny(driveSelectedItems) ||
    hasAny(driveInputItems) ||
    hasAny(motorSelectedItems);

  // Pump data now lives in the Liquid Parameters + Pump Details sections
  // (quotation layout), so there's no separate top "Pump Selection" block.
  const pumpFields: FieldItem[] = [];

  // Same section list the on-screen boxes render — single source of truth
  // for what "Confirm Pump Selection" bakes into the saved PDF.
  const pdfSections: SelectionSummaryPdfSection[] = [
    { title: "Liquid Parameters", items: liquidParametersItems },
    { title: "Material of Construction", items: materialOfConstructionItems },
    { title: "Sealing Type", items: sealingItems },
    { title: "Pump Details", items: pumpDetailsItems },
    { title: "Drive Systems", items: [...driveCommonItems, ...driveInputItems] },
    {
      title: `Selected ${isVBelt ? "V-Belt" : "Gearbox"} Option`,
      items: driveSelectedItems,
      highlight: true,
    },
    // Motor type & rating are already carried in Drive Systems above, so no
    // separate "Selected Motor" section in the PDF.
  ];

  // The Drive step's Recheck popup, recomputed here from the same pump data
  // (lib/recheck-calc) so it can be downloaded as a PDF. Null until there is
  // a confirmed pump and a drive with a final pump RPM.
  const recheck = (() => {
    if (!confirmedPump) return null;
    const rpm = finalPumpRpm(formData);
    return recheckTables(
      formData,
      computeRecheck(formData, confirmedPump, rpm.raw),
      confirmedPump.model,
      rpm.source,
    );
  })();
  // The Live Recommendation card for the picked pump, at the head the user
  // picked — same figures, so the Recheck PDF shows which pump it is for.
  const recheckPumpCard = (() => {
    if (!confirmedPump) return undefined;
    const point =
      confirmedPump.headPoints?.find((p) => String(p.headMwc) === String(formData.selectedHead)) ?? null;
    const suction = sizeOverride(formData.suctionSize, cardSize);
    const discharge = sizeOverride(formData.dischargeSize, cardSize);
    const agBk = formData.agBk === AG_BK_NOT_REQUIRED ? "" : formData.agBk;
    const typeLine = [formData.pumpType, agBk, sealingShort(formData.sealingType)].filter(Boolean).join(" · ");
    return {
      model: confirmedPump.model,
      badges: [
        ...(formData.modelConfirmed ? ["Confirmed"] : []),
        ...(confirmedPump.isTested === false ? ["Not Tested"] : []),
      ],
      fields: [
        ["Stage", confirmedPump.stage != null ? String(confirmedPump.stage) : "—"],
        [
          "Head",
          point ? `${point.headMwc} MWC` : confirmedPump.headBandMwc ? `${confirmedPump.headBandMwc} MWC` : "—",
        ],
        ["Qth", confirmedPump.qth != null ? String(confirmedPump.qth) : "—"],
        ["RPM", point ? String(point.rpmRange) : "—"],
        [
          "VOLE",
          point && point.voleMin != null && point.voleMax != null ? `${point.voleMin}–${point.voleMax}%` : "—",
        ],
        ["Mech Eff", point && point.mechEff != null ? `${point.mechEff}%` : "—"],
        ["Suction", suction !== null ? `${suction}"` : "—"],
        ["Discharge", discharge !== null ? `${discharge}"` : "—"],
      ] as [string, string][],
      typeLine: typeLine || undefined,
    };
  })();
  // Motor Rating step figures (BKW → Motor KW → Recommended) for the Recheck
  // PDF, fetched the same way that step does.
  const [motorRating, setMotorRating] = useState<MotorRating | null>(null);
  useEffect(() => {
    if (!formData.selectedModel) {
      setMotorRating(null);
      return;
    }
    let cancelled = false;
    getMotorRating(formData)
      .then((r) => !cancelled && setMotorRating(r))
      .catch(() => !cancelled && setMotorRating(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.selectedModel, formData.selectedHead, formData.capacity, formData.capacityUnit, formData.head, formData.headUnit, formData.sg]);
  const roundKw = (n: number | null) => (n === null ? "—" : String(Math.round(n * 1000) / 1000));
  const recheckMotorRating = motorRating
    ? {
        bkw: `${roundKw(motorRating.bkw)} kW`.replace("— kW", "—"),
        motorKw: `${roundKw(motorRating.motorKw)} kW`.replace("— kW", "—"),
        recommendedKw: motorRating.recommendedKw !== null ? `${motorRating.recommendedKw} kW` : "—",
        selectedKw: formData.driveMotorKw ? `${formData.driveMotorKw} kW` : "—",
        mechEff: `${motorRating.mechEff}%`,
        remarks: formData.driveMotorKwRemarks || undefined,
      }
    : undefined;
  const [downloadingRecheck, setDownloadingRecheck] = useState(false);
  const [recheckError, setRecheckError] = useState<string | null>(null);
  // The Recheck PDF opens in a preview first; Download saves that same file.
  const [recheckPreview, setRecheckPreview] = useState<{ url: string; filename: string } | null>(null);
  const closeRecheckPreview = () => {
    setRecheckPreview((p) => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
  };
  const handleRecheckPdf = async () => {
    if (!recheck) return;
    setDownloadingRecheck(true);
    setRecheckError(null);
    try {
      const file = await downloadRecheckPdf({
        projectCode: projectCode || "",
        tagName,
        projectName,
        customerName,
        generatedBy: user?.name || user?.email || undefined,
        tables: recheck,
        pumpCard: recheckPumpCard,
        motorRating: recheckMotorRating,
      }, { save: false });
      setRecheckPreview({ url: URL.createObjectURL(file.blob), filename: file.filename });
    } catch {
      setRecheckError("Couldn't generate the Recheck PDF. Please try again.");
    } finally {
      setDownloadingRecheck(false);
    }
  };

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // The report's content — shared by Confirm (saved copy) and the Summary
  // Report preview / downloads, so all three are the same document.
  const reportInput = () => ({
    projectCode: projectCode || "",
    projectName,
    customerName,
    pumpFields,
    sections: pdfSections,
    generatedBy: user?.name || user?.email || undefined,
  });

  // "Summary Report": the PDF opens in a preview first; PDF / Excel download
  // from there.
  const [preparingSummary, setPreparingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryPreview, setSummaryPreview] = useState<{ url: string; filename: string } | null>(null);
  const closeSummaryPreview = () => {
    setSummaryPreview((p) => {
      if (p) URL.revokeObjectURL(p.url);
      return null;
    });
  };
  const handleSummaryReport = async () => {
    if (!confirmedPump) return;
    setPreparingSummary(true);
    setSummaryError(null);
    try {
      const { filename, bytes } = await downloadSelectionSummaryPdf(reportInput(), { save: false });
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setSummaryPreview({ url, filename });
    } catch {
      setSummaryError("Couldn't generate the Summary Report. Please try again.");
    } finally {
      setPreparingSummary(false);
    }
  };

  // Persist the "confirmed" (green summary) state across reloads: if this tag
  // already has a saved report summary, the selection was confirmed on an
  // earlier visit, so start green rather than waiting for another click.
  useEffect(() => {
    if (!tagId) return;
    let cancelled = false;
    getReportSummary(tagId)
      .then((summary) => {
        if (!cancelled && summary) setConfirmed(true);
      })
      .catch(() => {
        // No summary / fetch error — leave unconfirmed; the button still works.
      });
    return () => {
      cancelled = true;
    };
  }, [tagId]);

  // Confirm only records the selection: the report is built and saved for the
  // Reports page, but nothing is downloaded — the Summary Report button is
  // for viewing / downloading.
  const handleConfirmSelection = async () => {
    // Reports live on the tag now (a project can carry N tags, each with its
    // own final report). The Confirm button is gated on projectId AND tagId
    // - if we have a project open but no tag id (legacy handoff), the server
    // wouldn't know which tag's row to write.
    if (!confirmedPump || !projectId || !tagId) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const pdfInput = reportInput();
      // The PDF is built and stored — it is what the Reports page serves as
      // the saved report. No file is handed to the user here.
      const { filename, bytes } = await downloadSelectionSummaryPdf(pdfInput, { save: false });
      await uploadFinalReport(tagId, filename, bytes);
      // Structured mirror of the same data, for the Reports list's
      // click-to-view summary — best-effort, doesn't block on the PDF
      // upload above having already succeeded.
      await saveReportSummary(tagId, { pumpFields, sections: pdfSections }).catch(() => {});
      setConfirmed(true);
    } catch {
      setConfirmError("Couldn't save the pump selection. Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="step-container">
      <Stepper
        currentStep={9}
        maxStep={formData.wizardMaxStep}
        onStepClick={onStepClick}
        finalCompleted={confirmed}
      />

      <div className="step-card">
        <h2>
          Selection Summary
          <button
            type="button"
            className="step-header-action"
            disabled={!confirmedPump || preparingSummary}
            onClick={() => void handleSummaryReport()}
            title={
              confirmedPump
                ? "View the Pump Selection Summary Report, then download it as PDF or Excel"
                : isLoading
                  ? "Loading pump data…"
                  : "Needs a confirmed pump model"
            }
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {preparingSummary ? "Preparing…" : "Summary Report"}
          </button>
          <button
            type="button"
            className="step-header-action"
            disabled={!recheck || downloadingRecheck}
            onClick={() => void handleRecheckPdf()}
            title={
              recheck
                ? "View the Drive step's Recheck (capacity & BKW at the final pump RPM) as a PDF, then download it"
                : isLoading
                  ? "Loading pump data…"
                  : "Needs a confirmed pump and a drive system with its final pump RPM — complete the Drive step first"
            }
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {downloadingRecheck ? "Preparing…" : "Recheck PDF"}
          </button>
        </h2>

        {recheckPreview && (
          <PdfPreviewModal preview={recheckPreview} title="Recheck at Final Selected RPM" onClose={closeRecheckPreview} />
        )}
        {summaryPreview && (
          <PdfPreviewModal
            preview={summaryPreview}
            title="Pump Selection Summary Report"
            onClose={closeSummaryPreview}
            downloadLabel="Download PDF"
            actions={
              <button
                type="button"
                onClick={() => downloadSelectionSummaryExcel(reportInput())}
                className="rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-fg-2 transition hover:border-accent hover:text-accent"
              >
                Download Excel
              </button>
            }
          />
        )}

        <p>
          Review your confirmed pump and its configuration. Go back to any step to
          change something.
          {inputEcho && (
            <>
              {" "}
              (Capacity: <strong>{inputEcho.capacity}</strong>, Head:{" "}
              <strong>{inputEcho.head}</strong>)
            </>
          )}
        </p>

        {isLoading && <p>Loading summary…</p>}

        {error && <p className="error-message">{error}</p>}

        {!isLoading && !error && !confirmedPump && (
          <p>
            No confirmed pump model found for these inputs. Go back and confirm a model
            in the recommendation panel.
          </p>
        )}

        {!isLoading && !error && confirmedPump && (
          <>
            <Section title="Liquid Parameters" items={liquidParametersItems} />
            <Section title="Material of Construction" items={materialOfConstructionItems} />
            <Section title="Sealing Type" items={sealingItems} />
            <Section title="Pump Details" items={pumpDetailsItems} />

            {driveHasAnything && (
              <div className="mt-4 overflow-hidden rounded-lg border border-line bg-paper">
                <div className="border-b border-line bg-elev px-4 py-2.5">
                  <span className="section-label">Drive Systems</span>
                </div>
                <div className="p-4">
                  <FieldGrid items={driveCommonItems} />

                  {hasAny(driveInputItems) && (
                    <div className={hasAny(driveCommonItems) ? "mt-4" : ""}>
                      <FieldGrid items={driveInputItems} />
                    </div>
                  )}

                  {hasAny(driveSelectedItems) && (
                    <div className="mt-4 rounded-md border-2 border-pos bg-[var(--pos-soft)] p-3">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[var(--pos-strong)]">
                        Selected {isVBelt ? "V-Belt" : "Gearbox"} Option
                      </span>
                      <FieldGrid items={driveSelectedItems} tone="pos" />
                    </div>
                  )}

                  {hasAny(motorSelectedItems) && (
                    <div className="mt-4 rounded-md border-2 border-pos bg-[var(--pos-soft)] p-3">
                      <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-[var(--pos-strong)]">
                        Selected Motor
                      </span>
                      <FieldGrid items={motorSelectedItems} tone="pos" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {recheckError && <p className="error-message">{recheckError}</p>}
        {summaryError && <p className="error-message">{summaryError}</p>}
        {confirmError && <p className="error-message">{confirmError}</p>}
        {confirmed && (
          <p className="mt-2 text-[13px] font-semibold text-pos">
            ✓ Pump selected — summary step completed. Use Summary Report to view or download it.
          </p>
        )}

        <div className="step-actions">
          <button onClick={onPrevious}>Previous</button>

          <button
            disabled={!confirmedPump || !projectId || !tagId || confirming}
            onClick={() => void handleConfirmSelection()}
            title={
              !projectId
                ? "No project open"
                : !tagId
                  ? "No tag open - reports are per-tag; open a tag from the Projects page"
                  : confirmed
                    ? "Save the selection again with the current inputs (e.g. after changing a step)"
                    : undefined
            }
          >
            {confirming ? "Saving…" : confirmed ? "Update Pump Selection" : "Confirm Pump Selection"}
          </button>
        </div>
      </div>

    </div>
  );
};

export default RecommendationStep;
