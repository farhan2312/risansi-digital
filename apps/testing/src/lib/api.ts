/**
 * Shared helpers for the route handlers — JSON responses and snake_case row
 * serializers (matches the old function_app.py `_row_to_dict` convention the
 * frontend was already built against).
 */
import { NextResponse } from "next/server";

import type * as schema from "./db/schema";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400): NextResponse {
  return json({ error: message }, status);
}

type RequisitionRow = typeof schema.testRequisitions.$inferSelect;
type ReportRow = typeof schema.pumpTestReports.$inferSelect;
type PointRow = typeof schema.pumpTestReportPoints.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;
type AttachmentRow = typeof schema.requisitionAttachments.$inferSelect;
type BugReportRow = typeof schema.bugReports.$inferSelect;
type ActionRegistryRow = typeof schema.actionRegistry.$inferSelect;
type CalendarEventRow = typeof schema.calendarEvents.$inferSelect;

/** Mirrors sales-portal-next's _user_to_dict(): raw snake_case columns, minus password_hash. */
export function userToDict(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    reviewed_by: u.reviewedBy,
    reviewed_at: u.reviewedAt,
    created_at: u.createdAt,
    must_change_password: u.mustChangePassword,
  };
}

export function requisitionToDict(r: RequisitionRow) {
  return {
    id: r.id,
    requisition_no: r.requisitionNo,
    model: r.model,
    category: r.category,
    ec_quotation_no: r.ecQuotationNo,
    offer_date: r.offerDate,
    responsible_person: r.responsiblePerson,
    source_team: r.sourceTeam,
    date_of_requisition: r.dateOfRequisition,
    test_qty: r.testQty,
    qth: r.qth,
    specific_gravity: r.specificGravity,
    power_hp: r.powerHp,
    power_kw: r.powerKw,
    head_kgcm2: r.headKgcm2,
    head_unit: r.headUnit,
    rpm: r.rpm,
    motor_rpm: r.motorRpm,
    req_capacity: r.reqCapacity,
    req_capacity_unit: r.reqCapacityUnit,
    media_type: r.mediaType,
    target_date: r.targetDate,
    observation: r.observation,
    ra_value: r.raValue,
    ve_rated_head: r.veRatedHead,
    me_rated_head: r.meRatedHead,
    measured_capacity: r.measuredCapacity,
    measured_head: r.measuredHead,
    measured_power: r.measuredPower,
    noise_jamming_other: r.noiseJammingOther,
    action: r.action,
    npsha: r.npsha,
    test_result: r.testResult,
    testing_plan_date: r.testingPlanDate,
    date_of_testing: r.dateOfTesting,
    retest_without_changing_die_pin: r.retestWithoutChangingDiePin,
    retest_needed: r.retestNeeded,
    die_pin_rework: r.diePinRework,
    status: r.status,
    general_remarks: r.generalRemarks,
    action_remarks: r.actionRemarks,
    created_by: r.createdBy,
    submitted_by: r.submittedBy,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    closed_at: r.closedAt,
  };
}

export function reportToDict(r: ReportRow) {
  return {
    id: r.id,
    requisition_id: r.requisitionId,
    report_no: r.reportNo,
    model: r.model,
    gearbox_no: r.gearboxNo,
    gearbox_ratio: r.gearboxRatio,
    motor: r.motor,
    motor_rpm: r.motorRpm,
    suction_type: r.suctionType,
    liquid: r.liquid,
    rated_capacity: r.ratedCapacity,
    rated_head: r.ratedHead,
    specific_gravity: r.specificGravity,
    viscosity_cps: r.viscosityCps,
    k_for_given_cps: r.kForGivenCps,
    rated_rpm: r.ratedRpm,
    q_theoretical_100rev: r.qTheoretical100rev,
    calculated_head: r.calculatedHead,
    rated_power_kw: r.ratedPowerKw,
    test_type: r.testType,
    npsha_status: r.npshaStatus,
    capacity_unit: r.capacityUnit,
    head_unit: r.headUnit,
    reference_voltage: r.referenceVoltage,
    reference_current: r.referenceCurrent,
    vnotch_baseline: r.vnotchBaseline,
    tested_by: r.testedBy,
    test_date: r.testDate,
    created_at: r.createdAt,
    report_format: r.reportFormat,
    po_no: r.poNo,
    ec_no: r.ecNo,
    rev_no: r.revNo,
    rev_date: r.revDate,
    pump_serial_no: r.pumpSerialNo,
    vibration_sound_db: r.vibrationSoundDb,
    vibration_x_mm_sec: r.vibrationXMmSec,
    vibration_y_mm_sec: r.vibrationYMmSec,
    vibration_z_mm_sec: r.vibrationZMmSec,
    pump_started_at: r.pumpStartedAt,
    pump_stopped_at: r.pumpStoppedAt,
    total_run: r.totalRun,
    ambient_temp_c: r.ambientTempC,
    max_bearing_temp_c: r.maxBearingTempC,
    total_rise_c: r.totalRiseC,
    witness: r.witness,
    inspector: r.inspector,
    recorder: r.recorder,
    remarks: r.remarks,
    prepared_by: r.preparedBy,
  };
}

export function pointToDict(p: PointRow) {
  return {
    id: p.id,
    report_id: p.reportId,
    rpm: p.rpm,
    head_kgcm2: p.headKgcm2,
    head_mwc: p.headMwc,
    vnotch_height: p.vnotchHeight,
    initial_reading: p.initialReading,
    differential_height: p.differentialHeight,
    capacity_calculated_m3hr: p.capacityCalculatedM3hr,
    volts: p.volts,
    amps: p.amps,
    cos_phi: p.cosPhi,
    power_calculated_kw: p.powerCalculatedKw,
    theoretical_power_kw: p.theoreticalPowerKw,
    mechanical_efficiency: p.mechanicalEfficiency,
    theoretical_capacity_at_measured_rpm: p.theoreticalCapacityAtMeasuredRpm,
    slip_water: p.slipWater,
    slip_viscous: p.slipViscous,
    theoretical_capacity_at_rated_rpm: p.theoreticalCapacityAtRatedRpm,
    capacity_liquid_at_rated_rpm_m3hr: p.capacityLiquidAtRatedRpmM3hr,
    capacity_liquid_at_rated_rpm_lph: p.capacityLiquidAtRatedRpmLph,
    height_taken_for_filling: p.heightTakenForFilling,
    time_taken_to_fill_bucket_sec: p.timeTakenToFillBucketSec,
    volumetric_efficiency: p.volumetricEfficiency,
    volumetric_efficiency_liquid: p.volumetricEfficiencyLiquid,
    mechanical_efficiency_liquid: p.mechanicalEfficiencyLiquid,
  };
}

/** Metadata only -- deliberately omits fileData, which only ever travels
 * through the dedicated download route, never the JSON list/detail APIs.
 * Takes just the fields it serializes (not the full AttachmentRow) so a
 * `select({...})` that leaves fileData out of the query entirely -- rather
 * than fetching and discarding the blob -- still satisfies the type. */
export function attachmentToDict(a: Omit<AttachmentRow, "fileData">) {
  return {
    id: a.id,
    requisition_id: a.requisitionId,
    file_name: a.fileName,
    mime_type: a.mimeType,
    file_size: a.fileSize,
    uploaded_by: a.uploadedBy,
    uploaded_by_name: a.uploadedByName,
    created_at: a.createdAt,
  };
}

/** Metadata only -- deliberately omits screenshotData, same reasoning as
 * attachmentToDict above (the blob only ever travels through its own
 * dedicated route). */
export function bugReportToDict(b: Omit<BugReportRow, "screenshotData">) {
  return {
    id: b.id,
    type: b.type,
    title: b.title,
    description: b.description,
    severity: b.severity,
    page: b.page,
    status: b.status,
    screenshot_file_name: b.screenshotFileName,
    screenshot_mime_type: b.screenshotMimeType,
    screenshot_file_size: b.screenshotFileSize,
    has_screenshot: b.screenshotFileName !== null,
    reported_by: b.reportedBy,
    reported_by_name: b.reportedByName,
    created_at: b.createdAt,
    is_read: b.isRead,
  };
}

export function actionRegistryToDict(a: ActionRegistryRow) {
  return {
    id: a.id,
    requisition_id: a.requisitionId,
    report_id: a.reportId,
    model: a.model,
    report_no: a.reportNo,
    unmet_fields: a.unmetFields,
    rated_head: a.ratedHead,
    measured_head: a.measuredHead,
    rated_capacity: a.ratedCapacity,
    measured_capacity: a.measuredCapacity,
    rated_power_kw: a.ratedPowerKw,
    measured_power_kw: a.measuredPowerKw,
    action_points: a.actionPoints ? a.actionPoints.split("\n").filter((s) => s.trim() !== "") : [],
    assigned_by: a.assignedBy,
    assigned_by_name: a.assignedByName,
    originally_raised_by: a.originallyRaisedBy,
    created_at: a.createdAt,
  };
}

export function calendarEventToDict(e: CalendarEventRow) {
  return {
    id: e.id,
    title: e.title,
    model: e.model,
    ec_quotation_no: e.ecQuotationNo,
    requisition_no: e.requisitionNo,
    event_type: e.eventType,
    responsible_person: e.responsiblePerson,
    status: e.status,
    event_date: e.eventDate,
    start_time: e.startTime,
    end_time: e.endTime,
    notes: e.notes,
    created_by: e.createdBy,
    created_by_name: e.createdByName,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}
