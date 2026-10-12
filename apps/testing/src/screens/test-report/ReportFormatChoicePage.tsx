"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReportFormatChoice from "@/components/test-report/ReportFormatChoice";
import { getRequisition } from "@/services/testingService";
import type { TestRequisition } from "@/types/testing";

const ReportFormatChoicePage = () => {
  const { id } = useParams<{ id: string }>();
  const [requisition, setRequisition] = useState<TestRequisition | null>(null);

  useEffect(() => {
    if (!id) return;
    getRequisition(id).then(setRequisition).catch(() => {});
  }, [id]);

  return (
    <ReportFormatChoice
      heading={`Test Report — ${requisition?.model ?? "..."}`}
      subheading="Choose which physical form this test was recorded on. Submitting either will close this requisition."
      observationHref={`/requisitions/${id}/report/observation`}
      viscosityChartHref={`/requisitions/${id}/report/viscosity-chart`}
      backHref={`/requisitions/${id}`}
      backLabel="Back to requisition"
    />
  );
};

export default ReportFormatChoicePage;
