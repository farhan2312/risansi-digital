import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canSeeDispatchPlan } from "@/lib/roles";
import { DISPATCH_PLAN_DAYS, listDispatchPlan, type DispatchPlanRow } from "@/lib/dispatch-plan";

export const metadata: Metadata = {
  title: "Dispatch Plan | Risansi",
};

export const dynamic = "force-dynamic";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** The views the tiles switch between. */
const SHOWS = {
  ready: { label: "Fully ready", test: (r: DispatchPlanRow) => r.fully_ready },
  plan: { label: `In plan · ${DISPATCH_PLAN_DAYS} days`, test: (r: DispatchPlanRow) => !r.fully_ready },
  boi: { label: "BOI to arrive", test: (r: DispatchPlanRow) => r.boi_in_hand < r.boi_total },
} as const;
type Show = keyof typeof SHOWS;

function Chip({ tone, children }: { tone: "done" | "part" | "pending" | "danger"; children: React.ReactNode }) {
  const cls = {
    done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    part: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
    pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    danger: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export default async function DispatchPlanPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canSeeDispatchPlan(user.role)) redirect("/risansi/dashboard");

  const { show: asked } = await searchParams;
  const show = asked && asked in SHOWS ? (asked as Show) : null;
  const all = await listDispatchPlan();
  const rows = show ? all.filter(SHOWS[show].test) : all;
  const now = today();
  const pumps = (list: DispatchPlanRow[]) => list.reduce((n, r) => n + r.pumps, 0);

  const tiles: { key: Show | null; label: string; list: DispatchPlanRow[] }[] = [
    { key: null, label: "On the plan", list: all },
    ...(Object.keys(SHOWS) as Show[]).map((k) => ({ key: k, label: SHOWS[k].label, list: all.filter(SHOWS[k].test) })),
  ];

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <CalendarRange className="h-6 w-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Dispatch Plan</h1>
          <p className="text-sm text-muted">
            Pump SOs that can go out in the next {DISPATCH_PLAN_DAYS} days: Fully ready or In plan, BOI in hand or
            expected, not held by Accounts. Filled in automatically.
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => {
          const on = show === t.key;
          return (
            <Link
              key={t.label}
              href={t.key && !on ? `?show=${t.key}` : "?"}
              aria-pressed={on}
              className={`rounded-xl border bg-surface px-3.5 py-2.5 shadow-sm transition-colors ${
                on ? "border-transparent ring-2 ring-primary/40" : "border-card-border hover:bg-background"
              }`}
            >
              <span className="block text-[11px] font-medium text-muted">{t.label}</span>
              <span className="mt-1 flex items-baseline gap-2 font-display text-xl font-bold tabular-nums text-foreground">
                <span>
                  {t.list.length}
                  <span className="ml-0.5 text-[10px] font-semibold text-muted">SO{t.list.length === 1 ? "" : "s"}</span>
                </span>
                <span className="text-[0.8em]">
                  {pumps(t.list)}
                  <span className="ml-0.5 text-[10px] font-semibold text-muted">pumps</span>
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-surface px-6 py-16 text-center shadow-sm">
          <p className="text-sm font-medium text-foreground">No pump SO is due to go out in the next {DISPATCH_PLAN_DAYS} days</p>
          <p className="mt-1 text-sm text-muted">
            An SO comes on here by itself once Planning has it Fully ready or In plan, and its BOI is in hand or expected.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border bg-surface shadow-sm">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Sl.</th>
                <th className="px-4 py-3">SO</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">ECs</th>
                <th className="px-4 py-3 text-right">Pumps</th>
                <th className="px-4 py-3">Readiness</th>
                <th className="px-4 py-3">BOI</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Dispatch Target</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {rows.map((r) => {
                const overdue = !r.fully_ready && !!r.plan_date && r.plan_date < now;
                const boiPending = r.boi_total - r.boi_in_hand;
                const targetLate = !!r.dispatch_target && r.dispatch_target < now;
                return (
                  <tr key={r.id} className="align-top text-foreground">
                    <td className="px-4 py-3 font-medium tabular-nums">{r.sl_no}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="font-medium">{r.so_no ?? "—"}</div>
                      <div className="text-xs text-muted">{formatDate(r.so_date)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{r.client_name ?? "—"}</div>
                      {(r.reps || r.zone) && <div className="text-xs text-muted">{[r.reps, r.zone].filter(Boolean).join(" · ")}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <ul className="space-y-0.5 text-xs">
                        {r.ecs.map((e) => (
                          <li key={e.id} className="whitespace-nowrap">
                            <span className="font-medium text-foreground">{e.ec_no ?? "EC"}</span>
                            <span className="text-muted"> ×{e.quantity}{e.status ? ` · ${e.status}` : ""}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{r.pumps}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.fully_ready ? (
                        <>
                          <Chip tone="done">Fully ready</Chip>
                          {r.ready_date && <div className="mt-1 text-xs text-muted">{formatDate(r.ready_date)}</div>}
                        </>
                      ) : (
                        <>
                          <Chip tone={overdue ? "danger" : "part"}>{overdue ? "In plan · overdue" : "In plan"}</Chip>
                          <div className="mt-1 text-xs text-muted">{formatDate(r.plan_date)}</div>
                        </>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.boi_total === 0 ? (
                        <span className="text-xs text-muted">No BOI</span>
                      ) : boiPending === 0 ? (
                        <Chip tone="done">All {r.boi_total} in hand</Chip>
                      ) : (
                        <>
                          <Chip tone="pending">
                            {boiPending} of {r.boi_total} to arrive
                          </Chip>
                          <div className="mt-1 text-xs text-muted">by {formatDate(r.boi_expected)}</div>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{r.payment_status ?? <span className="text-muted">—</span>}</td>
                    <td className={`whitespace-nowrap px-4 py-3 ${targetLate ? "font-medium text-rose-700 dark:text-rose-300" : ""}`}>
                      {formatDate(r.dispatch_target)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Chip tone={r.status === "LOT dispatch" ? "part" : "pending"}>{r.status === "LOT dispatch" ? "Lot dispatch" : r.status}</Chip>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={`/risansi/orders/${r.id}`} className="text-sm font-medium text-primary hover:text-primary-hover">
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
