"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import "../dashboard/DashboardPage.css";
import "../report-detail/ReportDetailPage.css";
import "./PumpDashboardPage.css";
import { POINT_ROWS } from "@/components/report-detail/ReportDetailSections";
import { computeRequirementStatus, unmetRequirementLabels } from "@/lib/requirementCheck";
import { getPumpDashboard } from "@/services/testingService";
import { SkeletonPage } from "@/components/ui/Skeleton";
import PageHeader, { pageHeaderButton } from "@/components/ui/PageHeader";
import type { PumpDashboardData, PumpTestReport } from "@/types/testing";
import { formatDate, formatNumber, installedPowerLabel, motorWithKw } from "@/lib/formUtils";

const fmt = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "-" : v);

interface HeaderRowDef {
  label: string;
  field: keyof PumpTestReport;
  /** True for genuinely-numeric columns -- caps the display at 3 decimal
   * places instead of passing a raw "22.380000"-style DB value through.
   * Free-text/identifier fields (PO No., Motor, Witness, etc.) stay plain. */
  numeric?: boolean;
  /** For a row not backed by its own column -- derives the display value
   * from the report instead of a plain `r[field]` lookup. `field` still
   * has to name a real column (used only to decide whether this row has
   * anything to show for a given report). */
  derive?: (r: PumpTestReport) => string;
}

const HEADER_ROWS: HeaderRowDef[] = [
  { label: "PO No.", field: "po_no" },
  { label: "EC No.", field: "ec_no" },
  { label: "Pump S.No.", field: "pump_serial_no" },
  { label: "Gearbox No.", field: "gearbox_no" },
  { label: "Gearbox Ratio", field: "gearbox_ratio" },
  { label: "Motor", field: "motor" },
  // Installed motor power -- the source team only ever enters this as free
  // text embedded in Motor ("CGL 30HP"), so it's derived, never its own
  // column. Always shown in KW, never the raw HP (see installedPowerLabel).
  { label: "Installed Power (KW)", field: "motor", derive: (r) => installedPowerLabel(r.motor) },
  { label: "Motor RPM", field: "motor_rpm", numeric: true },
  { label: "Capacity Method", field: "test_type" },
  { label: "NPSHa", field: "npsha_status" },
  { label: "Tested By", field: "tested_by" },
  { label: "Capacity Unit", field: "capacity_unit" },
  { label: "Head Unit", field: "head_unit" },
  { label: "Liquid", field: "liquid" },
  { label: "Rated Capacity", field: "rated_capacity", numeric: true },
  { label: "Rated Head", field: "rated_head", numeric: true },
  { label: "Rated RPM", field: "rated_rpm", numeric: true },
  { label: "Specific Gravity", field: "specific_gravity", numeric: true },
  { label: "Viscosity (CPS)", field: "viscosity_cps", numeric: true },
  { label: "K for Given CPS", field: "k_for_given_cps", numeric: true },
  { label: "Q Theoretical / 100 Rev", field: "q_theoretical_100rev", numeric: true },
  { label: "Calculated Head", field: "calculated_head", numeric: true },
  { label: "Suction", field: "suction_type" },
  { label: "Reference Voltage (Vin)", field: "reference_voltage", numeric: true },
  { label: "Reference Current (Iin)", field: "reference_current", numeric: true },
  { label: "V-Notch Baseline (Hin)", field: "vnotch_baseline", numeric: true },
  { label: "Vibration — Sound (Db)", field: "vibration_sound_db", numeric: true },
  { label: "Vibration — X (mm/sec)", field: "vibration_x_mm_sec", numeric: true },
  { label: "Vibration — Y (mm/sec)", field: "vibration_y_mm_sec", numeric: true },
  { label: "Vibration — Z (mm/sec)", field: "vibration_z_mm_sec", numeric: true },
  { label: "Pump Started At", field: "pump_started_at" },
  { label: "Pump Stopped At", field: "pump_stopped_at" },
  { label: "Total Run", field: "total_run" },
  { label: "Ambient Temp (°C)", field: "ambient_temp_c", numeric: true },
  { label: "Max. Bearing Temp (°C)", field: "max_bearing_temp_c", numeric: true },
  { label: "Total Rise (°C)", field: "total_rise_c", numeric: true },
  { label: "Witness", field: "witness" },
  { label: "Inspector", field: "inspector" },
  { label: "Recorder", field: "recorder" },
  { label: "Remarks", field: "remarks" },
];

const reportDate = (r: PumpTestReport) => r.test_date ?? r.created_at.slice(0, 10);

const PumpDashboardPage = () => {
  const { model } = useParams<{ model: string }>();
  const [data, setData] = useState<PumpDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    setIsLoading(true);
    setError("");

    getPumpDashboard(decodeURIComponent(model))
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this pump's dashboard.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [model]);

  if (isLoading) return <SkeletonPage cards={3} />;
  if (error) return <div className="dashboard-error">{error}</div>;
  if (!data) return null;

  // Every report is a column (sorted chronologically) -- header/vibration
  // fields are one value per report, so each parameter's history over time
  // reads left to right, oldest to newest. No report identity (report_no,
  // links) is shown -- just the date each value came from.
  const sortedReports = [...data.reports].sort(
    (a, b) => reportDate(a).localeCompare(reportDate(b)) || a.created_at.localeCompare(b.created_at)
  );
  const activeHeaderRows = HEADER_ROWS.filter((row) =>
    sortedReports.some((r) => r[row.field] !== null && r[row.field] !== undefined && r[row.field] !== "")
  );

  // Did each report actually reach its rated head/capacity/power? Still a
  // valid report either way (informational only) -- flags its whole column.
  const unmetTitleByReportId = new Map(
    sortedReports.map((r) => {
      const labels = unmetRequirementLabels(computeRequirementStatus(r, r.points));
      return [r.id, labels.length ? `Outside rated ${labels.join(", ")}` : ""];
    })
  );

  // Every individual test point across every report is its own column, in
  // the same chronological order -- points recorded on the same date (same
  // report) simply repeat that date.
  const sortedPoints = sortedReports.flatMap((r) => r.points.map((p) => ({ report: r, point: p })));
  const activePointRows = POINT_ROWS.filter((row) =>
    sortedPoints.some(({ point }) => point[row.field] !== null && point[row.field] !== undefined)
  );

  const hasObservation = data.reports.some((r) => (r.report_format ?? "observation") === "observation");
  const hasViscosityChart = data.reports.some((r) => r.report_format === "viscosity-chart");
  const latestTestDate = sortedReports.length ? reportDate(sortedReports[sortedReports.length - 1]) : "-";

  return (
    <div className="pump-dashboard-page">
      <PageHeader
        icon="⚙️"
        title={data.model}
        subtitle="Every requisition and report for this pump, aligned over time."
        actions={
          <Link href="/pumps" className={pageHeaderButton("secondary")}>
            &larr; Back to Report Compilation
          </Link>
        }
      />

      <div className="pump-summary-stats">
        <div className="pump-summary-stat">
          <span className="stat-value">{data.requisitions.length}</span>
          <span className="stat-label">Requisitions</span>
        </div>
        <div className="pump-summary-stat">
          <span className="stat-value">{data.reports.length}</span>
          <span className="stat-label">Test Reports</span>
        </div>
        <div className="pump-summary-stat">
          <span className="stat-value">{hasObservation ? "Yes" : "No"}</span>
          <span className="stat-label">Observation Sheet</span>
        </div>
        <div className="pump-summary-stat">
          <span className="stat-value">{hasViscosityChart ? "Yes" : "No"}</span>
          <span className="stat-label">Viscosity Chart</span>
        </div>
        <div className="pump-summary-stat">
          <span className="stat-value">{formatDate(latestTestDate)}</span>
          <span className="stat-label">Latest Test Date</span>
        </div>
      </div>

      <section className="dashboard-section">
        <h2>Requisitions ({data.requisitions.length})</h2>
        {data.requisitions.length === 0 ? (
          <p className="dashboard-empty">No requisitions raised for this pump.</p>
        ) : (
          <table className="requisition-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>EC/Quotation No.</th>
                <th>RES.</th>
                <th>Source Team</th>
                <th>Date of Requisition</th>
                <th>Submitted By</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.requisitions.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/requisitions/${r.requisition_no ?? r.id}`}>{r.category ?? "-"}</Link>
                  </td>
                  <td>{r.ec_quotation_no ?? "-"}</td>
                  <td>{r.responsible_person ?? "-"}</td>
                  <td>{r.source_team ?? "-"}</td>
                  <td>{formatDate(r.date_of_requisition)}</td>
                  <td>{r.submitted_by ?? "-"}</td>
                  <td>
                    <span className={`status-pill status-${r.status.replace(/\s+/g, "-").toLowerCase()}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="dashboard-section">
        <h2>Test Reports ({sortedReports.length})</h2>
        {sortedReports.length === 0 ? (
          <p className="dashboard-empty">No test reports for this pump.</p>
        ) : (
          <table className="requisition-table">
            <thead>
              <tr>
                <th>Report No.</th>
                <th>Test Date</th>
                <th>Format</th>
                <th>Motor</th>
                <th>Test Points</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...sortedReports].reverse().map((r) => {
                const unmetTitle = unmetTitleByReportId.get(r.id);
                return (
                  <tr key={r.id}>
                    <td>{r.report_no ?? "-"}</td>
                    <td>{formatDate(reportDate(r))}</td>
                    <td>
                      {(r.report_format ?? "observation") === "viscosity-chart"
                        ? "Viscosity Correction Chart"
                        : "Observation Sheet"}
                    </td>
                    <td>{motorWithKw(r.motor)}</td>
                    <td>{r.points.length}</td>
                    <td>
                      <span className="status-actions">
                        <Link
                          href={`/reports/${r.report_no ?? r.id}`}
                          className={`status-pill ${unmetTitle ? "status-view-report-unmet" : "status-view-report"}`}
                          title={unmetTitle || undefined}
                        >
                          View Report{unmetTitle && " ⚠"}
                        </Link>
                        <Link href={`/reports/${r.report_no ?? r.id}/curve`} className="status-pill status-view-curve">
                          View Curve
                        </Link>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <div className="report-detail-page">
        <section className="detail-card">
          <h2>Header Parameters Over Time</h2>
          {sortedReports.length === 0 ? (
            <p className="dashboard-empty">No test reports for this pump.</p>
          ) : (
            <table className="sheet-table header-history-table">
              <thead>
                <tr>
                  <th className="row-label-col">Parameter</th>
                  {sortedReports.map((r) => {
                    const unmetTitle = unmetTitleByReportId.get(r.id);
                    return (
                      <th key={r.id} className={unmetTitle ? "requirement-col-not-met" : ""} title={unmetTitle || undefined}>
                        {formatDate(reportDate(r))}
                        {unmetTitle && <span className="requirement-flag">⚠</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {activeHeaderRows.map((row) => (
                  <tr key={row.label}>
                    <td className="row-label-col">{row.label}</td>
                    {sortedReports.map((r) => {
                      const unmetTitle = unmetTitleByReportId.get(r.id);
                      return (
                        <td key={r.id} className={unmetTitle ? "requirement-cell-not-met" : "highlight"} title={unmetTitle || undefined}>
                          {row.derive
                            ? row.derive(r)
                            : row.numeric
                              ? formatNumber(r[row.field] as string | number | null)
                              : fmt(r[row.field] as string | number | null)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="detail-card">
          <h2>Test Point Parameters Over Time ({sortedPoints.length} points)</h2>
          {sortedPoints.length === 0 ? (
            <p className="dashboard-empty">No test points recorded for this pump.</p>
          ) : (
            <div className="sheet-table-wrapper">
              <table className="sheet-table points-sheet-table">
                <thead>
                  <tr>
                    <th className="row-label-col">Parameter</th>
                    <th className="row-unit-col">Unit</th>
                    {sortedPoints.map(({ report, point }, i) => (
                      <th key={point.id ?? i}>{formatDate(reportDate(report))}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activePointRows.map((row) => (
                    <tr key={`${row.label}-${row.unit ?? ""}`}>
                      <td className="row-label-col">{row.label}</td>
                      <td className="row-unit-col">{row.unit ?? ""}</td>
                      {sortedPoints.map(({ point }, i) => (
                        <td key={point.id ?? i} className="highlight">
                          {formatNumber(point[row.field])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default PumpDashboardPage;
