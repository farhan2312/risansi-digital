import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { canSeeDispatchPlan, isCentral } from "@/lib/roles";
import { FinalDispatchTarget } from "@/components/risansi/final-dispatch-target";
import { DISPATCH_PLAN_DAYS, listDispatchPlan, type DispatchPlanRow, type DispatchPlanStage } from "@/lib/dispatch-plan";
import { boiStatus } from "@/lib/dept-view";
import { FINAL_LOT_PENDING } from "@/lib/order-schema";
import { UrlSearchInput } from "@/components/risansi/url-table";
import { SortHeader } from "@/components/risansi/sort-header";
import { DispatchPlanFilters, DispatchPlanKindToggle } from "@/components/risansi/dispatch-plan-filters";
import { applyDispatchPlanFilter, dispatchWord, parseDispatchPlanFilter, sortDispatchPlan } from "@/lib/dispatch-plan-filter";
import { homeFor, mayOpenPage } from "@/lib/view-pages";
import { PageHeading } from "@/components/risansi/page-heading";

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


/** What the search reads: the SO, rep, zone, PO, PIs, its ECs and models, and its BOI items. */
const haystack = (r: DispatchPlanRow) =>
  [r.so_no, r.reps, r.zone, r.po_no, ...r.pi_docs.map((p) => (p.pi_no == null ? null : String(p.pi_no))), ...r.ecs.flatMap((e) => [e.ec_no, e.model_no]), ...r.boi_items.map((b) => b.name)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const TONE_TEXT = {
  done: "text-emerald-700 dark:text-emerald-300",
  part: "text-sky-700 dark:text-sky-300",
  pending: "text-amber-700 dark:text-amber-300",
} as const;

/** Assembly's or Packing's word on the SO: its status, and when it was last done. */
function Stage({ st }: { st: DispatchPlanStage }) {
  const full = /^fully/i.test(st.status);
  const tone = full ? "done" : /^partial/i.test(st.status) ? "part" : "pending";
  return (
    <>
      <Chip tone={tone}>{st.status}</Chip>
      {st.last && <div className="mt-1 text-xs text-muted">Done {formatDate(st.last)}</div>}
    </>
  );
}

/**
 * Assembly's or Packing's plan date: the next one still to be done (red once
 * past), else the last one planned (all of it done or nothing more planned).
 */
function PlanDate({ st, now }: { st: DispatchPlanStage; now: string }) {
  const full = /^fully/i.test(st.status);
  if (full || !st.next) return <span className={st.planned ? "" : "text-muted"}>{st.planned ? formatDate(st.planned) : "—"}</span>;
  const late = st.next < now;
  return (
    <span className={late ? "font-medium text-rose-700 dark:text-rose-300" : ""}>
      {formatDate(st.next)}
      {late && <span className="block text-xs">overdue</span>}
    </span>
  );
}

/** The SO's base plate and wooden box: No, not set, or each one's status with its day. */
function Alignment({ a }: { a: DispatchPlanRow["alignment"] }) {
  const line = (label: string, body: React.ReactNode) => (
    <div className="whitespace-nowrap text-xs">
      <span className="font-semibold text-foreground">{label}</span> {body}
    </div>
  );
  const plate =
    a.base_plate === "Yes" ? (
      <>
        <Chip tone={a.base_plate_status === "Manufactured" ? "done" : "pending"}>{a.base_plate_status || "Pending"}</Chip>
        {a.base_plate_date && <span className="text-muted"> {formatDate(a.base_plate_date)}</span>}
        {/* The steps before this one, each with its day. */}
        {a.base_plate_steps.filter((s) => s.status !== a.base_plate_status).map((s) => (
          <span key={s.status} className="block pl-1 text-[11px] text-muted">
            {s.status} {formatDate(s.date)}
          </span>
        ))}
      </>
    ) : (
      <span className="text-muted">{a.base_plate === "No" ? "No" : "—"}</span>
    );
  const boxes = a.wooden_box === "Yes" ? a.wooden_boxes ?? [] : [];
  const box =
    a.wooden_box === "Yes" ? (
      boxes.length ? (
        boxes.map((b) => (
          <span key={b.source} className="block">
            <span className="text-muted">{b.source}</span>{" "}
            <Chip tone={b.status === "Received" ? "done" : "pending"}>{b.status || "Pending"}</Chip>
            <span className="text-muted">
              {" "}Req {b.required_qty ?? 0} · Stock {b.stock_qty ?? 0}
              {b.status === "Received" && b.received_date ? ` · ${formatDate(b.received_date)}` : ""}
            </span>
          </span>
        ))
      ) : (
        <Chip tone="pending">Pending</Chip>
      )
    ) : (
      <span className="text-muted">{a.wooden_box === "No" ? "No" : "—"}</span>
    );
  return (
    <div className="space-y-1.5">
      {line("Base plate", plate)}
      {line("Wooden box", box)}
    </div>
  );
}

function Chip({ tone, children }: { tone: "done" | "part" | "pending" | "danger"; children: React.ReactNode }) {
  const cls = {
    done: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    part: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
    pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    danger: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export default async function DispatchPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canSeeDispatchPlan(user.role)) redirect("/risansi/dashboard");
  // 360° View: only the pages picked for them.
  if (!mayOpenPage(user, "/risansi/dispatch-plan")) redirect(homeFor(user));

  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const now = today();
  // The search, then the filter bar and its date range, then the sort.
  // Pump SOs or Spare SOs (the toggle); Pump unless asked.
  const spare = params.type === "spare";
  const searched = (await listDispatchPlan(spare ? "spare" : "pump")).filter((r) => !q || haystack(r).includes(q));
  const filter = parseDispatchPlanFilter((k) => params[k]);
  const rows = sortDispatchPlan(applyDispatchPlanFilter(searched, filter, now), params.sort);
  // The filters' choices: what the plan holds.
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  const reps = uniq(searched.map((r) => r.reps));
  const zones = uniq(searched.map((r) => r.zone));
  const statuses = uniq(searched.map(dispatchWord));
  const pumpCount = rows.reduce((n, r) => n + r.pumps, 0);


  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <PageHeading
        icon={<CalendarRange />}
        title="Dispatch Plan"
        description={<>{spare ? "Spare" : "Pump"} SOs that can go out in the next {DISPATCH_PLAN_DAYS} days: Fully ready, Partially ready or In plan, BOI in hand or expected, not held by Accounts. Filled in automatically.</>}
      />

      <div className="mb-3">
        <DispatchPlanKindToggle spare={spare} />
      </div>

      <div className="mb-3">
        <UrlSearchInput placeholder="Search SO, rep, zone, PO, PI, EC, model, BOI item…" />
      </div>

      <DispatchPlanFilters reps={reps} zones={zones} statuses={statuses} total={rows.length} spare={spare} />
      {!spare && (
        <p className="-mt-2 mb-3 text-xs text-muted">
          <span className="font-semibold text-foreground">{pumpCount}</span> pump{pumpCount === 1 ? "" : "s"} on these SOs
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-surface px-6 py-16 text-center shadow-sm">
          <p className="text-sm font-medium text-foreground">
            {q ? "Nothing on the plan matches the search" : `No ${spare ? "spare" : "pump"} SO is due to go out in the next ${DISPATCH_PLAN_DAYS} days`}
          </p>
          <p className="mt-1 text-sm text-muted">
            An SO comes on here by itself once Planning has it Fully ready, Partially ready or In plan, and its BOI is in hand or expected.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border bg-surface shadow-sm">
          <table className={`w-full ${spare ? "min-w-[1450px]" : "min-w-[2150px]"} text-sm`}>
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                {/* Sl. and SO stay put while the rest scrolls sideways. */}
                <th className="sticky left-0 z-10 w-16 min-w-16 bg-surface px-4 py-3">Sl.</th>
                <th className="sticky left-16 z-10 bg-surface px-4 py-3 shadow-[1px_0_0_var(--color-card-border)]"><SortHeader label="SO No." sortKey="so_no" /></th>
                <th className="whitespace-nowrap px-4 py-3"><SortHeader label="SO Date" sortKey="so_date" /></th>
                <th className="px-4 py-3">Rep · Zone</th>
                <th className="px-4 py-3"><SortHeader label="PO / Date" sortKey="po_date" /></th>
                <th className="whitespace-nowrap px-4 py-3"><SortHeader label="SO Sent to PPC" sortKey="ppc" /></th>
                <th className="px-4 py-3">ECs · Model</th>
                {!spare && <th className="px-4 py-3 text-right">Pumps</th>}
                <th className="px-4 py-3"><SortHeader label="Readiness" sortKey="readiness" /></th>
                {!spare && <th className="px-4 py-3">BOI</th>}
                {/* A spare has no alignment or assembly: only packing. */}
                {!spare && (
                  <>
                    <th className="px-4 py-3">Alignment</th>
                    <th className="px-4 py-3"><SortHeader label="Assembly" sortKey="asm" /></th>
                    <th className="whitespace-nowrap px-4 py-3"><SortHeader label="Assembly Plan Date" sortKey="asm_plan" /></th>
                  </>
                )}
                <th className="px-4 py-3"><SortHeader label="Packing" sortKey="pkg" /></th>
                <th className="whitespace-nowrap px-4 py-3"><SortHeader label="Packing Plan Date" sortKey="pkg_plan" /></th>
                <th className="whitespace-nowrap px-4 py-3"><SortHeader label="Dispatch Target" sortKey="dispatch_target" /></th>
                {/* Central Visibility's own, after the department's. */}
                <th className="whitespace-nowrap px-4 py-3"><SortHeader label="To Be Dispatch Date" sortKey="final_target" /></th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {rows.map((r) => {
                const overdue = !r.fully_ready && !!r.plan_date && r.plan_date < now;
                const boiPending = r.boi_total - r.boi_in_hand;
                const manyEcs = r.ecs.length > 1;
                const targetLate = !!r.dispatch_target && r.dispatch_target < now;
                return (
                  <tr key={r.id} className="align-top text-foreground">
                    <td className="sticky left-0 z-10 w-16 min-w-16 bg-surface px-4 py-3 font-medium tabular-nums">{r.sl_no}</td>
                    <td className="sticky left-16 z-10 whitespace-nowrap bg-surface px-4 py-3 shadow-[1px_0_0_var(--color-card-border)]">
                      <div className="font-medium">{r.so_no ?? "—"}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDate(r.so_date)}</td>
                    <td className="px-4 py-3">
                      <div>{r.reps ?? "—"}</div>
                      {r.zone && <div className="text-xs text-muted">{r.zone}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div>{r.po_no ?? "—"}</div>
                      {r.po_date && <div className="text-xs text-muted">{formatDate(r.po_date)}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDate(r.ppc_date)}</td>
                    <td className="px-4 py-3">
                      <ul className="space-y-1 text-xs">
                        {r.ecs.map((e) => (
                          <li key={e.id} className="whitespace-nowrap">
                            <span className="font-medium text-foreground">{e.ec_no ?? "EC"}</span>
                            <span className="text-muted"> ×{e.quantity}{e.status ? ` · ${e.status}` : ""}</span>
                            {e.model_no && <div className="text-muted">{e.model_no}</div>}
                          </li>
                        ))}
                      </ul>
                    </td>
                    {!spare && <td className="px-4 py-3 text-right font-semibold tabular-nums">{r.pumps}</td>}
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.fully_ready ? (
                        <>
                          <Chip tone="done">Fully ready</Chip>
                          {r.ready_date && <div className="mt-1 text-xs text-muted">{formatDate(r.ready_date)}</div>}
                        </>
                      ) : r.partial_ready ? (
                        // Part of it can go now; the rest as planned.
                        <>
                          <Chip tone="part">Partially ready</Chip>
                          {r.partial_date && <div className="mt-1 text-xs text-muted">{formatDate(r.partial_date)}</div>}
                          {r.plan_date && (
                            <div className={`text-xs ${overdue ? "font-medium text-rose-700 dark:text-rose-300" : "text-muted"}`}>
                              Rest in plan {formatDate(r.plan_date)}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <Chip tone={overdue ? "danger" : "part"}>{overdue ? "In plan · overdue" : "In plan"}</Chip>
                          <div className="mt-1 text-xs text-muted">{formatDate(r.plan_date)}</div>
                        </>
                      )}
                    </td>
                    {/* BOI: pumps only. */}
                    {!spare && (
                    <td className="px-4 py-3">
                      {r.boi_total === 0 ? (
                        <span className="text-xs text-muted">No BOI</span>
                      ) : (
                        <>
                          <Chip tone={boiPending === 0 ? "done" : "pending"}>
                            {boiPending === 0 ? `All ${r.boi_total} in hand` : `${boiPending} of ${r.boi_total} to arrive`}
                          </Chip>
                          {/* Each item: what it is, how many, where it stands and its date. */}
                          <ul className="mt-1.5 space-y-1 text-xs">
                            {r.boi_items.map((b) => {
                              const st = boiStatus(b);
                              const got = st.tone === "done";
                              const date = got ? b.receipt_date : b.expected_receipt_date;
                              const late = !got && !!date && date < now;
                              return (
                                <li key={b.id} className="min-w-[13rem]">
                                  <span className="font-medium text-foreground">{b.name || "BOI item"}</span>
                                  {b.boi_qty ? <span className="text-muted"> ×{b.boi_qty}</span> : null}
                                  {manyEcs && b.ec_no && <span className="text-muted"> · {b.ec_no}</span>}
                                  <div className="whitespace-nowrap">
                                    <span className={TONE_TEXT[st.tone]}>{st.label}</span>
                                    {date && (
                                      <span className={late ? "font-medium text-rose-700 dark:text-rose-300" : "text-muted"}>
                                        {" "}· {got ? "" : "exp. "}
                                        {formatDate(date)}
                                      </span>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                    </td>
                    )}
                    {/* Base plate and wooden box, as Assembly & Packing has them (pumps only). */}
                    {!spare && (
                      <>
                        <td className="px-4 py-3">
                          <Alignment a={r.alignment} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Stage st={r.assembly} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <PlanDate st={r.assembly} now={now} />
                        </td>
                      </>
                    )}
                    <td className="whitespace-nowrap px-4 py-3">
                      <Stage st={r.packing} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <PlanDate st={r.packing} now={now} />
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 ${targetLate ? "font-medium text-rose-700 dark:text-rose-300" : ""}`}>
                      {formatDate(r.dispatch_target)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <FinalDispatchTarget
                        orderId={r.id}
                        value={r.final_dispatch_target}
                        by={r.final_dispatch_target_by}
                        canEdit={isCentral(user.role)}
                        late={!!r.final_dispatch_target && r.final_dispatch_target < now}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.dispatch_hold ? (
                        <>
                          <Chip tone="danger">Dispatch hold</Chip>
                          {r.hold_reason && <div className="mt-1 max-w-[14rem] whitespace-normal text-xs text-rose-700 dark:text-rose-300">{r.hold_reason}</div>}
                        </>
                      ) : !r.in_dispatch ? (
                        // No numbered packing slip yet: Dispatch does not have it.
                        <span className="whitespace-nowrap text-xs text-muted-foreground">Not at Dispatch yet</span>
                      ) : (
                        <>
                          <Chip tone={r.status.startsWith("LOT dispatch") ? "part" : "pending"}>
                            {r.status === "LOT dispatch" ? "Lot dispatch" : r.status === FINAL_LOT_PENDING ? "Lot dispatch, final lot pending" : r.status}
                          </Chip>
                          {/* Final lot pending: why it waits. */}
                          {r.status === FINAL_LOT_PENDING && r.hold_reason && (
                            <div className="mt-1 max-w-[14rem] whitespace-normal text-xs text-sky-700 dark:text-sky-300">{r.hold_reason}</div>
                          )}
                        </>
                      )}
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
