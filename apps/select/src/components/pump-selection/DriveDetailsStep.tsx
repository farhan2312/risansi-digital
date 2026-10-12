"use client";

import { useEffect, useRef, useState } from "react";
import "./GeneralInformationStep.css";
import Stepper from "./Stepper";
import StepApprovalBadge from "./approval/StepApprovalBadge";
import {
  actions,
  btnGhost,
  btnGhostSm,
  btnPrimary,
  btnPrimarySm,
  control,
  fieldWrap,
  grid,
  hint,
  hintError,
  label,
} from "./formStyles";
import { getVBeltDrive, type VBeltDrive, type VBeltOption } from "../../services/vbeltDriveService";
import {
  getGearboxOptions,
  type GearboxOption,
  type GearboxRecommendation,
} from "../../services/gearboxOptionsService";
import { getRecommendations } from "../../services/recommendationService";
import {
  listMotorOptions,
  type MotorMasterRow,
} from "../../services/motorMasterService";
import { clearWizardInput, saveWizardInput } from "../../services/wizardInputService";
import { ratingPlateNumber } from "../../lib/rating-plate";
import { Err, ErrorBanner, Req, hasErrors, required } from "./fieldBits";
import { gearboxMountingUpliftPct, gearboxUpliftedRate, mountingUpliftPct } from "../../lib/motor-price";
import {
  OTHER_OPTION,
  STANDARD_RATING_PLATE,
  emptyDriveOptions,
  type DriveOptionKind,
  type DriveOptions,
} from "../../lib/drive-options";
import { addDriveOption, getDriveOptions } from "../../services/driveOptionsService";
import type { PumpRecommendation } from "../../data/Recommendations";
import {
  DEFAULT_VFD_MAX_HZ,
  DEFAULT_VFD_MIN_HZ,
  DEFAULT_VFD_STD_HZ,
  VFD_OPTIONS,
  VFD_YES,
  computeRecheck,
  finalPumpRpm,
  fmtRecheckNum,
  recheckTables,
  rpmAtHz,
} from "../../lib/recheck-calc";

type Props = {
  onNext: () => void;
  onPrevious: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFormData: any;
  onStepClick?: (step: number) => void;
  /** Open project's id — Recheck persists the drive + motor inputs against it
   * (see handleRecheck) rather than waiting for a Next/Previous navigation. */
  projectId?: string;
  /** The tag being edited - drive rows are keyed by tag. */
  tagId?: string;
};

type VbeltStatus = "idle" | "loading" | "ready" | "error";
type GearboxStatus = "idle" | "loading" | "ready" | "error";
type MotorStatus = "idle" | "loading" | "ready" | "error";

const num = (n: number | null): string => (n === null ? "—" : String(n));

/** Parses a percentage input; blank/invalid counts as 0 so a partially-filled
 * Non-Standard form still prices sensibly. */
const pct = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isNaN(n) ? 0 : n;
};

/** Two-stage pick bar shown under a group of candidate cards: clicking a card
 * only *selects* it, then this asks for an explicit confirmation (mirroring
 * the pump model's confirm gate in LivePumpRecommendation). Clicking the
 * selected card again clears the pick, so this disappears. */
const ConfirmBar = ({
  label,
  confirmed,
  onConfirm,
}: {
  label: string;
  confirmed: boolean;
  onConfirm: () => void;
}) =>
  confirmed ? (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
        ✓ Confirmed
      </span>
      <span className="text-[13px] text-emerald-900">
        <b>{label}</b> is locked in. Click the card again to change it.
      </span>
    </div>
  ) : (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
      <span className="text-[13px] text-amber-900">
        Confirm <b>{label}</b> as your selection?
      </span>
      <button
        type="button"
        onClick={onConfirm}
        className="rounded-lg bg-amber-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
      >
        Confirm
      </button>
    </div>
  );

type ManualField = { key: string; label: string; numeric?: boolean; options?: string[] };

const MANUAL_VBELT_FIELDS: ManualField[] = [
  { key: "driveVbeltRpm", label: "Pump RPM (achieved)", numeric: true },
  { key: "driveVbeltGroove", label: "V-Belt Groove" },
  { key: "drivePumpPulley", label: "Pump Pulley", numeric: true },
  { key: "driveMotorPulley", label: "Motor Pulley", numeric: true },
  { key: "driveCenterDistance", label: "Centre Distance", numeric: true },
  { key: "driveVbeltNo", label: "V-Belt No.", numeric: true },
];

const MANUAL_GEARBOX_FIELDS: ManualField[] = [
  { key: "gearboxOutputRpm", label: "Output RPM", numeric: true },
  { key: "gearboxSource", label: "Source", options: ["PBL", "PTL", "Top Gear", "Other"] },
  { key: "gearboxModel", label: "Model" },
  { key: "gearboxServiceFactor", label: "Service Factor", numeric: true },
  { key: "gearboxRatePerNos", label: "Rate per Nos (INR)", numeric: true },
];

/** Manual V-belt / gearbox entry — always available, whether or not the
 *  screen suggested options. The same details a card carries; only the RPM
 *  (the first field) is required, since Recheck works from it. While
 *  `active` (the tag's *RpmManual flag) the entry is the selection and is
 *  confirmed like a card; picking a card switches back. */
const ManualDrivePanel = ({
  what,
  fields,
  values,
  active,
  confirmed,
  rpmLo,
  rpmHi,
  onEdit,
  onConfirm,
  onCancel,
}: {
  /** "V-belt" | "gearbox" */
  what: string;
  fields: ManualField[];
  values: Record<string, string>;
  active: boolean;
  confirmed: boolean;
  /** The pump's required speed window, when known — out-of-window values warn. */
  rpmLo?: number;
  rpmHi?: number;
  /** A field typed in — the caller marks the entry manual and unconfirmed. */
  onEdit: (patch: Record<string, string>) => void;
  onConfirm: () => void;
  /** Drop the manual entry and go back to the suggestions. */
  onCancel: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const rpmField = fields[0];
  const rpm = values[rpmField.key] ?? "";
  const n = Number(rpm);
  const valid = rpm.trim() !== "" && Number.isFinite(n) && n > 0;
  const hasWindow = Number.isFinite(rpmLo) && Number.isFinite(rpmHi);
  const outside = active && valid && hasWindow && (n < (rpmLo as number) || n > (rpmHi as number));
  const inputCls =
    "w-full rounded-lg border border-line bg-paper px-3 py-2 text-[13px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

  if (!active && !open) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-accent hover:border-accent"
        >
          ✎ Enter {what} details manually
        </button>
        <span className="text-[12px] text-fg-3">Use your own RPM and details instead of a suggestion.</span>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-fg">
          Manual {what} entry
          {active && <span className="ml-2 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-semibold text-white">In use</span>}
        </span>
        <button
          type="button"
          onClick={() => {
            if (active) onCancel();
            setOpen(false);
          }}
          className="text-[12px] font-semibold text-fg-3 hover:text-neg"
        >
          {active ? "Remove manual entry" : "Close"}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {fields.map((f, i) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-[11.5px] font-semibold text-fg-3">
              {f.label}
              {i === 0 && <span className="text-neg"> *</span>}
            </span>
            {f.options ? (
              <select className={inputCls} value={values[f.key] ?? ""} onChange={(e) => onEdit({ [f.key]: e.target.value })}>
                <option value="">Select</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.numeric ? "number" : "text"}
                min={f.numeric ? 0 : undefined}
                step={f.numeric ? "any" : undefined}
                className={`${inputCls} ${f.numeric ? "text-right font-mono" : ""}`}
                value={values[f.key] ?? ""}
                onChange={(e) => onEdit({ [f.key]: e.target.value })}
              />
            )}
          </label>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-fg-3">
        Only the RPM is required — Recheck works out capacity and BKW at this speed.
        {hasWindow && (
          <>
            {" "}Required window:{" "}
            <b className="mono text-fg-2">
              {(rpmLo as number).toFixed(0)}–{(rpmHi as number).toFixed(0)} rpm
            </b>
            .
          </>
        )}
        {!active && " Typing here replaces the selected card."}
      </p>
      {active && rpm.trim() !== "" && !valid && <p className="mt-1 text-[12px] text-neg">Enter an RPM above 0.</p>}
      {outside && (
        <p className="mt-1 text-[12px] text-warn">
          {n} rpm is outside the pump&apos;s required window — check the Recheck result before proceeding.
        </p>
      )}
      {active &&
        valid &&
        (confirmed ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2">
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">
              ✓ Confirmed
            </span>
            <span className="text-[13px] text-emerald-900">
              Manual {what} at <b>{n} rpm</b> is locked in. Edit a field to change it.
            </span>
          </div>
        ) : (
          <ConfirmBar label={`manual ${what} at ${n} rpm`} confirmed={false} onConfirm={onConfirm} />
        ))}
    </div>
  );
};

/** Indian-format money for the motor cards (prices are plain rupee amounts). */
const money = (v: string | number | null): string => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

// Drive System input option lists (from the drive-selection spec sheet).
const MOTOR_MAKES = ["BBL", "Havells", "CGL", "ABB", "Siemens", "Other"];
// Motor mounting options. The value's FIRST WORD is what the motor-options
// query matches against motor_master.mounting (case-insensitive), so keep
// "Foot"/"Flange" as the leading token.
const MOTOR_MOUNTINGS = [
  { value: "Foot B3", label: "Foot Mounted (B3)" },
  { value: "Flange B5", label: "Flange Mounted (B5)" },
  { value: "Foot cum Flange B35", label: "Foot cum Flange (B35)" },
];
// Gear Box mounting options (display + persist only; not used in any DB query).
const GB_MOUNTINGS = [
  { value: "Foot Mount B3", label: "Foot Mount (B3)" },
  { value: "Flange Mount B5", label: "Flange Mount (B5)" },
  { value: "Foot cum Flange B35", label: "Foot cum Flange (B35)" },
];
// Coupling options.
const COUPLING_OPTIONS = ["No Coupling", "Driven Coupling", "Drive + Driven Coupling"];
// When a coupling IS present (anything other than "No Coupling"), the engineer
// also picks its construction type and make.
const COUPLING_TYPES = [
  "Flexible Bush Pin Type Coupling",
  "Spacer Type Coupling",
  "Tyre Type Coupling",
];
const COUPLING_MAKES = ["Rathi", "Fenner"];
// Configuration: the two ways a geared drive is put together. Kept purely as a
// user selection now - it no longer cascades mounting/coupling (those derive
// from pump type + GB type; see deriveGearedDefaults).
const GEARED_CONFIG_TYPES = ["Gear Box + Motor", "Geared Motor"];
// Motor efficiency classes — matched against motor_master.motor_type to filter
// the motor candidates ("FLP IE2" offers only flameproof IE2 motors). The live
// list comes from drive_option_master; this is only the fallback if that fetch
// fails, so keep it in step with the seeded values.
const MOTOR_EFFICIENCY_CLASSES = ["IE2", "IE3", "FLP IE2", "FLP IE3"];
const STARTER_TYPES = ["Star-Delta", "DOL"];
const POWER_SUPPLIES = ["Single Phase", "Three Phase"];
const STD_OPTIONS = ["Standard", "Non-Standard"];

// Gear-box construction type, offered per SHAFT type — the shaft type is
// picked first and decides what the gear box can be. "IN LINE HELICAL" /
// "PLANTERY" match the gear_box_type strings stored in
// pbl_gearbox/ptl_gearbox/top_gear_gearbox ("PLANTERY", not "PLANETARY") —
// the gearbox screening filters on an exact match. "PARALLEL SHAFT" and
// "WORM REDUCTION" have no rows in those masters yet, so choosing one leaves
// the gearbox recommendation empty until that data is loaded.
const GB_TYPES_BY_SHAFT: Record<string, string[]> = {
  SISO: ["PLANTERY", "PARALLEL SHAFT", "WORM REDUCTION"],
  HISO: ["PLANTERY", "IN LINE HELICAL"],
};
const gbTypesFor = (shaftType: string | undefined): string[] =>
  GB_TYPES_BY_SHAFT[shaftType ?? ""] ?? [];

// --- Geared drive auto-fill -------------------------------------------------
// Coupling and both mountings are DERIVED from the pump type (Operating
// Conditions step), the gear-box SHAFT type and the motor KW, per the
// drive-selection spec:
//   Vertical          -> No Coupling, GB Flange, Motor Flange (with the shaft
//                        forced to HISO and the GB type to IN LINE HELICAL)
//   Horizontal + SISO -> Drive + Driven Coupling, GB Foot, Motor Foot
//   Horizontal + HISO -> Driven Coupling, GB Foot,
//                        Motor Foot cum Flange if KW >= 15 else Flange
// These are auto-filled as editable DEFAULTS (see the effect in the
// component) — the engineer can still override any of them.
type GearedDefaults = {
  gbConstructionType?: string; // only forced for Vertical
  gearBoxType?: string; // only forced for Vertical
  driveCoupling: string;
  gearBoxMounting: string;
  driveMotorMounting: string;
};
function deriveGearedDefaults(
  pumpType: string | undefined,
  gearBoxType: string | undefined,
  driveMotorKw: string | undefined,
): GearedDefaults | null {
  if (pumpType === "Vertical") {
    return {
      gbConstructionType: "IN LINE HELICAL",
      gearBoxType: "HISO",
      driveCoupling: "No Coupling",
      gearBoxMounting: "Flange Mount B5",
      driveMotorMounting: "Flange B5",
    };
  }
  // Horizontal variants (pumpType starts with "Horizontal") — the shaft type
  // decides how the gear box and the motor are mounted.
  if (gearBoxType === "SISO") {
    return {
      driveCoupling: "Drive + Driven Coupling",
      gearBoxMounting: "Foot Mount B3",
      driveMotorMounting: "Foot B3",
    };
  }
  if (gearBoxType === "HISO") {
    const kw = parseFloat(driveMotorKw ?? "");
    return {
      driveCoupling: "Driven Coupling",
      gearBoxMounting: "Foot Mount B3",
      driveMotorMounting:
        Number.isFinite(kw) && kw >= 15 ? "Foot cum Flange B35" : "Flange B5",
    };
  }
  // Horizontal but no shaft type chosen yet — nothing to derive.
  return null;
}

// Fields this step persists on Recheck — mirrors TABLE_FIELDS in
// PumpSelectionPage for the same three tables.
const MOTOR_DRIVE_FIELDS = [
  "driveMotorKw", "driveSystem", "motorRPM",
  "driveMotorSpeed", "driveMotorMake", "driveMotorMounting", "driveStdNonStd",
  "driveMotorEfficiency", "driveMotorProtection", "driveMotorFrequency",
  "driveMotorVoltage",
  "driveMotorProtectionPct", "driveMotorFrequencyPct", "driveMotorVoltagePct",
  "driveMotorFrameSize", "driveMotorLpPrice", "driveMotorFinalPrice",
  "driveMotorPriceUplifted", "driveMotorConfirmed",
  "driveStarterType", "drivePowerSupply",
  "vfdRequired", "vfdStdHz", "vfdMinHz", "vfdMaxHz",
] as const;

const DRIVE_VBELT_FIELDS = [
  "driveVbeltGroove", "drivePumpPulley", "driveMotorPulley", "driveVbeltRpm",
  "driveCenterDistance", "driveVbeltNo", "vbeltConfirmed", "vbeltRpmManual",
] as const;

const DRIVE_GEARED_FIELDS = [
  "gearBoxType", "gearedConfigType", "gbConstructionType", "gearBoxMounting",
  "driveCoupling", "couplingType", "couplingMake", "asfRange", "gearboxSource", "gearboxModel",
  "gearboxOutputRpm", "gearboxServiceFactor", "gearboxRatePerNos", "gearboxConfirmed",
  "gearboxRpmManual",
] as const;

// A field whose unit never changes (Hz, V): the unit sits in the box, so the
// engineer types the number alone.
const unitFieldWrap = "relative flex items-center";
// The spinner arrows would sit under the unit text, so they are hidden for
// these two fields (the value is still typed/validated as a number).
const unitFieldInput =
  "pr-[46px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
const unitSuffix =
  "pointer-events-none absolute right-[14px] text-[13.5px] font-medium text-fg-3";

type RatingOptionFieldProps = {
  kind: DriveOptionKind;
  fieldLabel: string;
  value: string;
  options: string[];
  /** Fixed unit (Hz / V) — shown in the option labels and in the Other box. */
  unit?: string;
  emptyLabel?: string;
  fieldHint?: string;
  onChange: (value: string) => void;
  onOptionsChange: (options: DriveOptions) => void;
  /** Error to show under the field (already gated on showErrors). */
  error?: string;
};

/**
 * One rating-plate dropdown, backed by drive_option_master. Picking "Other"
 * swaps the list for a box: what is typed there is saved to the list, so the
 * next enquiry can pick it instead of retyping it.
 */
const RatingOptionField = ({
  kind,
  fieldLabel,
  value,
  options,
  unit,
  emptyLabel = "Select",
  fieldHint,
  onChange,
  onOptionsChange,
  error,
}: RatingOptionFieldProps) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState("");

  // A value saved before it reached the list (or added by someone else since
  // this page loaded) still has to show in the box.
  const shown = !value || options.includes(value) ? options : [...options, value];

  const save = async () => {
    const next = draft.trim();
    if (!next) {
      setAddError(`Enter a ${fieldLabel.toLowerCase()}.`);
      return;
    }
    setSaving(true);
    setAddError("");
    try {
      const res = await addDriveOption(kind, next);
      onOptionsChange(res.options);
      // The server returns the stored spelling, so "ip55" selects "IP55"
      // rather than adding a near-duplicate.
      onChange(res.value);
      setAdding(false);
      setDraft("");
    } catch {
      setAddError("Couldn't save it. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (adding) {
    return (
      <div className={fieldWrap}>
        <label className={label}>{fieldLabel}</label>
        <div className="flex items-center gap-[8px]">
          <div className={`${unit ? unitFieldWrap : ""} flex-1`}>
            <input
              autoFocus
              type={unit ? "number" : "text"}
              min={unit ? "0" : undefined}
              step={unit ? "any" : undefined}
              className={`${control} ${unit ? unitFieldInput : ""}`}
              value={draft}
              placeholder={`New ${fieldLabel.toLowerCase()}`}
              onChange={(e) => {
                setDraft(e.target.value);
                if (addError) setAddError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
            />
            {unit && <span className={unitSuffix}>{unit}</span>}
          </div>
          <button type="button" className={btnPrimarySm} onClick={() => void save()} disabled={saving}>
            {saving ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            className={btnGhostSm}
            onClick={() => {
              setAdding(false);
              setDraft("");
              setAddError("");
            }}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
        <span className={hint}>Saved to the {fieldLabel.toLowerCase()} list for future enquiries.</span>
        {addError && <span className={hintError}>{addError}</span>}
      </div>
    );
  }

  return (
    <div className={fieldWrap}>
      <label className={label}>{fieldLabel}<Req /></label>
      <select
        className={control}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER_OPTION) {
            setAdding(true);
            setDraft("");
            return;
          }
          onChange(next);
        }}
      >
        <option value="">{emptyLabel}</option>
        {shown.map((o) => (
          <option key={o} value={o}>
            {unit ? `${o} ${unit}` : o}
          </option>
        ))}
        <option value={OTHER_OPTION}>{OTHER_OPTION}…</option>
      </select>
      {fieldHint && <span className={hint}>{fieldHint}</span>}
      {error && <span className={hintError}>{error}</span>}
    </div>
  );
};

const DriveDetailsStep = ({
  onNext,
  onPrevious,
  formData,
  setFormData,
  onStepClick,
  projectId,
  tagId,
}: Props) => {
  const isVBelt = formData.driveSystem === "V-Belt Drive";
  const isGeared = formData.driveSystem === "Geared Motor Drive/Gear Box + Motor";
  const motorRpm = formData.motorRPM as string;

  // Auto-fill the geared drive's shaft type / coupling / mountings from the
  // pump type + GB construction type + motor KW (see deriveGearedDefaults).
  // Editable defaults: applied when a *driver* changes, but a restored tag's
  // saved values (and manual overrides) are preserved.
  //  - gearedInitRef guards the FIRST run after entering the geared system:
  //    if the tag already has saved geared values we adopt the basis without
  //    overwriting them; a fresh tag falls through and gets the defaults.
  //  - gearedBasisRef holds the last basis we derived for, so a re-render
  //    that didn't change a driver doesn't clobber a manual override.
  const gearedInitRef = useRef(false);
  const gearedBasisRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isGeared || !formData.pumpType) {
      // Re-arm so re-entering the geared system re-initialises cleanly.
      gearedInitRef.current = false;
      gearedBasisRef.current = null;
      return;
    }
    const vertical = formData.pumpType === "Vertical";
    // Vertical forces HISO, so the basis uses the effective shaft type (keeps
    // the basis stable when the effect itself sets gearBoxType).
    const effectiveShaftType = vertical ? "HISO" : (formData.gearBoxType as string) || "";
    const basis = `${vertical}|${effectiveShaftType}|${formData.driveMotorKw ?? ""}`;

    // The shaft type is now an input, not a derived value, so it can't stand
    // in for "this tag already has saved geared values".
    const hasSaved = Boolean(formData.driveCoupling || formData.gearBoxMounting);
    if (!gearedInitRef.current) {
      gearedInitRef.current = true;
      gearedBasisRef.current = basis;
      if (hasSaved) return; // preserve restored / previously-saved values
    } else if (basis === gearedBasisRef.current) {
      return; // no driver changed — leave manual overrides alone
    }
    gearedBasisRef.current = basis;

    const defaults = deriveGearedDefaults(
      formData.pumpType,
      effectiveShaftType,
      formData.driveMotorKw,
    );
    if (!defaults) return; // horizontal with no shaft type yet — nothing to fill

    const noCoupling = defaults.driveCoupling === "No Coupling";
    setFormData((f: typeof formData) => ({
      ...f,
      ...(defaults.gbConstructionType
        ? { gbConstructionType: defaults.gbConstructionType }
        : {}),
      ...(defaults.gearBoxType ? { gearBoxType: defaults.gearBoxType } : {}),
      driveCoupling: defaults.driveCoupling,
      gearBoxMounting: defaults.gearBoxMounting,
      driveMotorMounting: defaults.driveMotorMounting,
      // No coupling ⇒ the type/make fields don't apply; clear any stale values
      // so they don't linger hidden and leak into the report.
      ...(noCoupling ? { couplingType: "", couplingMake: "" } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGeared, formData.pumpType, formData.gearBoxType, formData.driveMotorKw]);

  // V-Belt drive: the motor sits on the base plate driving a pulley, so it is
  // foot mounted. Auto-filled as an editable DEFAULT, with the same two rules
  // the geared defaults use:
  //   - switching INTO V-Belt always sets it, so a mounting left over from the
  //     geared system (Flange / Foot cum Flange) does not stick;
  //   - arriving already on V-Belt (a reload/restore) keeps whatever was
  //     saved, so a deliberate manual override survives.
  const prevDriveRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevDriveRef.current;
    prevDriveRef.current = (formData.driveSystem as string) ?? "";
    if (!isVBelt) return;
    const switchedIn = prev !== null && prev !== formData.driveSystem;
    setFormData((f: typeof formData) => {
      if (!switchedIn && f.driveMotorMounting) return f; // restored - keep it
      if (f.driveMotorMounting === "Foot B3") return f; // already correct
      return { ...f, driveMotorMounting: "Foot B3" };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVBelt, formData.driveSystem]);

  // Recheck modal: computes the actual delivered capacity + BKW at the
  // drive-achieved pump RPM (v-belt actual RPM, gearbox output RPM, or motor
  // RPM for direct drive) using the pump's own qth/VE/ME. Fetched lazily on
  // first Recheck click via getRecommendations — kept out of the mount effect
  // so it doesn't hit the API for users who don't open the modal.
  const [showRecheck, setShowRecheck] = useState(false);
  const [recheckLoading, setRecheckLoading] = useState(false);
  const [recheckError, setRecheckError] = useState<string | null>(null);
  const [pumpSpecs, setPumpSpecs] = useState<PumpRecommendation | null>(null);

  // Rating-plate option lists. A failed fetch leaves them empty: the
  // dropdowns still offer "Other", so the step keeps working.
  const [driveOptions, setDriveOptions] = useState<DriveOptions>(emptyDriveOptions);
  useEffect(() => {
    let cancelled = false;
    getDriveOptions()
      .then((o) => {
        if (!cancelled) setDriveOptions(o);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // A draft saved as Standard before these defaults existed (or with a field
  // left blank) gets the standard plate filled in once, without overwriting
  // anything already chosen.
  const stdPlateRef = useRef(false);
  useEffect(() => {
    if (formData.driveStdNonStd !== "Standard") {
      stdPlateRef.current = false;
      return;
    }
    if (stdPlateRef.current) return;
    stdPlateRef.current = true;
    setFormData((f: typeof formData) => {
      const patch: Record<string, string> = {};
      for (const [field, value] of Object.entries(STANDARD_RATING_PLATE)) {
        if (!f[field]) patch[field] = value;
      }
      return Object.keys(patch).length > 0 ? { ...f, ...patch } : f;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.driveStdNonStd]);

  const { raw: finalPumpRpmRaw, source: finalPumpRpmSource } = finalPumpRpm(formData);

  // VFD range: pump speed is proportional to frequency, so show what the two
  // ends come to as soon as a final pump speed is known.
  const vfdStd = parseFloat(formData.vfdStdHz ?? "");
  const vfdMin = parseFloat(formData.vfdMinHz ?? "");
  const vfdMax = parseFloat(formData.vfdMaxHz ?? "");
  const vfdRangeError =
    formData.vfdRequired === VFD_YES &&
    Number.isFinite(vfdMin) &&
    Number.isFinite(vfdMax) &&
    vfdMin >= vfdMax
      ? "Min Hz must be less than Max Hz."
      : "";
  const finalRpmNumForVfd = Number(finalPumpRpmRaw);
  const vfdSpeedHint =
    formData.vfdRequired === VFD_YES &&
    !vfdRangeError &&
    Number.isFinite(finalRpmNumForVfd) &&
    finalRpmNumForVfd > 0 &&
    [vfdStd, vfdMin, vfdMax].every((v) => Number.isFinite(v) && v > 0)
      ? `Pump runs ${fmtRecheckNum(rpmAtHz(finalRpmNumForVfd, vfdMin, vfdStd), 0)}–${fmtRecheckNum(
          rpmAtHz(finalRpmNumForVfd, vfdMax, vfdStd),
          0,
        )} rpm. Recheck shows capacity & BKW at both.`
      : "";

  // Writes the Drive step's own tables: the drive-agnostic motor/rating-plate
  // block plus whichever drive-system-specific table matches the current
  // choice. Field lists mirror TABLE_FIELDS in PumpSelectionPage — the API
  // whitelists on its side too, so an extra key here is ignored rather than
  // trusted.
  const persistDriveInputs = () => {
    if (!projectId) return;
    const pick = (keys: readonly string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = formData[k];
      return out;
    };
    saveWizardInput("motor-drive", projectId, pick(MOTOR_DRIVE_FIELDS), tagId).catch(() => {});
    // Only the table matching the chosen drive system — the API clears the
    // other two on write, so an enquiry keeps exactly one drive row.
    if (isVBelt) {
      saveWizardInput("drive-vbelt", projectId, pick(DRIVE_VBELT_FIELDS), tagId).catch(() => {});
    } else if (isGeared) {
      saveWizardInput("drive-geared", projectId, pick(DRIVE_GEARED_FIELDS), tagId).catch(() => {});
    } else if (formData.driveSystem === "Direct Drive") {
      saveWizardInput("drive-direct", projectId, {}, tagId).catch(() => {});
    }
  };

  // Wipes every drive + motor input for this project - both the in-memory
  // formData and the three persisted tables (motor-drive, drive-vbelt,
  // drive-geared). Meant for recovering from a wrong initial drive-system
  // pick (V-Belt when the enquiry actually wants Geared Motor, or vice
  // versa) so no stale row lingers in the DB after switching. Destructive,
  // so it's confirm-guarded before the wipe runs.
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const handleClearDriveInputs = async () => {
    if (!projectId) return;
    const ok = window.confirm(
      "Clear all drive + motor inputs for this project? This wipes the choice, the rating fields and any selected V-belt / gearbox / motor card. This action cannot be undone.",
    );
    if (!ok) return;
    setClearError(null);
    setCleared(false);
    setClearing(true);
    // Local wipe: every field this step controls is set to "" / undefined so
    // the UI reflects the reset immediately, without waiting for the network.
    const wipe: Record<string, unknown> = {};
    for (const k of MOTOR_DRIVE_FIELDS) wipe[k] = "";
    for (const k of DRIVE_VBELT_FIELDS) wipe[k] = "";
    for (const k of DRIVE_GEARED_FIELDS) wipe[k] = "";
    wipe.driveSystem = "";
    wipe.driveMotorConfirmed = false;
    wipe.vbeltConfirmed = false;
    wipe.gearboxConfirmed = false;
    wipe.vbeltRpmManual = false;
    wipe.gearboxRpmManual = false;
    setFormData({ ...formData, ...wipe });
    // Server wipe: delete the row in each of the three drive tables. Best-
    // effort - if one fails we still report the failure so the user can
    // retry, but the in-memory state is already reset either way.
    try {
      await Promise.all([
        clearWizardInput("motor-drive", projectId, tagId),
        clearWizardInput("drive-vbelt", projectId, tagId),
        clearWizardInput("drive-geared", projectId, tagId),
      ]);
      setCleared(true);
    } catch {
      setClearError("Server couldn't clear all rows - try Clear again.");
    } finally {
      setClearing(false);
    }
  };

  // Every Drive input is required for the selections made - only the
  // Non-Standard price % fields are optional. Fields that aren't shown for the
  // current drive system / coupling / Std-Non-Std / VFD choice aren't asked for.
  const [showErrors, setShowErrors] = useState(false);
  const hasCoupling = !!formData.driveCoupling && formData.driveCoupling !== "No Coupling";
  const driveErrors: Record<string, string> = {
    driveSystem: required(formData.driveSystem, "Select a drive system."),
    ...(formData.driveSystem && !isGeared
      ? { motorRPM: required(formData.motorRPM, "Select the motor RPM.") }
      : {}),
    ...(isGeared
      ? {
          gearedConfigType: required(formData.gearedConfigType, "Select the configuration."),
          gearBoxType: required(formData.gearBoxType, "Select the gear box shaft type."),
          gbConstructionType: required(formData.gbConstructionType, "Select the GB type."),
          gearBoxMounting: required(formData.gearBoxMounting, "Select the gear box mounting."),
          driveCoupling: required(formData.driveCoupling, "Select the coupling."),
          ...(hasCoupling
            ? {
                couplingType: required(formData.couplingType, "Select the coupling type."),
                couplingMake: required(formData.couplingMake, "Select the coupling make."),
              }
            : {}),
          asfRange: required(formData.asfRange, "Select the ASF range."),
        }
      : {}),
    ...(formData.driveSystem
      ? {
          driveMotorSpeed: required(formData.driveMotorSpeed, "Enter the drive motor speed."),
          driveMotorMake: required(formData.driveMotorMake, "Select the motor make."),
          driveMotorMounting: required(formData.driveMotorMounting, "Select the motor mounting."),
          driveStdNonStd: required(formData.driveStdNonStd, "Select Standard or Non-Standard."),
          ...(formData.driveStdNonStd
            ? {
                driveMotorEfficiency: required(formData.driveMotorEfficiency, "Select the efficiency."),
                driveMotorProtection: required(formData.driveMotorProtection, "Select the protection."),
                driveMotorFrequency: required(formData.driveMotorFrequency, "Select the frequency."),
                driveMotorVoltage: required(formData.driveMotorVoltage, "Select the voltage."),
              }
            : {}),
          driveStarterType: required(formData.driveStarterType, "Select the starter type."),
          drivePowerSupply: required(formData.drivePowerSupply, "Select the power supply."),
          vfdRequired: required(formData.vfdRequired, "Select whether a VFD is required."),
          ...(formData.vfdRequired === VFD_YES
            ? {
                vfdStdHz: required(formData.vfdStdHz, "Enter the std Hz."),
                vfdHzRange:
                  !(formData.vfdMinHz ?? "").trim() || !(formData.vfdMaxHz ?? "").trim()
                    ? "Enter both the min and max Hz."
                    : "",
              }
            : {}),
        }
      : {}),
  };
  const driveErrorCount = Object.values(driveErrors).filter(Boolean).length;

  const handleStepClick = (target: number) => {
    if (target > 7 && hasErrors(driveErrors)) {
      setShowErrors(true);
      return;
    }
    if (target > 7 && (!formData.selectedModel || !formData.driveSystem || !finalPumpRpmRaw)) {
      void handleRecheck();
      return;
    }
    onStepClick?.(target);
  };

  const handleRecheck = async () => {
    setRecheckError(null);
    // Required inputs first: the errors show on the form itself.
    if (hasErrors(driveErrors)) {
      setShowErrors(true);
      return;
    }
    if (!formData.selectedModel) {
      setRecheckError("Confirm a pump model first.");
      setShowRecheck(true);
      return;
    }
    if (!formData.driveSystem) {
      setRecheckError("Pick a drive system first.");
      setShowRecheck(true);
      return;
    }
    if (!finalPumpRpmRaw) {
      setRecheckError(
        isVBelt
          ? "Pick a V-Belt option or enter the V-belt details manually — final pump RPM comes from the belt."
          : isGeared
            ? "Pick a gearbox or enter the gearbox details manually — final pump RPM comes from the gearbox output."
            : "Motor RPM is required.",
      );
      setShowRecheck(true);
      return;
    }
    // Recheck doubles as an explicit "save my work" action — persist the
    // drive + motor inputs now rather than waiting for a Next/Previous
    // navigation, so a refresh right after rechecking keeps them.
    persistDriveInputs();

    setRecheckLoading(true);
    setShowRecheck(true);
    try {
      const { recommendations } = await getRecommendations(formData);
      const match = recommendations.find((p) => p.model === formData.selectedModel);
      if (!match) {
        setRecheckError(
          "Couldn't find the confirmed pump in the current recommendation set — it may no longer satisfy the entered duty point.",
        );
        setPumpSpecs(null);
      } else {
        // The match carries every charted head point; the modal reads VE / ME /
        // Qth at the SELECTED head (see RecheckModal), while BKW still uses the
        // entered duty head — same split as the motor rating and drive steps.
        setPumpSpecs(match);
      }
    } catch {
      setRecheckError("Couldn't load pump specifications. Check your connection and try again.");
      setPumpSpecs(null);
    } finally {
      setRecheckLoading(false);
    }
  };

  const [vbeltStatus, setVbeltStatus] = useState<VbeltStatus>("idle");
  const [vbelt, setVbelt] = useState<VBeltDrive | null>(null);

  useEffect(() => {
    if (!isVBelt || !motorRpm || !formData.selectedModel || !formData.driveMotorKw) {
      setVbeltStatus("idle");
      setVbelt(null);
      return;
    }
    let cancelled = false;
    setVbeltStatus("loading");
    getVBeltDrive(formData, motorRpm)
      .then((res) => {
        if (cancelled) return;
        setVbelt(res);
        setVbeltStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setVbeltStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isVBelt,
    motorRpm,
    formData.selectedModel,
    // The selected head fixes the pump RPM window the options are screened
    // against, so changing it must re-run the search.
    formData.selectedHead,
    formData.driveMotorKw,
    formData.capacity,
    formData.capacityUnit,
    formData.head,
    formData.headUnit,
    formData.sg,
  ]);

  // Manual belt pick — clicking a candidate card records its details into
  // formData for the summary step. No auto-selection on fetch (per spec).
  // Clicking the already-selected card clears it; a fresh pick always drops
  // back to unconfirmed so the user has to confirm it explicitly.
  const selectVBelt = (grooves: string | null, opt: VBeltOption, alreadySelected: boolean) => {
    if (alreadySelected) {
      setFormData({
        ...formData,
        driveVbeltGroove: "",
        drivePumpPulley: "",
        driveMotorPulley: "",
        driveVbeltRpm: "",
        driveCenterDistance: "",
        driveVbeltNo: "",
        vbeltConfirmed: false,
        vbeltRpmManual: false,
      });
      return;
    }
    setFormData({
      ...formData,
      driveVbeltGroove: grooves ?? "",
      drivePumpPulley: opt.pumpPulley != null ? String(opt.pumpPulley) : "",
      driveMotorPulley: opt.motorPulley != null ? String(opt.motorPulley) : "",
      driveVbeltRpm: opt.actualRpm != null ? String(opt.actualRpm) : "",
      driveCenterDistance: opt.centerDistance != null ? String(opt.centerDistance) : "",
      driveVbeltNo: opt.vBelt != null ? String(opt.vBelt) : "",
      vbeltConfirmed: false,
      vbeltRpmManual: false,
    });
  };

  // Manual V-belt entry: the typed details are the selection (the RPM stands
  // in for the belt's achieved RPM); any edit needs confirming again.
  const editManualVbelt = (patch: Record<string, string>) =>
    setFormData({ ...formData, ...patch, vbeltRpmManual: true, vbeltConfirmed: false });
  const cancelManualVbelt = () =>
    setFormData({
      ...formData,
      driveVbeltGroove: "",
      drivePumpPulley: "",
      driveMotorPulley: "",
      driveVbeltRpm: "",
      driveCenterDistance: "",
      driveVbeltNo: "",
      vbeltRpmManual: false,
      vbeltConfirmed: false,
    });

  // "Drive Motor Speed" is the motor's nameplate RPM — default it from the
  // selected Motor RPM (960/1440), but leave it editable afterwards. Applies
  // to every drive system, not just V-Belt.
  useEffect(() => {
    if (formData.driveSystem && motorRpm && !formData.driveMotorSpeed) {
      setFormData((f: typeof formData) => ({ ...f, driveMotorSpeed: motorRpm }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.driveSystem, motorRpm]);

  // --- Motor selection (motor_master candidates) --------------------------
  // Every motor matching the fixed rating (KW) + RPM + mounting, optionally
  // narrowed by make. Shown as clickable cards, same manual-pick pattern as
  // the V-Belt/gearbox candidates — nothing is auto-selected.
  const [motorStatus, setMotorStatus] = useState<MotorStatus>("idle");
  const [motorOptions, setMotorOptions] = useState<MotorMasterRow[]>([]);

  // Motor selection applies to EVERY drive system, including the "Geared
  // Motor" config. It used to be hidden there on the reasoning that an
  // integrated geared motor isn't sourced separately, but per user decision
  // that config specifies and picks its motor the same way "Gear Box + Motor"
  // does — the motor still has to be rated, priced and quoted either way.
  useEffect(() => {
    if (!formData.driveSystem || !formData.driveMotorKw) {
      setMotorStatus("idle");
      setMotorOptions([]);
      return;
    }
    let cancelled = false;
    setMotorStatus("loading");
    listMotorOptions({
      kw: formData.driveMotorKw,
      rpm: formData.driveMotorSpeed || motorRpm || undefined,
      mounting: formData.driveMotorMounting || undefined,
      make: formData.driveMotorMake || undefined,
      motorType: formData.driveMotorEfficiency || undefined,
    })
      .then((rows) => {
        if (cancelled) return;
        setMotorOptions(rows);
        setMotorStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setMotorStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formData.driveSystem,
    formData.driveMotorKw,
    formData.driveMotorSpeed,
    motorRpm,
    formData.driveMotorMounting,
    formData.driveMotorMake,
    formData.driveMotorEfficiency,
  ]);

  const isNonStandard = formData.driveStdNonStd === "Non-Standard";

  // Non-Standard uplift: the percentages are summed, then applied once to the
  // motor's final price (additive, per spec) — not compounded. Efficiency is
  // NOT among them: it filters which motor type (IE class) is offered rather
  // than adding cost.
  const nonStdPct = isNonStandard
    ? pct(formData.driveMotorProtectionPct) +
      pct(formData.driveMotorFrequencyPct) +
      pct(formData.driveMotorVoltagePct)
    : 0;
  // Flange / Foot cum Flange: +3% up to 11 kW, +5% above (lib/motor-price.ts).
  // Every candidate has the fixed rating, so one % covers the whole list.
  const mountPct = mountingUpliftPct(formData.driveMotorMounting, formData.driveMotorKw);
  const upliftPct = nonStdPct + mountPct;
  // Gear box converted to Flange Mount (B5): +5% on the master rate.
  const gbFlangePct = gearboxMountingUpliftPct(formData.gearBoxMounting);

  const upliftedPrice = (finalPrice: string | null): number | null => {
    const base = finalPrice === null ? NaN : parseFloat(finalPrice);
    if (Number.isNaN(base)) return null;
    return Math.round(base * (1 + upliftPct / 100) * 100) / 100;
  };

  // Manual motor pick — records the motor and its (uplift-adjusted) price.
  // Same select/unselect + confirm cycle as the belt/gearbox cards. Note the
  // make is deliberately NOT cleared on unselect: it doubles as the candidate
  // filter, so wiping it would reshuffle the list the user is choosing from.
  const selectMotor = (m: MotorMasterRow, alreadySelected: boolean) => {
    if (alreadySelected) {
      setFormData({
        ...formData,
        driveMotorFrameSize: "",
        driveMotorLpPrice: "",
        driveMotorFinalPrice: "",
        driveMotorPriceUplifted: "",
        driveMotorConfirmed: false,
      });
      return;
    }
    const up = upliftedPrice(m.finalPrice);
    setFormData({
      ...formData,
      driveMotorMake: m.brand ?? "",
      driveMotorFrameSize: m.frameSize ?? "",
      driveMotorLpPrice: m.lpPrice ?? "",
      driveMotorFinalPrice: m.finalPrice ?? "",
      driveMotorPriceUplifted: up === null ? "" : String(up),
      driveMotorConfirmed: false,
    });
  };

  // Keep the stored uplifted price in step with the % inputs after a motor is
  // already picked, so editing a percentage doesn't leave a stale total.
  useEffect(() => {
    if (!formData.driveMotorFinalPrice) return;
    const up = upliftedPrice(formData.driveMotorFinalPrice);
    const next = up === null ? "" : String(up);
    if (next !== formData.driveMotorPriceUplifted) {
      setFormData((f: typeof formData) => ({ ...f, driveMotorPriceUplifted: next }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upliftPct, formData.driveMotorFinalPrice]);

  // Gearbox recommendation (PBL/PTL/Top Gear), only once a model + duty point
  // + the Motor Rating step's KW are known. Re-screens whenever ASF Range or
  // GB Type change too — those narrow the already-fetched candidate set.
  const [gearboxStatus, setGearboxStatus] = useState<GearboxStatus>("idle");
  const [gearboxRec, setGearboxRec] = useState<GearboxRecommendation | null>(null);

  useEffect(() => {
    if (!isGeared || !formData.selectedModel || !formData.driveMotorKw) {
      setGearboxStatus("idle");
      setGearboxRec(null);
      return;
    }
    let cancelled = false;
    setGearboxStatus("loading");
    getGearboxOptions(formData)
      .then((res) => {
        if (cancelled) return;
        setGearboxRec(res);
        setGearboxStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setGearboxStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isGeared,
    formData.selectedModel,
    // The selected head fixes the pump RPM window the options are screened
    // against, so changing it must re-run the search.
    formData.selectedHead,
    formData.driveMotorKw,
    formData.capacity,
    formData.capacityUnit,
    formData.head,
    formData.headUnit,
    formData.sg,
    formData.asfRange,
    formData.gbConstructionType,
  ]);

  // Whether the confirmed belt / motor is still among the current candidates.
  // Same concern as gearboxSelectionInList below: the confirmed-collapse must
  // not hide every card when the pick has dropped out of a re-run screen.
  const vbeltSelectionInList = Boolean(
    vbelt?.candidates.some(
      (o) =>
        formData.driveVbeltGroove === (vbelt.grooves ?? "") &&
        formData.driveVbeltRpm === (o.actualRpm != null ? String(o.actualRpm) : "") &&
        formData.driveVbeltNo === (o.vBelt != null ? String(o.vBelt) : ""),
    ),
  );

  const motorSelectionInList = motorOptions.some(
    (m) =>
      formData.driveMotorFrameSize === (m.frameSize ?? "") &&
      formData.driveMotorMake === (m.brand ?? ""),
  );

  // Identifies the persisted pick among the fetched candidates. Shared by the
  // card list and the out-of-list fallback below so both agree on what
  // "selected" means.
  const isGearboxSelected = (source: string, o: GearboxOption) =>
    formData.gearboxSource === source &&
    formData.gearboxModel === o.model &&
    formData.gearboxOutputRpm === String(o.outputRpm);

  // Whether the confirmed/selected gearbox still appears in the current
  // candidate list. It can drop out whenever the screen is re-run against
  // different inputs — ASF Range / GB Type narrowed, a new motor KW, or a
  // shifted RPM window. When that happens the card list renders nothing, so
  // the fallback card below is what keeps the selection visible (and
  // clearable) instead of stranding the confirm bar with no card to click.
  const gearboxSelectionInList = Boolean(
    gearboxRec &&
      (
        [
          ["PBL", gearboxRec.pbl],
          ["PTL", gearboxRec.ptl],
          ["Top Gear", gearboxRec.topGear],
        ] as [string, GearboxOption[]][]
      ).some(([source, opts]) => opts.some((o) => isGearboxSelected(source, o))),
  );

  const clearGearbox = () =>
    setFormData({
      ...formData,
      gearboxSource: "",
      gearboxModel: "",
      gearboxOutputRpm: "",
      gearboxServiceFactor: "",
      gearboxRatePerNos: "",
      gearboxConfirmed: false,
      gearboxRpmManual: false,
    });

  // Manual gearbox entry: the typed details are the selection (output RPM
  // feeds Recheck); any edit needs confirming again.
  const editManualGearbox = (patch: Record<string, string>) =>
    setFormData({ ...formData, ...patch, gearboxRpmManual: true, gearboxConfirmed: false });

  // Same select/unselect + confirm cycle as the belt cards above.
  const selectGearbox = (
    source: "PBL" | "PTL" | "Top Gear",
    opt: GearboxOption,
    alreadySelected: boolean,
  ) => {
    if (alreadySelected) {
      clearGearbox();
      return;
    }
    setFormData({
      ...formData,
      gearboxSource: source,
      gearboxModel: opt.model,
      gearboxOutputRpm: String(opt.outputRpm),
      gearboxServiceFactor: opt.serviceFactor != null ? String(opt.serviceFactor) : "",
      gearboxRatePerNos: opt.ratePerNos != null ? String(opt.ratePerNos) : "",
      gearboxConfirmed: false,
      gearboxRpmManual: false,
    });
  };

  return (
    <div className="step-container">
      <Stepper currentStep={7} maxStep={formData.wizardMaxStep} onStepClick={handleStepClick} />

      <div className="step-card">
        <h2>
          Drive Details
          <StepApprovalBadge step={7} />
        </h2>
        <p>Select the drive system and motor specification.</p>

        {/* clear-drive-top-bar: escape hatch for a wrong drive-system pick.
            Sits above the Drive System dropdown so the user finds it BEFORE
            re-picking - clicking it wipes every drive + motor field (both the
            form and the database) so the next choice starts clean. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-elev px-3 py-2">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-fg">
              Picked the wrong drive system?
            </div>
            <div className="text-[11px] text-fg-3">
              Clear the drive + motor inputs (form and database) before switching.
            </div>
          </div>
          <button
            type="button"
            className={btnGhost}
            onClick={handleClearDriveInputs}
            disabled={!projectId || clearing}
            title={
              !projectId
                ? "No project open"
                : "Wipe drive + motor inputs (both the form and the database)"
            }
          >
            {clearing ? "Clearing…" : "Clear"}
          </button>
        </div>
        {(clearError || cleared) && (
          <p
            className={
              cleared
                ? "mt-2 text-[12px] text-pos"
                : "mt-2 text-[12px] text-warn"
            }
          >
            {cleared
              ? "Drive and motor inputs cleared - pick a drive system to start fresh."
              : clearError}
          </p>
        )}

        <div className={grid}>
          <div className={fieldWrap}>
            <label className={label}>Drive System Type<Req /></label>
            <select
              className={control}
              value={formData.driveSystem}
              onChange={(e) => {
                const nextDrive = e.target.value;
                const isGeared = nextDrive === "Geared Motor Drive/Gear Box + Motor";
                setFormData({
                  ...formData,
                  driveSystem: nextDrive,
                  // Motor RPM: fixed 1440 for the Geared option (only one
                  // supported gear-motor speed); cleared when no drive is
                  // selected; preserved when switching between Direct/V-Belt.
                  motorRPM: isGeared
                    ? "1440"
                    : nextDrive === ""
                      ? ""
                      : formData.motorRPM,
                  gearBoxType: isGeared ? formData.gearBoxType : "",
                  gearBoxMounting: isGeared ? formData.gearBoxMounting : "",
                  asfRange: isGeared ? formData.asfRange : "",
                });
              }}
            >
              <option value="">Select Drive System</option>
              <option value="Direct Drive">Direct Drive</option>
              <option value="V-Belt Drive">V-Belt Drive</option>
              <option value="Geared Motor Drive/Gear Box + Motor">
                Geared Motor Drive/Gear Box + Motor
              </option>
            </select>
            <Err show={showErrors} msg={driveErrors.driveSystem} />
          </div>

          {/* Motor RPM: only relevant after a drive system is picked. For the
              Geared option it's fixed at 1440 (shown read-only). */}
          {formData.driveSystem && (
            <div className={fieldWrap}>
              <label className={label}>Motor RPM<Req /></label>
              {formData.driveSystem === "Geared Motor Drive/Gear Box + Motor" ? (
                <input
                  type="text"
                  readOnly
                  className={`${control} opacity-80`}
                  value="1440"
                />
              ) : (
                <select
                  className={control}
                  value={formData.motorRPM}
                  onChange={(e) =>
                    setFormData({ ...formData, motorRPM: e.target.value })
                  }
                >
                  <option value="">Select Motor RPM</option>
                  <option value="960">960</option>
                  <option value="1440">1440</option>
                </select>
              )}
              <Err show={showErrors} msg={driveErrors.motorRPM} />
            </div>
          )}

          {formData.driveSystem === "Geared Motor Drive/Gear Box + Motor" && (
            <>
              <div className={fieldWrap}>
                <label className={label}>Configuration<Req /></label>
                <select
                  className={control}
                  value={formData.gearedConfigType ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, gearedConfigType: e.target.value })
                  }
                >
                  <option value="">Select Configuration</option>
                  {GEARED_CONFIG_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <Err show={showErrors} msg={driveErrors.gearedConfigType} />
              </div>

              <div className={fieldWrap}>
                <label className={label}>Selected Motor KW</label>
                <input
                  type="text"
                  readOnly
                  className={`${control} opacity-80`}
                  value={formData.driveMotorKw ? `${formData.driveMotorKw} kW` : ""}
                  placeholder="Set on the Motor Rating step"
                />
                <span className={hint}>Auto-filled from the Motor Rating step.</span>
              </div>

              <div className={fieldWrap}>
                <label className={label}>Gear Box Shaft Type<Req /></label>
                <select
                  className={control}
                  value={formData.gearBoxType}
                  onChange={(e) => {
                    const shaftType = e.target.value;
                    const allowed = gbTypesFor(shaftType);
                    const gbType = (formData.gbConstructionType as string) || "";
                    setFormData({
                      ...formData,
                      gearBoxType: shaftType,
                      // GB Type is offered per shaft type — drop a pick the
                      // new shaft type doesn't offer rather than leaving a
                      // value that isn't in the list.
                      ...(gbType && !allowed.includes(gbType)
                        ? { gbConstructionType: "" }
                        : {}),
                    });
                  }}
                >
                  <option value="">Select Gear Box Shaft Type</option>
                  <option value="HISO">HISO (Hollow Input Solid Output)</option>
                  <option value="SISO">SISO (Solid Input Solid Output)</option>
                </select>
                <span className={hint}>
                  {formData.pumpType === "Vertical"
                    ? "Vertical pump — defaults to HISO."
                    : "Sets the GB Type list, the mountings and the coupling below."}
                </span>
                <Err show={showErrors} msg={driveErrors.gearBoxType} />
              </div>

              <div className={fieldWrap}>
                <label className={label}>GB Type<Req /></label>
                <select
                  className={control}
                  value={formData.gbConstructionType ?? ""}
                  disabled={!formData.gearBoxType}
                  onChange={(e) =>
                    setFormData({ ...formData, gbConstructionType: e.target.value })
                  }
                >
                  <option value="">Select GB Type</option>
                  {gbTypesFor(formData.gearBoxType as string).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <span className={hint}>
                  {formData.pumpType === "Vertical"
                    ? "Vertical pump — defaults to In Line Helical."
                    : !formData.gearBoxType
                      ? "Pick the shaft type first."
                      : "Narrows the gearbox recommendation below."}
                </span>
                <Err show={showErrors} msg={driveErrors.gbConstructionType} />
              </div>

              <div className={fieldWrap}>
                <label className={label}>Gear Box Mounting<Req /></label>
                <select
                  className={control}
                  value={formData.gearBoxMounting ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, gearBoxMounting: e.target.value })
                  }
                >
                  <option value="">Select Mounting</option>
                  {GB_MOUNTINGS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <span className={hint}>
                  Auto-filled from pump type &amp; shaft type — override if needed.
                </span>
                <Err show={showErrors} msg={driveErrors.gearBoxMounting} />
              </div>

              <div className={fieldWrap}>
                <label className={label}>Coupling<Req /></label>
                <select
                  className={control}
                  value={formData.driveCoupling ?? ""}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFormData({
                      ...formData,
                      driveCoupling: next,
                      // Dropping to "No Coupling" (or clearing) makes the
                      // type/make fields irrelevant — clear them so nothing
                      // stale lingers hidden.
                      ...(next === "No Coupling" || next === ""
                        ? { couplingType: "", couplingMake: "" }
                        : {}),
                    });
                  }}
                >
                  <option value="">Select Coupling</option>
                  {COUPLING_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className={hint}>
                  Auto-filled from pump type &amp; shaft type — override if needed.
                </span>
                <Err show={showErrors} msg={driveErrors.driveCoupling} />
              </div>

              {/* Coupling construction type + make — only when an actual
                  coupling is present (i.e. not "No Coupling" / unset). */}
              {formData.driveCoupling &&
                formData.driveCoupling !== "No Coupling" && (
                  <>
                    <div className={fieldWrap}>
                      <label className={label}>Types of Coupling Options<Req /></label>
                      <select
                        className={control}
                        value={formData.couplingType ?? ""}
                        onChange={(e) =>
                          setFormData({ ...formData, couplingType: e.target.value })
                        }
                      >
                        <option value="">Select Coupling Type</option>
                        {COUPLING_TYPES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <Err show={showErrors} msg={driveErrors.couplingType} />
                    </div>

                    <div className={fieldWrap}>
                      <label className={label}>Coupling Make<Req /></label>
                      <select
                        className={control}
                        value={formData.couplingMake ?? ""}
                        onChange={(e) =>
                          setFormData({ ...formData, couplingMake: e.target.value })
                        }
                      >
                        <option value="">Select Coupling Make</option>
                        {COUPLING_MAKES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <Err show={showErrors} msg={driveErrors.couplingMake} />
                    </div>
                  </>
                )}

              <div className={fieldWrap}>
                <label className={label}>ASF Range<Req /></label>
                <select
                  className={control}
                  value={formData.asfRange}
                  onChange={(e) =>
                    setFormData({ ...formData, asfRange: e.target.value })
                  }
                >
                  <option value="">Select ASF Range</option>
                  <option value="1.4-2">1.4 - 2</option>
                  <option value="2+">2 &amp; Above</option>
                </select>
                <Err show={showErrors} msg={driveErrors.asfRange} />
              </div>
            </>
          )}
        </div>

        {isGeared && (
          <div className="mt-4 rounded-md border border-line bg-elev p-4">
            <span className="section-label">Gearbox Recommendation</span>

            {gearboxStatus === "idle" && (
              <p className="mt-2 text-[13px] text-fg-3">
                Set the Drive Motor Rating on the Motor Rating step to see gearbox
                candidates from PBL, PTL, and Top Gear.
              </p>
            )}
            {gearboxStatus === "loading" && (
              <p className="mt-2 text-[13px] text-fg-3">Screening gearbox candidates…</p>
            )}
            {gearboxStatus === "error" && (
              <p className="mt-2 text-[13px] text-warn">
                Couldn&apos;t load gearbox candidates — check your connection and try again.
              </p>
            )}

            {gearboxStatus === "ready" && gearboxRec && (
              <>
                <p className="mt-2 text-[12px] text-fg-3">
                  Pump&apos;s required speed window is{" "}
                  <b className="mono text-fg-2">
                    {gearboxRec.rpmLo.toFixed(0)}–{gearboxRec.rpmHi.toFixed(0)} rpm
                  </b>{" "}
                  — screened here ±20%:{" "}
                  <b className="mono text-fg-2">
                    {gearboxRec.rpmLoPadded.toFixed(0)}–{gearboxRec.rpmHiPadded.toFixed(0)} rpm
                  </b>{" "}
                  at <b className="mono text-fg-2">{gearboxRec.motorKw} kW</b>.
                  {(formData.asfRange || formData.gbConstructionType) && (
                    <>
                      {" "}Narrowed by
                      {formData.asfRange ? ` ASF ${formData.asfRange}` : ""}
                      {formData.asfRange && formData.gbConstructionType ? " and" : ""}
                      {formData.gbConstructionType ? ` GB Type ${formData.gbConstructionType}` : ""}.
                    </>
                  )}
                </p>

                {gearboxRec.pbl.length === 0 &&
                  gearboxRec.ptl.length === 0 &&
                  gearboxRec.topGear.length === 0 && (
                    <p className="mt-2 text-[13px] text-warn">
                      No gearbox options match this window/KW
                      {formData.asfRange || formData.gbConstructionType
                        ? " with the current ASF Range/GB Type narrowing — try clearing one, or enter the details manually below."
                        : " — enter the details manually below."}
                    </p>
                  )}

                {(
                  [
                    ["PBL", gearboxRec.pbl],
                    ["PTL", gearboxRec.ptl],
                    ["Top Gear", gearboxRec.topGear],
                  ] as [ "PBL" | "PTL" | "Top Gear", GearboxOption[] ][]
                ).map(([source, allOpts]) => {
                  // Once confirmed, collapse to just the chosen gearbox —
                  // same as the pump card, so the panel reads as a decision
                  // rather than an open list. Clicking it again reopens.
                  const isSelectedOpt = (o: GearboxOption) => isGearboxSelected(source, o);
                  // Collapse to the confirmed pick only when it's actually in
                  // this list — otherwise leave the list open, since the
                  // fallback card below is carrying the selection instead.
                  const opts =
                    formData.gearboxConfirmed && gearboxSelectionInList
                      ? allOpts.filter(isSelectedOpt)
                      : allOpts;
                  return (
                    opts.length > 0 && (
                    <div key={source} className="mt-4">
  <span className="section-label text-orange-800">{source}</span>

  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
    {opts.map((o) => {
      const isSelected = isSelectedOpt(o);

      return (
        <button
          type="button"
          key={o.id}
          onClick={() => selectGearbox(source, o, isSelected)}
          className={`group rounded-xl border p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
            isSelected
              ? "border-orange-400 bg-orange-100 ring-2 ring-orange-300"
              : "border-orange-200 bg-orange-50 hover:border-orange-300 hover:bg-orange-100"
          }`}
        >
          <div className="flex items-center justify-between">
            <strong className="mono text-[14px] font-bold text-orange-900">
              {o.model}
            </strong>

            {isSelected && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold text-white ${
                  formData.gearboxConfirmed ? "bg-emerald-600" : "bg-orange-500"
                }`}
              >
                {formData.gearboxConfirmed ? "✓ Confirmed" : "Selected"}
              </span>
            )}
          </div>

          <div className="mt-3 rounded-lg bg-white/70 p-2">
            <div className="flex justify-between text-[12px]">
              <span className="text-slate-500">Output RPM</span>
              <b className="mono text-slate-800">{o.outputRpm}</b>
            </div>

            <div className="mt-1 flex justify-between text-[12px]">
              <span className="text-slate-500">Service Factor</span>
              <b className="mono text-slate-800">{num(o.serviceFactor)}</b>
            </div>

            <div className="mt-2 border-t border-orange-200 pt-2">
              <div className="flex justify-between text-[12px]">
                <span className="text-slate-500">Rate</span>
                <b className="mono text-slate-800">{num(o.ratePerNos)}</b>
              </div>
              {gbFlangePct !== 0 && (
                <div className="mt-1 flex justify-between text-[12px]">
                  <span className="text-slate-500">+{gbFlangePct}% Flange</span>
                  <b className="mono text-orange-900">
                    {num(gearboxUpliftedRate(o.ratePerNos, formData.gearBoxMounting))}
                  </b>
                </div>
              )}
            </div>
          </div>
        </button>
      );
    })}
  </div>
</div>
                    )
                  );
                })}

                {/* The pick no longer matches anything in the current screen
                    (inputs or ASF/GB-Type narrowing changed since it was
                    chosen). Show it anyway, from the saved values, so it stays
                    visible and clearable — without this the confirm bar tells
                    you to "click the card" when no card is rendered. */}
                {formData.gearboxModel && !gearboxSelectionInList && !formData.gearboxRpmManual && (
                  <div className="mt-4">
                    <span className="section-label text-orange-800">
                      Current selection (outside the options below)
                    </span>
                    <div className="mt-2 rounded-xl border border-orange-300 bg-orange-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="mono text-[14px] font-bold text-orange-900">
                          {formData.gearboxSource ? `${formData.gearboxSource} ` : ""}
                          {formData.gearboxModel}
                        </strong>
                        <button
                          type="button"
                          onClick={clearGearbox}
                          className="rounded-lg border border-orange-400 bg-white px-3 py-1 text-[12px] font-semibold text-orange-800 transition-colors hover:bg-orange-100"
                        >
                          Clear selection
                        </button>
                      </div>
                      <div className="mt-3 rounded-lg bg-white/70 p-2">
                        <div className="flex justify-between text-[12px]">
                          <span className="text-slate-500">Output RPM</span>
                          <b className="mono text-slate-800">
                            {formData.gearboxOutputRpm || "—"}
                          </b>
                        </div>
                        <div className="mt-1 flex justify-between text-[12px]">
                          <span className="text-slate-500">Service Factor</span>
                          <b className="mono text-slate-800">
                            {formData.gearboxServiceFactor || "—"}
                          </b>
                        </div>
                        <div className="mt-2 border-t border-orange-200 pt-2">
                          <div className="flex justify-between text-[12px]">
                            <span className="text-slate-500">Rate</span>
                            <b className="mono text-slate-800">
                              {formData.gearboxRatePerNos || "—"}
                            </b>
                          </div>
                          {gbFlangePct !== 0 && formData.gearboxRatePerNos && (
                            <div className="mt-1 flex justify-between text-[12px]">
                              <span className="text-slate-500">+{gbFlangePct}% Flange</span>
                              <b className="mono text-orange-900">
                                {num(gearboxUpliftedRate(formData.gearboxRatePerNos, formData.gearBoxMounting))}
                              </b>
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-[12px] text-orange-900">
                        This gearbox isn&apos;t in the current recommendation —
                        the duty inputs or the ASF Range / GB Type narrowing
                        have changed since it was picked. Keep it, or clear it
                        and choose from the options above.
                      </p>
                    </div>
                  </div>
                )}

                {formData.gearboxModel && !formData.gearboxRpmManual && (
                  <ConfirmBar
                    label={`${formData.gearboxSource ? `${formData.gearboxSource} ` : ""}${
                      formData.gearboxModel
                    }`}
                    confirmed={Boolean(formData.gearboxConfirmed)}
                    onConfirm={() => setFormData({ ...formData, gearboxConfirmed: true })}
                  />
                )}
              </>
            )}

            <ManualDrivePanel
              what="gearbox"
              fields={MANUAL_GEARBOX_FIELDS}
              values={Object.fromEntries(MANUAL_GEARBOX_FIELDS.map((f) => [f.key, String(formData[f.key] ?? "")]))}
              active={Boolean(formData.gearboxRpmManual)}
              confirmed={Boolean(formData.gearboxConfirmed)}
              rpmLo={gearboxRec?.rpmLo}
              rpmHi={gearboxRec?.rpmHi}
              onEdit={editManualGearbox}
              onConfirm={() => setFormData({ ...formData, gearboxConfirmed: true })}
              onCancel={clearGearbox}
            />
          </div>
        )}

        {isVBelt && (
          <div className="mt-4 rounded-md border border-line bg-elev p-4">
            <span className="section-label">V-Belt Drive Recommendation</span>

            {vbeltStatus === "idle" && (
              <p className="mt-2 text-[13px] text-fg-3">
                Select a Motor RPM above to get the belt/pulley recommendation
                {!formData.driveMotorKw
                  ? " (also set the Drive Motor Rating on the Motor Rating step)."
                  : "."}
              </p>
            )}
            {vbeltStatus === "loading" && (
              <p className="mt-2 text-[13px] text-fg-3">Calculating belt drive…</p>
            )}
            {vbeltStatus === "error" && (
              <p className="mt-2 text-[13px] text-warn">
                Couldn&apos;t calculate the belt drive — check your connection and try again.
              </p>
            )}

            {vbeltStatus === "ready" && vbelt && vbelt.candidates.length === 0 && (
              <p className="mt-2 text-[13px] text-warn">
                No V-belt/pulley data for {vbelt.model} at {vbelt.motorRpm} rpm /{" "}
                {vbelt.motorKw} kW — enter the details manually below.
              </p>
            )}

            {vbeltStatus === "ready" && vbelt && vbelt.candidates.length > 0 && (
              <>
                <p className="mt-2 text-[12px] text-fg-3">
                  Pump&apos;s required speed window is{" "}
                  <b className="mono text-fg-2">
                    {vbelt.rpmLo.toFixed(0)}–{vbelt.rpmHi.toFixed(0)} rpm
                  </b>{" "}
                  (from its VE band at the duty point). Groove{" "}
                  <b className="mono text-fg-2 bg-orange-100 px-2 py-1">
                    {vbelt.grooves ?? "—"}
                  </b>.
                </p>
                {!vbelt.withinRange && (
                  <p className="mt-1 text-[12px] text-warn">
                    No belt lands the pump inside that window — showing the next
                    lower and next higher belt speed to choose from.
                  </p>
                )}

                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
  {/* Once confirmed, collapse to just the chosen belt — same as the pump
      card. Clicking it again reopens the full list. Guarded by
      vbeltSelectionInList: if the confirmed belt isn't in the current
      candidates (inputs changed since it was picked), collapsing would
      render NOTHING and strand the confirm bar with no card to click, so
      the full list stays open instead. */}
  {vbelt.candidates
    .filter((o) =>
      !formData.vbeltConfirmed ||
      !vbeltSelectionInList ||
      (formData.driveVbeltGroove === (vbelt.grooves ?? "") &&
        formData.driveVbeltRpm === (o.actualRpm != null ? String(o.actualRpm) : "") &&
        formData.driveVbeltNo === (o.vBelt != null ? String(o.vBelt) : "")),
    )
    .map((o) => {
    const isSelected =
      formData.driveVbeltGroove === (vbelt.grooves ?? "") &&
      formData.drivePumpPulley ===
        (o.pumpPulley != null ? String(o.pumpPulley) : "") &&
      formData.driveVbeltRpm ===
        (o.actualRpm != null ? String(o.actualRpm) : "") &&
      formData.driveVbeltNo ===
        (o.vBelt != null ? String(o.vBelt) : "");

    return (
      <button
        type="button"
        key={o.targetRpm}
        onClick={() => selectVBelt(vbelt.grooves, o, isSelected)}
        className={`group rounded-xl border p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
          isSelected
            ? "border-orange-400 bg-orange-100 ring-2 ring-orange-300"
            : "border-orange-200 bg-orange-50 hover:border-orange-300 hover:bg-orange-100"
        }`}
      >
        <div className="flex items-center justify-between">
          <strong className="mono text-[14px] font-bold text-orange-900">
            {num(o.actualRpm)} RPM
          </strong>

          {isSelected && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold text-white ${
                formData.vbeltConfirmed ? "bg-emerald-600" : "bg-orange-500"
              }`}
            >
              {formData.vbeltConfirmed ? "✓ Confirmed" : "Selected"}
            </span>
          )}
        </div>

        <div className="mt-3 rounded-lg bg-white/70 p-2">
          <div className="flex justify-between text-[12px]">
            <span className="text-slate-500">Pump Pulley</span>
            <b className="mono text-slate-800">{num(o.pumpPulley)}</b>
          </div>

          <div className="mt-1 flex justify-between text-[12px]">
            <span className="text-slate-500">Motor Pulley</span>
            <b className="mono text-slate-800">{num(o.motorPulley)}</b>
          </div>

          <div className="mt-2 border-t border-orange-200 pt-2">
            <div className="flex justify-between text-[12px]">
              <span className="text-slate-500">Centre Distance</span>
              <b className="mono text-slate-800">
                {num(o.centerDistance)}
              </b>
            </div>

            <div className="mt-1 flex justify-between text-[12px]">
              <span className="text-slate-500">V-Belt</span>
              <b className="mono text-slate-800">{num(o.vBelt)}</b>
            </div>
          </div>
        </div>
      </button>
    );
  })}
</div>

                {formData.driveVbeltRpm && !formData.vbeltRpmManual && (
                  <ConfirmBar
                    label={`${formData.driveVbeltRpm} RPM belt${
                      formData.driveVbeltNo ? ` (V-Belt ${formData.driveVbeltNo})` : ""
                    }`}
                    confirmed={Boolean(formData.vbeltConfirmed)}
                    onConfirm={() => setFormData({ ...formData, vbeltConfirmed: true })}
                  />
                )}
              </>
            )}

            <ManualDrivePanel
              what="V-belt"
              fields={MANUAL_VBELT_FIELDS}
              values={Object.fromEntries(MANUAL_VBELT_FIELDS.map((f) => [f.key, String(formData[f.key] ?? "")]))}
              active={Boolean(formData.vbeltRpmManual)}
              confirmed={Boolean(formData.vbeltConfirmed)}
              rpmLo={vbelt?.rpmLo}
              rpmHi={vbelt?.rpmHi}
              onEdit={editManualVbelt}
              onConfirm={() => setFormData({ ...formData, vbeltConfirmed: true })}
              onCancel={cancelManualVbelt}
            />
          </div>
        )}

        {formData.driveSystem && (
          <div className="mt-4 rounded-md border border-line bg-elev p-4">
            <div className={grid}>
              <div className={fieldWrap}>
                <label className={label}>Drive Motor Rating</label>
                <input
                  type="text"
                  readOnly
                  className={`${control} opacity-80`}
                  value={formData.driveMotorKw ? `${formData.driveMotorKw} kW` : ""}
                  placeholder="Set on the Motor Rating step"
                />
                <span className={hint}>Auto-filled from the Motor Rating step.</span>
              </div>

              <div className={fieldWrap}>
                <label className={label}>Drive Motor Speed (RPM)<Req /></label>
                <input
                  type="number"
                  step="any"
                  className={control}
                  placeholder="Motor nameplate RPM"
                  value={formData.driveMotorSpeed ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, driveMotorSpeed: e.target.value })
                  }
                />
                <Err show={showErrors} msg={driveErrors.driveMotorSpeed} />
              </div>

              <div className={fieldWrap}>
                <label className={label}>Drive Motor Make<Req /></label>
                <select
                  className={control}
                  value={formData.driveMotorMake ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, driveMotorMake: e.target.value })
                  }
                >
                  <option value="">Select Make</option>
                  {MOTOR_MAKES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <Err show={showErrors} msg={driveErrors.driveMotorMake} />
              </div>

              <div className={fieldWrap}>
                <label className={label}>Motor Mounting<Req /></label>
                <select
                  className={control}
                  value={formData.driveMotorMounting ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, driveMotorMounting: e.target.value })
                  }
                >
                  <option value="">Select Mounting</option>
                  {MOTOR_MOUNTINGS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <Err show={showErrors} msg={driveErrors.driveMotorMounting} />
              </div>

              {/* Std / Non-Std sits directly after Motor Mounting and gates
                  every rating-plate field below it. */}
              <div className={fieldWrap}>
                <label className={label}>Std / Non-Std<Req /></label>
                <select
                  className={control}
                  value={formData.driveStdNonStd ?? ""}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFormData({
                      ...formData,
                      driveStdNonStd: next,
                      // "Standard" IS the standard rating plate, so choosing it
                      // fills those four in (all still editable).
                      ...(next === "Standard" ? STANDARD_RATING_PLATE : {}),
                    });
                  }}
                >
                  <option value="">Select</option>
                  {STD_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Err show={showErrors} msg={driveErrors.driveStdNonStd} />
              </div>

              {/* Standard → the plain rating-plate fields.
                  Non-Standard → protection/frequency/voltage each paired with
                  a % price uplift. Efficiency never gets a % — it selects the
                  motor type (IE class) the candidate list is filtered to. */}
              {formData.driveStdNonStd && (
                <>
                  <RatingOptionField
                    kind="efficiency"
                    fieldLabel="Efficiency"
                    emptyLabel="All efficiency classes"
                    fieldHint="Filters the motor list by type."
                    value={(formData.driveMotorEfficiency as string) ?? ""}
                    options={
                      driveOptions.efficiency.length > 0
                        ? driveOptions.efficiency
                        : MOTOR_EFFICIENCY_CLASSES
                    }
                    onChange={(v) => setFormData({ ...formData, driveMotorEfficiency: v })}
                    onOptionsChange={setDriveOptions}
                    error={showErrors ? driveErrors.driveMotorEfficiency : ""}
                  />

                  <RatingOptionField
                    kind="protection"
                    fieldLabel="Protection"
                    value={(formData.driveMotorProtection as string) ?? ""}
                    options={driveOptions.protection}
                    onChange={(v) => setFormData({ ...formData, driveMotorProtection: v })}
                    onOptionsChange={setDriveOptions}
                    error={showErrors ? driveErrors.driveMotorProtection : ""}
                  />
                  {isNonStandard && (
                    <div className={fieldWrap}>
                      <label className={label}>Protection %</label>
                      <input
                        type="number"
                        step="any"
                        className={control}
                        placeholder="Price increase %"
                        value={formData.driveMotorProtectionPct ?? ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            driveMotorProtectionPct: e.target.value,
                          })
                        }
                      />
                    </div>
                  )}

                  <RatingOptionField
                    kind="frequency"
                    fieldLabel="Frequency"
                    unit="Hz"
                    value={ratingPlateNumber(formData.driveMotorFrequency)}
                    options={driveOptions.frequency}
                    onChange={(v) => setFormData({ ...formData, driveMotorFrequency: v })}
                    onOptionsChange={setDriveOptions}
                    error={showErrors ? driveErrors.driveMotorFrequency : ""}
                  />
                  {isNonStandard && (
                    <div className={fieldWrap}>
                      <label className={label}>Frequency %</label>
                      <input
                        type="number"
                        step="any"
                        className={control}
                        placeholder="Price increase %"
                        value={formData.driveMotorFrequencyPct ?? ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            driveMotorFrequencyPct: e.target.value,
                          })
                        }
                      />
                    </div>
                  )}

                  <RatingOptionField
                    kind="voltage"
                    fieldLabel="Voltage"
                    unit="V"
                    value={ratingPlateNumber(formData.driveMotorVoltage)}
                    options={driveOptions.voltage}
                    onChange={(v) => setFormData({ ...formData, driveMotorVoltage: v })}
                    onOptionsChange={setDriveOptions}
                    error={showErrors ? driveErrors.driveMotorVoltage : ""}
                  />
                  {isNonStandard && (
                    <div className={fieldWrap}>
                      <label className={label}>Voltage %</label>
                      <input
                        type="number"
                        step="any"
                        className={control}
                        placeholder="Price increase %"
                        value={formData.driveMotorVoltagePct ?? ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            driveMotorVoltagePct: e.target.value,
                          })
                        }
                      />
                    </div>
                  )}
                </>
              )}

              <div className={fieldWrap}>
                <label className={label}>Starter Type<Req /></label>
                <select
                  className={control}
                  value={formData.driveStarterType ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, driveStarterType: e.target.value })
                  }
                >
                  <option value="">Select Starter</option>
                  {STARTER_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Err show={showErrors} msg={driveErrors.driveStarterType} />
              </div>

              <div className={fieldWrap}>
                <label className={label}>Power Supply<Req /></label>
                <select
                  className={control}
                  value={formData.drivePowerSupply ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, drivePowerSupply: e.target.value })
                  }
                >
                  <option value="">Select Supply</option>
                  {POWER_SUPPLIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <Err show={showErrors} msg={driveErrors.drivePowerSupply} />
              </div>

              {/* VFD: a "Yes" opens the Hz range the pump will be run across.
                  The Recheck then reports capacity + BKW at both ends of it. */}
              <div className={fieldWrap}>
                <label className={label}>VFD Required<Req /></label>
                <select
                  className={control}
                  value={formData.vfdRequired ?? ""}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFormData({
                      ...formData,
                      vfdRequired: next,
                      // Switching it on seeds the usual frequencies (all
                      // editable); switching it off clears them so nothing
                      // stale lingers hidden and leaks into the report.
                      ...(next === VFD_YES
                        ? {
                            vfdStdHz: formData.vfdStdHz || DEFAULT_VFD_STD_HZ,
                            vfdMinHz: formData.vfdMinHz || DEFAULT_VFD_MIN_HZ,
                            vfdMaxHz: formData.vfdMaxHz || DEFAULT_VFD_MAX_HZ,
                          }
                        : { vfdStdHz: "", vfdMinHz: "", vfdMaxHz: "" }),
                    });
                  }}
                >
                  <option value="">Select</option>
                  {VFD_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <span className={hint}>
                  On a VFD the pump runs across a speed range, so the Recheck
                  reports capacity &amp; BKW at both ends.
                </span>
                <Err show={showErrors} msg={driveErrors.vfdRequired} />
              </div>

              {formData.vfdRequired === VFD_YES && (
                <>
                  <div className={fieldWrap}>
                    <label className={label}>Std Hz<Req /></label>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      className={control}
                      value={formData.vfdStdHz ?? ""}
                      onChange={(e) => setFormData({ ...formData, vfdStdHz: e.target.value })}
                      placeholder="50"
                    />
                    <span className={hint}>
                      Supply frequency the selected speed ({finalPumpRpmRaw || "—"} rpm) is quoted at.
                    </span>
                    <Err show={showErrors} msg={driveErrors.vfdStdHz} />
                  </div>

                  <div className={fieldWrap}>
                    <label className={label}>VFD Hz Range<Req /></label>
                    <div className="flex items-center gap-[10px]">
                      <input
                        type="number"
                        min="1"
                        step="any"
                        className={control}
                        value={formData.vfdMinHz ?? ""}
                        onChange={(e) => setFormData({ ...formData, vfdMinHz: e.target.value })}
                        placeholder="Min 30"
                        aria-label="VFD minimum Hz"
                      />
                      <span className="text-[13px] text-fg-3">to</span>
                      <input
                        type="number"
                        min="1"
                        step="any"
                        className={control}
                        value={formData.vfdMaxHz ?? ""}
                        onChange={(e) => setFormData({ ...formData, vfdMaxHz: e.target.value })}
                        placeholder="Max 60"
                        aria-label="VFD maximum Hz"
                      />
                    </div>
                    {vfdSpeedHint && <span className={hint}>{vfdSpeedHint}</span>}
                    {vfdRangeError && <span className={hintError}>{vfdRangeError}</span>}
                    <Err show={showErrors} msg={driveErrors.vfdHzRange} />
                  </div>
                </>
              )}

            </div>

            {/* --- Motor selection (candidates from motor_master) --- */}
            <div className="mt-4 border-t border-line pt-3">
              <span className="section-label">Motor Selection</span>

              {!formData.driveMotorKw && (
                <p className="mt-2 text-[13px] text-fg-3">
                  Set the Motor Rating (kW) on the previous step to see matching
                  motors.
                </p>
              )}

              {formData.driveMotorKw && (
                <>
                  <p className="mt-2 text-[12px] text-fg-3">
                    Motors rated{" "}
                    <b className="mono text-fg-2">{formData.driveMotorKw} kW</b>
                    {(formData.driveMotorSpeed || motorRpm) && (
                      <>
                        {" "}at{" "}
                        <b className="mono text-fg-2">
                          {formData.driveMotorSpeed || motorRpm} RPM
                        </b>
                      </>
                    )}
                    {formData.driveMotorMounting && (
                      <>
                        , <b className="mono text-fg-2">{formData.driveMotorMounting}</b>
                      </>
                    )}
                    . Pick a Motor Make above to narrow the list.
                    {upliftPct !== 0 && (
                      <>
                        {" "}
                        {nonStdPct !== 0 && mountPct !== 0
                          ? `Non-Standard (${nonStdPct}%) + flange mounting (${mountPct}%) uplift of`
                          : mountPct !== 0
                            ? "Flange mounting uplift of"
                            : "Non-Standard uplift of"}{" "}
                        <b className="mono text-fg-2">{upliftPct}%</b> is applied to
                        each price below.
                      </>
                    )}
                  </p>

                  {motorStatus === "loading" && (
                    <p className="mt-2 text-[13px] text-fg-3">Screening motors…</p>
                  )}
                  {motorStatus === "error" && (
                    <p className="mt-2 text-[13px] text-warn">
                      Couldn&apos;t load motors — check your connection and try again.
                    </p>
                  )}
                  {motorStatus === "ready" && motorOptions.length === 0 && (
                    <p className="mt-2 text-[13px] text-warn">
                      No motor in the master matches this rating
                      {formData.driveMotorMake ? ` for ${formData.driveMotorMake}` : ""}
                      {formData.driveMotorMounting
                        ? ` with ${formData.driveMotorMounting} mounting`
                        : ""}
                      . Try a different make or mounting.
                    </p>
                  )}

                  {motorStatus === "ready" && motorOptions.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {/* Once confirmed, collapse to just the chosen motor —
                          same as the pump card. Clicking it reopens the list.
                          Guarded by motorSelectionInList for the same reason
                          as the belt list above: a confirmed motor that's no
                          longer among the candidates would otherwise collapse
                          the list to nothing. */}
                      {motorOptions
                        .filter(
                          (m) =>
                            !formData.driveMotorConfirmed ||
                            !motorSelectionInList ||
                            (formData.driveMotorFrameSize === (m.frameSize ?? "") &&
                              formData.driveMotorMake === (m.brand ?? "")),
                        )
                        .map((m) => {
                        const isSelected =
                          formData.driveMotorFrameSize === (m.frameSize ?? "") &&
                          formData.driveMotorMake === (m.brand ?? "");
                        const up = upliftedPrice(m.finalPrice);
                        return (
                          <button
                            type="button"
                            key={m.id}
                            onClick={() => selectMotor(m, isSelected)}
                            className={`group rounded-xl border p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                              isSelected
                                ? "border-orange-400 bg-orange-100 ring-2 ring-orange-300"
                                : "border-orange-200 bg-orange-50 hover:border-orange-300 hover:bg-orange-100"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <strong className="text-[14px] font-bold text-orange-900">
                                {m.brand ?? "—"}
                              </strong>
                              {isSelected && (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold text-white ${
                                    formData.driveMotorConfirmed
                                      ? "bg-emerald-600"
                                      : "bg-orange-500"
                                  }`}
                                >
                                  {formData.driveMotorConfirmed ? "✓ Confirmed" : "Selected"}
                                </span>
                              )}
                            </div>

                            <div className="mt-3 rounded-lg bg-white/70 p-2">
                              <div className="flex justify-between text-[12px]">
                                <span className="text-slate-500">Frame</span>
                                <b className="mono text-slate-800">
                                  {m.frameSize ?? "—"}
                                </b>
                              </div>
                              <div className="mt-1 flex justify-between text-[12px]">
                                <span className="text-slate-500">kW / HP</span>
                                <b className="mono text-slate-800">
                                  {m.motorKw ?? "—"} / {m.motorHp ?? "—"}
                                </b>
                              </div>

                              <div className="mt-2 border-t border-orange-200 pt-2">
                                <div className="flex justify-between text-[12px]">
                                  <span className="text-slate-500">LP Price</span>
                                  <b className="mono text-slate-800">
                                    {money(m.lpPrice)}
                                  </b>
                                </div>
                                <div className="mt-1 flex justify-between text-[12px]">
                                  <span className="text-slate-500">Final Price</span>
                                  <b className="mono text-slate-800">
                                    {money(m.finalPrice)}
                                  </b>
                                </div>
                                {upliftPct !== 0 && (
                                  <div className="mt-1 flex justify-between text-[12px]">
                                    <span className="text-slate-500">
                                      +{upliftPct}% Price
                                    </span>
                                    <b className="mono text-orange-900">{money(up)}</b>
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {formData.driveMotorFrameSize && (
                    <ConfirmBar
                      label={`${formData.driveMotorMake ? `${formData.driveMotorMake} ` : ""}${
                        formData.driveMotorFrameSize
                      }`}
                      confirmed={Boolean(formData.driveMotorConfirmed)}
                      onConfirm={() =>
                        setFormData({ ...formData, driveMotorConfirmed: true })
                      }
                    />
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <ErrorBanner show={showErrors} count={driveErrorCount} />

        {/* BOTTOM-ROW-REMOVED: Clear now lives in the top bar. */}
        <div className={actions}>
          <button className={btnGhost} onClick={onPrevious}>
            Previous
          </button>
          <button className={btnPrimary} onClick={handleRecheck}>
            Recheck
          </button>
        </div>
      </div>

      {showRecheck && (
        <RecheckModal
          loading={recheckLoading}
          error={recheckError}
          pumpSpecs={pumpSpecs}
          finalRpm={finalPumpRpmRaw}
          finalRpmSource={finalPumpRpmSource}
          formData={formData}
          onClose={() => setShowRecheck(false)}
          onProceed={() => {
            setShowRecheck(false);
            onNext();
          }}
        />
      )}
    </div>
  );
};

// --- Recheck modal ---------------------------------------------------------
// Delivered capacity + BKW at the drive-achieved pump RPM. The maths lives in
// lib/recheck-calc.ts, shared with the Recheck PDF on the Selection Summary.

type RecheckModalProps = {
  loading: boolean;
  error: string | null;
  pumpSpecs: PumpRecommendation | null;
  finalRpm: string;
  finalRpmSource: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData: any;
  onClose: () => void;
  onProceed: () => void;
};

const fmtNum = fmtRecheckNum;

const RecheckModal = ({
  loading,
  error,
  pumpSpecs,
  finalRpm,
  finalRpmSource,
  formData,
  onClose,
  onProceed,
}: RecheckModalProps) => {
  const tables = pumpSpecs
    ? recheckTables(
        formData,
        computeRecheck(formData, pumpSpecs, finalRpm),
        pumpSpecs.model,
        finalRpmSource,
      )
    : null;
  const canCompute = tables !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-lg bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-fg">
              Recheck at final selected RPM
            </h3>
            <p className="mt-0.5 text-xs text-fg-3">
              Delivered capacity &amp; BKW recomputed at the drive-achieved pump RPM.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-3 hover:bg-elev hover:text-fg"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {loading && (
            <p className="text-[13px] text-fg-3">Loading pump specifications…</p>
          )}
          {!loading && error && (
            <p className="text-[13px] text-warn">{error}</p>
          )}
          {!loading && !error && !canCompute && (
            <p className="text-[13px] text-warn">
              Not enough data to recompute — need pump specs, head, and final pump RPM.
            </p>
          )}

          {!loading && !error && tables && (
            <>
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full text-[13px]">
                  <tbody>
                    {tables.inputs.map((row) => (
                      <RecheckRow key={row.label} label={row.label} value={row.value} note={row.note} />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 overflow-x-auto rounded-md border border-line">
                <table className="w-full text-[13px]">
                  <thead className="bg-elev text-left text-[11px] uppercase tracking-wide text-fg-3">
                    <tr>
                      <th className="px-3 py-2">At VE</th>
                      <th className="px-3 py-2 text-right">{tables.hiHeading}</th>
                      <th className="px-3 py-2 text-right">{tables.loHeading}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.outputs.map((row) => (
                      <RecheckCalcRow
                        key={row.label}
                        label={row.label}
                        hi={row.hi}
                        lo={row.lo}
                        unit={row.unit}
                        highlight={row.highlight}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {tables.vfd && (
                <div className="mt-4 overflow-x-auto rounded-md border border-line">
                  <table className="w-full text-[13px]">
                    <thead className="bg-elev text-left text-[11px] uppercase tracking-wide text-fg-3">
                      <tr>
                        <th className="px-3 py-2">On VFD</th>
                        <th className="px-3 py-2 text-right">{tables.vfd.minHeading}</th>
                        <th className="px-3 py-2 text-right">{tables.vfd.midHeading}</th>
                        <th className="px-3 py-2 text-right">{tables.vfd.maxHeading}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tables.vfd.rows.map((row) => (
                        <tr
                          key={row.label}
                          className={`border-t border-line ${
                            row.label === "Pump RPM" ? "bg-[var(--pos-soft)]" : ""
                          }`}
                        >
                          <td className="px-3 py-2 text-fg">{row.label}</td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              row.label === "Pump RPM"
                                ? "font-semibold text-[var(--pos-strong)]"
                                : "text-fg"
                            }`}
                          >
                            {row.min}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              row.label === "Pump RPM"
                                ? "font-semibold text-[var(--pos-strong)]"
                                : "text-fg"
                            }`}
                          >
                            {row.mid}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              row.label === "Pump RPM"
                                ? "font-semibold text-[var(--pos-strong)]"
                                : "text-fg"
                            }`}
                          >
                            {row.max}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button
            className={btnPrimary}
            onClick={onProceed}
            disabled={loading || !canCompute}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

const RecheckRow = ({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) => (
  <tr className="border-t border-line first:border-t-0">
    <td className="px-3 py-2 font-medium text-fg">{label}</td>
    <td className="px-3 py-2 text-right font-mono text-fg">
      {value}
      {note && <span className="ml-2 font-sans text-[11px] text-fg-3">({note})</span>}
    </td>
  </tr>
);

const RecheckCalcRow = ({
  label,
  hi,
  lo,
  unit,
  highlight,
}: {
  label: string;
  hi: number;
  lo: number;
  unit?: string;
  highlight?: boolean;
}) => (
  <tr className={`border-t border-line ${highlight ? "bg-[var(--pos-soft)]" : ""}`}>
    <td className="px-3 py-2 text-fg">{label}</td>
    <td className={`px-3 py-2 text-right font-mono ${highlight ? "font-semibold text-[var(--pos-strong)]" : "text-fg"}`}>
      {fmtNum(hi)} {unit ?? ""}
    </td>
    <td className={`px-3 py-2 text-right font-mono ${highlight ? "font-semibold text-[var(--pos-strong)]" : "text-fg"}`}>
      {fmtNum(lo)} {unit ?? ""}
    </td>
  </tr>
);

export default DriveDetailsStep;
