import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Truck } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canSeeDispatched } from "@/lib/roles";
import { listDispatchRegister } from "@/lib/orders";

export const metadata: Metadata = {
  title: "Dispatched | Risansi",
};

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function StatusChip({ value }: { value: string | null }) {
  if (!value || value.trim() === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  const full = value.toLowerCase().includes("fully");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        full ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"
      }`}
    >
      {value}
    </span>
  );
}

export default async function DispatchedPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canSeeDispatched(user.role)) redirect("/risansi/dashboard");

  const rows = await listDispatchRegister();

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Truck className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Dispatched
          </h1>
          <p className="text-sm text-muted">
            Completed dispatches with LR &amp; invoice details —{" "}
            {rows.length} {rows.length === 1 ? "lot" : "lots"}.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-surface px-6 py-16 text-center shadow-sm">
          <p className="text-sm font-medium text-foreground">
            Nothing dispatched yet
          </p>
          <p className="mt-1 text-sm text-muted">
            Lots gain a dispatch date and LR in the order&apos;s Dispatch Lots
            section; they&apos;ll appear here once dispatched.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border bg-surface shadow-sm">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Sl.</th>
                <th className="px-4 py-3">SO / EC</th>
                <th className="px-4 py-3">Client Name</th>
                <th className="px-4 py-3">Lot No.</th>
                <th className="px-4 py-3">Dispatch Date</th>
                <th className="px-4 py-3">Invoice Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {rows.map((row, i) => (
                <tr key={`${row.id}-${i}`} className="text-foreground">
                  <td className="px-4 py-3 font-medium tabular-nums">{row.sl_no}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div>{row.so_no ?? "—"}</div>
                    <div className="text-xs text-muted">{row.ec_no ?? ""}</div>
                  </td>
                  <td className="px-4 py-3">{row.client_name ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{row.lot_no ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDate(row.lot_dispatch_date)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDate(row.invoice_date)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip value={row.dispatch_status} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link
                      href={`/risansi/orders/${row.id}`}
                      className="text-sm font-medium text-primary hover:text-primary-hover"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
