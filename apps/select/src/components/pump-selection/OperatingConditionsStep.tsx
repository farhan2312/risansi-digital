"use client";

import { useEffect, useState } from "react";
import "./GeneralInformationStep.css";
import Stepper from "./Stepper";
import StepApprovalBadge from "./approval/StepApprovalBadge";
import { actions, btnGhost, btnPrimary, control, fieldWrap, grid, hint, label } from "./formStyles";
import { Err, ErrorBanner, Req, hasErrors } from "./fieldBits";
import {
  BUCKET_CONNECTION,
  ConnectionSelect,
  END_CONNECTIONS,
  FlangeStdField,
  SUCTION_CONNECTIONS,
  useFlangeStandards,
} from "./ConnectionFields";
import {
  PUMP_SUPPORT_LABEL,
  PUMP_SUPPORT_OPTIONS,
} from "../../lib/pump-support";

type Props = {
  onNext: () => void;
  onPrevious: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFormData: any;
  onStepClick?: (step: number) => void;
};

// Cascading options driven by Pump Type. Each pump type constrains which AG/BK
// feed option and which suction housings are valid:
//   Horizontal Standard       -> no AG/BK; standard / CIP housings only
//   Vertical                  -> AG only; vertical suction housing only
//   Horizontal Bucket w/Auger -> AG & BK only; all housings
//   Horizontal Auger Only     -> AG only; standard / CIP housings only
const ALL_SUCTION_HOUSINGS = [
  "Standard Pump Housing",
  "Bucket",
  "Pump Housing with CIP",
  "Bucket with CIP",
];
const STANDARD_CIP_HOUSINGS = ["Standard Pump Housing", "Pump Housing with CIP"];

const AG_BK_OPTIONS_BY_PUMP_TYPE: Record<string, string[]> = {
  "Horizontal Standard": [],
  Vertical: ["AG"],
  "Horizontal Bucket with Auger": ["AG & BK"],
  "Horizontal Auger Only": ["AG"],
};
const SUCTION_HOUSINGS_BY_PUMP_TYPE: Record<string, string[]> = {
  "Horizontal Standard": STANDARD_CIP_HOUSINGS,
  Vertical: ["Vertical Suction Housing"],
  "Horizontal Bucket with Auger": ALL_SUCTION_HOUSINGS,
  "Horizontal Auger Only": STANDARD_CIP_HOUSINGS,
};

// Some jobs genuinely do not need a feed aid even when the pump type offers
// one. "Not Required" is always available alongside the real options, and
// picking it makes the remarks box mandatory so the reason is on record.
export const AG_BK_NOT_REQUIRED = "Not Required";

// Metres or feet — this is a sump depth, so both units are whole-length ones.
// (It was mt/mm; millimetres were the wrong scale for the measurement.) The
// first entry is the default for a newly-shown field.
const NEGATIVE_SUCTION_UNITS = ["mt", "feet"];

const agBkOptionsFor = (pumpType: string): string[] =>
  AG_BK_OPTIONS_BY_PUMP_TYPE[pumpType] ?? [];
// Before a pump type is chosen, show every housing so the field isn't empty;
// once chosen it narrows, and an invalid prior pick is cleared on change.
const suctionHousingOptionsFor = (pumpType: string): string[] =>
  pumpType ? SUCTION_HOUSINGS_BY_PUMP_TYPE[pumpType] ?? ALL_SUCTION_HOUSINGS : ALL_SUCTION_HOUSINGS;

/** "AG & BK" (bucket with auger): the suction connection is the bucket. */
const AG_AND_BK = "AG & BK";
const hasBucket = (agBk: unknown) => agBk === AG_AND_BK;

const OperatingConditionsStep = ({
  onNext,
  onPrevious,
  formData,
  setFormData,
  onStepClick,
}: Props) => {
  // Pump Type cascades to AG/BK + Suction Housing: auto-pick the single valid
  // AG/BK option (or clear it), and clear a suction housing the new pump type
  // no longer allows.
  const handlePumpTypeChange = (pumpType: string) => {
    const agOpts = agBkOptionsFor(pumpType);
    const suctionOpts = suctionHousingOptionsFor(pumpType);
    // An explicit "Not Required" survives a pump-type change - it is the
    // user's decision, not a default we are free to overwrite. Otherwise the
    // sole valid option is auto-picked and an invalid prior pick is cleared.
    const agBk =
      agOpts.length === 0
        ? ""
        : formData.agBk === AG_BK_NOT_REQUIRED
          ? AG_BK_NOT_REQUIRED
          : agOpts.length === 1
            ? agOpts[0]
            : agOpts.includes(formData.agBk)
              ? formData.agBk
              : "";
    setFormData({
      ...formData,
      pumpType,
      agBk,
      agBkRemarks: agBk === AG_BK_NOT_REQUIRED ? formData.agBkRemarks ?? "" : "",
      ...suctionConnectionFor(agBk),
      // Negative suction is asked for every pump type now, so the answer and
      // its depth survive a pump-type change.
      suctionHousing: suctionOpts.includes(formData.suctionHousing)
        ? formData.suctionHousing
        : "",
    });
  };

  // With AG & BK the suction connection is the bucket (the only option) and
  // there is no suction flange std; any other choice clears "Bucket".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function suctionConnectionFor(agBk: string): Record<string, any> {
    if (hasBucket(agBk)) return { suctionConnection: BUCKET_CONNECTION, suctionFlangeStd: "" };
    return formData.suctionConnection === BUCKET_CONNECTION ? { suctionConnection: "" } : {};
  }
  const bucket = hasBucket(formData.agBk);
  // A tag saved before this rule (or before the fields moved here) is brought
  // in line when the step opens.
  useEffect(() => {
    if (bucket && (formData.suctionConnection !== BUCKET_CONNECTION || formData.suctionFlangeStd))
      setFormData({ ...formData, suctionConnection: BUCKET_CONNECTION, suctionFlangeStd: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, formData.suctionConnection, formData.suctionFlangeStd]);
  const flangeStds = useFlangeStandards();

  const agBkOptions = agBkOptionsFor(formData.pumpType);
  const suctionHousingOptions = suctionHousingOptionsFor(formData.pumpType);
  const agBkNotRequired = formData.agBk === AG_BK_NOT_REQUIRED;
  const hasNegativeSuction = formData.negativeSuction === "Yes";

  // "No" drops any depth already entered, so nothing stale reaches the
  // quotation from a field that is no longer shown.
  const handleNegativeSuctionChange = (value: string) =>
    setFormData({
      ...formData,
      negativeSuction: value,
      negativeSuctionSize: value === "Yes" ? formData.negativeSuctionSize ?? "" : "",
      negativeSuctionUnit: value === "Yes" ? formData.negativeSuctionUnit || NEGATIVE_SUCTION_UNITS[0] : "",
    });

  // Remarks only belong to "Not Required" - switching back to a real option
  // drops them so a stale justification cannot follow the pump into a
  // quotation that does use a feed aid.
  const handleAgBkChange = (agBk: string) =>
    setFormData({
      ...formData,
      agBk,
      agBkRemarks: agBk === AG_BK_NOT_REQUIRED ? formData.agBkRemarks ?? "" : "",
      ...suctionConnectionFor(agBk),
    });

  // Every specification is required - they all feed the MOC component split,
  // the quotation and the built pump. AG/BK is the one conditional field: it
  // only applies to pump types that offer it (Horizontal Standard has none).
  const [showErrors, setShowErrors] = useState(false);
  const errors: Record<string, string> = {
    pumpType: formData.pumpType ? "" : "Select a pump type.",
    agBk:
      agBkOptions.length === 0 || formData.agBk ? "" : "Select an AG / BK option.",
    agBkRemarks:
      agBkNotRequired && !(formData.agBkRemarks ?? "").trim()
        ? "Explain why AG / BK is not required."
        : "",
    bearingHousing: formData.bearingHousing
      ? ""
      : "Select a pump support and drive arrangement.",
    suctionHousing: formData.suctionHousing ? "" : "Select a suction housing.",
    jointType: formData.jointType ? "" : "Select a joint type.",
    negativeSuction: formData.negativeSuction ? "" : "Select whether the pump has a negative suction.",
    negativeSuctionSize:
      !hasNegativeSuction || (formData.negativeSuctionSize ?? "").trim()
        ? ""
        : "Enter the negative suction size.",
    negativeSuctionUnit:
      !hasNegativeSuction || formData.negativeSuctionUnit ? "" : "Select a negative suction unit.",
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
    if (target > 3 && hasErrors(errors)) {
      setShowErrors(true);
      return;
    }
    onStepClick?.(target);
  };

  return (
    <div className="step-container">
      <Stepper currentStep={3} maxStep={formData.wizardMaxStep} onStepClick={handleStepClick} />

      <div className="step-card">
        <h2>
          Specifications
          <StepApprovalBadge step={3} />
        </h2>
        <p>Select the pump&apos;s structural specifications.</p>

        <div className={grid}>
          <div className={fieldWrap}>
            <label className={label}>Pump Type<Req /></label>
            <select
              className={control}
              value={formData.pumpType}
              onChange={(e) => handlePumpTypeChange(e.target.value)}
            >
              <option value="">Select Pump Type</option>
              <option value="Horizontal Standard">Horizontal Standard</option>
              <option value="Horizontal Bucket with Auger">
                Horizontal Bucket with Auger
              </option>
              <option value="Horizontal Auger Only">
                Horizontal Auger Only
              </option>
              <option value="Vertical">Vertical</option>
            </select>
            <Err show={showErrors} msg={errors.pumpType} />
          </div>

          {/* AG / BK feed option — availability + choices are decided by the
              selected pump type (Horizontal Standard has none). */}
          {agBkOptions.length > 0 && (
            <div className={fieldWrap}>
              <label className={label}>AG / BK<Req /></label>
              <select
                className={control}
                value={formData.agBk ?? ""}
                onChange={(e) => handleAgBkChange(e.target.value)}
              >
                {agBkOptions.length > 1 && <option value="">Select AG / BK</option>}
                {agBkOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                <option value={AG_BK_NOT_REQUIRED}>{AG_BK_NOT_REQUIRED}</option>
              </select>
              <span className={hint}>
                Suggested by the selected pump type — choose “{AG_BK_NOT_REQUIRED}”
                if this job does not need a feed aid.
              </span>
              <Err show={showErrors} msg={errors.agBk} />
            </div>
          )}

          {/* Marking AG/BK as not required is a deliberate deviation from what
              the pump type suggests, so the reason is mandatory. */}
          {agBkOptions.length > 0 && agBkNotRequired && (
            <div className={fieldWrap}>
              <label className={label}>Why AG / BK Is Not Required<Req /></label>
              <textarea
                className={control}
                rows={2}
                placeholder="Reason for omitting AG / BK"
                value={formData.agBkRemarks ?? ""}
                onChange={(e) =>
                  setFormData({ ...formData, agBkRemarks: e.target.value })
                }
              />
              <Err show={showErrors} msg={errors.agBkRemarks} />
            </div>
          )}

          <div className={fieldWrap}>
            <label className={label}>{PUMP_SUPPORT_LABEL}<Req /></label>
            <select
              className={control}
              value={formData.bearingHousing}
              onChange={(e) =>
                setFormData({ ...formData, bearingHousing: e.target.value })
              }
            >
              <option value="">Select an arrangement</option>
              {PUMP_SUPPORT_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <span className={hint}>
              Sets what the MOC step calls the drive-end component.
            </span>
            <Err show={showErrors} msg={errors.bearingHousing} />
          </div>

          <div className={fieldWrap}>
            <label className={label}>Suction Housing<Req /></label>
            <select
              className={control}
              value={formData.suctionHousing}
              onChange={(e) =>
                setFormData({ ...formData, suctionHousing: e.target.value })
              }
            >
              <option value="">Select Suction Housing</option>
              {suctionHousingOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <Err show={showErrors} msg={errors.suctionHousing} />
          </div>

          <div className={fieldWrap}>
            <label className={label}>Joint Type<Req /></label>
            <select
              className={control}
              value={formData.jointType}
              onChange={(e) =>
                setFormData({ ...formData, jointType: e.target.value })
              }
            >
              <option value="">Select Joint Type</option>
              <option value="Eccentric Joint">Eccentric Joint</option>
              <option value="Cardan Joint 2">Cardan Joint 2</option>
              <option value="CJSM">CJSM</option>
            </select>
            <Err show={showErrors} msg={errors.jointType} />
          </div>

          {/* Connections + flange standards (moved here from Fluid Properties). */}
          <ConnectionSelect
            fieldLabel="Suction Connection"
            value={formData.suctionConnection ?? ""}
            options={bucket ? [BUCKET_CONNECTION] : SUCTION_CONNECTIONS}
            onChange={(v) => setFormData({ ...formData, suctionConnection: v })}
          />
          {!bucket && (
            <FlangeStdField
              fieldLabel="Suction Flange Std"
              value={formData.suctionFlangeStd ?? ""}
              onChange={(v) => setFormData({ ...formData, suctionFlangeStd: v })}
              options={flangeStds.options}
              setOptions={flangeStds.setOptions}
              loadFailed={flangeStds.loadFailed}
            />
          )}
          <ConnectionSelect
            fieldLabel="End Connection (Discharge)"
            value={formData.endConnection ?? ""}
            options={END_CONNECTIONS}
            onChange={(v) => setFormData({ ...formData, endConnection: v })}
          />
          <FlangeStdField
            fieldLabel="Discharge Flange Std"
            value={formData.dischargeFlangeStd ?? ""}
            onChange={(v) => setFormData({ ...formData, dischargeFlangeStd: v })}
            options={flangeStds.options}
            setOptions={flangeStds.setOptions}
            loadFailed={flangeStds.loadFailed}
          />

          {/* Asked for every pump type: does the suction hang below the pump's
              mounting flange, and if so by how much (metres or millimetres). */}
          <div className={fieldWrap}>
            <label className={label}>Negative Suction<Req /></label>
            <select
              className={control}
              value={formData.negativeSuction ?? ""}
              onChange={(e) => handleNegativeSuctionChange(e.target.value)}
            >
              <option value="">Select</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
            <Err show={showErrors} msg={errors.negativeSuction} />
          </div>

          {hasNegativeSuction && (
            <div className={fieldWrap}>
              <label className={label}>Negative Suction Size<Req /></label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Enter Negative Suction Size"
                  className={control}
                  value={formData.negativeSuctionSize ?? ""}
                  onChange={(e) =>
                    setFormData({ ...formData, negativeSuctionSize: e.target.value })
                  }
                />
                <select
                  className={control}
                  value={formData.negativeSuctionUnit || NEGATIVE_SUCTION_UNITS[0]}
                  onChange={(e) =>
                    setFormData({ ...formData, negativeSuctionUnit: e.target.value })
                  }
                >
                  {NEGATIVE_SUCTION_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <Err
                show={showErrors}
                msg={errors.negativeSuctionSize || errors.negativeSuctionUnit}
              />
            </div>
          )}
        </div>

        <ErrorBanner show={showErrors} count={errorCount} />

        <div className={actions}>
          <button className={btnGhost} onClick={onPrevious}>
            Previous
          </button>
          <button className={btnPrimary} onClick={handleNext}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default OperatingConditionsStep;
