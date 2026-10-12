"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import "../report-detail/ReportDetailPage.css";
import { getReport } from "@/services/testingService";
import { formatDate, reportExportFileName } from "@/lib/formUtils";
import PerformanceCurve from "@/components/report-detail/PerformanceCurve";
import { SkeletonPage } from "@/components/ui/Skeleton";
import PageHeader, { pageHeaderButton } from "@/components/ui/PageHeader";
import type { PumpTestReport } from "@/types/testing";

const FORMAT_LABELS: Record<string, string> = {
  observation: "Observation Sheet",
  "viscosity-chart": "Viscosity Correction Chart",
};

/** The three performance curves for one test, on their own page so they can
 * be opened (and printed) per testing rather than only inline on the report. */
const ReportCurvePage = () => {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<PumpTestReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    getReport(id).then(setReport).catch(() => setError("Could not load report."));
  }, [id]);

  // See ReportDetailPage's identical effect -- browsers use document.title
  // as the default "Save as PDF" filename.
  useEffect(() => {
    if (!report) return;
    const previousTitle = document.title;
    document.title = reportExportFileName(report, "Curve");
    return () => {
      document.title = previousTitle;
    };
  }, [report]);

  if (error) return <div className="form-error-banner">{error}</div>;
  if (!report) return <SkeletonPage />;

  return (
    <div className="report-detail-page">
      <div className="print-header">
        <img src="/logo.png" alt="Risansi Industries" />
        <div>
          <strong>Risansi Industries Ltd</strong>
          <span>
            Performance Curve — {report.model}
            {report.report_no ? ` — ${report.report_no}` : ""}
          </span>
        </div>
      </div>

      <PageHeader
        icon="📈"
        title={
          <>
            {report.model}
            {report.report_no && <span className="report-no-pill">{report.report_no}</span>}
          </>
        }
        subtitle={`${FORMAT_LABELS[report.report_format ?? ""] ?? "Observation Sheet"} — ${formatDate(report.test_date ?? report.created_at)}`}
        actions={
          <>
            <button type="button" className={pageHeaderButton("primary")} onClick={() => window.print()}>
              🖨️ Export PDF
            </button>
            <Link href={`/reports/${report.report_no ?? report.id}`} className={pageHeaderButton("secondary")}>
              View full report
            </Link>
            <Link href="/reports" className={pageHeaderButton("secondary")}>
              &larr; Back to archive
            </Link>
          </>
        }
      />

      <section className="detail-card">
        <h2>Performance Curves</h2>
        {report.points.length >= 2 ? (
          <PerformanceCurve points={report.points} />
        ) : (
          <p className="detail-empty">
            This report has fewer than two test points, so there is nothing to plot.
          </p>
        )}
      </section>
    </div>
  );
};

export default ReportCurvePage;
