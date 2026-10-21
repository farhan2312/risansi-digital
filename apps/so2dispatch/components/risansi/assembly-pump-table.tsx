"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Layers, Loader2, MessageSquare, Moon, Package, Sun, Wrench, X } from "lucide-react";
import { PUMP_LIKE } from "@/lib/order-schema";
import {
  ASSEMBLY_SHIFTS,
  PDI_CHOICES,
  ecDone,
  ecStageStatus,
  lotStagesError,
  pumpLotsFromEcs,
  soStatuses,
  type LotStages,
  type PumpLot,
} from "@/lib/assembly";
import { saveLotStagesAction } from "@/app/risansi/orders/assembly-actions";
import { PackingPlanHistoryButton } from "./packing-plan-history";

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

/**
 * Each lot's planned date for a stage — "L1 22 Oct 2026 · Night" — the whole
 * cell opening how the plan moved.
 */
function PlannedCell({
  lots,
  stage,
  orderId,
  soLabel,
}: {
  lots: PumpLot[];
  stage: "assembly" | "packing";
  orderId: string;
  soLabel: string;
}) {
  const planned = lots.filter((l) => (stage === "assembly" ? l.assembly_plan_date : l.packing_plan_date));
  if (planned.length === 0) return <span className="text-muted">—</span>;
  return (
    <PackingPlanHistoryButton
      orderId={orderId}
      soLabel={soLabel}
      stage={stage}
      label={
        <span className="flex flex-col items-start gap-0.5">
          {planned.map((l) => {
            const date = stage === "assembly" ? l.assembly_plan_date : l.packing_plan_date;
            const shift = stage === "assembly" ? l.assembly_shift : l.packing_shift;
            const done = stage === "assembly" ? l.assembled_date : l.packed_date;
            return (
              <span key={l.n} className={`inline-flex items-center gap-1 text-xs ${done ? "text-muted line-through decoration-muted/50" : "text-foreground"}`}>
                <span className="font-semibold">L{l.n}</span> {shortDate(date)}
                {shift === "Night" ? <Moon className="h-3 w-3" /> : shift ? <Sun className="h-3 w-3" /> : null}
                {stage === "packing" && l.pdi ? <span className="text-muted">PDI {l.pdi}</span> : null}
              </span>
            );
          })}
        </span>
      }
    />
  );
}

/**
 * Assembly & Packing's Pump view: each SO once on the left — Planning's
 * status, its lots, and how far assembly and packing have got lot by lot —
 * and its pump ECs on the right with what is ready, assembled and packed.
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
  const [lotsFor, setLotsFor] = useState<string | null>(null);
  const th = "px-3 py-2 whitespace-nowrap";
  const group = "border-l border-card-border px-3 pt-2.5 pb-1 text-center";

  return (
    <>
      <table className="w-full min-w-[1900px] text-sm">
        <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <th colSpan={6} className="px-3 pt-2.5 pb-1">SO</th>
            <th colSpan={2} className={group}>Assembly</th>
            <th colSpan={3} className={group}>Packing</th>
            <th colSpan={8} className={group}>EC</th>
          </tr>
          <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <th className={th}>Sl.</th>
            <th className={th}>SO No.</th>
            <th className={th}>SO Date</th>
            <th className={th}>Chat</th>
            <th className={th}>PPC Status</th>
            <th className={th}>Lots</th>
            <th className={`${th} border-l border-card-border`}>Status</th>
            <th className={th}>Planned Date</th>
            <th className={`${th} border-l border-card-border`}>Status</th>
            <th className={th}>Planned Date</th>
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
            const lots = pumpLotsFromEcs(ecs);
            const ecList = ecs.map(ecOf);
            const so = soStatuses(ecList, lots);
            const span = ecs.length;
            const soCell = "px-3 py-2 align-top border-b border-card-border";
            const unread = unreadThreads[orderId] ?? 0;
            return (
              <Fragment key={orderId}>
                {ecs.map((r, k) => {
                  const e = ecList[k];
                  const d = ecDone(lots, e.id);
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
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                            {lots.length === 0 ? (
                              <span className="text-muted">—</span>
                            ) : (
                              lots.map((l) => (
                                <span key={l.n} className="block text-xs">
                                  <span className="font-semibold">Lot {l.n}</span>{" "}
                                  <span className="text-muted">
                                    {l.packed_date ? "Packed" : l.assembled_date ? "Assembled" : l.status || "—"}
                                  </span>
                                </span>
                              ))
                            )}
                          </td>
                          <td rowSpan={span} className={`${soCell} border-l border-card-border`}>
                            <Chip label={so.assembly} />
                          </td>
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                            <PlannedCell lots={lots} stage="assembly" orderId={orderId} soLabel={soLabel} />
                          </td>
                          <td rowSpan={span} className={`${soCell} border-l border-card-border`}>
                            <Chip label={so.packing} />
                          </td>
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                            <PlannedCell lots={lots} stage="packing" orderId={orderId} soLabel={soLabel} />
                          </td>
                          <td rowSpan={span} className={soCell}>
                            <button
                              type="button"
                              onClick={() => setLotsFor(orderId)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
                            >
                              <Layers className="h-3.5 w-3.5" />
                              Lots
                            </button>
                          </td>
                        </>
                      )}
                      <td className={`${ecCell} whitespace-nowrap border-l border-card-border font-semibold`}>{e.label}</td>
                      <td className={`${ecCell} whitespace-nowrap text-muted`}>{shortDate(((r.ec ?? {}) as Row).ec_date)}</td>
                      <td className={`${ecCell} tabular-nums`}>{e.quantity || "—"}</td>
                      <td className={`${ecCell} tabular-nums`}>{e.ready}</td>
                      <td className={`${ecCell} tabular-nums`}>{d.assembled}</td>
                      <td className={ecCell}>
                        <Chip label={ecStageStatus(d.assembled, e.quantity, "assembly")} />
                      </td>
                      <td className={`${ecCell} tabular-nums`}>{d.packed}</td>
                      <td className={ecCell}>
                        <Chip label={ecStageStatus(d.packed, e.quantity, "packing")} />
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
        const so = lotsFor ? sos.find((s) => s.orderId === lotsFor) : null;
        if (!so) return null;
        return (
          <LotStagesModal
            key={so.orderId}
            orderId={so.orderId}
            soLabel={str(so.ecs[0].so_no) || `#${str(so.ecs[0].sl_no)}`}
            ecs={so.ecs.map(ecOf)}
            lots={pumpLotsFromEcs(so.ecs)}
            canEdit={canEdit}
            onClose={() => setLotsFor(null)}
          />
        );
      })()}
    </>
  );
}

const input =
  "h-9 w-full rounded-lg border border-input-border bg-surface px-2.5 text-[13px] text-foreground focus:border-primary focus:outline-none disabled:bg-background disabled:text-muted";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * One SO's lots, as Planning made them: each lot's ECs, then its assembly
 * (day, shift, Assembled) and its packing (day, shift, PDI, Packed — once
 * assembled).
 */
function LotStagesModal({
  orderId,
  soLabel,
  ecs,
  lots: initialLots,
  canEdit,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  ecs: Ec[];
  lots: PumpLot[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [lots, setLots] = useState<PumpLot[]>(initialLots);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ro = !canEdit;
  const dirty = JSON.stringify(lots) !== JSON.stringify(initialLots);
  const set = (i: number, patch: Partial<PumpLot>) => setLots((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const label = (id: string) => ecs.find((e) => e.id === id)?.label ?? "EC";
  const so = soStatuses(ecs, lots);

  async function save() {
    const stages: LotStages[] = lots.map((l) => ({
      n: l.n,
      assembly_plan_date: l.assembly_plan_date,
      assembly_shift: l.assembly_shift,
      assembled_date: l.assembled_date,
      packing_plan_date: l.packing_plan_date,
      packing_shift: l.packing_shift,
      pdi: l.pdi,
      packed_date: l.packed_date,
    }));
    const problem = lotStagesError(stages);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveLotStagesAction(orderId, stages);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Lots · ${soLabel}`} className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Assembly &amp; packing · {soLabel}</h2>
            <p className="text-xs text-muted">Lot by lot, as Planning readied them: assemble a lot, then pack it.</p>
          </div>
          <div className="flex items-center gap-2">
            <Chip label={so.assembly} />
            <Chip label={so.packing} />
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {lots.length === 0 ? (
          <p className="rounded-xl border border-dashed border-card-border px-4 py-8 text-center text-sm text-muted">
            Planning has no readiness lots on this SO yet.
          </p>
        ) : (
          <div className="space-y-3">
            {lots.map((l, i) => {
              const named = l.ecs.length > 0;
              const assembled = !!l.assembled_date;
              return (
                <section key={l.n} className={`rounded-xl border p-4 ${l.packed_date ? "border-emerald-200 bg-emerald-50/30" : "border-card-border"}`}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Lot {l.n} <span className="font-normal text-muted">· {l.status || "—"} · ready {shortDate(l.ready_date)}</span>
                      </p>
                      <p className="text-xs text-muted">
                        {named ? l.ecs.map((e) => `${label(e.id)} ×${e.qty}`).join(", ") : "No ECs named — Planning sets them in its lot form."}
                      </p>
                    </div>
                    <Chip label={l.packed_date ? "Packed" : assembled ? "Assembled" : "Pending"} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-card-border p-3">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                        <Wrench className="h-3.5 w-3.5" /> Assembly
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Plan date">
                          <input type="date" value={l.assembly_plan_date} disabled={ro || !named} onChange={(e) => set(i, { assembly_plan_date: e.target.value })} className={input} />
                        </Field>
                        <Field label="Shift">
                          <select value={l.assembly_shift} disabled={ro || !named} onChange={(e) => set(i, { assembly_shift: e.target.value })} className={input}>
                            <option value="">—</option>
                            {ASSEMBLY_SHIFTS.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </Field>
                        <label className="col-span-2 flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={assembled}
                            disabled={ro || !named || !!l.packed_date}
                            onChange={(e) => set(i, { assembled_date: e.target.checked ? l.assembly_plan_date || todayIso() : "" })}
                            className="h-4 w-4 accent-primary"
                          />
                          Assembled
                          {assembled && (
                            <input
                              type="date"
                              value={l.assembled_date}
                              disabled={ro || !!l.packed_date}
                              onChange={(e) => set(i, { assembled_date: e.target.value })}
                              aria-label={`Lot ${l.n} assembled on`}
                              className={`${input} ml-auto w-40`}
                            />
                          )}
                        </label>
                      </div>
                    </div>
                    <div className={`rounded-lg border border-card-border p-3 ${assembled ? "" : "opacity-60"}`}>
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                        <Package className="h-3.5 w-3.5" /> Packing
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        <Field label="Plan date">
                          <input type="date" value={l.packing_plan_date} disabled={ro || !named} onChange={(e) => set(i, { packing_plan_date: e.target.value })} className={input} />
                        </Field>
                        <Field label="Shift">
                          <select value={l.packing_shift} disabled={ro || !named} onChange={(e) => set(i, { packing_shift: e.target.value })} className={input}>
                            <option value="">—</option>
                            {ASSEMBLY_SHIFTS.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="PDI">
                          <select value={l.pdi} disabled={ro || !named} onChange={(e) => set(i, { pdi: e.target.value })} className={input}>
                            <option value="">—</option>
                            {PDI_CHOICES.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </Field>
                        <label className="col-span-3 flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={!!l.packed_date}
                            disabled={ro || !assembled}
                            onChange={(e) => set(i, { packed_date: e.target.checked ? l.packing_plan_date || todayIso() : "" })}
                            className="h-4 w-4 accent-primary"
                          />
                          Packed
                          {!assembled && <span className="text-xs text-muted">(once assembled)</span>}
                          {l.packed_date && (
                            <input
                              type="date"
                              value={l.packed_date}
                              disabled={ro}
                              onChange={(e) => set(i, { packed_date: e.target.value })}
                              aria-label={`Lot ${l.n} packed on`}
                              className={`${input} ml-auto w-40`}
                            />
                          )}
                        </label>
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {canEdit && lots.length > 0 && (
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
