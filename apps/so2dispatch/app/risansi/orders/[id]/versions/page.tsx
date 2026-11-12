import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, History, Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { isOrderMakingAny } from "@/lib/roles";
import { roleSeesOrder } from "@/lib/dept-view";
import { getOrderVersion, listOrderVersions, readSnapshot } from "@/lib/order-versions";
import { OrderVersionView, diffVersions } from "@/components/risansi/order-version-view";

export const metadata: Metadata = {
  title: "SO versions | Risansi",
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const when = (v: string) =>
  new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/**
 * An SO's versions: each frozen one read-only, with every department's data
 * as it stood, and the current one — where the departments work — beside them.
 */
export default async function OrderVersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!UUID_RE.test(id)) notFound();

  const [current, versions] = await Promise.all([readSnapshot(id), listOrderVersions(id)]);
  if (!current) notFound();
  // Order Making made them; everyone else, as they see the SO.
  const om = isOrderMakingAny(user.role);
  if (!om && !roleSeesOrder(user.role, { ...current.order, ec_types: current.items.map((i) => i.item_type) }, user.rep_names)) notFound();

  const currentNo = Number(current.order.version_no ?? 1) || 1;
  const picked = Math.min(Math.max(Number(v) || currentNo, 1), currentNo);
  const frozen = picked < currentNo ? await getOrderVersion(id, picked) : null;
  const snap = frozen?.snapshot ?? current;
  // What changed in this version: against the one before it.
  const before = picked > 1 ? (await getOrderVersion(id, picked - 1))?.snapshot ?? null : null;
  const changes = before ? diffVersions(before, snap) : [];
  const madeBy = picked > 1 ? versions.find((x) => x.version_no === picked - 1) : undefined;

  const soLabel = String(current.order.so_no ?? `#${current.order.sl_no}`);
  const back = om ? "/risansi/departments/order-making" : `/risansi/orders/${id}`;

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        {om ? "Order Making" : "Back to the SO"}
      </Link>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            {soLabel} · Versions
          </h1>
          <p className="mt-1 text-sm text-muted">{String(current.order.client_name ?? "")}</p>
        </div>
      </div>

      <nav aria-label="Versions" className="mb-4 flex flex-wrap gap-1.5">
        {Array.from({ length: currentNo }, (_, i) => i + 1).map((n) => (
          <Link
            key={n}
            href={`/risansi/orders/${id}/versions?v=${n}`}
            aria-current={n === picked ? "page" : undefined}
            className={`inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-semibold transition-colors ${
              n === picked
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input-border text-foreground hover:bg-background"
            }`}
          >
            {n < currentNo && <Lock className="h-3 w-3" />}v{n}
            {n === currentNo && <span className="font-normal opacity-80">· current</span>}
          </Link>
        ))}
      </nav>

      {frozen ? (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="font-semibold">Version {picked} · read-only</p>
          <p className="mt-0.5 text-xs">
            Saved {when(frozen.created_at)}
            {frozen.created_by_name ? ` by ${frozen.created_by_name}` : ""}, when v{picked + 1} was made — {frozen.reason}
          </p>
          <p className="mt-0.5 text-xs opacity-80">The SO and every department&apos;s work as they stood then. The departments work on v{currentNo}.</p>
        </div>
      ) : (
        <div role="status" className="mb-4 rounded-xl border border-card-border bg-surface px-4 py-3 text-sm text-foreground">
          <p className="font-semibold">Version {currentNo} · current</p>
          <p className="mt-0.5 text-xs text-muted">
            {currentNo === 1
              ? "No earlier version yet. Order Making PO makes a new version from the Order Making page."
              : "Where the departments work. The earlier versions are kept read-only above."}
          </p>
        </div>
      )}

      {picked > 1 && (
        <section className="mb-4 rounded-xl border border-card-border bg-surface p-4">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <History className="h-4 w-4 text-primary" />
            What changed in v{picked}
          </h2>
          {madeBy && (
            <p className="mb-3 text-xs text-muted">
              Made {when(madeBy.created_at)}
              {madeBy.created_by_name ? ` by ${madeBy.created_by_name}` : ""} — {madeBy.reason}
            </p>
          )}
          {changes.length === 0 ? (
            <p className="text-xs text-muted">Nothing changed from v{picked - 1} yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-card-border">
              <table className="w-full text-xs">
                <thead className="bg-background/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-2.5 py-1.5">Where</th>
                    <th className="px-2.5 py-1.5">What</th>
                    <th className="px-2.5 py-1.5">v{picked - 1}</th>
                    <th className="px-2.5 py-1.5">v{picked}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {changes.map((c, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">{c.where}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-foreground">{c.field}</td>
                      <td className="whitespace-pre-wrap px-2.5 py-1.5 text-muted line-through decoration-rose-400/60">{c.from}</td>
                      <td className="whitespace-pre-wrap px-2.5 py-1.5 font-medium text-foreground">{c.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <OrderVersionView snap={snap} />
    </div>
  );
}
