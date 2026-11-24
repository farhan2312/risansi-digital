"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  basePlateHistoryAction,
  saveAlignmentLotsAction,
  type AlignmentLotInput,
  type BasePlateEvent,
  type AssemblyResult,
  type BasePlate,
  type WoodenBox,
} from "@/app/risansi/orders/assembly-actions";
import { BASE_PLATE_STATUSES, WOODEN_BOX_SOURCES, WOODEN_BOX_STATUSES, alignmentLotsOf, inHouseToPlan, type AlignmentLot } from "@/lib/assembly";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

/** The SO's (or a lot's) wooden boxes, a row per way (in house, bought out). */
const boxesOf = (a: Row): Row[] => (Array.isArray(a.wooden_boxes) ? (a.wooden_boxes as Row[]) : []);

const blankBox = (source: string): WoodenBox => ({
  source,
  required_qty: "",
  stock_qty: "",
  status: "Pending",
  received_date: "",
  received_qty: "",
  remarks: "",
});

const boxFrom = (b: Row): WoodenBox => ({
  source: str(b.source),
  required_qty: str(b.required_qty),
  stock_qty: str(b.stock_qty),
  status: str(b.status) || "Pending",
  received_date: str(b.received_date).slice(0, 10),
  received_qty: str(b.received_qty),
  remarks: str(b.remarks),
});

/** The status each item is done at. */
const DONE = { base_plate: "Manufactured", wooden_box: "Received" } as const;

function shortDate(v: string): string {
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** One Alignment item on the front: its status (Pending until set) and the day, No, or not set. */
function Value({ yes, status, done, date = "" }: { yes: string; status: string; done: string; date?: string }) {
  if (yes === "No") return <span className="text-xs text-muted">No</span>;
  if (yes !== "Yes") return <span className="text-xs text-muted">—</span>;
  const st = status || "Pending";
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span
        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          st === done ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
        }`}
      >
        {st}
      </span>
      {date && <span className="whitespace-nowrap text-[11px] text-muted">{shortDate(date)}</span>}
    </span>
  );
}

const input =
  "h-10 w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";

/** A labelled input, or (group) a labelled row of choices — a label would click the first. */
function Field({ label, required, group, children }: { label: string; required?: boolean; group?: boolean; children: React.ReactNode }) {
  const Box = group ? "div" : "label";
  return (
    <Box className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
    </Box>
  );
}

/** A row of choices, one or several on. */
function Pills({ options, on, pick }: { options: string[]; on: (o: string) => boolean; pick: (o: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => pick(o)}
          className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
            on(o) ? "border-primary bg-primary text-primary-foreground" : "border-input-border text-muted hover:bg-background"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

const YES_NO = ["Yes", "No"];

/** The pop-up the form sits in: its title, Save and Cancel. */
function AlignmentDialog({
  title,
  soLabel,
  save,
  onClose,
  children,
}: {
  title: string;
  soLabel: string;
  save: () => Promise<AssemblyResult>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await save();
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted">SO {soLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">{children}</div>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-10 items-center rounded-lg border border-input-border px-4 text-sm font-medium text-foreground hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

/** A lot's base plate: Yes or No, then its status, day and remarks. */
function BasePlateFields({ v, set }: { v: BasePlate; set: (patch: Partial<BasePlate>) => void }) {
  return (
    <>
      <Field label="Base Plate" required group>
        <Pills options={YES_NO} on={(o) => v.required === o} pick={(o) => set({ required: o })} />
      </Field>
      {v.required === "Yes" && (
        <>
          <Field label="Status" required group>
            <Pills options={BASE_PLATE_STATUSES} on={(o) => v.status === o} pick={(o) => set({ status: o })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" required={v.status !== "Pending"}>
              <input type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} className={input} />
            </Field>
            <Field label="Remarks">
              <input type="text" value={v.remarks} onChange={(e) => set({ remarks: e.target.value })} className={input} />
            </Field>
          </div>
        </>
      )}
    </>
  );
}

/** A lot's wooden boxes: Yes or No, then each way (in house, bought out) with its own quantities, status and receipt. */
function WoodenBoxFields({
  required,
  setRequired,
  boxes,
  setBoxes,
}: {
  required: string;
  setRequired: (v: string) => void;
  boxes: WoodenBox[];
  setBoxes: (b: WoodenBox[]) => void;
}) {
  const has = (source: string) => boxes.some((b) => b.source === source);
  const setBox = (source: string, patch: Partial<WoodenBox>) => setBoxes(boxes.map((b) => (b.source === source ? { ...b, ...patch } : b)));
  return (
    <>
      <Field label="Wooden Box" required group>
        <Pills options={YES_NO} on={(o) => required === o} pick={setRequired} />
      </Field>
      {required === "Yes" && (
        <Field label="In house / Bought out" required group>
          <Pills
            options={WOODEN_BOX_SOURCES}
            on={has}
            pick={(o) =>
              setBoxes(
                has(o)
                  ? boxes.filter((b) => b.source !== o)
                  : WOODEN_BOX_SOURCES.flatMap((s) => (s === o ? [blankBox(s)] : boxes.filter((b) => b.source === s)))
              )
            }
          />
        </Field>
      )}
      {/* Each way with its own: some pumps' boxes in house, some bought out. */}
      {required === "Yes" &&
        boxes.map((b) => {
          // In house: stock covering the required quantity needs no plan; short, the rest is planned.
          const inHouse = b.source === "In house";
          const toPlan = inHouseToPlan(b.required_qty, b.stock_qty);
          const fromStock = inHouse && String(b.required_qty).trim() !== "" && toPlan === 0;
          return (
            <div key={b.source} className="space-y-3 rounded-lg border border-card-border/70 bg-background/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{b.source}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Required Quantity" required>
                  <input type="number" min={0} step={1} value={b.required_qty} onChange={(e) => setBox(b.source, { required_qty: e.target.value })} className={input} />
                </Field>
                <Field label="Stock Quantity">
                  <input type="number" min={0} step={1} value={b.stock_qty} onChange={(e) => setBox(b.source, { stock_qty: e.target.value })} className={input} />
                </Field>
              </div>
              {fromStock ? (
                <p className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  Covered from stock: nothing to plan.
                </p>
              ) : (
                <>
                  {inHouse && toPlan > 0 && String(b.required_qty).trim() !== "" && (
                    <p className="text-xs font-medium text-amber-700">To plan in house: {toPlan}</p>
                  )}
                  <Field label="Status" required group>
                    <Pills options={WOODEN_BOX_STATUSES} on={(o) => b.status === o} pick={(o) => setBox(b.source, { status: o })} />
                  </Field>
                </>
              )}
              {/* Received on a day, in a quantity. */}
              {!fromStock && b.status === "Received" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Received Date" required>
                    <input type="date" value={b.received_date} onChange={(e) => setBox(b.source, { received_date: e.target.value })} className={input} />
                  </Field>
                  <Field label="Received Quantity" required>
                    <input type="number" min={1} step={1} value={b.received_qty} onChange={(e) => setBox(b.source, { received_qty: e.target.value })} className={input} />
                  </Field>
                </div>
              )}
              <Field label="Remarks">
                <input type="text" value={b.remarks} onChange={(e) => setBox(b.source, { remarks: e.target.value })} className={input} />
              </Field>
            </div>
          );
        })}
    </>
  );
}

/** The base plate's steps so far on a lot: each status with its day, who set it and when. */
function BasePlateHistory({ orderId, lotId }: { orderId: string; lotId: string }) {
  const [rows, setRows] = useState<BasePlateEvent[] | null>(null);
  useEffect(() => {
    let live = true;
    basePlateHistoryAction(orderId, lotId)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [orderId, lotId]);
  if (!rows || rows.length === 0) return null;
  return (
    <details className="rounded-lg border border-card-border/70 p-3">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">History</summary>
      <ul className="mt-1.5 space-y-1">
        {rows.map((h, i) => (
          <li key={i} className="text-xs">
            <span className="font-semibold text-foreground">{h.status}</span>
            {h.stage_date && <span className="text-foreground"> · {shortDate(h.stage_date)}</span>}
            {h.prev_status && h.prev_status !== h.status && <span className="text-muted"> (from {h.prev_status})</span>}
            {h.remarks && <span className="text-muted"> · {h.remarks}</span>}
            <span className="block text-[11px] text-muted">{[h.changed_by_name, shortDate(h.changed_at)].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A pump EC of the SO, as the lots name it. */
export type AlignmentEc = { id: string; label: string; quantity: number; base_plate: string };

/** A lot as the form holds it. */
type Draft = {
  key: string;
  id: string;
  ecs: Record<string, string>;
  plate: BasePlate;
  boxRequired: string;
  boxes: WoodenBox[];
};

let draftKey = 0;
const nextKey = () => `new-${++draftKey}`;

/**
 * The SO's alignment lots, for the base plate or the wooden box (each filled
 * by its own person): each lot's ECs and how many of each, and that part of
 * it. Lots are added and removed here; an SO with none starts with a lot of
 * all its pumps, carrying what the SO has.
 */
export function AlignmentLotsForm({
  orderId,
  soLabel,
  which,
  alignment,
  ecs,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  which: "base_plate" | "wooden_box";
  alignment: unknown;
  ecs: AlignmentEc[];
  onClose: () => void;
}) {
  const a = (alignment ?? {}) as Row;
  const saved = alignmentLotsOf(a.lots);
  const plateFor = (ecQty: Record<string, string>) =>
    ecs.some((e) => Number(ecQty[e.id] || 0) > 0 && e.base_plate === "Yes") ? "Yes" : "No";
  const [lots, setLots] = useState<Draft[]>(() =>
    saved.length
      ? saved.map((l) => ({
          key: l.id,
          id: l.id,
          ecs: Object.fromEntries(l.ecs.map((e) => [e.item_id, String(e.qty)])),
          plate: {
            required: l.base_plate,
            status: l.base_plate_status || "Pending",
            date: l.base_plate_date,
            remarks: l.base_plate_remarks,
          },
          boxRequired: l.wooden_box,
          boxes: l.wooden_boxes.map(boxFrom),
        }))
      : [
          {
            key: nextKey(),
            id: "",
            ecs: Object.fromEntries(ecs.map((e) => [e.id, String(e.quantity)])),
            plate: {
              required: str(a.base_plate),
              status: str(a.base_plate_status) || "Pending",
              date: str(a.base_plate_date).slice(0, 10),
              remarks: str(a.base_plate_remarks),
            },
            boxRequired: str(a.wooden_box),
            boxes: boxesOf(a).map(boxFrom),
          },
        ]
  );
  const [deleted, setDeleted] = useState<string[]>([]);
  const set = (key: string, patch: Partial<Draft>) => setLots((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const used = (ecId: string, except = "") =>
    lots.filter((l) => l.key !== except).reduce((t, l) => t + (Number(l.ecs[ecId] || 0) || 0), 0);

  function addLot() {
    const left = Object.fromEntries(ecs.map((e) => [e.id, String(Math.max(0, e.quantity - used(e.id)))]));
    setLots((p) => [
      ...p,
      {
        key: nextKey(),
        id: "",
        ecs: left,
        plate: { required: plateFor(left), status: "Pending", date: "", remarks: "" },
        boxRequired: str(a.wooden_box),
        boxes: [],
      },
    ]);
  }

  function removeLot(l: Draft, n: number) {
    if (l.id && !window.confirm(`Remove Lot ${n}? Its base plate and wooden box go with it.`)) return;
    if (l.id) setDeleted((d) => [...d, l.id]);
    setLots((p) => p.filter((x) => x.key !== l.key));
  }

  const save = () =>
    saveAlignmentLotsAction(
      orderId,
      lots.map(
        (l): AlignmentLotInput => ({
          id: l.id,
          ecs: ecs.map((e) => ({ item_id: e.id, qty: l.ecs[e.id] ?? "" })),
          ...(which === "base_plate" ? { base_plate: l.plate } : { wooden_box: { required: l.boxRequired, boxes: l.boxes } }),
        })
      ),
      deleted
    );

  return (
    <AlignmentDialog title={which === "base_plate" ? "Base Plate · lots" : "Wooden Box · lots"} soLabel={soLabel} save={save} onClose={onClose}>
      {lots.length === 0 && <p className="text-sm text-muted">No lots. Add one to set the {which === "base_plate" ? "base plate" : "wooden box"}.</p>}
      {lots.map((l, i) => (
        <div key={l.key} className="space-y-3 rounded-xl border border-card-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">Lot {i + 1}</p>
            <button
              type="button"
              onClick={() => removeLot(l, i + 1)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
          {/* The ECs in the lot: how many of each, never past what the other lots leave. */}
          <Field label="ECs in the lot" required group>
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1.5 text-sm">
              {ecs.map((e) => {
                const left = e.quantity - used(e.id, l.key);
                return (
                  <Fragment key={e.id}>
                    <span className="truncate text-foreground">EC {e.label}</span>
                    <span className="whitespace-nowrap text-[11px] text-muted">
                      of {e.quantity} · {Math.max(0, left)} free
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, left)}
                      step={1}
                      value={l.ecs[e.id] ?? ""}
                      onChange={(ev) => set(l.key, { ecs: { ...l.ecs, [e.id]: ev.target.value } })}
                      className="h-9 w-20 rounded-lg border border-input-border bg-surface px-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                  </Fragment>
                );
              })}
            </div>
          </Field>
          {which === "base_plate" ? (
            <>
              <BasePlateFields v={l.plate} set={(patch) => set(l.key, { plate: { ...l.plate, ...patch } })} />
              {l.id && <BasePlateHistory orderId={orderId} lotId={l.id} />}
            </>
          ) : (
            <WoodenBoxFields
              required={l.boxRequired}
              setRequired={(v) => set(l.key, { boxRequired: v })}
              boxes={l.boxes}
              setBoxes={(boxes) => set(l.key, { boxes })}
            />
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addLot}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-input-border px-3 py-2 text-sm font-medium text-foreground hover:bg-background"
      >
        <Plus className="h-4 w-4" /> Add lot
      </button>
    </AlignmentDialog>
  );
}

/** The base plate or wooden boxes of the SO, or of one lot, on the front. */
function OneAlignment({ a, which }: { a: Row; which: "base_plate" | "wooden_box" }) {
  const needed = str(a[which]) === "Yes";
  const boxes = which === "wooden_box" && needed ? boxesOf(a) : [];
  if (boxes.length) {
    // In house and bought out together, each on a line with its status,
    // then its required, stock and received quantities.
    return (
      <span className="flex flex-col items-start gap-1.5">
        {boxes.map((b) => {
          const n = (v: unknown) => str(v) || "0";
          // In house covered by stock: From stock; short of it, its status for the rest.
          const fromStock =
            str(b.source) === "In house" && str(b.required_qty) !== "" && inHouseToPlan(b.required_qty, b.stock_qty) === 0 && str(b.status) === "Received";
          const st = fromStock ? "From stock" : str(b.status) || "Pending";
          return (
            <span key={str(b.source)} className="flex flex-col items-start gap-0.5">
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-[11px] font-semibold text-foreground">{str(b.source)}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    st === DONE.wooden_box || fromStock ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {st}
                </span>
              </span>
              <span className="whitespace-nowrap text-[11px] text-muted">
                Required {n(b.required_qty)} · Stock {n(b.stock_qty)}
                {!fromStock && ` · Received ${n(b.received_qty)}`}
              </span>
              {st === "Received" && str(b.received_date) && (
                <span className="whitespace-nowrap text-[11px] text-muted">{shortDate(str(b.received_date))}</span>
              )}
            </span>
          );
        })}
      </span>
    );
  }
  const steps = which === "base_plate" && needed && Array.isArray(a.base_plate_steps) ? (a.base_plate_steps as Row[]) : [];
  return (
    <span className="inline-flex items-center gap-1">
      <Value yes={str(a[which])} status={str(a[`${which}_status`])} done={DONE[which]} date={which === "base_plate" ? str(a.base_plate_date) : ""} />
      {/* The steps before this one, each with its day. */}
      {steps.length > 1 && (
        <span className="ml-1 flex flex-col items-start gap-0.5 border-l border-card-border pl-2">
          {steps
            .filter((s) => str(s.status) !== str(a.base_plate_status))
            .map((s) => (
              <span key={str(s.status)} className="whitespace-nowrap text-[11px] text-muted">
                {str(s.status)} {str(s.date) ? shortDate(str(s.date)) : ""}
              </span>
            ))}
        </span>
      )}
    </span>
  );
}

/**
 * One Alignment cell on the front (Base Plate or Wooden Box), opening its own
 * form. With alignment lots, each lot on a line: its ECs, then its own value;
 * without, the SO's.
 */
export function AlignmentValue({
  alignment,
  which,
  canEdit,
  onOpen,
  ecLabels,
}: {
  alignment: unknown;
  which: "base_plate" | "wooden_box";
  canEdit: boolean;
  onOpen: () => void;
  /** The SO's pump ECs' names by id, to say what each lot holds. */
  ecLabels?: Record<string, string>;
}) {
  const a = (alignment ?? {}) as Row;
  const lots: AlignmentLot[] = alignmentLotsOf(a.lots);
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={onOpen}
      title={canEdit ? (which === "base_plate" ? "Set the base plate, lot by lot" : "Set the wooden box, lot by lot") : undefined}
      className="w-full text-left enabled:hover:opacity-80 disabled:cursor-default"
    >
      {lots.length ? (
        <span className="flex flex-col items-start gap-2">
          {lots.map((l) => (
            <span key={l.id} className="flex flex-col items-start gap-0.5">
              <span className="whitespace-nowrap text-[11px]">
                <span className="font-semibold text-foreground">Lot {l.n}</span>
                <span className="text-muted">
                  {" · "}
                  {l.ecs.map((e) => `${ecLabels?.[e.item_id] ? `EC ${ecLabels[e.item_id]}` : "EC"} ×${e.qty}`).join(", ")}
                </span>
              </span>
              <OneAlignment a={l as unknown as Row} which={which} />
            </span>
          ))}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          <OneAlignment a={a} which={which} />
          {canEdit && <Pencil className="h-3 w-3 text-muted" aria-hidden />}
        </span>
      )}
    </button>
  );
}
