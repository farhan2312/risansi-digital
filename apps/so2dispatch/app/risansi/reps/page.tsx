import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listReps } from "@/lib/reps";
import { RepsView } from "@/components/risansi/reps-view";

export const metadata: Metadata = {
  title: "Reps | Risansi",
};

export const dynamic = "force-dynamic";

/**
 * Reps and Rep Managers, and whose SOs each sees. Read-only: accounts and
 * roles are managed at Risansi Digital, teams in the sales portal. Admin only.
 */
export default async function RepsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/risansi/dashboard");

  const { accounts, unclaimed, teamsRead } = await listReps();
  return <RepsView accounts={accounts} unclaimed={unclaimed} teamsRead={teamsRead} />;
}
