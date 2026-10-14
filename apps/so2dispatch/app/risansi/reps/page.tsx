import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listReps } from "@/lib/reps";
import { listOrderListOptions } from "@/lib/orders";
import { RepsView } from "@/components/risansi/reps-view";

export const metadata: Metadata = {
  title: "Reps | Risansi",
};

export const dynamic = "force-dynamic";

/**
 * Which account is which rep on the orders — the one piece of people data
 * this portal still keeps for itself (accounts are managed at Risansi
 * Digital). Admin only.
 */
export default async function RepsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/risansi/dashboard");

  const [{ accounts, unclaimed }, options] = await Promise.all([listReps(), listOrderListOptions()]);
  return <RepsView accounts={accounts} unclaimed={unclaimed} repNames={options.reps} />;
}
