import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Download, FileSpreadsheet } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canAccessOrderMaking } from "@/lib/roles";
import { COLUMNS, loadOrderMakingReport, orderMakingReportLines, type Cell } from "@/lib/order-making-export";

export const metadata: Metadata = {
  title: "Order Making Report | Risansi",
};

export const dynamic = "force-dynamic";

function show(c: Cell): string {
  if (c == null) return "";
  if (c instanceof Date) return c.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  return String(c);
}

/** The Excel report on screen first, to look over before downloading it. */
export default async function OrderMakingReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessOrderMaking(user.role)) redirect("/risansi/dashboard");

  const params = await searchParams;
  const { rows, scope } = await loadOrderMakingReport(user, (key) => params[key]);
  const lines = orderMakingReportLines(rows);
  const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  const qs = query ? `?${query}` : "";
  const button =
    "inline-flex h-9 items-center gap-1.5 rounded-lg border border-input-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-background";

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white">
          <FileSpreadsheet className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Order Making report</h1>
          <p className="text-sm text-muted">
            {scope} · {lines.length} row{lines.length === 1 ? "" : "s"}, one per EC
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href={`/risansi/departments/order-making${qs}`} className={button}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <a href={`/risansi/departments/order-making/export${qs}`} className={`${button} border-transparent bg-primary text-primary-foreground hover:bg-primary-hover`}>
            <Download className="h-4 w-4" />
            Download Excel
          </a>
        </div>
      </div>

      <div className="overflow-auto rounded-xl border border-card-border bg-surface shadow-sm" style={{ maxHeight: "calc(100vh - 12rem)" }}>
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.header} className="whitespace-nowrap border-b border-card-border bg-[#1F3864] px-2.5 py-2 text-left font-semibold text-white">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map(({ cells, filled }, i) => (
              <tr key={i} className="border-b border-card-border/70 odd:bg-background/40 hover:bg-primary/[0.04]">
                {cells.map((c, j) =>
                  j === cells.length - 1 ? (
                    <td key={j} className={`whitespace-nowrap px-2.5 py-1.5 font-semibold ${filled ? "text-emerald-600" : "text-amber-600"}`}>
                      {show(c)}
                    </td>
                  ) : (
                    <td key={j} className={`px-2.5 py-1.5 text-foreground ${COLUMNS[j].width > 20 ? "min-w-[12rem]" : "whitespace-nowrap"}`}>
                      {show(c)}
                    </td>
                  )
                )}
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-sm text-muted">
                  No SOs match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
