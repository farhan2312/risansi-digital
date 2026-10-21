"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, MessageSquare, Moon, Plus, Sun, Trash2, Wrench, X } from "lucide-react";
import { PUMP_LIKE } from "@/lib/order-schema";
import {
  ASSEMBLY_SHIFTS,
  ecAssembly,
  ecAssemblyStatus,
  plansError,
  plansFromRows,
  soAssemblyStatus,
  type AssemblyPlan,
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

const TONE: Record<string, string> = {
  Assembled: "bg-emerald-50 text-emerald-700",
  "Fully assembled": "bg-emerald-50 text-emerald-700",
  "Partially assembled": "bg-sky-50 text-sky-700",
  "Partial assembled": "bg-sky-50 text-sky-700",
};
function Chip({ label }: { label: string }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[label] ?? "bg-amber-50 text-amber-700"}`}>
      {label}
    </span>
  );
}

/** A pump EC as assembly reads it. */
type Ec = { id: string; label: string; quantity: number; ready: number };
const ecOf = (r: Row): Ec => ({
  id: str(r.id),
  label: str(r.ec_no) || "EC",
  quantity: num(((r.ec ?? {}) as Row).quantity),
  ready: num(r.ready_qty),
});

/**
 * Assembly & Packing's Pump view, assembly first: each SO once on the left
 * — Planning's status, the SO's assembly status and its next planned shift —
 * and its pump ECs on the right with what is ready, planned and assembled.
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
  const [planFor, setPlanFor] = useState<string | null>(null);
  const th = "px-3 py-2 whitespace-nowrap";
  const group = "border-l border-card-border px-3 pt-2.5 pb-1 text-center";

  return (
    <>
      <table className="w-full min-w-[1500px] text-sm">
        <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <th colSpan={8} className="px-3 pt-2.5 pb-1">SO</th>
            <th colSpan={7} className={group}>EC</th>
          </tr>
          <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <th className={th}>Sl.</th>
            <th className={th}>SO No.</th>
            <th className={th}>SO Date</th>
            <th className={th}>Chat</th>
            <th className={th}>PPC Status</th>
            <th className={th}>Assembly Status</th>
            <th className={th}>Next Assembly</th>
            <th className={th} />
            <th className={`${th} border-l border-card-border`}>EC No.</th>
            <th className={th}>EC Date</th>
            <th className={th}>Qty</th>
            <th className={th}>Ready</th>
            <th className={th}>Planned</th>
            <th className={th}>Assembled</th>
            <th className={th}>EC Status</th>
          </tr>
        </thead>
        <tbody>
          {sos.length === 0 && (
            <tr>
              <td colSpan={15} className="px-4 py-10 text-center text-sm text-muted">
                No pump SO is ready to assemble.
              </td>
            </tr>
          )}
          {sos.map(({ orderId, ecs }) => {
            const head = ecs[0];
            const soLabel = str(head.so_no) || `#${str(head.sl_no)}`;
            const plans = plansFromRows(head.assembly_plans);
            const ecStatuses = ecs.map((r) => {
              const e = ecOf(r);
              return ecAssemblyStatus(ecAssembly(plans, e.id).assembled, e.quantity);
            });
            const soStatus = soAssemblyStatus(ecStatuses);
            const next = plans
              .filter((p) => !p.assembled && p.plan_date)
              .sort((a, b) => a.plan_date.localeCompare(b.plan_date))[0];
            const span = ecs.length;
            const soCell = "px-3 py-2 align-top border-b border-card-border";
            const unread = unreadThreads[orderId] ?? 0;
            return (
              <Fragment key={orderId}>
                {ecs.map((r, k) => {
                  const e = ecOf(r);
                  const a = ecAssembly(plans, e.id);
                  const lastRow = k === ecs.length - 1;
                  const ecCell = `px-3 py-2 ${lastRow ? "border-b border-card-border" : "border-b border-card-border/50"}`;
                  return (
                    <tr key={e.id} className="text-foreground hover:bg-background/40">
                      {k === 0 && (
                        <>
                          <td rowSpan={span} className={`${soCell} tabular-nums`}>{str(head.sl_no)}</td>
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                            <span className="font-semibold">{soLabel}</span>
                          </td>
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
                          <td rowSpan={span} className={soCell}>
                            <Chip label={soStatus} />
                          </td>
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                            {next ? (
                              <>
                                <span className="block font-medium">{shortDate(next.plan_date)}</span>
                                <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                                  {next.shift === "Night" ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                                  {next.shift || "—"} · {ecs.find((x) => str(x.id) === next.item_id)?.ec_no as string} ×{next.qty}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td rowSpan={span} className={soCell}>
                            <button
                              type="button"
                              onClick={() => setPlanFor(orderId)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
                            >
                              <Wrench className="h-3.5 w-3.5" />
                              Assembly
                            </button>
                          </td>
                        </>
                      )}
                      <td className={`${ecCell} whitespace-nowrap border-l border-card-border font-semibold`}>{e.label}</td>
                      <td className={`${ecCell} whitespace-nowrap text-muted`}>{shortDate(((r.ec ?? {}) as Row).ec_date)}</td>
                      <td className={`${ecCell} tabular-nums`}>{e.quantity || "—"}</td>
                      <td className={`${ecCell} tabular-nums`}>{e.ready}</td>
                      <td className={`${ecCell} tabular-nums`}>{a.planned}</td>
                      <td className={`${ecCell} tabular-nums`}>{a.assembled}</td>
                      <td className={ecCell}>
                        <Chip label={ecStatuses[k]} />
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
        const so = planFor ? sos.find((s) => s.orderId === planFor) : null;
        if (!so) return null;
        return (
          <AssemblyPlanModal
            key={so.orderId}
            orderId={so.orderId}
            soLabel={str(so.ecs[0].so_no) || `#${str(so.ecs[0].sl_no)}`}
            ecs={so.ecs.map(ecOf)}
            plans={plansFromRows(so.ecs[0].assembly_plans)}
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
 * One SO's assembly plan: its ECs with what is ready, planned and assembled,
 * and the plan entries — day, shift, EC, how many — each ticked Assembled.
 */
function AssemblyPlanModal({
  orderId,
  soLabel,
  ecs,
  plans: initial,
  canEdit,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  ecs: Ec[];
  plans: AssemblyPlan[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [plans, setPlans] = useState<AssemblyPlan[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ro = !canEdit;
  const dirty = JSON.stringify(plans) !== JSON.stringify(initial);
  const set = (i: number, patch: Partial<AssemblyPlan>) =>
    setPlans((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  // What is left to plan on an EC: Planning's ready qty less what other entries hold.
  const leftFor = (ecId: string, skip = -1) => {
    const ec = ecs.find((e) => e.id === ecId);
    if (!ec) return 0;
    const cap = Math.min(ec.quantity || Infinity, ec.ready);
    const others = plans.reduce((n, p, i) => (i !== skip && p.item_id === ecId ? n + p.qty : n), 0);
    return Math.max(0, cap - others);
  };

  function add() {
    const ec = ecs.find((e) => leftFor(e.id) > 0);
    if (!ec) return;
    setPlans((ps) => [
      ...ps,
      { item_id: ec.id, plan_date: todayIso(), shift: "Day", qty: leftFor(ec.id), assembled: false, assembled_date: "", remarks: "" },
    ]);
  }

  async function save() {
    const problem = plansError(plans, ecs);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveAssemblyPlansAction(orderId, plans);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  const status = soAssemblyStatus(ecs.map((e) => ecAssemblyStatus(ecAssembly(plans, e.id).assembled, e.quantity)));
  const canAdd = canEdit && ecs.some((e) => leftFor(e.id) > 0);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Assembly · ${soLabel}`} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Assembly · {soLabel}</h2>
            <p className="text-xs text-muted">Plan each EC by day and shift; tick it Assembled once done.</p>
          </div>
          <div className="flex items-center gap-2">
            <Chip label={status} />
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Each EC: what Planning has ready, and how far assembly has got. */}
        <div className="mb-4 overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead className="bg-background/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">EC No.</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Ready</th>
                <th className="px-3 py-2">Planned</th>
                <th className="px-3 py-2">Assembled</th>
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
                    <td className="px-3 py-2 tabular-nums">{e.ready}</td>
                    <td className="px-3 py-2 tabular-nums">{a.planned}</td>
                    <td className="px-3 py-2 tabular-nums">{a.assembled}</td>
                    <td className="px-3 py-2">
                      <Chip label={ecAssemblyStatus(a.assembled, e.quantity)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Assembly plan</h3>
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
            Nothing planned yet{canEdit ? " — Add plan to schedule an EC." : "."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-card-border">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-background/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Shift</th>
                  <th className="px-3 py-2">EC</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Assembled</th>
                  <th className="px-3 py-2">Assembled On</th>
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
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={p.assembled}
                          disabled={ro}
                          onChange={(e) =>
                            set(i, e.target.checked ? { assembled: true, assembled_date: p.assembled_date || p.plan_date || todayIso() } : { assembled: false, assembled_date: "" })
                          }
                          aria-label="Assembled"
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
