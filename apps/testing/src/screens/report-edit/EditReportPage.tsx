"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import "./EditReportPage.css";
import { getReport } from "@/services/testingService";
import { isWithinReportEditWindow, REPORT_EDIT_WINDOW_DAYS } from "@/lib/reportEditWindow";
import TestReportForm from "@/components/test-report/TestReportForm";
import ViscosityChartForm from "@/components/test-report/ViscosityChartForm";
import { SkeletonPage } from "@/components/ui/Skeleton";
import type { PumpTestReport } from "@/types/testing";

const EditReportPage = () => {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<PumpTestReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    getReport(id).then(setReport).catch(() => setError("Could not load report."));
  }, [id]);

  if (error) return <div className="form-error-banner">{error}</div>;
  if (!report) return <SkeletonPage />;

  if (!isWithinReportEditWindow(report.created_at)) {
    return (
      <div className="edit-report-expired">
        <h1>Editing window closed</h1>
        <p>
          This report can only be edited within {REPORT_EDIT_WINDOW_DAYS} days of submission.
          That window has passed.
        </p>
        <Link href={`/reports/${id}`}>&larr; Back to report</Link>
      </div>
    );
  }

  const shared = {
    existingReport: report,
    heading: `Edit Test Report — ${report.report_no ?? report.model}`,
    subheading: "Changes are saved to the existing report — its report number and submission date stay the same.",
    submitLabel: "Save Changes",
    onSubmitted: () => router.push(`/reports/${id}`),
    onCancel: () => router.push(`/reports/${id}`),
  };

  return report.report_format === "viscosity-chart" ? (
    <ViscosityChartForm {...shared} />
  ) : (
    <TestReportForm {...shared} />
  );
};

export default EditReportPage;
