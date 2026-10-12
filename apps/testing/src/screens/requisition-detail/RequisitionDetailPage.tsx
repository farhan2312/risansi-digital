"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import "./RequisitionDetailPage.css";
import "@/components/ui/AttachmentsField.css";
import { headToKgcm2 } from "@/lib/unitConversion";
import { formatDate, formatFileSize, formatNumber, installedPowerLabel, motorWithKw, targetDateFor } from "@/lib/formUtils";
import {
  computeRequirementStatus,
  ratedPowerKwFromRequisition,
  unmetRequirementLabels,
} from "@/lib/requirementCheck";
import { dedupCheck, getRequisition, openAttachment, updateRequisition } from "@/services/testingService";
import { useAuth } from "@/contexts/AuthContext";
import { SkeletonPage } from "@/components/ui/Skeleton";
import PageHeader, { pageHeaderButton } from "@/components/ui/PageHeader";
import { ecQuotationLabel } from "@/types/testing";
import type { DedupCheckResult, PumpTestReport, TestRequisition } from "@/types/testing";

/** Short "did this report meet its rated targets" label for a list row --
 * empty string when there's nothing to flag (still valid either way, this
 * is informational only). */
const reportUnmetTitle = (r: PumpTestReport): string => {
  const labels = unmetRequirementLabels(computeRequirementStatus(r, r.points));
  return labels.length ? `Outside rated ${labels.join(", ")}` : "";
};

const RequisitionDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const canProcessTesting = currentUser?.role !== "source";

  const [requisition, setRequisition] = useState<TestRequisition | null>(null);
  const [dedup, setDedup] = useState<DedupCheckResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    if (!id) return;
    setIsLoading(true);
    setError("");
    try {
      const req = await getRequisition(id);
      setRequisition(req);
      const dedupResult = await dedupCheck(req.model);
      dedupResult.priorReports = dedupResult.priorReports.filter((r) => r.requisition_id !== id);
      setDedup(dedupResult);
    } catch {
      setError("Could not load testing summary.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const markRetest = async (retestNeeded: boolean) => {
    if (!id) return;
    setIsSaving(true);
    try {
      const updated = await updateRequisition(id, {
        retest_needed: retestNeeded,
        status: retestNeeded ? "Retest Needed" : "In Testing",
      });
      setRequisition(updated);
    } catch {
      setError("Could not update testing summary.");
    } finally {
      setIsSaving(false);
    }
  };

  const startTesting = async () => {
    if (!id) return;
    setIsSaving(true);
    try {
      const updated = await updateRequisition(id, { status: "In Testing" });
      setRequisition(updated);
    } catch {
      setError("Could not update testing summary.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <SkeletonPage />;
  if (error) return <div className="form-error-banner">{error}</div>;
  if (!requisition) return <p className="detail-empty">Testing summary not found.</p>;

  const hasPriorReports = (dedup?.priorReports.length ?? 0) > 0;
  const submittedReport = requisition.reports?.[0];
  const hasObservation =
    requisition.reports?.some((r) => (r.report_format ?? "observation") === "observation") ?? false;
  const hasViscosityChart = requisition.reports?.some((r) => r.report_format === "viscosity-chart") ?? false;
  const canEditRequisition = currentUser?.role === "source" && requisition.created_by === currentUser.id;
  const headConvertedKgcm2 = headToKgcm2(requisition.head_kgcm2, requisition.head_unit, requisition.specific_gravity);
  // Source team enters Power in HP; this section always shows it in KW.
  // Same helper the report's Rated Power autofill uses: an explicitly stored
  // power_kw wins (older rows hold real motor ratings like 5.5 / 15 / 75 kW,
  // which beat an approximated HP x 0.746), otherwise it converts the HP.
  const powerKw = ratedPowerKwFromRequisition(requisition);

  return (
    <div className="requisition-detail-page">
      <PageHeader
        icon="📋"
        title={requisition.model}
        subtitle={
          requisition.status === "Closed" && submittedReport ? (
            <Link href={`/reports/${submittedReport.report_no ?? submittedReport.id}`} className="status-pill status-view-report">
              View Report
            </Link>
          ) : (
            <span className={`status-pill status-${requisition.status.replace(/\s+/g, "-").toLowerCase()}`}>
              {requisition.status}
            </span>
          )
        }
        actions={
          <>
            {canEditRequisition && (
              <Link
                href={`/requisitions/${requisition.requisition_no ?? requisition.id}/edit`}
                className={pageHeaderButton("secondary")}
              >
                ✏️ Edit
              </Link>
            )}
            <Link href="/dashboard" className={pageHeaderButton("secondary")}>
              &larr; Back to testing summaries
            </Link>
          </>
        }
      />

      <section className="detail-card">
        <h2>Testing Summary Details</h2>
        <div className="detail-grid">
          <div>
            <span className="label">Category</span>
            <span>{requisition.category ?? "-"}</span>
          </div>
          <div>
            <span className="label">{ecQuotationLabel(requisition.category)}</span>
            <span>{requisition.ec_quotation_no ?? "-"}</span>
          </div>
          <div>
            <span className="label">Offer Date</span>
            <span>{formatDate(requisition.offer_date)}</span>
          </div>
          <div>
            <span className="label">Responsible Person</span>
            <span>{requisition.responsible_person ?? "-"}</span>
          </div>
          <div>
            <span className="label">Source Team</span>
            <span>{requisition.source_team ?? "-"}</span>
          </div>
          <div>
            <span className="label">Date of Requisition</span>
            <span>{formatDate(requisition.date_of_requisition)}</span>
          </div>
          <div>
            <span className="label">Target Date</span>
            <span>
              {(() => {
                const target = targetDateFor(requisition);
                if (!target) return "-";
                return (
                  <>
                    {formatDate(target.date)}
                    {target.isAuto && <span className="target-date-auto-hint"> (auto)</span>}
                  </>
                );
              })()}
            </span>
          </div>
          <div>
            <span className="label">Test Qty</span>
            <span>{requisition.test_qty ?? "-"}</span>
          </div>
          <div>
            <span className="label">Specific Gravity</span>
            <span>{formatNumber(requisition.specific_gravity)}</span>
          </div>
          <div>
            <span className="label">Power (KW)</span>
            <span>{powerKw !== undefined ? formatNumber(powerKw) : "-"}</span>
          </div>
          <div>
            <span className="label">Head</span>
            <span>
              {formatNumber(requisition.head_kgcm2)} {requisition.head_unit ?? ""}
              {headConvertedKgcm2 !== null && ` (= ${formatNumber(headConvertedKgcm2)} KG/CM2)`}
            </span>
          </div>
          <div>
            <span className="label">RPM</span>
            <span>{formatNumber(requisition.rpm)}</span>
          </div>
          <div>
            <span className="label">Motor RPM</span>
            <span>{formatNumber(requisition.motor_rpm)}</span>
          </div>
          <div>
            <span className="label">Submitted By</span>
            <span>{requisition.submitted_by ?? "-"}</span>
          </div>
          {requisition.category === "Against R&D Trials" && (
            <>
              <div>
                <span className="label">Media Type</span>
                <span>{requisition.media_type ?? "-"}</span>
              </div>
              <div>
                <span className="label">Open Remarks</span>
                <span>{requisition.general_remarks ?? "-"}</span>
              </div>
            </>
          )}
        </div>
      </section>

      {(requisition.attachments?.length ?? 0) > 0 && (
        <section className="detail-card">
          <h2>Attachments</h2>
          <ul className="attachment-list">
            {requisition.attachments!.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="attachment-open-btn"
                  onClick={() => openAttachment(requisition.id, a.id)}
                >
                  {a.file_name}
                </button>
                <span className="attachment-meta">
                  {formatFileSize(a.file_size)}
                  {a.uploaded_by_name && ` · ${a.uploaded_by_name}`}
                  {` · ${formatDate(a.created_at)}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="detail-card">
        <h2>Prior Test Reports for &quot;{requisition.model}&quot;</h2>
        {!hasPriorReports ? (
          <p className="dedup-note">No prior test report found for this model. Proceed with testing.</p>
        ) : (
          <>
            <p className="dedup-note">
              This model has been tested before. Confirm with the source team
              (verbally) whether a retest is actually needed, then record the
              decision below.
            </p>
            <table className="prior-reports-table">
              <thead>
                <tr>
                  <th>Report Date</th>
                  <th>Gearbox No.</th>
                  <th>Motor</th>
                  <th>Installed Power</th>
                  <th>Rated Head</th>
                  <th>Rated Capacity</th>
                  <th>Rated RPM</th>
                  <th>Test Points</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {dedup!.priorReports.map((r) => {
                  const unmetTitle = reportUnmetTitle(r);
                  return (
                    <tr key={r.id} className={unmetTitle ? "requirement-row-not-met" : ""} title={unmetTitle || undefined}>
                      <td>
                        {formatDate(r.test_date ?? r.created_at)}
                        {unmetTitle && <span className="requirement-flag">⚠</span>}
                      </td>
                      <td>{r.gearbox_no ?? "-"}</td>
                      <td>{r.motor ?? "-"}</td>
                      <td>{installedPowerLabel(r.motor)}</td>
                      <td>{formatNumber(r.rated_head)}</td>
                      <td>{formatNumber(r.rated_capacity)}</td>
                      <td>{formatNumber(r.rated_rpm)}</td>
                      <td>{r.points.length}</td>
                      <td>
                        <Link href={`/reports/${r.report_no ?? r.id}`}>View Report</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        {requisition.status === "Pending" && canProcessTesting && (
          <div className="retest-actions">
            {hasPriorReports ? (
              <>
                <button disabled={isSaving} onClick={() => markRetest(true)}>
                  Retest Needed: Yes
                </button>
                <button disabled={isSaving} className="secondary" onClick={() => markRetest(false)}>
                  Retest Needed: No
                </button>
              </>
            ) : (
              <button disabled={isSaving} onClick={startTesting}>
                Start Testing
              </button>
            )}
          </div>
        )}
      </section>

      {(requisition.status === "In Testing" || requisition.status === "Retest Needed") && canProcessTesting && (
        <section className="detail-card">
          <h2>Test Report</h2>
          <p className="dedup-note">
            Once physical testing is complete, submit the test report below.
            This will close the testing summary.
          </p>
          <button onClick={() => router.push(`/requisitions/${requisition.requisition_no ?? requisition.id}/report`)}>
            Fill Test Report
          </button>
        </section>
      )}

      {requisition.status === "Closed" && (
        <section className="detail-card">
          <h2>Test Report</h2>
          <p className="dedup-note">
            This testing summary is closed.
            {submittedReport && (
              <>
                {" "}
                <Link href={`/reports/${submittedReport.report_no ?? submittedReport.id}`}>View the full report &rarr;</Link>
              </>
            )}
          </p>

          {(!hasObservation || !hasViscosityChart) && canProcessTesting && (
            <>
              <p className="dedup-note">
                This pump is still missing its {!hasObservation ? "Observation Sheet" : "Viscosity Correction Chart"}
                {" "}— submit it below so both reports exist for this pump.
              </p>
              <div className="retest-actions">
                {!hasObservation && (
                  <button onClick={() => router.push(`/requisitions/${requisition.requisition_no ?? requisition.id}/report/observation`)}>
                    + Fill Observation Sheet
                  </button>
                )}
                {!hasViscosityChart && (
                  <button onClick={() => router.push(`/requisitions/${requisition.requisition_no ?? requisition.id}/report/viscosity-chart`)}>
                    + Fill Viscosity Correction Chart
                  </button>
                )}
              </div>
            </>
          )}

          {requisition.reports?.map((r) => {
            const unmetTitle = reportUnmetTitle(r);
            return (
            <table key={r.id} className="prior-reports-table">
              <tbody>
                <tr className={unmetTitle ? "requirement-row-not-met" : ""} title={unmetTitle || undefined}>
                  <td className="label">
                    <Link href={`/reports/${r.report_no ?? r.id}`}>
                      {(r.report_format ?? "observation") === "viscosity-chart"
                        ? "Viscosity Correction Chart"
                        : "Observation Sheet"}
                    </Link>
                    {unmetTitle && <span className="requirement-flag">⚠</span>}
                  </td>
                  <td colSpan={3}>{r.report_no ?? "-"}</td>
                </tr>
                <tr>
                  <td className="label">Gearbox No.</td>
                  <td>{r.gearbox_no ?? "-"}</td>
                  <td className="label">Motor</td>
                  <td>{motorWithKw(r.motor)}</td>
                </tr>
                <tr>
                  <td className="label">Rated Head</td>
                  <td>{formatNumber(r.rated_head)}</td>
                  <td className="label">Rated RPM</td>
                  <td>{formatNumber(r.rated_rpm)}</td>
                </tr>
                <tr>
                  <td className="label">Test Points</td>
                  <td colSpan={3}>{r.points.length}</td>
                </tr>
              </tbody>
            </table>
            );
          })}
        </section>
      )}
    </div>
  );
};

export default RequisitionDetailPage;
