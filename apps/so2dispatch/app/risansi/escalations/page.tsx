import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canSeeEscalations } from "@/lib/roles";
import { listPaymentHoldsPage } from "@/lib/orders";
import { parsePage } from "@/lib/pagination";
import { UrlPagination } from "@/components/risansi/url-table";

export const metadata: Metadata = {
  title: "Payment Holds | Risansi",
};

export const dynamic = "force-dynamic";

const numberFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function formatValue(value: string | null): string {
  if (value === null || value.trim() === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? numberFmt.format(n) : value;
}

export default async function EscalationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canSeeEscalations(user.role)) redirect("/risansi/dashboard");

  const params = await searchParams;
  const result = await listPaymentHoldsPage(parsePage(params.page));
  const holds = result.rows;

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500 text-white">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Payment Holds
          </h1>
          <p className="text-sm text-muted">
            Orders escalated by Accounts because payment is not confirmed —{" "}
            {result.total} {result.total === 1 ? "order" : "orders"}.
          </p>
        </div>
      </div>

      {result.total === 0 ? (
        <div className="rounded-xl border border-card-border bg-surface px-6 py-16 text-center shadow-sm">
          <p className="text-sm font-medium text-foreground">
            No payment holds
          </p>
          <p className="mt-1 text-sm text-muted">
            Orders put on Hold by Accounts will appear here for review.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border bg-surface shadow-sm">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Sl.</th>
                <th className="px-4 py-3">SO No.</th>
                <th className="px-4 py-3">Client Name</th>
                <th className="px-4 py-3">Hold Reason</th>
                <th className="px-4 py-3 text-right">Order Value</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {holds.map((hold) => (
                <tr key={hold.id} className="text-foreground">
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {hold.sl_no}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {hold.so_no ?? "—"}
                  </td>
                  <td className="px-4 py-3">{hold.client_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">
                    {hold.hold_reason ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatValue(hold.order_value)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link
                      href={`/risansi/orders/${hold.id}`}
                      className="text-sm font-medium text-primary hover:text-primary-hover"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <UrlPagination
            page={result.page}
            totalPages={result.totalPages}
            from={result.from}
            to={result.to}
            total={result.total}
          />
        </div>
      )}
    </div>
  );
}
