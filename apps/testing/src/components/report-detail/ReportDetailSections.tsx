"use client";

import Link from "next/link";
import PerformanceCurve from "./PerformanceCurve";
import { computeRequirementStatus, unmetRequirementLabels } from "@/lib/requirementCheck";
import { veMeAcceptanceFor } from "@/lib/veMeAcceptance";
import type { PumpTestReport, PumpTestReportPoint } from "@/types/testing";
import { formatDate, formatNumber, installedPowerLabel } from "@/lib/formUtils";

const fmt = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "-" : v);
// Same as `fmt`, but for genuinely-numeric fields -- caps the display at 3
// decimal places instead of passing a raw "22.380000"-style DB value through.
const fmtNum = (v: number | string | null | undefined) => formatNumber(v);

export interface PointRowDef {
  label: string;
  unit?: string;
  field: keyof PumpTestReportPoint;
  /** Shown as a hover tooltip on the row label -- matches the "Formulae"
   * column the original Excel workbook prints next to a computed row. */
  formula?: string;
}

export const POINT_ROWS: PointRowDef[] = [
  { label: "Measured Data at RPM", unit: "RPM", field: "rpm" },
  { label: "Measured Data at Head", unit: "kg/cm2", field: "head_kgcm2" },
  {
    label: "Measured Data at Head",
    unit: "MWC",
    field: "head_mwc",
    formula: "1 kg/cm2 = 10 MWC",
  },
  { label: "Height Taken for Filling", unit: "mm", field: "height_taken_for_filling" },
  { label: "Height Over V-Notch", unit: "mm", field: "vnotch_height" },
  { label: "Time to Fill 5L Bucket", unit: "sec", field: "time_taken_to_fill_bucket_sec" },
  { label: "Initial Reading", unit: "mm", field: "initial_reading" },
  {
    label: "Differential Height",
    unit: "mm",
    field: "differential_height",
    formula: "Height Over V-Notch − Initial Reading",
  },
  {
    label: "Capacity Calculated",
    unit: "M3/Hr",
    field: "capacity_calculated_m3hr",
    formula: "As per IS 1520:1977 (V-notch) / bucket-fill (Barrel) / direct reading (Flow Meter)",
  },
  { label: "Volts Measured", unit: "V", field: "volts" },
  { label: "Amperes Measured", unit: "A", field: "amps" },
  { label: "Cos Phi", field: "cos_phi" },
  {
    label: "Power Calculated",
    unit: "Kw",
    field: "power_calculated_kw",
    formula: "√3 x Volts x Amps x Cos Phi / 1000",
  },
  {
    label: "Theoretical Power Calculated",
    unit: "Kw",
    field: "theoretical_power_kw",
    formula: "Capacity (M3/Hr) x Head (MWC) / 367",
  },
  {
    label: "Volumetric Efficiency (VE)",
    unit: "%",
    field: "volumetric_efficiency",
    formula: "Measured Capacity / ((RPM / 100) x Q Theoretical/100 Rev) x 100",
  },
  {
    label: "Mechanical Efficiency (ME)",
    unit: "%",
    field: "mechanical_efficiency",
    formula: "Theoretical Power / Measured Power x 100",
  },
  {
    label: "Theoretical Capacity at Measured RPM",
    unit: "M3/Hr",
    field: "theoretical_capacity_at_measured_rpm",
    formula: "Q Theoretical/100 Rev x RPM / 100",
  },
  {
    label: "Slip of Water",
    unit: "M3/Hr",
    field: "slip_water",
    formula: "Theoretical Capacity at Measured RPM − Measured Capacity",
  },
  {
    label: "Slip for Viscous Fluid",
    unit: "M3/Hr",
    field: "slip_viscous",
    formula: "Slip for Viscous Fluid = K x Slip of Water",
  },
  {
    label: "Theoretical Capacity at Rated RPM",
    unit: "M3/Hr",
    field: "theoretical_capacity_at_rated_rpm",
    formula: "Rated RPM x Q Theoretical/100 Rev / 100",
  },
  {
    label: "Capacity for Liquid at Rated RPM",
    unit: "M3/Hr",
    field: "capacity_liquid_at_rated_rpm_m3hr",
    formula: "Theoretical Capacity at Rated RPM − Slip for Viscous Fluid",
  },
  {
    label: "Capacity for Liquid at Rated RPM",
    unit: "LPH",
    field: "capacity_liquid_at_rated_rpm_lph",
    formula: "Capacity for Liquid at Rated RPM (M3/Hr) x 1000",
  },
  {
    label: "Volumetric Efficiency for Liquid",
    unit: "%",
    field: "volumetric_efficiency_liquid",
    formula: "Capacity for Liquid at Rated RPM / ((RPM / 100) x Q Theoretical/100 Rev) x 100",
  },
  {
    label: "Mechanical Efficiency for Liquid",
    unit: "%",
    field: "mechanical_efficiency_liquid",
    formula: "(Capacity for Liquid at Rated RPM x Head (MWC) / 367) / Measured Power x 100",
  },
];

/**
 * Every parameter for one report -- Given Data, Test Data, Vibration & Run
 * Summary, Witness/Remarks. Shared between ReportDetailPage (single report)
 * and the per-pump dashboard (every report for that pump, stacked).
 */
const ReportDetailSections = ({ report }: { report: PumpTestReport }) => {
  const points = [...report.points].sort(
    (a, b) => (a.head_kgcm2 ?? 0) - (b.head_kgcm2 ?? 0) || (a.rpm ?? 0) - (b.rpm ?? 0)
  );
  const activeRows = POINT_ROWS.filter((row) =>
    points.some((p) => p[row.field] !== null && p[row.field] !== undefined)
  );

  const hasVibrationSummary = [
    report.vibration_sound_db, report.vibration_x_mm_sec, report.vibration_y_mm_sec,
    report.vibration_z_mm_sec, report.pump_started_at, report.pump_stopped_at, report.total_run,
    report.ambient_temp_c, report.max_bearing_temp_c, report.total_rise_c,
  ].some((v) => v !== null && v !== undefined && v !== "");

  // Did testing actually satisfy the rated requirements? Still a valid report
  // either way -- this is a flag, not a validation error. Head/Capacity fail
  // by falling short of the rating, Power by going over it.
  const requirementStatus = computeRequirementStatus(report, report.points);
  const unmetLabels = unmetRequirementLabels(requirementStatus);

  // VE/ME acceptance is a flat per-model threshold (the testing team's own table), checked per test
  // point -- unlike Head/Capacity/Power above, which judge the report as a whole against one rated
  // value. Only the specific point that falls short turns red, never the whole row or report.
  const veMeAcceptance = veMeAcceptanceFor(report.model);

  return (
    <>
      {unmetLabels.length > 0 && (
        <div className="requirement-not-met-banner">
          ⚠ This report is outside the rated requirement for: {unmetLabels.join(", ")}.
          {requirementStatus.power === false && " Measured power exceeded the rated power."}
        </div>
      )}

      <section className="detail-card">
        <h2>Given Data</h2>
        <div className="sheet-table-wrapper">
        <table className="sheet-table header-sheet-table">
          <tbody>
            <tr>
              <th>PO No.</th>
              <td>{fmt(report.po_no)}</td>
              <th>EC No.</th>
              <td>{fmt(report.ec_no)}</td>
              <th>Pump S.No.</th>
              <td>{fmt(report.pump_serial_no)}</td>
            </tr>
            <tr>
              <th>Gear Box No.</th>
              <td>{fmt(report.gearbox_no)}</td>
              <th>Gearbox Ratio</th>
              <td>{fmt(report.gearbox_ratio)}</td>
              <th>Installed Power (KW)</th>
              <td>{installedPowerLabel(report.motor)}</td>
            </tr>
            <tr>
              <th>Motor</th>
              <td>{fmt(report.motor)}</td>
              <th>Motor RPM</th>
              <td>{fmtNum(report.motor_rpm)}</td>
              <th>Test Date</th>
              <td>{formatDate(report.test_date ?? report.created_at)}</td>
            </tr>
            <tr>
              <th>Capacity Method</th>
              <td className="highlight">{fmt(report.test_type)}</td>
              <th>NPSHa</th>
              <td className="highlight">{fmt(report.npsha_status)}</td>
              <th>Tested By</th>
              <td>{fmt(report.tested_by)}</td>
            </tr>
            <tr>
              <th>Capacity Unit</th>
              <td className="highlight">{fmt(report.capacity_unit)}</td>
              <th>Head Unit</th>
              <td className="highlight">{fmt(report.head_unit)}</td>
              <th>Liquid</th>
              <td className="highlight">{fmt(report.liquid)}</td>
            </tr>
            <tr>
              <th>Rated Capacity</th>
              <td className={`highlight ${requirementStatus.capacity === false ? "requirement-cell-not-met" : ""}`}>
                {fmtNum(report.rated_capacity)}
              </td>
              <th>Rated Head</th>
              <td className={`highlight ${requirementStatus.head === false ? "requirement-cell-not-met" : ""}`}>
                {fmtNum(report.rated_head)}
              </td>
              <th>Rated RPM</th>
              <td className="highlight">{fmtNum(report.rated_rpm)}</td>
            </tr>
            <tr>
              <th>Rated Power (KW)</th>
              <td className={`highlight ${requirementStatus.power === false ? "requirement-cell-not-met" : ""}`}>
                {fmtNum(report.rated_power_kw)}
              </td>
              <th></th>
              <td></td>
              <th></th>
              <td></td>
            </tr>
            <tr>
              <th>Specific Gravity</th>
              <td className="highlight">{fmtNum(report.specific_gravity)}</td>
              <th>Viscosity (CPS)</th>
              <td className="highlight">{fmtNum(report.viscosity_cps)}</td>
              <th title="Used in: Slip for Viscous Fluid = K x Slip of Water">
                K for Given CPS<span className="formula-flag">ƒ</span>
              </th>
              <td className="highlight">{fmtNum(report.k_for_given_cps)}</td>
            </tr>
            <tr>
              <th>Q Theoretical / 100 Rev</th>
              <td className="highlight">{fmtNum(report.q_theoretical_100rev)}</td>
              <th title="Calculated Head (MWC) = Head (MLC) x Specific Gravity">
                Calculated Head<span className="formula-flag">ƒ</span>
              </th>
              <td className="highlight">{fmtNum(report.calculated_head)}</td>
              <th>Suction</th>
              <td>{fmt(report.suction_type)}</td>
            </tr>
            <tr>
              <th>Reference Voltage (Vin)</th>
              <td className="highlight">{fmtNum(report.reference_voltage)}</td>
              <th>Reference Current (Iin)</th>
              <td className="highlight">{fmtNum(report.reference_current)}</td>
              <th>V-Notch Baseline (Hin)</th>
              <td className="highlight">{fmtNum(report.vnotch_baseline)}</td>
            </tr>
            <tr>
              <th>Linked Testing Summary</th>
              <td colSpan={5}>
                {report.requisition_id ? (
                  <Link href={`/requisitions/${report.requisition_no ?? report.requisition_id}`}>
                    {report.requisition_no ?? report.requisition_id.slice(0, 8)}
                  </Link>
                ) : (
                  "Historical (imported)"
                )}
              </td>
            </tr>
            {report.prepared_by && (
              <tr>
                <th>Prepared By</th>
                <td colSpan={5}>{report.prepared_by}</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </section>

      <section className="detail-card">
        <h2>Test Data ({points.length} points)</h2>
        <div className="sheet-table-wrapper">
          <table className="sheet-table points-sheet-table">
            <thead>
              <tr>
                <th className="row-label-col">Parameter</th>
                <th className="row-unit-col">Unit</th>
                {points.map((p, i) => (
                  <th key={p.id ?? i}>Pt. {i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeRows.map((row) => {
                const rowNotMet =
                  (row.field === "head_kgcm2" && requirementStatus.head === false) ||
                  (row.field === "capacity_calculated_m3hr" && requirementStatus.capacity === false) ||
                  (row.field === "power_calculated_kw" && requirementStatus.power === false);
                const rowNotMetTitle =
                  row.field === "power_calculated_kw"
                    ? "Measured power exceeded the rated power"
                    : "Testing did not reach this rated value";

                // VE/ME: per-point, against this model's own acceptance threshold -- a row can be a
                // mix of met and missed points, so each cell is judged on its own.
                const veMeThreshold =
                  veMeAcceptance && row.field === "volumetric_efficiency"
                    ? veMeAcceptance.ve
                    : veMeAcceptance && row.field === "mechanical_efficiency"
                      ? veMeAcceptance.me
                      : null;

                return (
                  <tr key={`${row.label}-${row.unit ?? ""}`}>
                    <td className="row-label-col" title={row.formula}>
                      {row.label}
                      {row.formula && <span className="formula-flag">ƒ</span>}
                      {rowNotMet && (
                        <span className="requirement-flag" title={rowNotMetTitle}>
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="row-unit-col">{row.unit ?? ""}</td>
                    {points.map((p, i) => {
                      const value = p[row.field];
                      const belowThreshold = veMeThreshold !== null && typeof value === "number" && value < veMeThreshold;
                      const cellNotMet = rowNotMet || belowThreshold;
                      return (
                        <td
                          key={p.id ?? i}
                          className={cellNotMet ? "requirement-cell-not-met" : "highlight"}
                          title={belowThreshold ? `Below the ${report.model} acceptance criteria of ${veMeThreshold}%` : undefined}
                        >
                          {fmtNum(value)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Renders itself away when the points can't form a curve. */}
      {points.length >= 2 && (
        <section className="detail-card">
          <h2>Performance Curve</h2>
          <PerformanceCurve points={points} />
        </section>
      )}

      {hasVibrationSummary && (
        <section className="detail-card">
          <h2>Vibration Test &amp; Run Summary</h2>
          <div className="sheet-table-wrapper">
          <table className="sheet-table header-sheet-table">
            <tbody>
              <tr>
                <th>Vibration — Sound</th>
                <td>{fmtNum(report.vibration_sound_db)} Db</td>
                <th>X</th>
                <td>{fmtNum(report.vibration_x_mm_sec)} mm/sec</td>
              </tr>
              <tr>
                <th>Y</th>
                <td>{fmtNum(report.vibration_y_mm_sec)} mm/sec</td>
                <th>Z</th>
                <td>{fmtNum(report.vibration_z_mm_sec)} mm/sec</td>
              </tr>
              <tr>
                <th>Pump Started At</th>
                <td>{fmt(report.pump_started_at)}</td>
                <th>Pump Stopped At</th>
                <td>{fmt(report.pump_stopped_at)}</td>
              </tr>
              <tr>
                <th>Total Run</th>
                <td>{fmt(report.total_run)}</td>
                <th>Ambient Temp</th>
                <td>{fmtNum(report.ambient_temp_c)} °C</td>
              </tr>
              <tr>
                <th>Max. Bearing Temp</th>
                <td>{fmtNum(report.max_bearing_temp_c)} °C</td>
                <th>Total Rise</th>
                <td>{fmtNum(report.total_rise_c)} °C</td>
              </tr>
            </tbody>
          </table>
          </div>
        </section>
      )}

      <section className="detail-card">
        <h2>Witness, Inspection &amp; Remarks</h2>
        <div className="sheet-table-wrapper">
        <table className="sheet-table header-sheet-table sign-off-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Name</th>
              <th>Signature</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Witness</th>
              <td>{fmt(report.witness)}</td>
              <td className="signature-line"></td>
            </tr>
            <tr>
              <th>Inspector</th>
              <td>{fmt(report.inspector)}</td>
              <td className="signature-line"></td>
            </tr>
            <tr>
              <th>Recorder</th>
              <td>{fmt(report.recorder)}</td>
              <td className="signature-line"></td>
            </tr>
          </tbody>
        </table>
        </div>
        <div className={report.remarks ? "remarks-box" : "remarks-box remarks-box-blank"}>
          {report.remarks ? (
            <p className="remarks-text">{report.remarks}</p>
          ) : (
            <span className="remarks-placeholder">Remarks</span>
          )}
        </div>
      </section>
    </>
  );
};

export default ReportDetailSections;
