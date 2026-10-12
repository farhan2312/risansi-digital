import { useState } from "react";
import Stepper from "./Stepper";
import StepApprovalBadge from "./approval/StepApprovalBadge";
import "./GeneralInformationStep.css";
import {
  actions,
  btnGhost,
  btnPrimary,
  control,
  fieldWrap,
  fullWidth,
  grid,
  hint,
  label,
} from "./formStyles";
import { needsBkAg, sizeDeviates } from "../../lib/suction-discharge-size";
import { Err, ErrorBanner, Req, hasErrors } from "./fieldBits";
import { toCp } from "../../utils/units";
import type { FluidMode } from "../../lib/fluid-inputs";

type Props = {
  onNext: () => void;
  onPrevious: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFormData: any;
  onStepClick?: (step: number) => void;
};

// Viscosity range list — mirrors Model_vs_Viscosity_vs_Size.xlsx (the 5
// columns whose labels are stored on pump_model_master as the size_visc_*
// columns). Ranges are in cP; a cSt input is converted with SG first
// (cP = cSt × SG). Boundaries are treated as non-overlapping (upper-inclusive)
// — the source labels write "1000-3000" but that collides with "0-1000" at
// 1000, so 1000 stays in the lower band here.
const viscosityRangeFor = (viscosityCp: number): string => {
  if (viscosityCp <= 1000) return "0-1000";
  if (viscosityCp <= 3000) return "1000-3000";
  if (viscosityCp <= 5000) return "3000-5000";
  if (viscosityCp <= 10000) return "5000-10000";
  return ">10000";
};

// Convert temperature to Celsius (the canonical value stored in formData.temperature).
const toCelsius = (value: number, unit: string): number => {
  if (unit === "F") return ((value - 32) * 5) / 9;
  if (unit === "K") return value - 273.15;
  return value;
};

// Round to 2 decimals for the derived Celsius value, without trailing zeros.
const round2 = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return String(r);
};

// Small Single/Range switch shown next to pH, Viscosity and Temperature —
// each of those can be entered as one value or as a Min-Max band. "single" is
// the default whenever the stored mode is absent (every pre-existing draft).
const ModeToggle = ({
  mode,
  onChange,
}: {
  mode: FluidMode;
  onChange: (mode: FluidMode) => void;
}) => (
  <span className="inline-flex overflow-hidden rounded-md border border-line-strong">
    {(["single", "range"] as const).map((m) => (
      <button
        key={m}
        type="button"
        onClick={() => onChange(m)}
        aria-pressed={mode === m}
        className={`px-2 py-0.5 text-[11px] font-semibold capitalize transition-colors ${
          mode === m
            ? "bg-accent text-white"
            : "bg-paper text-fg-3 hover:text-fg"
        }`}
      >
        {m}
      </button>
    ))}
  </span>
);

// A field's label row: the label plus its Single/Range switch on the right.
const RangeLabel = ({
  text,
  mode,
  onModeChange,
}: {
  text: string;
  mode: FluidMode;
  onModeChange: (mode: FluidMode) => void;
}) => (
  <div className="flex items-center justify-between gap-2">
    <label className={label}>{text}</label>
    <ModeToggle mode={mode} onChange={onModeChange} />
  </div>
);

// Absent/unrecognized mode = "single", so drafts saved before ranges existed
// keep behaving exactly as they did.
const modeOf = (value: unknown): FluidMode =>
  value === "range" ? "range" : "single";



const FluidPropertiesStep = ({
  onNext,
  onPrevious,
  formData,
  setFormData,
  onStepClick,
}: Props) => {
  // Single-vs-range mode per field (see fluid-inputs.ts). Absent = "single",
  // so drafts saved before ranges existed behave exactly as before.

  const phMode = modeOf(formData.phMode);
  const viscosityMode = modeOf(formData.viscosityMode);
  const temperatureMode = modeOf(formData.temperatureMode);
  const solidSizeMode = modeOf(formData.solidSizeMode);

  // Re-derive the viscosity range whenever viscosity or its unit changes, so
  // the range is auto-selected (spec: "when enter viscosity it automatically
  // select viscosity range"). Still overridable via the dropdown afterward.
  // viscosityCp is the canonical converted value (cP = cSt × SG) — same shape
  // as temperature's canonical Celsius field — so anything downstream can
  // read the real cP value without re-parsing viscosity + viscosityUnit + sg.
  // When a range is entered, the band comes from the MAX (worst case) — the
  // most demanding end of the band drives sizing. In single mode there's only
  // one value, so it decides on its own.
  const applyViscosity = (
    viscosity: string,
    viscosityUnit: string,
    viscosityMax: string = formData.viscosityMax ?? "",
    mode: FluidMode = viscosityMode,
  ) => {
    const sg = parseFloat(formData.sg) || 1;
    const cpMin = toCp(parseFloat(viscosity), viscosityUnit, sg);
    const cpMax = toCp(parseFloat(viscosityMax), viscosityUnit, sg);
    const viscosityCp = Number.isNaN(cpMin) ? "" : round2(cpMin);
    const viscosityCpMax =
      mode === "range" && !Number.isNaN(cpMax) ? round2(cpMax) : "";
    // Worst case: the max when ranged and set, else the single/min value.
    const bandCp = mode === "range" && !Number.isNaN(cpMax) ? cpMax : cpMin;
    const viscosityRange = Number.isNaN(bandCp) ? "" : viscosityRangeFor(bandCp);
    setFormData({
      ...formData,
      viscosity,
      viscosityUnit,
      viscosityMax: mode === "range" ? viscosityMax : "",
      viscosityMode: mode,
      viscosityRange,
      viscosityCp,
      viscosityCpMax,
    });
  };

  // Store the as-entered values in temperatureRaw/temperatureMaxRaw +
  // temperatureUnit for display, and the canonical Celsius conversions in
  // temperature/temperatureMax (what everything else reads). Empty input
  // clears the derived Celsius so downstream checks (formData.temperature ? …)
  // still work.
  const applyTemperature = (
    temperatureRaw: string,
    temperatureUnit: string,
    temperatureMaxRaw: string = formData.temperatureMaxRaw ?? "",
    mode: FluidMode = temperatureMode,
  ) => {
    const min = parseFloat(temperatureRaw);
    const max = parseFloat(temperatureMaxRaw);
    const temperature = Number.isNaN(min) ? "" : round2(toCelsius(min, temperatureUnit));
    const temperatureMax =
      mode === "range" && !Number.isNaN(max)
        ? round2(toCelsius(max, temperatureUnit))
        : "";
    setFormData({
      ...formData,
      temperatureRaw,
      temperatureUnit,
      temperatureMaxRaw: mode === "range" ? temperatureMaxRaw : "",
      temperatureMax,
      temperatureMode: mode,
      temperature,
    });
  };

  const applyPh = (
    ph: string,
    phMax: string = formData.phMax ?? "",
    mode: FluidMode = phMode,
  ) => {
    setFormData({
      ...formData,
      ph,
      phMax: mode === "range" ? phMax : "",
      phMode: mode,
    });
  };

  // Solid size mirrors pH: the base field holds the single value or the range
  // MIN. Screening reads that base field, so the min is what a pump must pass.
  const applySolidSize = (
    solidSize: string,
    solidSizeMax: string = formData.solidSizeMax ?? "",
    mode: FluidMode = solidSizeMode,
  ) => {
    setFormData({
      ...formData,
      solidSize,
      solidSizeMax: mode === "range" ? solidSizeMax : "",
      solidSizeMode: mode,
    });
  };

  // Baseline an entered size is checked against (not shown on the form): the
  // picked pump's own size for the viscosity range, which the live panel keeps
  // in formData.recommendedSize. No pump, or a pump without a size for this
  // range, means no baseline - nothing to deviate from, so no remark.
  const recommendedSize = formData.selectedModel ? (formData.recommendedSize ?? "").trim() : "";

  // Overriding a recommended size is allowed, but it has to be justified —
  // the quotation has to say why the line was sized off-recommendation.
  const suctionDeviates = sizeDeviates(formData.suctionSize, recommendedSize);
  const dischargeDeviates = sizeDeviates(formData.dischargeSize, recommendedSize);
  const [showErrors, setShowErrors] = useState(false);
  // One remark covers both sizes; required once either differs.
  const eitherSizeDeviates = suctionDeviates || dischargeDeviates;
  const errors: Record<string, string> = {
    sizeRemarks:
      eitherSizeDeviates && !(formData.sizeRemarks ?? "").trim()
        ? "Explain why the size differs from the recommendation."
        : "",
  };
  const errorCount = Object.values(errors).filter(Boolean).length;

  const handleNext = () => {
    if (hasErrors(errors)) {
      setShowErrors(true);
      return;
    }
    onNext();
  };

  // Jumping forward on the stepper gets the same check as Next; going back
  // is always allowed.
  const handleStepClick = (target: number) => {
    if (target > 2 && hasErrors(errors)) {
      setShowErrors(true);
      return;
    }
    onStepClick?.(target);
  };

  const tempUnit = formData.temperatureUnit;
  const tempRawNum = parseFloat(formData.temperatureRaw ?? "");
  const tempCelsius = Number.isNaN(tempRawNum) ? null : toCelsius(tempRawNum, tempUnit);
  const tempMaxRawNum = parseFloat(formData.temperatureMaxRaw ?? "");
  const tempMaxCelsius = Number.isNaN(tempMaxRawNum)
    ? null
    : toCelsius(tempMaxRawNum, tempUnit);

  return (
    <div className="step-container">
      <Stepper currentStep={2} maxStep={formData.wizardMaxStep} onStepClick={handleStepClick} />

      <div className="step-card">
        <h2>
          Fluid Properties
          <StepApprovalBadge step={2} />
        </h2>
        <p>Enter the fluid characteristics required for pump selection.</p>

        <div className={grid}>
          <div className={fieldWrap}>
            <RangeLabel
              text="Viscosity"
              mode={viscosityMode}
              onModeChange={(m) =>
                applyViscosity(
                  formData.viscosity,
                  formData.viscosityUnit,
                  formData.viscosityMax ?? "",
                  m,
                )
              }
            />
            <div className={viscosityMode === "range" ? "flex gap-2" : undefined}>
              <input
                type="number"
                placeholder={viscosityMode === "range" ? "Min" : "Enter Viscosity"}
                className={control}
                value={formData.viscosity}
                onChange={(e) => applyViscosity(e.target.value, formData.viscosityUnit)}
              />
              {viscosityMode === "range" && (
                <input
                  type="number"
                  placeholder="Max"
                  className={control}
                  value={formData.viscosityMax ?? ""}
                  onChange={(e) =>
                    applyViscosity(
                      formData.viscosity,
                      formData.viscosityUnit,
                      e.target.value,
                    )
                  }
                />
              )}
            </div>
            {formData.viscosityCp && formData.viscosityUnit === "cSt" && (
              <span className={hint}>
                ={" "}
                <b className="mono font-semibold text-fg">
                  {formData.viscosityCp}
                  {viscosityMode === "range" && formData.viscosityCpMax
                    ? `–${formData.viscosityCpMax}`
                    : ""}
                </b>{" "}
                cP
              </span>
            )}
          </div>

          <div className={fieldWrap}>
            <label className={label}>Viscosity Unit</label>
            <select
              className={control}
              value={formData.viscosityUnit || "cP"}
              onChange={(e) => applyViscosity(formData.viscosity, e.target.value)}
            >
              <option value="cP">cP</option>
              <option value="cSt">cSt</option>
            </select>
          </div>

          <div className={fieldWrap}>
            <label className={label}>Viscosity Range (cP)</label>
            <select
              className={control}
              value={formData.viscosityRange}
              onChange={(e) =>
                setFormData({ ...formData, viscosityRange: e.target.value })
              }
            >
              <option value="">Select Range</option>
              <option value="0-1000">0 - 1000</option>
              <option value="1000-3000">1000 - 3000</option>
              <option value="3000-5000">3000 - 5000</option>
              <option value="5000-10000">5000 - 10000</option>
              <option value=">10000">10000 &amp; Above</option>
            </select>
            <span className={hint}>
              {viscosityMode === "range"
                ? "Auto-selected from the maximum viscosity — override if needed."
                : "Auto-selected from viscosity — override if needed."}
            </span>
          </div>

          <div className={fieldWrap}>
            <label className={label}>Solid %</label>
            <input
              type="number"
              placeholder="Enter Solid %"
              className={control}
              value={formData.solidPercentage}
              onChange={(e) =>
                setFormData({ ...formData, solidPercentage: e.target.value })
              }
            />
          </div>

          <div className={fieldWrap}>
            <RangeLabel
              text="Solid Size (mm)"
              mode={solidSizeMode}
              onModeChange={(m) =>
                applySolidSize(formData.solidSize, formData.solidSizeMax ?? "", m)
              }
            />
            <div className={solidSizeMode === "range" ? "flex gap-2" : undefined}>
              <input
                type="number"
                placeholder={solidSizeMode === "range" ? "Min" : "Enter Solid Size"}
                className={control}
                value={formData.solidSize}
                onChange={(e) => applySolidSize(e.target.value)}
              />
              {solidSizeMode === "range" && (
                <input
                  type="number"
                  placeholder="Max"
                  className={control}
                  value={formData.solidSizeMax ?? ""}
                  onChange={(e) => applySolidSize(formData.solidSize, e.target.value)}
                />
              )}
            </div>
          </div>

          <div className={fieldWrap}>
            <label className={label}>Solid Type</label>
            <select
              className={control}
              value={formData.solidType ?? ""}
              onChange={(e) =>
                setFormData({ ...formData, solidType: e.target.value })
              }
            >
              <option value="">Select Solid Type</option>
              <option value="Hard Solid">Hard Solid</option>
              <option value="Soft Solid">Soft Solid</option>
            </select>
          </div>

          <div className={fieldWrap}>
            <RangeLabel
              text="pH Value"
              mode={phMode}
              onModeChange={(m) => applyPh(formData.ph, formData.phMax ?? "", m)}
            />
            <div className={phMode === "range" ? "flex gap-2" : undefined}>
              <input
                type="number"
                placeholder={phMode === "range" ? "Min" : "Enter pH"}
                className={control}
                value={formData.ph}
                onChange={(e) => applyPh(e.target.value)}
              />
              {phMode === "range" && (
                <input
                  type="number"
                  placeholder="Max"
                  className={control}
                  value={formData.phMax ?? ""}
                  onChange={(e) => applyPh(formData.ph, e.target.value)}
                />
              )}
            </div>
          </div>

          <div className={fieldWrap}>
            <RangeLabel
              text="Temperature"
              mode={temperatureMode}
              onModeChange={(m) =>
                applyTemperature(
                  formData.temperatureRaw ?? "",
                  tempUnit,
                  formData.temperatureMaxRaw ?? "",
                  m,
                )
              }
            />
            <div className={temperatureMode === "range" ? "flex gap-2" : undefined}>
              <input
                type="number"
                placeholder={temperatureMode === "range" ? "Min" : "Enter Temperature"}
                className={control}
                value={formData.temperatureRaw ?? ""}
                onChange={(e) => applyTemperature(e.target.value, tempUnit)}
              />
              {temperatureMode === "range" && (
                <input
                  type="number"
                  placeholder="Max"
                  className={control}
                  value={formData.temperatureMaxRaw ?? ""}
                  onChange={(e) =>
                    applyTemperature(
                      formData.temperatureRaw ?? "",
                      tempUnit,
                      e.target.value,
                    )
                  }
                />
              )}
            </div>
            {tempCelsius !== null && tempUnit !== "C" && (
              <span className={hint}>
                ={" "}
                <b className="mono font-semibold text-fg">
                  {round2(tempCelsius)}
                  {temperatureMode === "range" && tempMaxCelsius !== null
                    ? `–${round2(tempMaxCelsius)}`
                    : ""}
                </b>{" "}
                °C
              </span>
            )}
          </div>

          <div className={fieldWrap}>
            <label className={label}>Temperature Unit</label>
            <select
              className={control}
              value={tempUnit}
              onChange={(e) =>
                applyTemperature(
                  formData.temperatureRaw ?? "",
                  e.target.value,
                  formData.temperatureMaxRaw ?? "",
                )
              }
            >
              <option value="">Select</option>
              <option value="C">°C</option>
              <option value="F">°F</option>
              <option value="K">K</option>
            </select>
          </div>


          {/* Line sizes, inches only. Both start blank for the user to enter
              (no recommendation shown here); suction need not match discharge.
              A value that differs from the model's recommended size still
              needs a remark. */}
          <div className={fieldWrap}>
            <label className={label}>Suction Size (inch)</label>
            <input
              type="number"
              placeholder="Enter Suction Size"
              className={control}
              value={formData.suctionSize ?? ""}
              onChange={(e) =>
                setFormData({ ...formData, suctionSize: e.target.value })
              }
            />
          </div>

          <div className={fieldWrap}>
            <label className={label}>Discharge Size (inch)</label>
            <input
              type="number"
              placeholder="Enter Discharge Size"
              className={control}
              value={formData.dischargeSize ?? ""}
              onChange={(e) =>
                setFormData({ ...formData, dischargeSize: e.target.value })
              }
            />
          </div>

          {eitherSizeDeviates && (
            <div className={`${fieldWrap} ${fullWidth}`}>
              <label className={label}>Suction / Discharge Size Remarks<Req /></label>
              <textarea
                className={control}
                rows={2}
                placeholder={`Why ${[
                  suctionDeviates ? `suction ${formData.suctionSize}"` : "",
                  dischargeDeviates ? `discharge ${formData.dischargeSize}"` : "",
                ]
                  .filter(Boolean)
                  .join(" and ")} instead of the recommended ${recommendedSize}"?`}
                value={formData.sizeRemarks ?? ""}
                onChange={(e) => setFormData({ ...formData, sizeRemarks: e.target.value })}
              />
              <Err show={showErrors} msg={errors.sizeRemarks} />
            </div>
          )}
        </div>

        <ErrorBanner show={showErrors} count={errorCount} />

 {needsBkAg(formData.viscosityRange, formData.solidPercentage) && (
  <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-4">
    <p className="text-sm font-semibold text-orange-900">
      BK / AG Recommendation
    </p>

    <p className="mt-2 text-sm text-orange-800">
      Based on the selected viscosity and/or solids content, it is recommended
      to use the <strong>BK</strong> or <strong>AG</strong> feed/construction
      option. Please select either <strong>BK</strong> or <strong>AG</strong> in
      the <strong>Specifications</strong> step.
    </p>
  </div>
)}


        {!formData.modelConfirmed && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            Pick a pump model in the recommendation panel below and confirm it to continue.
          </div>
        )}

        <div className={actions}>
          <button className={btnGhost} onClick={onPrevious}>
            Previous
          </button>
          <button
            className={`${btnPrimary} disabled:opacity-50 disabled:cursor-not-allowed`}
            onClick={handleNext}
            disabled={!formData.modelConfirmed}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default FluidPropertiesStep;
