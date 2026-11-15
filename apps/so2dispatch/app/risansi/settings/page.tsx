import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { isCentral } from "@/lib/roles";
import { getSetting, USD_INR_RATE } from "@/lib/settings";
import { query } from "@/lib/db";
import { UsdRateForm } from "@/components/risansi/usd-rate-form";
import { PageHeading } from "@/components/risansi/page-heading";

export const metadata: Metadata = {
  title: "USD to INR | Risansi",
};

export const dynamic = "force-dynamic";

/** Values the business sets once and the app uses everywhere. */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isCentral(user.role)) redirect("/risansi/dashboard");

  const [rate, pending] = await Promise.all([
    getSetting(USD_INR_RATE),
    // USD orders that have a value but no conversion yet — the ones the next
    // save of each will convert at this rate.
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM orders
        WHERE upper(COALESCE(order_currency, '')) = 'USD'
          AND order_value IS NOT NULL AND order_fx_rate IS NULL`
    ),
  ]);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <PageHeading
        icon={<Settings />}
        title="USD to INR"
        description="The conversion rate USD orders are valued in INR at."
      />

      <UsdRateForm
        rate={rate.value}
        updatedAt={rate.updated_at}
        updatedBy={rate.updated_by_name}
        unconverted={pending.rows[0]?.n ?? 0}
      />
    </div>
  );
}
