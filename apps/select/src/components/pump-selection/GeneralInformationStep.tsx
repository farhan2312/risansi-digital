"use client";

import { useState } from "react";
import "./GeneralInformationStep.css";
import Stepper from "./Stepper";
import StepApprovalBadge from "./approval/StepApprovalBadge";
import MediaSelect from "./MediaSelect";
import { toM3PerHr, toMwc, fmt } from "../../utils/units";
import {
  actions,
  btnPrimary,
  control,
  fieldWrap,
  fullWidth,
  grid,
  hint,
  label,
} from "./formStyles";
import { Err, ErrorBanner, Req, hasErrors } from "./fieldBits";
import HeadCalcModal from "./HeadCalcModal";
import { normalizeHeadCalc, seedHeadCalc } from "../../lib/head-calc-store";
import { calculateDischarge } from "../../lib/discharge-calculator";

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFormData: any;
  onNext: () => void;
  onStepClick?: (step: number) => void;
};

const GeneralInformationStep = ({
  onNext,
  formData,
  setFormData,
  onStepClick,
}: Props) => {
  const sg = parseFloat(formData.sg) || 1;

  const capNum = parseFloat(formData.capacity);
  const capConv =
    formData.capacityUnit && formData.capacityUnit !== "M3/hr" && !isNaN(capNum)
      ? toM3PerHr(capNum, formData.capacityUnit, sg)
      : null;

  const headNum = parseFloat(formData.head);
  const headConv =
    formData.headUnit && formData.headUnit !== "MWC" && !isNaN(headNum)
      ? toMwc(headNum, formData.headUnit, sg)
      : null;

  // Required before the pump can be screened at all: without capacity, head,
  // their units, an RPM band and a media there is nothing to select against.
  // Specific Gravity stays optional - it defaults to 1.0 in the conversions.
  const [showErrors, setShowErrors] = useState(false);
  // Head Calculator pop-up; its inputs are saved with the tag (headCalc).
  const [showHeadCalc, setShowHeadCalc] = useState(false);
  const savedCalc = normalizeHeadCalc(formData.headCalc);
  const savedDischargeHead = savedCalc ? calculateDischarge(savedCalc.discharge).totalHead : null;
  const errors: Record<string, string> = {
    capacity: formData.capacity ? "" : "Capacity is required.",
    capacityUnit: formData.capacityUnit ? "" : "Select a capacity unit.",
    head: formData.head ? "" : "Head / discharge pressure is required.",
    headUnit: formData.headUnit ? "" : "Select a head unit.",
    rpmRange: formData.rpmRange ? "" : "Select an RPM range.",
    media: formData.media ? "" : "Media / application is required.",
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
    if (target > 1 && hasErrors(errors)) {
      setShowErrors(true);
      return;
    }
    onStepClick?.(target);
  };
  return (
    <div className="step-container">
      <Stepper currentStep={1} maxStep={formData.wizardMaxStep} onStepClick={handleStepClick} />

      <div className="step-card">
        <h2>
          General Information
          <StepApprovalBadge step={1} />
        </h2>
        <p>Enter the basic operating parameters required for pump selection.</p>

        <div className={grid}>
          <div className={fieldWrap}>
            <label className={label}>Capacity<Req /></label>
            <input
              type="number"
              placeholder="Enter Capacity"
              className={control}
              value={formData.capacity}
              onChange={(e) =>
                setFormData({ ...formData, capacity: e.target.value })
              }
            />
            {capConv !== null && (
              <span className={hint}>
                = <b className="mono font-semibold text-fg">{fmt(capConv)}</b>{" "}
                m³/hr
                {formData.capacityUnit === "TPH" && !formData.sg && (
                  <em className="not-italic text-warn"> (using SG 1.0 — set Specific Gravity)</em>
                )}
              </span>
            )}
            <Err show={showErrors} msg={errors.capacity} />
          </div>

          <div className={fieldWrap}>
            <label className={label}>Capacity Unit<Req /></label>
            <select
              className={control}
              value={formData.capacityUnit}
              onChange={(e) =>
                setFormData({ ...formData, capacityUnit: e.target.value })
              }
            >
              <option value="">Select</option>
              <option value="M3/hr">M³/hr</option>
              <option value="LPH">LPH</option>
              <option value="LPM">LPM</option>
              <option value="GPM">GPM</option>
              <option value="KLPD">KLPD</option>
              <option value="TPH">TPH</option>
            </select>
            <Err show={showErrors} msg={errors.capacityUnit} />
          </div>

          <div className={fieldWrap}>
            <label className={label}>Head / Discharge Pressure<Req /></label>
            <input
              type="number"
              placeholder="Enter Head"
              className={control}
              value={formData.head}
              onChange={(e) => setFormData({ ...formData, head: e.target.value })}
            />
            {headConv !== null && (
              <span className={hint}>
                = <b className="mono font-semibold text-fg">{fmt(headConv)}</b>{" "}
                MWC
                {formData.headUnit === "MLC" && !formData.sg && (
                  <em className="not-italic text-warn"> (using SG 1.0 — set Specific Gravity)</em>
                )}
              </span>
            )}
            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px]">
              <button
                type="button"
                className="font-semibold text-accent hover:underline"
                onClick={() => setShowHeadCalc(true)}
              >
                {savedCalc ? "Open head calculator" : "Head calculator (suction / discharge)"}
              </button>
              {savedCalc && savedDischargeHead !== null && Number.isFinite(savedDischargeHead) && (
                <span className="text-fg-3">
                  · saved — discharge head <b className="mono text-fg-2">{savedDischargeHead.toFixed(2)} MWC</b>
                </span>
              )}
            </span>
            <Err show={showErrors} msg={errors.head} />
          </div>

          <div className={fieldWrap}>
            <label className={label}>Head Unit<Req /></label>
            <select
              className={control}
              value={formData.headUnit}
              onChange={(e) =>
                setFormData({ ...formData, headUnit: e.target.value })
              }
            >
              <option value="">Select</option>
              <option value="MWC">MWC</option>
              <option value="MLC">MLC</option>
              <option value="Bar">Bar</option>
              <option value="Kg/cm²">Kg/cm²</option>
            </select>
            <Err show={showErrors} msg={errors.headUnit} />
          </div>

          <div className={fieldWrap}>
            <label className={label}>Specific Gravity</label>
            <input
              type="number"
              step="0.01"
              placeholder="e.g. 1.0 water, 1.4 molasses"
              className={control}
              value={formData.sg}
              onChange={(e) => setFormData({ ...formData, sg: e.target.value })}
            />
          </div>

          <div className={fieldWrap}>
            <label className={label}>RPM Range<Req /></label>
            <select
              className={control}
              value={formData.rpmRange ?? ""}
              onChange={(e) =>
                setFormData({ ...formData, rpmRange: e.target.value })
              }
            >
              <option value="">Select RPM range</option>
              <option value="vlow">Very Low ( 0 – 50 )</option>
              <option value="low">Low ( 50 – 200 )</option>
              <option value="medium">Medium ( 200 – 320 )</option>
              <option value="high">High ( 320 – 400 )</option>
              <option value="vhigh">Very High ( &gt; 400 )</option>
            </select>
            <Err show={showErrors} msg={errors.rpmRange} />
          </div>

          <div className={`${fieldWrap} ${fullWidth}`}>
            <label className={label}>Media / Application<Req /></label>
            <MediaSelect
              value={formData.media}
              onChange={(value) => setFormData({ ...formData, media: value })}
            />
            <Err show={showErrors} msg={errors.media} />
          </div>
        </div>

        {showHeadCalc && (
          <HeadCalcModal
            initial={savedCalc ?? seedHeadCalc(formData)}
            onClose={() => setShowHeadCalc(false)}
            onSave={(calc, headMwc) => {
              setFormData({
                ...formData,
                headCalc: calc,
                ...(headMwc !== null ? { head: String(Math.round(headMwc * 100) / 100), headUnit: "MWC" } : {}),
              });
              setShowHeadCalc(false);
            }}
          />
        )}

        <ErrorBanner show={showErrors} count={errorCount} />

        <div className={actions}>
          <button className={btnPrimary} onClick={handleNext}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default GeneralInformationStep;
