"use client";

import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import "./TestReportForm.css";
import { getLatestObservationReport, getReport, getRequisition, submitReport, updateReport } from "@/services/testingService";
import { computeViscosityChartPoint } from "@/lib/testReportCalc";
import { normalizeModelOnChange, normalizeMotorRpm, formatNumber } from "@/lib/formUtils";
import { normalizeCapacityForSubmit, normalizeHeadForSubmit } from "@/lib/unitConversion";
import {
  clearReportDraft,
  draftFromReport,
  draftFromRequisition,
  loadReportDraft,
  saveReportDraft,
  type SharedReportDraft,
} from "@/lib/reportDraft";
import { computeRequirementStatus } from "@/lib/requirementCheck";
import { veMeAcceptanceFor } from "@/lib/veMeAcceptance";
import PageHeader from "@/components/ui/PageHeader";
import {
  MOTOR_RPM_OPTIONS,
  NPSHA_STATUSES,
  TEST_TYPES,
  VISCOSITY_CAPACITY_UNITS,
  VISCOSITY_HEAD_UNITS,
  type PumpTestReport,
  type TestType,
} from "@/types/testing";

interface PointFormValues {
  rpm: string;
  head_kgcm2: string;
  height_over_vnotch: string;
  initial_reading: string;
  time_taken_to_fill_bucket_sec: string;
  capacity_direct: string;
  volts: string;
  amps: string;
  cos_phi: string;
}

interface ChartFormValues {
  model: string;
  po_no: string;
  ec_no: string;
  pump_serial_no: string;
  gearbox_no: string;
  gearbox_ratio: string;
  motor: string;
  motor_rpm: string;
  test_type: TestType;
  npsha_status: string;
  liquid: string;
  rated_capacity: string;
  capacity_unit: string;
  rated_head: string;
  head_unit: string;
  specific_gravity: string;
  viscosity_cps: string;
  k_for_given_cps: string;
  rated_rpm: string;
  q_theoretical_100rev: string;
  calculated_head: string;
  rated_power_kw: string;
  reference_voltage: string;
  reference_current: string;
  vnotch_baseline: string;
  tested_by: string;
  test_date: string;
  vibration_sound_db: string;
  vibration_x_mm_sec: string;
  vibration_y_mm_sec: string;
  vibration_z_mm_sec: string;
  pump_started_at: string;
  pump_stopped_at: string;
  ambient_temp_c: string;
  max_bearing_temp_c: string;
  witness: string;
  inspector: string;
  recorder: string;
  remarks: string;
  points: PointFormValues[];
}

const emptyPoint: PointFormValues = {
  rpm: "",
  head_kgcm2: "",
  height_over_vnotch: "",
  initial_reading: "",
  time_taken_to_fill_bucket_sec: "",
  capacity_direct: "",
  volts: "",
  amps: "",
  cos_phi: "",
};

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const numOrUndef = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));
const fmt = (v: number | null) => (v === null || Number.isNaN(v) ? "-" : formatNumber(v));
const str = (v: string | number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

/** Duration between two "HH:MM" (24-hour) times, formatted "HH:MM hrs".
 * Assumes a stop time earlier than the start crossed midnight. */
const computeTotalRun = (start: string, stop: string): string => {
  if (!start || !stop) return "";
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = stop.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return "";
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm} hrs`;
};

/** Total Rise = Max. Bearing Temp − Ambient Temp. */
const computeTotalRise = (ambient: string, maxBearing: string): number | null => {
  if (ambient.trim() === "" || maxBearing.trim() === "") return null;
  const a = Number(ambient);
  const m = Number(maxBearing);
  if (Number.isNaN(a) || Number.isNaN(m)) return null;
  return Math.round((m - a) * 100) / 100;
};

const pointsFromExistingReport = (report: PumpTestReport): PointFormValues[] => {
  const isFlowMeter = report.test_type === "Flow Meter";
  return report.points.map((p) => ({
    rpm: str(p.rpm),
    head_kgcm2: str(p.head_kgcm2),
    height_over_vnotch: str(p.height_taken_for_filling),
    initial_reading: str(p.initial_reading),
    time_taken_to_fill_bucket_sec: str(p.time_taken_to_fill_bucket_sec),
    capacity_direct: isFlowMeter ? str(p.capacity_calculated_m3hr) : "",
    volts: str(p.volts),
    amps: str(p.amps),
    cos_phi: str(p.cos_phi),
  }));
};

interface ViscosityChartFormProps {
  lockedModel?: string;
  requisitionId?: string;
  /** Editing an already-submitted report — prefills every field (including
   * points) from it and PATCHes instead of POSTing on submit. */
  existingReport?: PumpTestReport;
  heading: string;
  subheading: string;
  submitLabel: string;
  onSubmitted: (report: PumpTestReport) => void;
  onCancel: () => void;
}

const ViscosityChartForm = ({
  lockedModel,
  requisitionId,
  existingReport,
  heading,
  subheading,
  submitLabel,
  onSubmitted,
  onCancel,
}: ViscosityChartFormProps) => {
  const [submitError, setSubmitError] = useState("");
  const [autofillNotice, setAutofillNotice] = useState("");
  const scopeId = requisitionId ?? "standalone";
  const lookedUpModel = useRef<string>("");
  // capacity_unit / head_unit start with a hardcoded generic default
  // ("M3/HR" / "MWC") rather than empty, so "is this field already filled"
  // can't tell a real edit apart from that default. Track separately which
  // of the two has already been claimed by a higher-priority autofill call
  // (Observation Sheet before requisition) so the lower-priority one only
  // fills what's still unclaimed, instead of unconditionally overwriting it.
  const unitsAutofilled = useRef({ capacity_unit: false, head_unit: false });

  const initialDraft = useRef<SharedReportDraft | null>(null);
  if (initialDraft.current === null) {
    if (existingReport) {
      initialDraft.current = {};
    } else {
      const loaded = loadReportDraft(scopeId);
      // Viscosity Chart's unit dropdowns use a different value set than the
      // Observation Sheet's — only carry a unit over if it's valid here.
      if (loaded.capacity_unit && !VISCOSITY_CAPACITY_UNITS.includes(loaded.capacity_unit as never)) {
        delete loaded.capacity_unit;
      }
      if (loaded.head_unit && !VISCOSITY_HEAD_UNITS.includes(loaded.head_unit as never)) {
        delete loaded.head_unit;
      }
      initialDraft.current = loaded;
    }
  }
  const draft = initialDraft.current;
  const r = existingReport;

  const { register, control, handleSubmit, getValues, setValue, formState: { isSubmitting, errors } } = useForm<ChartFormValues>({
    defaultValues: {
      model: lockedModel ?? r?.model ?? draft.model ?? "",
      po_no: str(r?.po_no) || draft.po_no || "",
      ec_no: str(r?.ec_no) || draft.ec_no || "",
      pump_serial_no: str(r?.pump_serial_no) || draft.pump_serial_no || "",
      gearbox_no: str(r?.gearbox_no) || draft.gearbox_no || "",
      gearbox_ratio: str(r?.gearbox_ratio) || draft.gearbox_ratio || "",
      motor: str(r?.motor) || draft.motor || "",
      motor_rpm: normalizeMotorRpm(r?.motor_rpm) || normalizeMotorRpm(draft.motor_rpm) || "",
      liquid: r?.liquid ?? draft.liquid ?? "WATER",
      test_type: (r?.test_type as TestType) ?? (draft.test_type as TestType) ?? "V-notch",
      npsha_status: r?.npsha_status ?? draft.npsha_status ?? "POSITIVE",
      capacity_unit: r?.capacity_unit ?? draft.capacity_unit ?? "M3/HR",
      head_unit: r?.head_unit ?? draft.head_unit ?? "MWC",
      rated_capacity: str(r?.rated_capacity) || draft.rated_capacity || "",
      rated_head: str(r?.rated_head) || draft.rated_head || "",
      specific_gravity: str(r?.specific_gravity) || draft.specific_gravity || "",
      viscosity_cps: str(r?.viscosity_cps) || draft.viscosity_cps || "",
      k_for_given_cps: str(r?.k_for_given_cps) || draft.k_for_given_cps || "1",
      rated_rpm: str(r?.rated_rpm) || draft.rated_rpm || "",
      q_theoretical_100rev: str(r?.q_theoretical_100rev) || draft.q_theoretical_100rev || "",
      calculated_head: str(r?.calculated_head) || draft.calculated_head || "",
      rated_power_kw: str(r?.rated_power_kw) || draft.rated_power_kw || "",
      reference_voltage: str(r?.reference_voltage) || draft.reference_voltage || "",
      reference_current: str(r?.reference_current) || draft.reference_current || "",
      vnotch_baseline: str(r?.vnotch_baseline) || draft.vnotch_baseline || "",
      tested_by: r?.tested_by ?? draft.tested_by ?? "",
      test_date: r?.test_date ?? draft.test_date ?? "",
      vibration_sound_db: str(r?.vibration_sound_db) || draft.vibration_sound_db || "",
      vibration_x_mm_sec: str(r?.vibration_x_mm_sec) || draft.vibration_x_mm_sec || "",
      vibration_y_mm_sec: str(r?.vibration_y_mm_sec) || draft.vibration_y_mm_sec || "",
      vibration_z_mm_sec: str(r?.vibration_z_mm_sec) || draft.vibration_z_mm_sec || "",
      pump_started_at: str(r?.pump_started_at) || draft.pump_started_at || "",
      pump_stopped_at: str(r?.pump_stopped_at) || draft.pump_stopped_at || "",
      ambient_temp_c: str(r?.ambient_temp_c) || draft.ambient_temp_c || "",
      max_bearing_temp_c: str(r?.max_bearing_temp_c) || draft.max_bearing_temp_c || "",
      witness: str(r?.witness) || draft.witness || "",
      inspector: str(r?.inspector) || draft.inspector || "",
      recorder: str(r?.recorder) || draft.recorder || "",
      remarks: str(r?.remarks),
      points: r ? pointsFromExistingReport(r) : [emptyPoint],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({ control, name: "points" });

  // Fills currently-empty fields from a shared draft (report- or
  // requisition-sourced) — never overwrites something the tester already
  // typed. Returns whether anything was actually filled.
  const applyDraftFields = (d: SharedReportDraft): boolean => {
    let filledAny = false;
    const setIfEmpty = (name: keyof ChartFormValues, value?: string) => {
      if (!value || getValues(name)) return;
      setValue(name, value as never);
      filledAny = true;
    };
    setIfEmpty("po_no", d.po_no);
    setIfEmpty("ec_no", d.ec_no);
    setIfEmpty("pump_serial_no", d.pump_serial_no);
    setIfEmpty("gearbox_no", d.gearbox_no);
    setIfEmpty("gearbox_ratio", d.gearbox_ratio);
    setIfEmpty("motor", d.motor);
    setIfEmpty("motor_rpm", normalizeMotorRpm(d.motor_rpm));
    setIfEmpty("test_type", d.test_type);
    setIfEmpty("npsha_status", d.npsha_status);
    setIfEmpty("liquid", d.liquid);
    if (
      d.capacity_unit &&
      VISCOSITY_CAPACITY_UNITS.includes(d.capacity_unit as never) &&
      !unitsAutofilled.current.capacity_unit
    ) {
      setValue("capacity_unit", d.capacity_unit as never);
      unitsAutofilled.current.capacity_unit = true;
      filledAny = true;
    }
    if (
      d.head_unit &&
      VISCOSITY_HEAD_UNITS.includes(d.head_unit as never) &&
      !unitsAutofilled.current.head_unit
    ) {
      setValue("head_unit", d.head_unit as never);
      unitsAutofilled.current.head_unit = true;
      filledAny = true;
    }
    setIfEmpty("rated_capacity", d.rated_capacity);
    setIfEmpty("rated_head", d.rated_head);
    setIfEmpty("specific_gravity", d.specific_gravity);
    setIfEmpty("viscosity_cps", d.viscosity_cps);
    setIfEmpty("k_for_given_cps", d.k_for_given_cps);
    setIfEmpty("rated_rpm", d.rated_rpm);
    setIfEmpty("q_theoretical_100rev", d.q_theoretical_100rev);
    setIfEmpty("calculated_head", d.calculated_head);
    setIfEmpty("rated_power_kw", d.rated_power_kw);
    setIfEmpty("reference_voltage", d.reference_voltage);
    setIfEmpty("reference_current", d.reference_current);
    setIfEmpty("vnotch_baseline", d.vnotch_baseline);
    setIfEmpty("tested_by", d.tested_by);
    setIfEmpty("test_date", d.test_date);
    setIfEmpty("vibration_sound_db", d.vibration_sound_db);
    setIfEmpty("vibration_x_mm_sec", d.vibration_x_mm_sec);
    setIfEmpty("vibration_y_mm_sec", d.vibration_y_mm_sec);
    setIfEmpty("vibration_z_mm_sec", d.vibration_z_mm_sec);
    setIfEmpty("pump_started_at", d.pump_started_at);
    setIfEmpty("pump_stopped_at", d.pump_stopped_at);
    setIfEmpty("ambient_temp_c", d.ambient_temp_c);
    setIfEmpty("max_bearing_temp_c", d.max_bearing_temp_c);
    setIfEmpty("witness", d.witness);
    setIfEmpty("inspector", d.inspector);
    setIfEmpty("recorder", d.recorder);
    return filledAny;
  };

  // Prefill from the same pump's Observation Sheet — its test points are the
  // actual measured data, copied over exactly as recorded (same rule as the
  // header fields: only if nothing's been entered here yet, so we never
  // clobber work in progress). The viscosity-corrected columns (VE/ME for
  // liquid, slip, etc.) still recompute live from Specific Gravity / K /
  // Viscosity via computeViscosityChartPoint — only the raw inputs are copied.
  const applyAutofillFromReport = (source: Parameters<typeof draftFromReport>[0]): boolean => {
    let filledAny = applyDraftFields(draftFromReport(source));

    const currentPoints = getValues("points");
    const pointsArePristine =
      currentPoints.length === 1 && Object.values(currentPoints[0]).every((v) => !v);
    const sourceReport = source as PumpTestReport;
    if (pointsArePristine && sourceReport.points?.length > 0) {
      replace(pointsFromExistingReport(sourceReport));
      filledAny = true;
    }
    return filledAny;
  };

  // Requisition-linked: this exact job's Observation Sheet report (if any)
  // is the most authoritative source (real measured data), known as soon as
  // the requisition loads — applied first. Whatever's still empty afterward
  // falls back to the requisition's own intake data (what was requested,
  // not yet measured).
  useEffect(() => {
    if (existingReport || !requisitionId) return;
    getRequisition(requisitionId)
      .then((req) => {
        let notice = "";
        const obs = req.reports?.find((rep) => (rep.report_format ?? "observation") === "observation");
        if (obs && applyAutofillFromReport(obs)) {
          notice = `Prefilled from the Observation Sheet${obs.report_no ? ` (${obs.report_no})` : ""} already submitted for this pump, including its test points — edit anything as needed.`;
        }
        if (applyDraftFields(draftFromRequisition(req))) {
          notice = notice
            ? `${notice} Remaining fields prefilled from the linked requisition.`
            : "Prefilled from the linked requisition — edit anything as needed.";
        }
        if (notice) setAutofillNotice(notice);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requisitionId, existingReport]);

  // Standalone: look up by model once the tester finishes typing it.
  const handleModelBlur = () => {
    if (existingReport || requisitionId) return;
    const modelVal = getValues("model").trim();
    if (!modelVal || modelVal === lookedUpModel.current) return;
    lookedUpModel.current = modelVal;
    getLatestObservationReport(modelVal)
      .then((obs) => {
        if (!obs) return;
        const notify = (reportNo?: string | null, filled?: boolean) => {
          if (!filled) return;
          setAutofillNotice(
            `Prefilled from the Observation Sheet${reportNo ? ` (${reportNo})` : ""} already submitted for this pump, including its test points — edit anything as needed.`
          );
        };
        // getLatestObservationReport only returns a summary (no points) --
        // fetch the full report so its test points can be copied over too.
        getReport(obs.id)
          .then((full) => notify(full.report_no, applyAutofillFromReport(full)))
          .catch(() => notify(obs.report_no, applyAutofillFromReport(obs)));
      })
      .catch(() => {});
  };

  const sharedFieldsWatch = useWatch({
    control,
    name: [
      "model", "po_no", "ec_no", "pump_serial_no", "gearbox_no",
      "gearbox_ratio", "motor", "motor_rpm", "test_type", "npsha_status", "liquid",
      "rated_capacity", "capacity_unit", "rated_head", "head_unit", "specific_gravity",
      "viscosity_cps", "k_for_given_cps", "rated_rpm", "q_theoretical_100rev", "calculated_head",
      "rated_power_kw",
      "reference_voltage", "reference_current", "vnotch_baseline", "tested_by", "test_date",
      "vibration_sound_db", "vibration_x_mm_sec", "vibration_y_mm_sec", "vibration_z_mm_sec",
      "pump_started_at", "pump_stopped_at", "ambient_temp_c", "max_bearing_temp_c",
      "witness", "inspector", "recorder",
    ],
  });
  useEffect(() => {
    if (existingReport) return;
    const [model, po_no, ec_no, pump_serial_no, gearbox_no, gearbox_ratio,
      motor, motor_rpm, test_type, npsha_status, liquid, rated_capacity, capacity_unit, rated_head,
      head_unit, specific_gravity, viscosity_cps, k_for_given_cps, rated_rpm, q_theoretical_100rev,
      calculated_head, rated_power_kw, reference_voltage, reference_current, vnotch_baseline, tested_by, test_date,
      vibration_sound_db, vibration_x_mm_sec, vibration_y_mm_sec, vibration_z_mm_sec,
      pump_started_at, pump_stopped_at, ambient_temp_c, max_bearing_temp_c,
      witness, inspector, recorder] = sharedFieldsWatch;
    const nextDraft: SharedReportDraft = {
      model: lockedModel ?? model, po_no, ec_no, pump_serial_no, gearbox_no,
      gearbox_ratio, motor, motor_rpm, test_type, npsha_status, liquid, rated_capacity,
      capacity_unit, rated_head, head_unit, specific_gravity, viscosity_cps, k_for_given_cps,
      rated_rpm, q_theoretical_100rev, calculated_head, rated_power_kw, reference_voltage, reference_current,
      vnotch_baseline, tested_by, test_date, vibration_sound_db, vibration_x_mm_sec,
      vibration_y_mm_sec, vibration_z_mm_sec, pump_started_at, pump_stopped_at, ambient_temp_c,
      max_bearing_temp_c, witness, inspector, recorder,
    };
    saveReportDraft(scopeId, nextDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedFieldsWatch]);

  const testType = useWatch({ control, name: "test_type" });

  // V-Notch Baseline (Hin) is a fixed physical constant of the test rig's
  // V-notch weir, not a per-test reading, so it's never typed in: 320 when
  // the Capacity Measurement Method is V-notch, blank when it isn't -- the
  // baseline is meaningless for Barrel / Flow Meter, and a stale 320 left
  // behind after switching methods would be misleading. Skip on existing
  // reports so legacy-imported values aren't silently overwritten.
  useEffect(() => {
    if (existingReport) return;
    setValue("vnotch_baseline", testType === "V-notch" ? "320" : "");
  }, [testType, setValue, existingReport]);

  // Each test point's own "Initial Reading" (the V-notch weir reading before
  // the pump starts) is the value that actually drives this format's
  // capacity formula -- lock it to 320 the same way, for every point
  // (including ones added later via "+ Add Test Point").
  useEffect(() => {
    if (existingReport || testType !== "V-notch") return;
    fields.forEach((_, i) => setValue(`points.${i}.initial_reading`, "320"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testType, existingReport, setValue, fields.length]);

  const qThVal = useWatch({ control, name: "q_theoretical_100rev" });
  const ratedRpmVal = useWatch({ control, name: "rated_rpm" });
  const kVal = useWatch({ control, name: "k_for_given_cps" });
  const watchedPoints = useWatch({ control, name: "points" });
  const watchedModel = useWatch({ control, name: "model" });
  // VE/ME acceptance: a flat per-model threshold (the testing team's own table), checked live per
  // point as the tester types -- lockedModel wins when this report is filled against a requisition
  // (the model field is disabled then), otherwise whatever's typed into the Model field.
  const veMeAcceptance = veMeAcceptanceFor(lockedModel ?? watchedModel);
  const pumpStartedAt = useWatch({ control, name: "pump_started_at" });
  const pumpStoppedAt = useWatch({ control, name: "pump_stopped_at" });
  const totalRun = computeTotalRun(pumpStartedAt ?? "", pumpStoppedAt ?? "");
  const ambientTempVal = useWatch({ control, name: "ambient_temp_c" });
  const maxBearingTempVal = useWatch({ control, name: "max_bearing_temp_c" });
  const totalRise = computeTotalRise(ambientTempVal ?? "", maxBearingTempVal ?? "");
  const ratedHeadVal = useWatch({ control, name: "rated_head" });
  const ratedCapacityVal = useWatch({ control, name: "rated_capacity" });
  const ratedPowerKwVal = useWatch({ control, name: "rated_power_kw" });

  const header = {
    testType,
    qTheoretical100rev: num(qThVal ?? ""),
    ratedRpm: num(ratedRpmVal ?? ""),
    kForGivenCps: num(kVal ?? ""),
  };

  const computedRows = (watchedPoints ?? []).map((p) =>
    computeViscosityChartPoint(
      {
        rpm: num(p?.rpm ?? ""),
        headKgcm2: num(p?.head_kgcm2 ?? ""),
        volts: num(p?.volts ?? ""),
        amps: num(p?.amps ?? ""),
        cosPhi: num(p?.cos_phi ?? ""),
        heightOverVNotch: num(p?.height_over_vnotch ?? ""),
        initialReading: num(p?.initial_reading ?? ""),
        timeTakenToFillBucketSec: num(p?.time_taken_to_fill_bucket_sec ?? ""),
        capacityDirect: num(p?.capacity_direct ?? ""),
      },
      header
    )
  );

  // Does testing actually satisfy the rated requirements? Still a valid,
  // submittable report either way -- this is a flag, not a validation error.
  const requirementStatus = computeRequirementStatus(
    {
      rated_head: num(ratedHeadVal ?? ""),
      rated_capacity: num(ratedCapacityVal ?? ""),
      rated_power_kw: num(ratedPowerKwVal ?? ""),
    },
    (watchedPoints ?? []).map((p, i) => ({
      head_kgcm2: num(p?.head_kgcm2 ?? ""),
      capacity_calculated_m3hr: computedRows[i]?.capacityCalculatedM3hr ?? null,
      power_calculated_kw: computedRows[i]?.powerCalculatedKw ?? null,
    }))
  );

  const onSubmit = async (values: ChartFormValues) => {
    const model = (lockedModel ?? values.model).trim();
    if (!model) {
      setSubmitError("Model is required.");
      return;
    }
    setSubmitError("");
    try {
      const points = values.points.map((p, i) => {
        const computed = computedRows[i];
        return {
          rpm: num(p.rpm),
          head_kgcm2: num(p.head_kgcm2),
          head_mwc: computed.headMwc,
          vnotch_height: computed.differentialHeight,
          initial_reading: num(p.initial_reading),
          differential_height: computed.differentialHeight,
          capacity_calculated_m3hr: computed.capacityCalculatedM3hr,
          volts: num(p.volts),
          amps: num(p.amps),
          cos_phi: num(p.cos_phi),
          power_calculated_kw: computed.powerCalculatedKw,
          theoretical_power_kw: computed.theoreticalPowerKw,
          mechanical_efficiency: computed.mechanicalEfficiency,
          theoretical_capacity_at_measured_rpm: computed.theoreticalCapacityAtMeasuredRpm,
          slip_water: computed.slipWater,
          slip_viscous: computed.slipViscous,
          theoretical_capacity_at_rated_rpm: computed.theoreticalCapacityAtRatedRpm,
          capacity_liquid_at_rated_rpm_m3hr: computed.capacityLiquidAtRatedRpmM3hr,
          capacity_liquid_at_rated_rpm_lph: computed.capacityLiquidAtRatedRpmLph,
          height_taken_for_filling: num(p.height_over_vnotch),
          time_taken_to_fill_bucket_sec: num(p.time_taken_to_fill_bucket_sec),
          volumetric_efficiency: computed.volumetricEfficiency,
          volumetric_efficiency_liquid: computed.volumetricEfficiencyLiquid,
          mechanical_efficiency_liquid: computed.mechanicalEfficiencyLiquid,
        };
      });

      // Rated Head always means KG/CM2 -- it's compared directly against
      // test points' measured head_kgcm2 for the requirement-met check, so
      // whatever unit it was entered/prefilled in gets normalized here.
      const normalizedHead = normalizeHeadForSubmit(
        numOrUndef(values.rated_head) ?? null,
        values.head_unit || null,
        numOrUndef(values.specific_gravity) ?? null
      );
      // Same story for Rated Capacity -- always M3/Hr, since it's compared
      // directly against test points' computed capacity_calculated_m3hr.
      const normalizedCapacity = normalizeCapacityForSubmit(
        numOrUndef(values.rated_capacity) ?? null,
        values.capacity_unit || null,
        numOrUndef(values.specific_gravity) ?? null
      );

      const payload = {
        model,
        report_format: "viscosity-chart" as const,
        po_no: values.po_no || undefined,
        ec_no: values.ec_no || undefined,
        pump_serial_no: values.pump_serial_no || undefined,
        gearbox_no: values.gearbox_no || undefined,
        gearbox_ratio: values.gearbox_ratio || undefined,
        motor: values.motor || undefined,
        motor_rpm: numOrUndef(values.motor_rpm),
        test_type: values.test_type,
        npsha_status: values.npsha_status,
        capacity_unit: normalizedCapacity.unit ?? undefined,
        head_unit: normalizedHead.unit ?? undefined,
        liquid: values.liquid || undefined,
        rated_capacity: normalizedCapacity.capacity ?? undefined,
        rated_head: normalizedHead.head ?? undefined,
        specific_gravity: numOrUndef(values.specific_gravity),
        viscosity_cps: numOrUndef(values.viscosity_cps),
        k_for_given_cps: numOrUndef(values.k_for_given_cps),
        rated_rpm: numOrUndef(values.rated_rpm),
        q_theoretical_100rev: numOrUndef(values.q_theoretical_100rev),
        calculated_head: numOrUndef(values.calculated_head),
        rated_power_kw: numOrUndef(values.rated_power_kw),
        reference_voltage: numOrUndef(values.reference_voltage),
        reference_current: numOrUndef(values.reference_current),
        vnotch_baseline: numOrUndef(values.vnotch_baseline),
        tested_by: values.tested_by || undefined,
        test_date: values.test_date || undefined,
        vibration_sound_db: numOrUndef(values.vibration_sound_db),
        vibration_x_mm_sec: numOrUndef(values.vibration_x_mm_sec),
        vibration_y_mm_sec: numOrUndef(values.vibration_y_mm_sec),
        vibration_z_mm_sec: numOrUndef(values.vibration_z_mm_sec),
        pump_started_at: values.pump_started_at || undefined,
        pump_stopped_at: values.pump_stopped_at || undefined,
        total_run: computeTotalRun(values.pump_started_at, values.pump_stopped_at) || undefined,
        ambient_temp_c: numOrUndef(values.ambient_temp_c),
        max_bearing_temp_c: numOrUndef(values.max_bearing_temp_c),
        total_rise_c: computeTotalRise(values.ambient_temp_c, values.max_bearing_temp_c) ?? undefined,
        witness: values.witness || undefined,
        inspector: values.inspector || undefined,
        recorder: values.recorder || undefined,
        remarks: values.remarks || undefined,
        points,
      };

      const report = existingReport
        ? await updateReport(existingReport.id, payload)
        : await submitReport({ requisitionId, ...payload });
      if (!existingReport) clearReportDraft(scopeId);
      onSubmitted(report);
    } catch {
      setSubmitError("Could not submit test report. Please try again.");
    }
  };

  return (
    <div className="test-report-page">
      <PageHeader icon="🧪" title={heading} subtitle={subheading} />

      {submitError && <div className="form-error-banner">{submitError}</div>}
      {autofillNotice && <div className="form-info-banner">{autofillNotice}</div>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="form-grid">
          {lockedModel ? (
            <div className="field">
              <label>Model No.</label>
              <input value={lockedModel} disabled />
            </div>
          ) : (
            <div className="field">
              <label>Model No. *</label>
              {(() => {
                const modelReg = register("model", { required: true });
                return (
                  <input
                    {...modelReg}
                    onChange={(e) => {
                      normalizeModelOnChange(e);
                      modelReg.onChange(e);
                    }}
                    onBlur={(e) => {
                      modelReg.onBlur(e);
                      handleModelBlur();
                    }}
                    placeholder="e.g. RMOH1115"
                  />
                );
              })()}
              {errors.model && <span className="field-error">Model is required</span>}
            </div>
          )}

          <div className="field">
            <label>PO No.</label>
            <input {...register("po_no")} />
          </div>
          <div className="field">
            <label>EC No.</label>
            <input {...register("ec_no")} />
          </div>
          <div className="field">
            <label>Pump S.No.</label>
            <input {...register("pump_serial_no")} />
          </div>
          <div className="field">
            <label>Gearbox No.</label>
            <input {...register("gearbox_no")} />
          </div>
          <div className="field">
            <label>Gearbox Ratio</label>
            <input {...register("gearbox_ratio")} placeholder="e.g. 10:1" />
          </div>
          <div className="field">
            <label>Motor</label>
            <input {...register("motor")} placeholder="e.g. CGL 3HP" />
          </div>
          <div className="field">
            <label>Motor RPM</label>
            <select {...register("motor_rpm")}>
              <option value="">Select</option>
              {MOTOR_RPM_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Type of Testing</label>
            <select {...register("test_type")}>
              {TEST_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>NPSHa</label>
            <select {...register("npsha_status")}>
              {NPSHA_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Liquid</label>
            <input {...register("liquid")} />
          </div>

          <div className="field">
            <label>Rated Capacity</label>
            <div className="value-unit-group">
              <input type="number" step="any" {...register("rated_capacity")} />
              <select {...register("capacity_unit")}>
                {VISCOSITY_CAPACITY_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Rated Head</label>
            <div className="value-unit-group">
              <input type="number" step="any" {...register("rated_head")} />
              <select {...register("head_unit")}>
                {VISCOSITY_HEAD_UNITS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Specific Gravity</label>
            <input type="number" step="any" {...register("specific_gravity")} />
          </div>
          <div className="field">
            <label>Viscosity (CPS)</label>
            <input type="number" step="any" {...register("viscosity_cps")} />
          </div>
          <div className="field">
            <label>K for Given CPS</label>
            <input type="number" step="any" {...register("k_for_given_cps")} />
          </div>
          <div className="field">
            <label>Rated RPM</label>
            <input type="number" step="any" {...register("rated_rpm")} />
          </div>
          <div className="field">
            <label>Q Theoretical / 100 Rev</label>
            <input type="number" step="any" {...register("q_theoretical_100rev")} />
          </div>
          <div className="field">
            <label>Calculated Head (MWC)</label>
            <input type="number" step="any" {...register("calculated_head")} />
          </div>
          <div className="field">
            <label>Rated Power (KW)</label>
            <input type="number" step="any" {...register("rated_power_kw")} />
          </div>

          <div className="field">
            <label>Reference Voltage (Vin)</label>
            <input type="number" step="any" {...register("reference_voltage")} />
          </div>
          <div className="field">
            <label>Reference Current (Iin)</label>
            <input type="number" step="any" {...register("reference_current")} />
          </div>
          <div className="field">
            <label>
              V-Notch Baseline (Hin) {!existingReport && testType === "V-notch" && <span className="required-hint">fixed at 320</span>}
            </label>
            <input type="number" step="any" readOnly={!existingReport} {...register("vnotch_baseline")} />
          </div>

          <div className="field">
            <label>Tested By</label>
            <input {...register("tested_by")} />
          </div>
          <div className="field">
            <label>Test Date</label>
            <input type="date" {...register("test_date")} />
          </div>
        </div>

        <h2 className="points-heading">
          Test Points — Capacity via {testType || "..."}
        </h2>
        <div className="points-table-wrapper">
          <table className="points-table">
            <thead>
              <tr>
                <th>RPM</th>
                <th className={requirementStatus.head === false ? "requirement-col-not-met" : ""}>
                  Head (KG/CM2)
                  {requirementStatus.head === false && (
                    <span className="requirement-flag" title="Testing did not reach the rated head">
                      ⚠
                    </span>
                  )}
                </th>
                {testType === "V-notch" && (
                  <>
                    <th>Height Over V-Notch (mm)</th>
                    <th>Initial Reading (mm){!existingReport && " (fixed at 320)"}</th>
                  </>
                )}
                {testType === "Barrel" && <th>Time to Fill 5L (sec)</th>}
                {testType === "Flow Meter" && (
                  <th className={requirementStatus.capacity === false ? "requirement-col-not-met" : ""}>
                    Capacity (M3/Hr)
                    {requirementStatus.capacity === false && (
                      <span className="requirement-flag" title="Testing did not reach the rated capacity">
                        ⚠
                      </span>
                    )}
                  </th>
                )}
                <th>Volts</th>
                <th>Amps</th>
                <th>Cos Phi</th>
                {testType !== "Flow Meter" && (
                  <th className={`computed-col ${requirementStatus.capacity === false ? "requirement-col-not-met" : ""}`}
                    title="As per IS 1520:1977 (V-notch) / bucket-fill (Barrel)"
                  >
                    Capacity (M3/Hr)
                    {requirementStatus.capacity === false && (
                      <span className="requirement-flag" title="Testing did not reach the rated capacity">
                        ⚠
                      </span>
                    )}
                  </th>
                )}
                <th className={`computed-col ${requirementStatus.power === false ? "requirement-col-not-met" : ""}`}
                  title="√3 x Volts x Amps x Cos Phi / 1000"
                >
                  Power (KW)
                  {requirementStatus.power === false && (
                    <span className="requirement-flag" title="Measured power exceeded the rated power">
                      ⚠
                    </span>
                  )}
                </th>
                <th className="computed-col" title="Capacity (M3/Hr) x Head (MWC) / 367">
                  Theoretical Power (KW)
                </th>
                <th className="computed-col" title="Measured Capacity / ((RPM / 100) x Q Theoretical/100 Rev) x 100">
                  VE % (Water)
                </th>
                <th className="computed-col" title="Theoretical Power / Measured Power x 100">
                  ME % (Water)
                </th>
                <th className="computed-col" title="Q Theoretical/100 Rev x RPM / 100">
                  Theo. Capacity at Measured RPM (M3/Hr)
                </th>
                <th className="computed-col" title="Theoretical Capacity at Measured RPM − Measured Capacity">
                  Slip of Water (M3/Hr)
                </th>
                <th className="computed-col" title="K x Slip of Water">
                  Slip Viscous (M3/Hr)
                </th>
                <th className="computed-col" title="Rated RPM x Q Theoretical/100 Rev / 100">
                  Theo. Capacity at Rated RPM (M3/Hr)
                </th>
                <th className="computed-col" title="Theoretical Capacity at Rated RPM − Slip for Viscous Fluid">
                  Capacity for Liquid at Rated RPM (M3/Hr)
                </th>
                <th className="computed-col" title="Capacity for Liquid at Rated RPM (M3/Hr) x 1000">
                  Capacity for Liquid at Rated RPM (LPH)
                </th>
                <th className="computed-col" title="Capacity for Liquid at Rated RPM / ((RPM / 100) x Q Theoretical/100 Rev) x 100">
                  VE % (Liquid)
                </th>
                <th className="computed-col" title="(Capacity for Liquid at Rated RPM x Head (MWC) / 367) / Measured Power x 100">
                  ME % (Liquid)
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => {
                const computed = computedRows[index];
                return (
                  <tr key={field.id}>
                    <td><input type="number" step="any" {...register(`points.${index}.rpm`)} /></td>
                    <td className={requirementStatus.head === false ? "requirement-cell-not-met" : ""}>
                      <input type="number" step="any" {...register(`points.${index}.head_kgcm2`)} />
                    </td>
                    {testType === "V-notch" && (
                      <>
                        <td><input type="number" step="any" {...register(`points.${index}.height_over_vnotch`)} /></td>
                        <td>
                          <input
                            type="number"
                            step="any"
                            readOnly={!existingReport && testType === "V-notch"}
                            {...register(`points.${index}.initial_reading`)}
                          />
                        </td>
                      </>
                    )}
                    {testType === "Barrel" && (
                      <td><input type="number" step="any" {...register(`points.${index}.time_taken_to_fill_bucket_sec`)} /></td>
                    )}
                    {testType === "Flow Meter" && (
                      <td className={requirementStatus.capacity === false ? "requirement-cell-not-met" : ""}>
                        <input type="number" step="any" {...register(`points.${index}.capacity_direct`)} />
                      </td>
                    )}
                    <td><input type="number" step="any" {...register(`points.${index}.volts`)} /></td>
                    <td><input type="number" step="any" {...register(`points.${index}.amps`)} /></td>
                    <td><input type="number" step="any" {...register(`points.${index}.cos_phi`)} /></td>
                    {testType !== "Flow Meter" && (
                      <td className={`computed-cell ${requirementStatus.capacity === false ? "requirement-cell-not-met" : ""}`}>
                        {fmt(computed?.capacityCalculatedM3hr ?? null)}
                      </td>
                    )}
                    <td className={`computed-cell ${requirementStatus.power === false ? "requirement-cell-not-met" : ""}`}>
                      {fmt(computed?.powerCalculatedKw ?? null)}
                    </td>
                    <td className="computed-cell">{fmt(computed?.theoreticalPowerKw ?? null)}</td>
                    <td
                      className={`computed-cell ${veMeAcceptance && computed?.volumetricEfficiency != null && computed.volumetricEfficiency < veMeAcceptance.ve ? "requirement-cell-not-met" : ""}`}
                      title={veMeAcceptance && computed?.volumetricEfficiency != null && computed.volumetricEfficiency < veMeAcceptance.ve ? `Below the ${lockedModel ?? watchedModel} acceptance criteria of ${veMeAcceptance.ve}%` : undefined}
                    >
                      {fmt(computed?.volumetricEfficiency ?? null)}
                    </td>
                    <td
                      className={`computed-cell ${veMeAcceptance && computed?.mechanicalEfficiency != null && computed.mechanicalEfficiency < veMeAcceptance.me ? "requirement-cell-not-met" : ""}`}
                      title={veMeAcceptance && computed?.mechanicalEfficiency != null && computed.mechanicalEfficiency < veMeAcceptance.me ? `Below the ${lockedModel ?? watchedModel} acceptance criteria of ${veMeAcceptance.me}%` : undefined}
                    >
                      {fmt(computed?.mechanicalEfficiency ?? null)}
                    </td>
                    <td className="computed-cell">{fmt(computed?.theoreticalCapacityAtMeasuredRpm ?? null)}</td>
                    <td className="computed-cell">{fmt(computed?.slipWater ?? null)}</td>
                    <td className="computed-cell">{fmt(computed?.slipViscous ?? null)}</td>
                    <td className="computed-cell">{fmt(computed?.theoreticalCapacityAtRatedRpm ?? null)}</td>
                    <td className="computed-cell">{fmt(computed?.capacityLiquidAtRatedRpmM3hr ?? null)}</td>
                    <td className="computed-cell">{fmt(computed?.capacityLiquidAtRatedRpmLph ?? null)}</td>
                    <td className="computed-cell">{fmt(computed?.volumetricEfficiencyLiquid ?? null)}</td>
                    <td className="computed-cell">{fmt(computed?.mechanicalEfficiencyLiquid ?? null)}</td>
                    <td>
                      <button
                        type="button"
                        className="remove-point-btn"
                        onClick={() => remove(index)}
                        disabled={fields.length === 1}
                      >
                        &times;
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="add-point-btn" onClick={() => append(emptyPoint)}>
          + Add Test Point
        </button>

        <h2 className="points-heading">Vibration Test &amp; Run Summary</h2>
        <div className="form-grid">
          <div className="field">
            <label>Vibration — Sound (Db)</label>
            <input type="number" step="any" {...register("vibration_sound_db")} />
          </div>
          <div className="field">
            <label>Vibration — X (mm/sec)</label>
            <input type="number" step="any" {...register("vibration_x_mm_sec")} />
          </div>
          <div className="field">
            <label>Vibration — Y (mm/sec)</label>
            <input type="number" step="any" {...register("vibration_y_mm_sec")} />
          </div>
          <div className="field">
            <label>Vibration — Z (mm/sec)</label>
            <input type="number" step="any" {...register("vibration_z_mm_sec")} />
          </div>

          <div className="field">
            <label>Pump Started At</label>
            <input type="time" {...register("pump_started_at")} />
          </div>
          <div className="field">
            <label>Pump Stopped At</label>
            <input type="time" {...register("pump_stopped_at")} />
          </div>
          <div className="field">
            <label>Total Run</label>
            <div className="computed-cell computed-field">{totalRun || "-"}</div>
          </div>

          <div className="field">
            <label>Ambient Temp (°C)</label>
            <input type="number" step="any" {...register("ambient_temp_c")} />
          </div>
          <div className="field">
            <label>Max. Bearing Temp (°C)</label>
            <input type="number" step="any" {...register("max_bearing_temp_c")} />
          </div>
          <div className="field">
            <label>Total Rise (°C)</label>
            <div className="computed-cell computed-field">{totalRise ?? "-"}</div>
          </div>
        </div>

        <h2 className="points-heading">Witness, Inspector &amp; Recorder</h2>
        <div className="form-grid">
          <div className="field">
            <label>Witness</label>
            <input {...register("witness")} />
          </div>
          <div className="field">
            <label>Inspector</label>
            <input {...register("inspector")} />
          </div>
          <div className="field">
            <label>Recorder</label>
            <input {...register("recorder")} />
          </div>
        </div>

        <h2 className="points-heading">Remarks</h2>
        <div className="form-grid">
          <div className="field field-full">
            <label>Remarks</label>
            <textarea rows={3} {...register("remarks")} placeholder="Any additional observations or comments" />
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ViscosityChartForm;
