"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Layers, Loader2, MessageSquare, Moon, Package, Plus, Sun, Wrench, X } from "lucide-react";
import { PUMP_LIKE, READY_LOT_LIMIT } from "@/lib/order-schema";
import {
  ASSEMBLY_SHIFTS,
  PDI_CHOICES,
  ecDone,
  ecReadyLots,
  ecStageStatus,
  lotAssembly,
  lotStagesError,
  pumpLotsFromEcs,
  soStatuses,
  type AsmEntry,
  type LotStages,
  type PumpLot,
} from "@/lib/assembly";
import { saveLotStagesAction } from "@/app/risansi/orders/assembly-actions";
import { PackingPlanHistoryButton } from "./packing-plan-history";
import { PackingSlipsInline } from "./packing-slips-inline";
import { AlignmentForm, AlignmentValue } from "./alignment-cell";
import { Chip, LotCell } from "./lot-cell";
import { cvHeld, HoldBadge, HoldChip } from "./hold-badge";
import { DispatchStatusPill, NotAtDispatch } from "./dispatch-status-pill";

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

/** A pump EC as assembly and packing read it. */
/** model: its Internal Model. */
type Ec = { id: string; label: string; model: string; quantity: number; ready: number };
const ecOf = (r: Row): Ec => ({
  id: str(r.id),
  label: str(r.ec_no) || "EC",
  model: str(((r.ec ?? {}) as Row).internal_model),
  quantity: num(((r.ec ?? {}) as Row).quantity),
  ready: num(r.ready_qty),
});

/**
 * Each lot's planned date for a stage — "L1 22 Oct 2026 · Night", a green
 * tick once that lot is done — the whole cell opening how the plan moved.
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
              <span key={l.n} title={done ? `${stage === "assembly" ? "Assembled" : "Packed"} ${shortDate(done)}` : undefined} className="inline-flex items-center gap-1 text-xs text-foreground">
                <span className="font-semibold">L{l.n}</span> {shortDate(date)}
                {shift === "Night" ? <Moon className="h-3 w-3" /> : shift ? <Sun className="h-3 w-3" /> : null}
                {stage === "packing" && l.pdi ? <span className="text-muted">PDI {l.pdi}</span> : null}
                {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-label="Done" /> : null}
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
  canEditCentral = false,
  onThread,
}: {
  rows: Row[];
  unreadThreads: Record<string, number>;
  canEdit: boolean;
  canEditCentral?: boolean;
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
  // The SO whose Alignment is open.
  const [alignFor, setAlignFor] = useState<string | null>(null);
  const alignSo = alignFor ? sos.find((x) => x.orderId === alignFor) : null;
  // Lot 1 to n, each in its own column: as many as any SO here has, at least READY_LOT_LIMIT.
  const lotCols = Array.from(
    { length: Math.max(READY_LOT_LIMIT, ...sos.map((s) => pumpLotsFromEcs(s.ecs).length)) },
    (_, i) => i + 1
  );
  const th = "px-3 py-2 whitespace-nowrap";
  const group = "border-l border-card-border px-3 pt-2.5 pb-1 text-center";

  return (
    <>
      {alignSo && (
        <AlignmentForm
          orderId={alignSo.orderId}
          soLabel={str(alignSo.ecs[0]?.so_no) || `#${str(alignSo.ecs[0]?.sl_no)}`}
          alignment={alignSo.ecs[0]?.alignment}
          onClose={() => setAlignFor(null)}
        />
      )}
      <table className="w-full min-w-[1900px] text-sm">
        <thead className="relative z-10 bg-surface data-[stuck=1]:shadow-[0_2px_6px_-2px_rgba(0,0,0,0.18)] [&_th]:bg-surface">
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
            <th colSpan={5} className="px-3 pt-2.5 pb-1">SO</th>
            <th colSpan={lotCols.length} className={group}>Lots</th>
            <th colSpan={2} className={group}>Alignment</th>
            <th colSpan={2} className={group}>Assembly</th>
            <th colSpan={3} className={group}>Packing</th>
            <th colSpan={1} className={group} />
            <th colSpan={1} className={group}>Dispatch</th>
            <th colSpan={9} className={group}>EC</th>
          </tr>
          <tr className="border-b border-card-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <th className={th}>Sl.</th>
            <th className={`${th} sticky-so`}>SO No.</th>
            <th className={th}>SO Date</th>
            <th className={th}>Chat</th>
            <th className={th}>PPC Status</th>
            {lotCols.map((n, i) => (
              <th key={n} className={`${th} ${i === 0 ? "border-l border-card-border" : ""}`}>Lot {n}</th>
            ))}
            <th className={`${th} border-l border-card-border`}>Base Plate</th>
            <th className={th}>Wooden Box</th>
            <th className={`${th} border-l border-card-border`}>Status</th>
            <th className={th}>Planned Date</th>
            <th className={`${th} border-l border-card-border`}>Status</th>
            <th className={th}>Planned Date</th>
            <th className={th} />
            <th className={`${th} border-l border-card-border`}>Packing Slips</th>
            <th className={`${th} border-l border-card-border`}>Status</th>
            <th className={`${th} border-l border-card-border`}>EC No. / Internal Model</th>
            <th className={th}>EC Date</th>
            <th className={th}>Assembly Readiness Date</th>
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
              <td colSpan={23 + lotCols.length} className="px-4 py-10 text-center text-sm text-muted">
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
                          <td rowSpan={span} data-focus-row={orderId} className={`${soCell} tabular-nums`}>{str(head.sl_no)}</td>
                          <td rowSpan={span} className={`${soCell} sticky-so whitespace-nowrap font-semibold`}>
                            {soLabel}
                            <HoldBadge order={head} />
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
                          {/* Each lot's work, a column per lot. */}
                          {lotCols.map((n, i) => (
                            <td key={n} rowSpan={span} className={`${soCell} ${i === 0 ? "border-l border-card-border" : ""}`}>
                              <LotCell lot={lots.find((l) => l.n === n)} slips={(head.so_child_rows ?? []) as Row[]} />
                            </td>
                          ))}
                          {/* The SO's Alignment: base plate and wooden box. */}
                          <td rowSpan={span} className={`${soCell} border-l border-card-border`}>
                            <AlignmentValue alignment={head.alignment} which="base_plate" canEdit={canEdit} onOpen={() => setAlignFor(orderId)} />
                          </td>
                          <td rowSpan={span} className={soCell}>
                            <AlignmentValue alignment={head.alignment} which="wooden_box" canEdit={canEdit} onOpen={() => setAlignFor(orderId)} />
                          </td>
                          <td rowSpan={span} className={`${soCell} border-l border-card-border`}>
                            {cvHeld(head) ? <HoldChip /> : <Chip label={so.assembly} />}
                          </td>
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap`}>
                            <PlannedCell lots={lots} stage="assembly" orderId={orderId} soLabel={soLabel} />
                          </td>
                          <td rowSpan={span} className={`${soCell} border-l border-card-border`}>
                            {cvHeld(head) ? <HoldChip /> : <Chip label={so.packing} />}
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
                          {/* The SO's packing slips, each naming the lots it carries. */}
                          <td rowSpan={span} className={`${soCell} border-l border-card-border`}>
                            <PackingSlipsInline
                              orderId={orderId}
                              soLabel={soLabel}
                              slips={(head.so_child_rows ?? []) as Row[]}
                              context={{ market_type: head.market_type, packing_details_required: head.packing_details_required }}
                              gateOk={str(head.market_type).trim() !== ""}
                              canEdit={canEdit}
                              canEditCentral={canEditCentral}
                              lotCount={lots.length}
                              packedLots={lots.filter((l) => l.packed_date).map((l) => l.n)}
                            />
                          </td>
                          {/* Where Dispatch has got to: — until it has the SO (a numbered packing slip). */}
                          <td rowSpan={span} className={`${soCell} whitespace-nowrap border-l border-card-border`}>
                            {cvHeld(head) ? (
                              <HoldChip />
                            ) : ((head.so_child_rows ?? []) as Row[]).some((sl) => str(sl.packing_slip_no).trim() !== "") ? (
                              <DispatchStatusPill status={str(head.so_dispatch_status) || "Pending"} />
                            ) : (
                              <NotAtDispatch />
                            )}
                          </td>
                        </>
                      )}
                      <td className={`${ecCell} whitespace-nowrap border-l border-card-border font-semibold`}>
                        {e.label}
                        {e.model && <div className="text-xs font-normal text-muted">{e.model}</div>}
                      </td>
                      <td className={`${ecCell} whitespace-nowrap text-muted`}>{shortDate(((r.ec ?? {}) as Row).ec_date)}</td>
                      {/* Planning's readiness for this EC, lot by lot: the lots it has a
                          share in (its own date when it has no lots). */}
                      <td className={`${ecCell} whitespace-nowrap`}>
                        {(() => {
                          const mine = ecReadyLots(lots, e.id);
                          if (mine.length === 0) return shortDate(r.planning_readiness_date);
                          return mine.map((l) => (
                            <div key={l.n} className="text-xs">
                              <span className="font-semibold">L{l.n}</span> {shortDate(l.date)}
                              <span className="text-muted"> ×{l.qty}</span>
                            </div>
                          ));
                        })()}
                      </td>
                      <td className={`${ecCell} tabular-nums`}>{e.quantity || "—"}</td>
                      <td className={`${ecCell} tabular-nums`}>{e.ready}</td>
                      <td className={`${ecCell} tabular-nums`}>{d.assembled}</td>
                      <td className={ecCell}>
                        {cvHeld(head) ? <HoldChip /> : <Chip label={ecStageStatus(d.assembled, e.quantity, "assembly")} />}
                      </td>
                      <td className={`${ecCell} tabular-nums`}>{d.packed}</td>
                      <td className={ecCell}>
                        {cvHeld(head) ? <HoldChip /> : <Chip label={ecStageStatus(d.packed, e.quantity, "packing")} />}
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
 * One SO's lots, as Planning made them: each lot's ECs, then its assembly —
 * EC by EC, entries picking an EC of the lot and how many, on a day and
 * shift, ticked Assembled — and its packing as one (day, shift, PDI,
 * Packed — once all of the lot is assembled).
 */
type Entry = AsmEntry & { key: string };
let entryKeys = 0;
const newKey = () => `new-${++entryKeys}`;

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
  const initialEntries = initialLots.flatMap((l) => l.entries.map((e) => ({ ...e, key: e.id })));
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ro = !canEdit;
  const dirty = JSON.stringify([lots, entries]) !== JSON.stringify([initialLots, initialEntries]);
  const set = (i: number, patch: Partial<PumpLot>) => setLots((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const setEntry = (key: string, patch: Partial<Entry>) => setEntries((es) => es.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  // The EC with its internal model, so the pump is plain.
  const label = (id: string) => {
    const e = ecs.find((x) => x.id === id);
    return e ? [e.label, e.model].filter(Boolean).join(" · ") : "EC";
  };
  const inLot = (l: PumpLot) => (e: Entry) => l.ecs.some((x) => x.row_id === e.lot_row_id);
  // The lots as the entries now stand: how many of each EC are assembled, and whether all of the lot is.
  const shown = lots.map((l) => {
    const asm = lotAssembly(l.ecs, entries.filter(inLot(l)));
    return { ...l, ecs: l.ecs.map((x) => ({ ...x, assembled: asm.assembled[x.id] ?? 0 })), assembled_date: asm.assembled_date };
  });
  const so = soStatuses(ecs, shown);
  // How many of an EC's share of a lot no entry has picked yet.
  const unpicked = (l: PumpLot, x: PumpLot["ecs"][number], except?: string) =>
    x.qty - entries.filter((e) => e.lot_row_id === x.row_id && e.key !== except).reduce((t, e) => t + (Number(e.qty) || 0), 0);

  function add(l: PumpLot, which: "one" | "all") {
    const open = l.ecs.filter((x) => unpicked(l, x) > 0);
    const pick = which === "one" ? open.slice(0, 1) : open;
    if (pick.length === 0) return;
    setEntries((es) => [
      ...es,
      ...pick.map((x) => ({
        key: newKey(),
        id: "",
        lot_row_id: x.row_id,
        item_id: x.id,
        qty: unpicked(l, x),
        plan_date: "",
        shift: "",
        assembled_date: "",
      })),
    ]);
  }

  async function save() {
    const stages: LotStages[] = lots.map((l) => ({
      n: l.n,
      packing_plan_date: l.packing_plan_date,
      packing_shift: l.packing_shift,
      pdi: l.pdi,
      packed_date: l.packed_date,
    }));
    const sending: AsmEntry[] = entries.map((e) => ({
      id: e.id,
      lot_row_id: e.lot_row_id,
      item_id: e.item_id,
      qty: Number(e.qty),
      plan_date: e.plan_date,
      shift: e.shift,
      assembled_date: e.assembled_date,
    }));
    const problem = lotStagesError(initialLots, stages, sending);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await saveLotStagesAction(orderId, stages, sending);
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
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Assembly &amp; packing · {soLabel}</h2>
            <p className="text-xs text-muted">
              Lot by lot, as Planning readied them: pick the ECs of a lot and how many to assemble, then pack the lot once all of it is assembled.
            </p>
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
              // A lot only In plan is not ready: nothing to assemble or pack yet.
              const named = l.ecs.length > 0 && l.status !== "In plan";
              const view = shown[i];
              const assembled = !!view.assembled_date;
              const some = view.ecs.some((x) => x.assembled > 0);
              const mine = entries.filter(inLot(l));
              const canAdd = !ro && named && l.ecs.some((x) => unpicked(l, x) > 0);
              return (
                <section key={l.n} className={`rounded-xl border p-4 ${l.packed_date ? "border-emerald-200 bg-emerald-50/30" : "border-card-border"}`}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Lot {l.n} <span className="font-normal text-muted">· {l.status || "—"} · ready {shortDate(l.ready_date)}</span>
                      </p>
                      <p className="text-xs text-muted">
                        {l.ecs.length > 0
                          ? view.ecs.map((x) => `${label(x.id)} ${x.assembled}/${x.qty} assembled`).join(" · ")
                          : "No ECs named — Planning sets them in its lot form."}
                        {l.status === "In plan" ? " · In plan, not ready yet" : ""}
                      </p>
                    </div>
                    <Chip label={l.packed_date ? "Packed" : assembled ? "Assembled" : some ? "Partially assembled" : "Pending"} />
                  </div>
                  <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
                    <div className="rounded-lg border border-card-border p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                          <Wrench className="h-3.5 w-3.5" /> Assembly
                        </p>
                        {canAdd && (
                          <span className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => add(l, "one")}
                              className="inline-flex h-7 items-center gap-1 rounded-lg border border-input-border px-2 text-[11px] font-semibold text-foreground hover:bg-background"
                            >
                              <Plus className="h-3 w-3" /> Add EC
                            </button>
                            <button
                              type="button"
                              onClick={() => add(l, "all")}
                              className="inline-flex h-7 items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2 text-[11px] font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
                            >
                              <Plus className="h-3 w-3" /> All remaining
                            </button>
                          </span>
                        )}
                      </div>
                      {mine.length === 0 ? (
                        <p className="py-2 text-xs text-muted">
                          {named ? "No ECs picked to assemble yet." : "Nothing to assemble until the lot is ready."}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <div className="hidden grid-cols-[minmax(0,2fr)_4.5rem_8.5rem_5.5rem_minmax(0,2fr)_1.75rem] gap-2 text-[11px] font-medium text-muted sm:grid">
                            <span>EC</span>
                            <span>Qty</span>
                            <span>Plan date</span>
                            <span>Shift</span>
                            <span>Assembled</span>
                            <span />
                          </div>
                          {mine.map((e) => {
                            const x = l.ecs.find((y) => y.row_id === e.lot_row_id);
                            const max = x ? unpicked(l, x, e.key) : 0;
                            const lock = ro || !!l.packed_date;
                            return (
                              <div key={e.key} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(0,2fr)_4.5rem_8.5rem_5.5rem_minmax(0,2fr)_1.75rem]">
                                <select
                                  value={e.lot_row_id}
                                  disabled={lock}
                                  aria-label="EC"
                                  onChange={(ev) => {
                                    const y = l.ecs.find((z) => z.row_id === ev.target.value);
                                    if (y) setEntry(e.key, { lot_row_id: y.row_id, item_id: y.id, qty: Math.max(1, Math.min(Number(e.qty) || 1, unpicked(l, y, e.key))) });
                                  }}
                                  className={input}
                                >
                                  {l.ecs.map((y) => (
                                    <option key={y.row_id} value={y.row_id}>
                                      {label(y.id)} (of {y.qty})
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min={1}
                                  max={max}
                                  value={e.qty || ""}
                                  disabled={lock}
                                  aria-label="Quantity"
                                  onChange={(ev) => setEntry(e.key, { qty: Number(ev.target.value) })}
                                  className={input}
                                />
                                <input
                                  type="date"
                                  value={e.plan_date}
                                  disabled={lock}
                                  aria-label="Plan date"
                                  onChange={(ev) => setEntry(e.key, { plan_date: ev.target.value })}
                                  className={input}
                                />
                                <select value={e.shift} disabled={lock} aria-label="Shift" onChange={(ev) => setEntry(e.key, { shift: ev.target.value })} className={input}>
                                  <option value="">—</option>
                                  {ASSEMBLY_SHIFTS.map((s) => (
                                    <option key={s}>{s}</option>
                                  ))}
                                </select>
                                <span className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={!!e.assembled_date}
                                    disabled={lock}
                                    aria-label="Assembled"
                                    onChange={(ev) => setEntry(e.key, { assembled_date: ev.target.checked ? e.plan_date || todayIso() : "" })}
                                    className="h-4 w-4 accent-primary"
                                  />
                                  {e.assembled_date ? (
                                    <input
                                      type="date"
                                      value={e.assembled_date}
                                      disabled={lock}
                                      aria-label="Assembled on"
                                      onChange={(ev) => setEntry(e.key, { assembled_date: ev.target.value })}
                                      className={input}
                                    />
                                  ) : (
                                    <span className="text-xs text-muted">Not yet</span>
                                  )}
                                </span>
                                {!lock && (
                                  <button
                                    type="button"
                                    onClick={() => setEntries((es) => es.filter((y) => y.key !== e.key))}
                                    aria-label="Remove"
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-background hover:text-rose-600"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
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
                          {!assembled && <span className="text-xs text-muted">(once all of the lot is assembled)</span>}
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
