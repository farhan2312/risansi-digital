import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { loadSparesReport } from "@/lib/spares-report";
import { parseSparesReportFilter } from "@/lib/spares-report-filter";
import { SparesReportView } from "@/components/risansi/spares-report-view";

export const metadata: Metadata = {
  title: "Reports | Risansi",
};

export const dynamic = "force-dynamic";

/** Admin's Spares report: work done in a period, and where every Spare SO stands. */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/risansi/dashboard");

  const params = await searchParams;
  const report = await loadSparesReport(parseSparesReportFilter((key) => params[key]));
  return <SparesReportView report={report} />;
}
