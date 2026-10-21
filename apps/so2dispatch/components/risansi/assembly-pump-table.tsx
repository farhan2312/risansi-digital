"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, MessageSquare, Moon, Package, Plus, Sun, Trash2, Wrench, X } from "lucide-react";
import { PUMP_LIKE } from "@/lib/order-schema";
import {
  ASSEMBLY_SHIFTS,
  PDI_CHOICES,
  STAGE_WORDS,
  ecAssembly,
  ecStageStatus,
  plansError,
  plansFromRows,
  soStageStatus,
  type AssemblyPlan,
  type Stage,
} from "@/lib/assembly";
import { saveAssemblyPlansAction } from "@/app/risansi/orders/assembly-actions";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => Number(v ?? 0) || 0;

function shortDate(v: unknown): string {
  const s = str(v).slice(0, 10);
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
const todayIso = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const DONE = new Set(["Assembled", "Fully assembled", "Packed", "Fully packed"]);
const PART = new Set(["Partially assembled", "Partial assembled", "Partially packed"]);
function Chip({ label }: { label: string }) {
  const cls = DONE.has(label) ? "bg-emerald-50 text-emerald-700" : PART.has(label) ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700";
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

/** A pump EC as assembly and packing read it. */
type Ec = { id: string; label: string; quantity: number; ready: number };
const ecOf = (r: Row): Ec => ({
  id: str(r.id),
  label: str(r.ec_no) || "EC",
  quantity: num(((r.ec ?? {}) as Row).quantity),
  ready: num(r.ready_qty),
});

/** The next entry not done yet, soonest first. */
function nextOf(plans: AssemblyPlan[]): AssemblyPlan | undefined {
  return plans.filter((p) => !p.assembled && p.plan_date).sort((a, b) => a.plan_date.localeCompare(b.plan_date))[0];
}

function NextCell({ plan, ecs }: { plan: AssemblyPlan | undefined; ecs: Row[] }) {
  if (!plan) return <span className="text-muted">—</span>;
  return (
    <>
      <span className="block font-medium">{shortDate(plan.plan_date)}</span>
      <span className="inline-flex items-center gap-1 text-[11px] text-muted">
        {plan.shift === "Night" ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
        {plan.shift || "—"} · {str(ecs.find((x) => str(x.id) === plan.item_id)?.ec_no)} ×{plan.qty}
      </span>
    </>
  );
}

/**
 * Assembly & Packing's Pump view: each SO once on the left — Planning's
 * status, then its assembly and its packing, each with its next planned shift
 * and a pop-up to plan it — and its pump ECs on the right with what is ready,
 * assembled and packed.
 */
export function AssemblyPumpTable({
  rows,
  unreadThreads,
  canEdit,
  onThread,
}: {
  rows: Row[];
  unreadThreads: Record<string, number>;
  canEdit: boolean;
  onThread: (orderId: string, soLabel: string) => void;
}) {
  const pumps = rows.filter((r) => PUMP_LIKE.includes(str(r.item_type)));
  const sos: { orderId: string; ecs: Row[] }[] = [];
  for (const r of pumps) {
    const id = str(r.order_id);
    const last = sos[sos.length - 1];
    if (last && last.orderId === id) last.ecs.push(r);
    else sos.push({ orderId: id, ecs: [r] });
  }
  const [planFor, setPlanFor] = useState<{ orderId: string; stage: Stage } | null>(null);
  const th = "px-3 py-2 whitespace-nowrap";
  const group = "border-l border-card-border px-3 pt-2.5 pb-1 text-center";
  const stageButton = (orderId: string, stage: Stage) => (
    <button
      type="button"
      onClick={() => setPlanFor({ orderId, stage })}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
    >
      {stage === "assembly" ? <Wrench className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
      {STAGE_WORDS[stage].title}
    </button>
  );

  return (
    <>
      <table className="w-full min-w-[1900px] text-sm">
        <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <th colSpan={5} className="px-3 pt-2.5 pb-1">SO</th>
            <th colSpan={3} className={group}>Assembly</th>
            <th colSpan={3} className={group}>Packing</th>
            <th colSpan={8} className={group}>EC</th>
          </tr>
          <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <th className={th}>Sl.</th>
            <th className={th}>SO No.</th>
            <th className={th}>SO Date</th>
            <th className={th}>Chat</th>
            <th className={th}>PPC Status</th>
            <th className={`${th} border-l border-card-border`}>Status</th>
            <th className={th}>Next</th>
            <th className={th} />
            <th className={`${th} border-l border-card-border`}>Status</th>
            <th className={th}>Next</th>
            <th className={th} />
            <th className={`${th} border-l border-card-border`}>EC No.</th>
            <th className={th}>EC Date</th>
            <th className={th}>Qty</th>
            <th className={th}>Ready</th>
            <th className={th}>Assembled</th>
            <th className={th}>Assembly</th>
            <th className={th}>Packed</th>
            <th className={th}>Packing</th>
          </tr>
        </thead>
        <tbody>
          {sos.length === 0 && (
            <tr>
              <td colSpan={19} className="px-4 py-10 text-center text-sm text-muted">
                No pump SO is ready to assemble.
              </td>
            </tr>
          )}
          {sos.map(({ orderId, ecs }) => {
            const head = ecs[0];
            const soLabel = str(head.so_no) || `#${str(head.sl_no)}`;
            const asm = plansFromRows(head.assembly_plans, "assembly");
            const pkg = plansFromRows(head.assembly_plans, "packing");
            const asmEc = ecs.map((r) => {
              const e = ecOf(r);
              return ecStageStatus(ecAssembly(asm, e.id).assembled, e.quantity, "assembly");
            });
            const pkgEc = ecs.map((r) => {
              const e = ecOf(r);
              return ecStageStatus(ecAssembly(pkg, e.id).assembled, e.quantity, "packing");
            });
            const span = ecs.length;
            const soCell = "px-3 py-2 align-top border-b border-card-border";
            const unread = unreadThreads[orderId] ?? 0;
            return (
              <Fragment key={orderId}>
                {ecs.map((r, k) => {
                  const e = ecOf(r);
                  const a = ecAssembly(asm, e.id);
                  const p = ecAssembly(pkg, e.id);
                  const lastRow = k === ecs.length - 1;
                  const ecCell = `px-3 py-2 ${lastRow ? "border-b border-card-border" : "border-b border-card-border/50"}`;
                  return (
                    <tr key={e.id} className="text-foreground hover:bg-background/40">
                      {k === 0 && (
                        <>
                          <td rowSpan={span} className={`${soCell} tabular-nums`}>{str(head.sl_no)}</td>
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap font-semibold`}>{soLabel}</td>
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap text-muted`}>{shortDate(head.so_date)}</td>
                          <td rowSpan={span} className={soCell}>
                            <button
                              type="button"
                              onClick={() => onThread(orderId, soLabel)}
                              aria-label="Chat"
                              className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg border border-input-border hover:bg-background"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              {unread > 0 && (
                                <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                                  {unread}
                                </span>
                              )}
                            </button>
                          </td>
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                            <span className={`block font-medium ${str(head.ppc_status) === "Fully ready" ? "text-emerald-700" : ""}`}>
                              {str(head.ppc_status) || "—"}
                            </span>
                            <span className="block text-[11px] text-muted">{shortDate(head.planning_readiness_date)}</span>
                          </td>
                          <td rowSpan={span} className={`${soCell} border-l border-card-border`}>
                            <Chip label={soStageStatus(asmEc, "assembly")} />
                          </td>
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                            <NextCell plan={nextOf(asm)} ecs={ecs} />
                          </td>
                          <td rowSpan={span} className={soCell}>{stageButton(orderId, "assembly")}</td>
                          <td rowSpan={span} className={`${soCell} border-l border-card-border`}>
                            <Chip label={soStageStatus(pkgEc, "packing")} />
                          </td>
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                            <NextCell plan={nextOf(pkg)} ecs={ecs} />
                          </td>
                          <td rowSpan={span} className={soCell}>{stageButton(orderId, "packing")}</td>
                        </>
                      )}
                      <td className={`${ecCell} whitespace-nowrap border-l border-card-border font-semibold`}>{e.label}</td>
                      <td className={`${ecCell} whitespace-nowrap text-muted`}>{shortDate(((r.ec ?? {}) as Row).ec_date)}</td>
                      <td className={`${ecCell} tabular-nums`}>{e.quantity || "—"}</td>
                      <td className={`${ecCell} tabular-nums`}>{e.ready}</td>
                      <td className={`${ecCell} tabular-nums`} title={`${a.planned} planned`}>{a.assembled}</td>
                      <td className={ecCell}>
                        <Chip label={asmEc[k]} />
                      </td>
                      <td className={`${ecCell} tabular-nums`} title={`${p.planned} planned`}>{p.assembled}</td>
                      <td className={ecCell}>
                        <Chip label={pkgEc[k]} />
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {(() => {
        const so = planFor ? sos.find((s) => s.orderId === planFor.orderId) : null;
        if (!so || !planFor) return null;
        const all = so.ecs[0].assembly_plans;
        return (
          <StagePlanModal
            key={`${so.orderId}:${planFor.stage}`}
            stage={planFor.stage}
            orderId={so.orderId}
            soLabel={str(so.ecs[0].so_no) || `#${str(so.ecs[0].sl_no)}`}
            ecs={so.ecs.map(ecOf)}
            plans={plansFromRows(all, planFor.stage)}
            assembled={plansFromRows(all, "assembly")}
            canEdit={canEdit}
            onClose={() => setPlanFor(null)}
          />
        );
      })()}
    </>
  );
}

const input =
  "h-9 w-full rounded-lg border border-input-border bg-surface px-2.5 text-[13px] text-foreground focus:border-primary focus:outline-none disabled:bg-background disabled:text-muted";

/**
 * One SO's plan in one stage: its ECs with what the stage can take and how
 * far it has got, and the entries — day, shift, EC, how many (and for
 * packing, PDI) — each ticked done.
 */
function StagePlanModal({
  stage,
  orderId,
  soLabel,
  ecs,
  plans: initial,
  assembled,
  canEdit,
  onClose,
}: {
  stage: Stage;
  orderId: string;
  soLabel: string;
  ecs: Ec[];
  plans: AssemblyPlan[];
  /** The SO's assembly entries: what packing can take. */
  assembled: AssemblyPlan[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const words = STAGE_WORDS[stage];
  const packing = stage === "packing";
  const [plans, setPlans] = useState<AssemblyPlan[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ro = !canEdit;
  const dirty = JSON.stringify(plans) !== JSON.stringify(initial);
  const set = (i: number, patch: Partial<AssemblyPlan>) => setPlans((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  // What the stage may take of an EC: Planning's ready qty to assemble; what is assembled to pack.
  const capOf = (ec: Ec) => (packing ? ecAssembly(assembled, ec.id).assembled : Math.min(ec.quantity || Infinity, ec.ready));
  const caps = ecs.map((e) => ({ id: e.id, label: e.label, cap: capOf(e) }));
  const leftFor = (ecId: string, skip = -1) => {
    const ec = ecs.find((e) => e.id === ecId);
    if (!ec) return 0;
    const others = plans.reduce((n, p, i) => (i !== skip && p.item_id === ecId ? n + p.qty : n), 0);
    return Math.max(0, capOf(ec) - others);
  };

  function add() {
    const ec = ecs.find((e) => leftFor(e.id) > 0);
    if (!ec) return;
    setPlans((ps) => [
      ...ps,
      { item_id: ec.id, plan_date: todayIso(), shift: "Day", qty: leftFor(ec.id), assembled: false, assembled_date: "", pdi: "", remarks: "" },
    ]);
  }

  async function save() {
    const problem = plansError(plans, caps, stage);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveAssemblyPlansAction(orderId, plans, stage);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  const status = soStageStatus(
    ecs.map((e) => ecStageStatus(ecAssembly(plans, e.id).assembled, e.quantity, stage)),
    stage
  );
  const canAdd = canEdit && ecs.some((e) => leftFor(e.id) > 0);

  return (
    <div role="dialog" aria-modal="true" aria-label={`${words.title} · ${soLabel}`} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              {words.title} · {soLabel}
            </h2>
            <p className="text-xs text-muted">
              {packing
                ? "Plan the assembled pumps for packing by day and shift; tick Packed once done."
                : "Plan each EC by day and shift; tick Assembled once done."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip label={status} />
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Each EC: what this stage can take, and how far it has got. */}
        <div className="mb-4 overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead className="bg-background/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">EC No.</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">{packing ? "Assembled" : "Ready"}</th>
                <th className="px-3 py-2">Planned</th>
                <th className="px-3 py-2">{words.done}</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {ecs.map((e) => {
                const a = ecAssembly(plans, e.id);
                return (
                  <tr key={e.id}>
                    <td className="px-3 py-2 font-semibold">{e.label}</td>
                    <td className="px-3 py-2 tabular-nums">{e.quantity}</td>
                    <td className="px-3 py-2 tabular-nums">{capOf(e) === Infinity ? "—" : capOf(e)}</td>
                    <td className="px-3 py-2 tabular-nums">{a.planned}</td>
                    <td className="px-3 py-2 tabular-nums">{a.assembled}</td>
                    <td className="px-3 py-2">
                      <Chip label={ecStageStatus(a.assembled, e.quantity, stage)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{words.title} plan</h3>
          {canAdd && (
            <button
              type="button"
              onClick={add}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-primary/50 px-3 text-xs font-semibold text-primary hover:bg-primary/10"
            >
              <Plus className="h-3.5 w-3.5" />
              Add plan
            </button>
          )}
        </div>
        {plans.length === 0 ? (
          <p className="rounded-xl border border-dashed border-card-border px-4 py-6 text-center text-sm text-muted">
            {canAdd
              ? "Nothing planned yet — Add plan to schedule an EC."
              : packing
                ? "Nothing assembled yet to pack."
                : "Nothing planned yet."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-card-border">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-background/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Shift</th>
                  <th className="px-3 py-2">EC</th>
                  <th className="px-3 py-2">Qty</th>
                  {packing && <th className="px-3 py-2">PDI</th>}
                  <th className="px-3 py-2">{words.done}</th>
                  <th className="px-3 py-2">{words.doneOn}</th>
                  <th className="px-3 py-2">Remarks</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {plans.map((p, i) => {
                  const max = leftFor(p.item_id, i);
                  return (
                    <tr key={p.id ?? `new-${i}`} className={p.assembled ? "bg-emerald-50/40" : ""}>
                      <td className="px-3 py-2">
                        <input type="date" value={p.plan_date} disabled={ro} onChange={(e) => set(i, { plan_date: e.target.value })} className={`${input} w-36`} />
                      </td>
                      <td className="px-3 py-2">
                        <select value={p.shift} disabled={ro} onChange={(e) => set(i, { shift: e.target.value })} className={`${input} w-24`}>
                          <option value="">—</option>
                          {ASSEMBLY_SHIFTS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={p.item_id}
                          disabled={ro}
                          onChange={(e) => set(i, { item_id: e.target.value, qty: Math.min(p.qty || 1, leftFor(e.target.value, i)) || leftFor(e.target.value, i) })}
                          className={`${input} w-44`}
                        >
                          {ecs
                            .filter((e) => e.id === p.item_id || leftFor(e.id, i) > 0)
                            .map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.label} ({leftFor(e.id, i)} left)
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          max={max}
                          value={p.qty}
                          disabled={ro}
                          onChange={(e) => set(i, { qty: Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))) })}
                          className={`${input} w-20`}
                        />
                      </td>
                      {packing && (
                        <td className="px-3 py-2">
                          <select value={p.pdi} disabled={ro} onChange={(e) => set(i, { pdi: e.target.value })} className={`${input} w-20`}>
                            <option value="">—</option>
                            {PDI_CHOICES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={p.assembled}
                          disabled={ro}
                          onChange={(e) =>
                            set(i, e.target.checked ? { assembled: true, assembled_date: p.assembled_date || p.plan_date || todayIso() } : { assembled: false, assembled_date: "" })
                          }
                          aria-label={words.done}
                          className="h-4 w-4 accent-primary"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input type="date" value={p.assembled_date} disabled={ro || !p.assembled} onChange={(e) => set(i, { assembled_date: e.target.value })} className={`${input} w-36`} />
                      </td>
                      <td className="px-3 py-2">
                        <input value={p.remarks} disabled={ro} onChange={(e) => set(i, { remarks: e.target.value })} className={`${input} min-w-[10rem]`} />
                      </td>
                      <td className="px-3 py-2">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setPlans((ps) => ps.filter((_, k) => k !== i))}
                            aria-label="Remove plan"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {canEdit && (
          <div className="mt-4 flex items-center justify-end gap-3">
            {error && <span className="text-sm text-rose-600">{error}</span>}
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
