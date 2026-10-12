/**
 * Carries the header fields shared between the two report formats
 * (Observation Sheet / Viscosity Correction Chart) across a format switch,
 * so a tester who fills one and then picks the other doesn't retype them.
 *
 * Session-scoped (sessionStorage): survives navigating between the choice
 * screen and either form in the same tab, cleared on successful submit and
 * when the browser tab closes. Keyed per requisition so unrelated reports
 * don't bleed into each other.
 */
import { ratedPowerKwFromRequisition } from "./requirementCheck";
import { normalizeHeadForSubmit } from "./unitConversion";

export interface SharedReportDraft {
  model?: string;
  po_no?: string;
  ec_no?: string;
  pump_serial_no?: string;
  gearbox_no?: string;
  gearbox_ratio?: string;
  motor?: string;
  motor_rpm?: string;
  test_type?: string;
  npsha_status?: string;
  liquid?: string;
  rated_capacity?: string;
  capacity_unit?: string;
  rated_head?: string;
  head_unit?: string;
  specific_gravity?: string;
  viscosity_cps?: string;
  k_for_given_cps?: string;
  rated_rpm?: string;
  q_theoretical_100rev?: string;
  calculated_head?: string;
  rated_power_kw?: string;
  reference_voltage?: string;
  reference_current?: string;
  vnotch_baseline?: string;
  tested_by?: string;
  test_date?: string;
  vibration_sound_db?: string;
  vibration_x_mm_sec?: string;
  vibration_y_mm_sec?: string;
  vibration_z_mm_sec?: string;
  pump_started_at?: string;
  pump_stopped_at?: string;
  ambient_temp_c?: string;
  max_bearing_temp_c?: string;
  witness?: string;
  inspector?: string;
  recorder?: string;
}

const draftKey = (scopeId: string) => `test-report-draft:${scopeId}`;

export function loadReportDraft(scopeId: string): SharedReportDraft {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(draftKey(scopeId));
    return raw ? (JSON.parse(raw) as SharedReportDraft) : {};
  } catch {
    return {};
  }
}

export function saveReportDraft(scopeId: string, draft: SharedReportDraft) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(draftKey(scopeId), JSON.stringify(draft));
  } catch {
    // sessionStorage unavailable (private mode etc.) — carrying values over is
    // a convenience, not a requirement, so fail silently.
  }
}

export function clearReportDraft(scopeId: string) {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(draftKey(scopeId));
}

/** Same shared fields, sourced from an already-submitted report (typically an
 * Observation Sheet) instead of sessionStorage — used to prefill the
 * Viscosity Correction Chart form for the same pump across sessions/days,
 * not just within one browser tab. */
export function draftFromReport(report: {
  model: string;
  po_no?: string | null;
  ec_no: string | null;
  pump_serial_no?: string | null;
  gearbox_no?: string | null;
  gearbox_ratio?: string | null;
  motor?: string | null;
  motor_rpm?: number | string | null;
  test_type: string | null;
  npsha_status?: string | null;
  liquid: string | null;
  rated_capacity: number | string | null;
  capacity_unit: string | null;
  rated_head: number | string | null;
  head_unit: string | null;
  specific_gravity: number | string | null;
  viscosity_cps: number | string | null;
  k_for_given_cps: number | string | null;
  rated_rpm: number | string | null;
  q_theoretical_100rev: number | string | null;
  calculated_head?: number | string | null;
  rated_power_kw?: number | string | null;
  reference_voltage?: number | string | null;
  reference_current?: number | string | null;
  vnotch_baseline?: number | string | null;
  tested_by: string | null;
  test_date: string | null;
  vibration_sound_db?: number | string | null;
  vibration_x_mm_sec?: number | string | null;
  vibration_y_mm_sec?: number | string | null;
  vibration_z_mm_sec?: number | string | null;
  pump_started_at?: string | null;
  pump_stopped_at?: string | null;
  ambient_temp_c?: number | string | null;
  max_bearing_temp_c?: number | string | null;
  witness?: string | null;
  inspector?: string | null;
  recorder?: string | null;
}): SharedReportDraft {
  const s = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
  return {
    model: report.model,
    po_no: s(report.po_no),
    ec_no: s(report.ec_no),
    pump_serial_no: s(report.pump_serial_no),
    gearbox_no: s(report.gearbox_no),
    gearbox_ratio: s(report.gearbox_ratio),
    motor: s(report.motor),
    motor_rpm: s(report.motor_rpm),
    test_type: s(report.test_type),
    npsha_status: s(report.npsha_status),
    liquid: s(report.liquid),
    rated_capacity: s(report.rated_capacity),
    capacity_unit: s(report.capacity_unit),
    rated_head: s(report.rated_head),
    head_unit: s(report.head_unit),
    specific_gravity: s(report.specific_gravity),
    viscosity_cps: s(report.viscosity_cps),
    k_for_given_cps: s(report.k_for_given_cps),
    rated_rpm: s(report.rated_rpm),
    q_theoretical_100rev: s(report.q_theoretical_100rev),
    calculated_head: s(report.calculated_head),
    rated_power_kw: s(report.rated_power_kw),
    reference_voltage: s(report.reference_voltage),
    reference_current: s(report.reference_current),
    vnotch_baseline: s(report.vnotch_baseline),
    tested_by: s(report.tested_by),
    test_date: s(report.test_date),
    vibration_sound_db: s(report.vibration_sound_db),
    vibration_x_mm_sec: s(report.vibration_x_mm_sec),
    vibration_y_mm_sec: s(report.vibration_y_mm_sec),
    vibration_z_mm_sec: s(report.vibration_z_mm_sec),
    pump_started_at: s(report.pump_started_at),
    pump_stopped_at: s(report.pump_stopped_at),
    ambient_temp_c: s(report.ambient_temp_c),
    max_bearing_temp_c: s(report.max_bearing_temp_c),
    witness: s(report.witness),
    inspector: s(report.inspector),
    recorder: s(report.recorder),
  };
}

/** Same shared fields, sourced from the linked requisition's own intake data
 * -- prefills a report the moment it's opened, even before any prior report
 * exists for this pump. Lower priority than an actual prior report (real
 * measured data beats what was merely requested at intake): callers should
 * apply this after any report-sourced draft, so it only fills the gaps. */
export function draftFromRequisition(requisition: {
  ec_quotation_no?: string | null;
  motor_rpm?: number | string | null;
  head_kgcm2?: number | string | null;
  head_unit?: string | null;
  req_capacity?: number | string | null;
  req_capacity_unit?: string | null;
  rpm?: number | string | null;
  specific_gravity?: number | string | null;
  power_hp?: number | string | null;
  power_kw?: number | string | null;
}): SharedReportDraft {
  const s = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
  const n = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

  // The requisition's Head is stored as whatever unit was picked at intake
  // (see head_unit) -- a report's Rated Head always means KG/CM2 (it's
  // compared directly against test points' measured head_kgcm2 for the
  // requirement-met check), so convert here rather than passing it through.
  const normalizedHead = normalizeHeadForSubmit(
    n(requisition.head_kgcm2),
    requisition.head_unit ?? null,
    n(requisition.specific_gravity)
  );

  return {
    ec_no: s(requisition.ec_quotation_no),
    motor_rpm: s(requisition.motor_rpm),
    rated_head: s(normalizedHead.head),
    head_unit: s(normalizedHead.unit),
    rated_capacity: s(requisition.req_capacity),
    capacity_unit: s(requisition.req_capacity_unit),
    rated_rpm: s(requisition.rpm),
    specific_gravity: s(requisition.specific_gravity),
    rated_power_kw: s(ratedPowerKwFromRequisition(requisition)),
  };
}
