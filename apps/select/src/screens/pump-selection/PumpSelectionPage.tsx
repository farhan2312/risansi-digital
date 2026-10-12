"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import GeneralInformationStep from "../../components/pump-selection/GeneralInformationStep";
import FluidPropertiesStep from "../../components/pump-selection/FluidPropertiesStep";
import OperatingConditionsStep from "../../components/pump-selection/OperatingConditionsStep";
import DriveDetailsStep from "../../components/pump-selection/DriveDetailsStep";
import SealingDetailsStep from "../../components/pump-selection/SealingDetailsStep";
import MocDetailsStep from "../../components/pump-selection/MocDetailsStep";
import MotorRatingStep from "../../components/pump-selection/MotorRatingStep";
import ApprovalStep from "../../components/pump-selection/ApprovalStep";
import { ApprovalProvider } from "../../components/pump-selection/approval/ApprovalContext";
import RecommendationStep from "../../components/pump-selection/RecommendationStep";
import ProjectHeader from "../../components/projects/ProjectHeader";
import LivePumpRecommendation from "../../components/pump-selection/LivePumpRecommendation";
import { SELECTED_PROJECT_KEY } from "../projects/ProjectsPage";
import { getProject } from "../../services/projectService";
import {
  getWizardInput,
  saveWizardInput,
  type WizardInputTable,
} from "../../services/wizardInputService";

type SelectedProject = {
  id: string;
  code?: string;
  name?: string;
  customer?: string;
  status?: string;
  // Tag the user opened from the projects page. Absent means the server
  // resolves to the project's Default tag - safe for legacy links or an old
  // session that predates the tags feature.
  tagId?: string;
  tagName?: string;
};

// Every wizard field autosaved to the DB, one table per step (two merges:
// MOC+Sealing share a table, Motor Rating + Drive-common fields share a
// table) plus one table per drive system for the Drive step's type-specific
// fields. Field-based, not step-number-based, so this doesn't need to change
// if the step order does. Kept in sync with the FIELDS whitelist in
// api/wizard-input/[table]/route.ts.
const TABLE_FIELDS: Record<WizardInputTable, readonly string[]> = {
  "general-info": [
    "capacity", "capacityUnit", "head", "headUnit", "media",
    "sg", "rpmRange", "selectedModel", "selectedHead", "modelConfirmed",
    "wizardStep", "wizardMaxStep",
    "headCalc",
  ],
  "fluid-properties": [
    "viscosity", "viscosityUnit", "viscosityRange", "viscosityCp",
    "suctionSize", "dischargeSize", "recommendedSize",
    "sizeRemarks",
    "solidPercentage", "solidSize", "solidSizeMax", "solidSizeMode", "solidType",
    "ph", "temperature", "temperatureRaw", "temperatureUnit",
    // Min–Max ranges (pH / viscosity / temperature) — without these a range
    // was dropped on save and every document showed only the minimum.
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
    "clientRequirementsFilename", "clientRequirementsMime", "clientRequirementsUploadedAt",
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
  // Product code + quantity are edited on the Commercial page, not here — the
  // wizard neither restores nor saves them.
  "pump-model-qty": [],
};

// Fields backed by a boolean column — a NULL restores as `false`, not the ""
// every other (string) field falls back to.
const BOOLEAN_FIELDS = new Set([
  "modelConfirmed",
  "vbeltConfirmed",
  "gearboxConfirmed",
  "driveMotorConfirmed",
  "vbeltRpmManual",
  "gearboxRpmManual",
]);

// Fields backed by an integer column — a NULL restores as 1 (step one), not
// the "" every other (string) field falls back to.
const NUMBER_FIELDS = new Set(["wizardStep", "wizardMaxStep"]);

// Pump Model & Qty was step 8 for a while (Sep 2026) and moved to the
// Commercial page (2026-10-01); tags saved on step 10 then reopen on 9.
const TOTAL_STEPS = 9;

// Keep a restored step inside the wizard's real range — a corrupt/stale value
// shouldn't strand the user on a step that doesn't exist.
const clampStep = (n: unknown): number => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(Math.max(v, 1), TOTAL_STEPS);
};

// Which table(s) each wizard step writes when the user leaves it — so a Next
// (or stepper jump, or Previous) saves ONLY the step being left, not every
// table. Steps 4+5 both write moc-sealing (MOC and Sealing share one table);
// step 7's drive-system-specific table is appended conditionally at save time
// (see stepTablesToSave). Step 8 (Approval) keeps its state in step_approval
// via its own route, and step 9 (read-only Recommendation) writes nothing, so
// neither has a wizard-input table. (Pump Model & Qty lives on the Commercial
// page, not in the wizard.)
const STEP_TABLES: Record<number, WizardInputTable[]> = {
  1: ["general-info"],
  2: ["fluid-properties"],
  3: ["operating-conditions"],
  4: ["moc-sealing"],
  5: ["moc-sealing"],
  6: ["motor-drive"],
  7: ["motor-drive"],
  8: [],
  9: [],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pickTableFields = (table: WizardInputTable, data: any): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of TABLE_FIELDS[table]) out[key] = data[key];
  return out;
};

const PumpSelectionPage = () => {
  // Replaces react-router's location.state.project — read the project stashed
  // by ProjectsPage before navigating here. `projectChecked` gates the "no
  // project selected" screen so it can't flash before this client-only read
  // (sessionStorage) has actually run. sessionStorage is just a snapshot from
  // whenever "Open" was last clicked — it doesn't know if the project has
  // since been deleted, so it's re-validated against the DB below; `wasDeleted`
  // distinguishes that case from "never picked one" for the empty-state copy.
  const [project, setProject] = useState<SelectedProject | undefined>(undefined);
  const [projectChecked, setProjectChecked] = useState(false);
  const [wasDeleted, setWasDeleted] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem(SELECTED_PROJECT_KEY);
    if (!raw) {
      setProjectChecked(true);
      return;
    }
    let stashed: SelectedProject | undefined;
    try {
      stashed = JSON.parse(raw);
    } catch {
      stashed = undefined;
    }
    if (!stashed?.id) {
      setProjectChecked(true);
      return;
    }
    let cancelled = false;
    getProject(stashed.id)
      .then((live) => {
        if (cancelled) return;
        if (live) {
          setProject(stashed);
        } else {
          // Deleted since it was picked — drop the stale cache so a future
          // visit doesn't keep showing it either.
          sessionStorage.removeItem(SELECTED_PROJECT_KEY);
          setWasDeleted(true);
        }
      })
      .catch(() => {
        // Network/auth error — fail closed to the stashed copy rather than
        // silently dropping a still-valid project the user picked.
        if (!cancelled) setProject(stashed);
      })
      .finally(() => {
        if (!cancelled) setProjectChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [step, setStep] = useState(1);

  const [formData, setFormData] = useState({
    projectName: "",
    customerName: "",

    // Step 1
    capacity: "",
    capacityUnit: "",
    head: "",
    headUnit: "",
    media: "",
    temperature: "", // canonical °C value (converted from temperatureRaw + temperatureUnit)
    temperatureRaw: "", // as-entered value in the currently-selected unit
    temperatureUnit: "C", // display-only unit for the input: C / F / K
    sg: "", // Specific Gravity
    ph: "",
    rpmRange: "", // manual RPM band filter (low/medium/high/vhigh)
    selectedModel: "", // pump picked in the live panel; persists across steps
    selectedHead: "", // charted head (MWC) picked for the model
    modelConfirmed: false, // gate: a model must be picked + confirmed after the Fluid step before continuing
    // Wizard progress (persisted): where the user last was, and the furthest
    // step they've reached — the stepper keeps everything below the latter
    // ticked even after jumping back.
    wizardStep: 1,
    wizardMaxStep: 1,

    // Step 2
    viscosity: "",
    viscosityUnit: "cP", // default unit; cSt is the alternative
    viscosityRange: "",
    suctionSize: "", // inches - defaulted from the recommendation, editable
    dischargeSize: "",
    recommendedSize: "", // baseline the two above are compared against
    sizeRemarks: "", // suction / discharge size remarks — mandatory once either deviates
    viscosityCp: "", // canonical cP value (cP = cSt × SG when entered in cSt)
    solidPercentage: "",
    solidSize: "",
    solidSizeMax: "",
    solidSizeMode: "single",
    phMax: "",
    phMode: "single",
    viscosityMax: "",
    viscosityCpMax: "",
    viscosityMode: "single",
    temperatureMax: "",
    temperatureMaxRaw: "",
    temperatureMode: "single",
    solidType: "", // "Hard Solid" / "Soft Solid" — only meaningful when solidPercentage > 0
    endConnection: "", // discharge end connection type
    suctionConnection: "", // suction connection type
    suctionFlangeStd: "", // flange standards (flange_standard_master)
    dischargeFlangeStd: "",

    // Step 3
    pumpType: "",
    agBk: "", // AG / BK feed option — only shown when viscosity > 10000 cP
    agBkRemarks: "", // why AG/BK was marked Not Required (mandatory when it is)
    negativeSuction: "", // "Yes" / "No" - any pump type
    negativeSuctionSize: "", // depth below the flange, when negativeSuction is Yes
    negativeSuctionUnit: "mt",
    bearingHousing: "",
    suctionHousing: "",
    jointType: "",

    // Step 6
    driveSystem: "",
    motorMake: "",
    gearboxMake: "",
    motorRPM: "",
    gearBoxType: "", // HISO / SISO — Geared Motor Drive only
    gearedConfigType: "", // "Geared Motor" | "Gear Box + Motor" — cascades mounting + coupling below
    gbConstructionType: "", // IN LINE HELICAL / PLANTERY — Geared Motor Drive only
    gearBoxMounting: "", // Foot Mount B3 / Flange Mount B5 / Foot cum Flange B35 — cascades on gearedConfigType
    driveCoupling: "", // derived from gearedConfigType
    asfRange: "", // Application Service Factor band — Geared Motor Drive only
    gearboxSource: "", // "PBL" | "PTL" | "Top Gear" — manual gearbox pick
    gearboxModel: "",
    gearboxOutputRpm: "",
    gearboxServiceFactor: "",
    gearboxRatePerNos: "",
    gearboxConfirmed: false, // gearbox card picked, then explicitly confirmed
    gearboxRpmManual: false, // no gearbox found — output RPM typed in by hand

    // Step 4
    sealingType: "",
    sealingSubType: "", // MSA / SCG / DCG / MSK — Mechanical Seal only
    glandPackingType: "",
    glandPackingMake: "",
    mechSealMoc: "",
    mechSealFace: "",
    mechSealMake: "",

    // Free-text client extras (chemical composition, special notes) with no
    // dedicated wizard field — appended to the MOC AI prompt.
    clientRequirements: "",

    mocAiBearingHousing: "",
    mocAiBearingHousingRemarks: "",
    mocAiBasePlate: "",
    mocAiBasePlateRemarks: "",
    mocAiMountingPlate: "",
    mocAiMountingPlateRemarks: "",
    mocAiTieRod: "",
    mocAiTieRodRemarks: "",
    mocAiNutBolt: "",
    mocAiNutBoltRemarks: "",
    mocAiPumpHousing: "",
    mocAiPumpHousingRemarks: "",
    mocAiRotor: "",
    mocAiRotorRemarks: "",
    mocAiShaft: "",
    mocAiShaftRemarks: "",
    mocAiStatorRubber: "",
    mocAiStatorRubberRemarks: "",
    mocAiStatorSleeve: "",
    mocAiStatorSleeveRemarks: "",

    // The AI's own recommendation, persisted in full to moc_sealing_input so
    // the whole post-generation panel rebuilds on reload — distinct from the
    // manual picks above. Includes the summary/alternatives/seal-recommendation
    // /rationale (previously session-only, now saved too).
    mocAiProvider: "",
    mocAiSuggestedBearingHousing: "",
    mocAiSuggestedBasePlate: "",
    mocAiSuggestedMountingPlate: "",
    mocAiSuggestedTieRod: "",
    mocAiSuggestedNutBolt: "",
    mocAiSuggestedPumpHousing: "",
    mocAiSuggestedRotor: "",
    mocAiSuggestedShaft: "",
    mocAiSuggestedStatorRubber: "",
    mocAiSuggestedStatorSleeve: "",
    mocAiSuggestedSummary: "",
    mocAiSuggestedAlternatives: "",
    sealingRemarks: "",
    mocAiSuggestedSealRecommendation: "",
    mocAiSuggestedSealMoc: "",
    mocAiSuggestedSealRationale: "",
    mocAiGeneratedAt: "",

    // Step 6 — Motor Rating (KW) — final drive motor rating (manual pick from
    // the pulley-table KW list, defaulted to the recommendation)
    driveMotorKw: "",
    driveMotorKwRemarks: "", // mandatory once the rating deviates

    // Step 7 — V-Belt drive recommendation (only when Drive System = V-Belt)
    driveVbeltGroove: "",
    drivePumpPulley: "",
    driveMotorPulley: "",
    driveVbeltRpm: "",
    driveCenterDistance: "",
    driveVbeltNo: "",
    vbeltConfirmed: false, // belt card picked, then explicitly confirmed
    vbeltRpmManual: false, // no belt found — pump RPM typed in by hand

    // Step 7 — Drive System inputs (shown for every drive system)
    driveMotorSpeed: "",
    driveMotorMake: "",
    driveMotorMounting: "",
    driveStdNonStd: "", // Standard / Non-Standard — gates the fields below
    driveMotorEfficiency: "",
    driveMotorProtection: "",
    driveMotorFrequency: "",
    driveMotorVoltage: "",
    // Non-Standard only — % uplifts, summed then applied to the motor's final
    // price. No efficiency % — efficiency instead filters the motor type.
    driveMotorProtectionPct: "",
    driveMotorFrequencyPct: "",
    driveMotorVoltagePct: "",
    // Motor picked from the motor_master candidate cards
    driveMotorFrameSize: "",
    driveMotorLpPrice: "",
    driveMotorFinalPrice: "",
    driveMotorPriceUplifted: "",
    driveMotorConfirmed: false, // motor card picked, then explicitly confirmed
    driveStarterType: "",
    drivePowerSupply: "Three Phase", // the usual supply; Single Phase on request
    // VFD: off unless asked for; the Hz boxes get their usual defaults when
    // it's switched on (see DriveDetailsStep).
    vfdRequired: "",
    vfdStdHz: "",
    vfdMinHz: "",
    vfdMaxHz: "",
  });

  // Whether the autosaved draft has been loaded (or confirmed absent) for the
  // current project — gates the autosave effect so it can't fire on the
  // pre-load default formData and stomp a real saved draft with blanks.
  const [restored, setRestored] = useState(false);

  // Every table with fields to restore (drive-direct has none, so it's
  // skipped — nothing to fetch).
  const RESTORABLE_TABLES = (Object.keys(TABLE_FIELDS) as WizardInputTable[]).filter(
    (t) => TABLE_FIELDS[t].length > 0,
  );

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    Promise.all(RESTORABLE_TABLES.map((table) => getWizardInput(table, project.id, project.tagId)))
      .then((rows) => {
        if (cancelled) return;
        const merged: Record<string, unknown> = {};
        rows.forEach((row, i) => {
          if (!row) return;
          const tableKey = RESTORABLE_TABLES[i];
          for (const key of TABLE_FIELDS[tableKey]) {
            merged[key] =
              row[key] ??
              (BOOLEAN_FIELDS.has(key) ? false : NUMBER_FIELDS.has(key) ? 1 : "");
          }
        });
        // A tag saved before a unit was ever picked still opens on cP.
        if (!merged.viscosityUnit) merged.viscosityUnit = "cP";
        // Power supply not chosen yet defaults to Three Phase.
        if (!merged.drivePowerSupply) merged.drivePowerSupply = "Three Phase";
        setFormData((f: typeof formData) => ({ ...f, ...merged }));
        // Reopen the wizard exactly where the user left off.
        merged.wizardMaxStep = clampStep(merged.wizardMaxStep);
        setStep(clampStep(merged.wizardStep));
      })
      .finally(() => {
        if (!cancelled) setRestored(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  // Tables to save when leaving `fromStep` — STEP_TABLES plus, for the Drive
  // step, the one drive-system-specific table matching the current choice
  // (so switching drive types never leaves stale data in the other).
  const stepTablesToSave = (fromStep: number): WizardInputTable[] => {
    const tables = [...(STEP_TABLES[fromStep] ?? [])];
    if (fromStep === 7) {
      // Exactly one drive table per enquiry — the API deletes the other two
      // on write, so switching drive type can't leave a stale row behind.
      if (formData.driveSystem === "V-Belt Drive") tables.push("drive-vbelt");
      else if (formData.driveSystem === "Geared Motor Drive/Gear Box + Motor") tables.push("drive-geared");
      else if (formData.driveSystem === "Direct Drive") tables.push("drive-direct");
    }
    return tables;
  };

  // Bumped after a step's saves land, so ApprovalProvider re-reads statuses.
  const [approvalRefresh, setApprovalRefresh] = useState(0);

  // Persists ONLY the step being left — one PUT per its table(s), not all of
  // them. Called on every navigation (Next / Previous / stepper jump).
  // `data` defaults to the current formData; goToStep passes the
  // progress-updated copy so the new wizardStep lands in the same write
  // (React state updates aren't visible synchronously).
  const saveStep = (fromStep: number, data: typeof formData = formData) => {
    if (!project?.id || !restored) return;
    const saves = stepTablesToSave(fromStep).map((table) =>
      saveWizardInput(table, project.id, pickTableFields(table, data), project.tagId).catch(() => {
        // Best-effort — the wizard still works from in-memory state if a save fails.
      }),
    );
    // A real change can send that step's approval back to Pending on the
    // server; once the saves land, have the approval state re-read.
    if (saves.length > 0) {
      void Promise.all(saves).then(() => setApprovalRefresh((n) => n + 1));
    }
  };

  const [selectedPump, setSelectedPump] = useState<number | null>(null);

  // Flow gate: a pump model must be picked AND confirmed (in the live panel,
  // after the General + Fluid forms) before advancing past the Fluid step.
  // Applies to Next buttons and to jumping via the stepper — backward nav and
  // staying within steps 1–2 are always allowed. Saves the step being left
  // before navigating, so its inputs land in that step's own table.
  const goToStep = (target: number) => {
    if (target > 2 && !formData.modelConfirmed) return;
    const clamped = clampStep(target);
    // Record progress before saving so the step being left writes the new
    // position in the same PUT (general-info carries wizardStep/wizardMaxStep).
    const nextMax = Math.max(clampStep(formData.wizardMaxStep), clamped);
    const progressed = { ...formData, wizardStep: clamped, wizardMaxStep: nextMax };
    setFormData(progressed);
    saveStep(step, progressed);
    // The step being left isn't always general-info, so make sure the progress
    // itself is persisted too (no-op duplicate when it *is* general-info).
    if (project?.id && restored) {
      saveWizardInput("general-info", project.id, {
        tagId: project.tagId,
        wizardStep: clamped,
        wizardMaxStep: nextMax,
      }).catch(() => {});
    }
    setStep(clamped);
  };

  // Stepper / approval-link jumps: back anywhere, forward only as far as the
  // furthest step already reached or the next one - so a stepper click can't
  // skip steps whose required fields were never filled. (Each step also runs
  // its own required-field check before calling this.)
  const jumpToStep = (target: number) => {
    const limit = Math.max(clampStep(formData.wizardMaxStep), step + 1);
    if (target > limit) return;
    goToStep(target);
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <GeneralInformationStep
            onNext={() => goToStep(2)}
            formData={formData}
            setFormData={setFormData}
            onStepClick={jumpToStep}
          />
        );

      case 2:
        return (
          <FluidPropertiesStep
            onPrevious={() => goToStep(1)}
            onNext={() => goToStep(3)}
            formData={formData}
            setFormData={setFormData}
            onStepClick={jumpToStep}
          />
        );

      case 3:
        return (
          <OperatingConditionsStep
            onPrevious={() => goToStep(2)}
            onNext={() => goToStep(4)}
            formData={formData}
            setFormData={setFormData}
            onStepClick={jumpToStep}
          />
        );

      case 4:
        return (
          <MocDetailsStep
            onPrevious={() => goToStep(3)}
            onNext={() => goToStep(5)}
            formData={formData}
            setFormData={setFormData}
            onStepClick={jumpToStep}
            projectId={project?.id}
            tagId={project?.tagId}
          />
        );

      case 5:
        return (
          <SealingDetailsStep
            onPrevious={() => goToStep(4)}
            onNext={() => goToStep(6)}
            formData={formData}
            setFormData={setFormData}
            onStepClick={jumpToStep}
          />
        );

      case 6:
        return (
          <MotorRatingStep
            onPrevious={() => goToStep(5)}
            onNext={() => goToStep(7)}
            formData={formData}
            setFormData={setFormData}
            onStepClick={jumpToStep}
          />
        );

      case 7:
        return (
          <DriveDetailsStep
            onPrevious={() => goToStep(6)}
            onNext={() => goToStep(8)}
            formData={formData}
            setFormData={setFormData}
            onStepClick={jumpToStep}
            projectId={project?.id}
            tagId={project?.tagId}
          />
        );

      case 8:
        return (
          <ApprovalStep
            onPrevious={() => goToStep(7)}
            onNext={() => goToStep(9)}
            onStepClick={jumpToStep}
            formData={formData}
          />
        );

      case 9:
        return (
          <RecommendationStep
            onPrevious={() => goToStep(8)}
            formData={formData}
            selectedPump={selectedPump}
            setSelectedPump={setSelectedPump}
            onStepClick={jumpToStep}
            projectId={project?.id}
            tagId={project?.tagId}
            projectCode={project?.code}
            projectName={project?.name}
            customerName={project?.customer}
            tagName={project?.tagName}
          />
        );

      default:
        return (
          <GeneralInformationStep
            onNext={() => goToStep(2)}
            formData={formData}
            setFormData={setFormData}
            onStepClick={jumpToStep}
          />
        );
    }
  };

  // Wait for the client-only sessionStorage check before deciding whether to
  // show the wizard or the "no project" screen — avoids a flash.
  if (projectChecked && !project) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-24 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-elev text-2xl">
          📁
        </div>
        <h2 className="text-[18px] font-semibold text-fg">
          {wasDeleted ? "This enquiry was deleted" : "No enquiry selected"}
        </h2>
        <p className="text-[13px] text-fg-3">
          {wasDeleted
            ? "The enquiry you had open has since been deleted. Open or create another one from the Enquiries page."
            : "Pump selection is tied to an enquiry. Open or create one from the Enquiries page, then click “Open” to start configuring a pump for it."}
        </p>
        <Link
          href="/projects"
          className="mt-2 rounded-lg bg-title px-6 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          Go to Enquiries
        </Link>
      </div>
    );
  }

  // A project is selected but its saved wizard draft is still being fetched
  // from the database — show a loading state rather than flashing the empty
  // default form (which would then jump as restored values arrive).
  if (!projectChecked || (project && !restored)) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-6 py-24 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-title" />
        <h2 className="text-[16px] font-semibold text-fg">Loading pump selection…</h2>
        <p className="text-[13px] text-fg-3">
          Fetching this enquiry&apos;s saved configuration from the database.
        </p>
      </div>
    );
  }

  return (
    // Approval state is shared by every step: each step header shows its status
    // badge, and the Approval step lists them all, so it is fetched once here.
    <ApprovalProvider tagId={project?.tagId} refreshKey={approvalRefresh}>
      <ProjectHeader project={project} />
      {renderStep()}
      {/* Live recommendation that refines as the user fills each step. Sits at
          the bottom of the page. A model is picked and confirmed on the Fluid
          step (2) only: on General Information the matches are a read-only
          preview, and from Specifications (3) on the confirmed pump is a
          locked reference card - the later steps are configured for it, so
          swapping it there would silently invalidate that work. */}
      <LivePumpRecommendation
        formData={formData}
        setFormData={setFormData}
        projectId={project?.id}
        tagId={project?.tagId}
        locked={step > 2}
        canPick={step === 2}
      />
    </ApprovalProvider>
  );
};

export default PumpSelectionPage;
