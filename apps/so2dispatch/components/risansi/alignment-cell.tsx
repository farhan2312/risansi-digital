"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";
import {
  basePlateHistoryAction,
  saveAlignmentLotsAction,
  type AlignmentLotInput,
  type BasePlateEvent,
  type AssemblyResult,
  type BasePlate,
  type WoodenBox,
} from "@/app/risansi/orders/assembly-actions";
import { BASE_PLATE_STATUSES, WOODEN_BOX_SOURCES, WOODEN_BOX_STATUSES, alignmentLotsOf, inHouseToPlan, type AlignmentPart } from "@/lib/assembly";

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
export type AlignmentEc = { id: string; label: string };

/** A lot as the form holds it. */
type Draft = {
  n: number;
  ecs: { item_id: string; qty: number }[];
  /** Its own row once set (else it shows what it takes). */
  id: string;
  plate: BasePlate;
  boxRequired: string;
  boxes: WoodenBox[];
};

const draftOf = (l: AlignmentPart & { n: number; ecs: { item_id: string; qty: number }[]; id: string }): Draft => ({
  n: l.n,
  ecs: l.ecs,
  id: l.id,
  plate: { required: l.base_plate, status: l.base_plate_status || "Pending", date: l.base_plate_date, remarks: l.base_plate_remarks },
  boxRequired: l.wooden_box,
  boxes: l.wooden_boxes.map(boxFrom),
});

/**
 * The SO's alignment, lot by lot as Planning has them, for the base plate or
 * the wooden box (each filled by its own person). With no Planning lot yet,
 * the SO as a whole.
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
  const [lots, setLots] = useState<Draft[]>(() => {
    const { lots: saved } = alignmentLotsOf(a.lot_data);
    if (saved.length) return saved.map(draftOf);
    // No Planning lot and nothing set: the SO as a whole, from what it has.
    return [
      draftOf({
        n: 0,
        id: "",
        ecs: [],
        base_plate: str(a.base_plate),
        base_plate_status: str(a.base_plate_status),
        base_plate_date: str(a.base_plate_date).slice(0, 10),
        base_plate_remarks: str(a.base_plate_remarks),
        base_plate_steps: [],
        wooden_box: str(a.wooden_box),
        wooden_boxes: boxesOf(a),
      }),
    ];
  });
  const set = (n: number, patch: Partial<Draft>) => setLots((p) => p.map((l) => (l.n === n ? { ...l, ...patch } : l)));
  const label = (id: string) => ecs.find((e) => e.id === id)?.label || "—";

  const save = () =>
    saveAlignmentLotsAction(
      orderId,
      lots.map(
        (l): AlignmentLotInput =>
          which === "base_plate" ? { n: l.n, base_plate: l.plate } : { n: l.n, wooden_box: { required: l.boxRequired, boxes: l.boxes } }
      )
    );

  return (
    <AlignmentDialog title={which === "base_plate" ? "Base Plate" : "Wooden Box"} soLabel={soLabel} save={save} onClose={onClose}>
      {lots.map((l) => (
        <div key={l.n} className="space-y-3 rounded-xl border border-card-border p-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{l.n > 0 ? `Lot ${l.n}` : "All pumps"}</p>
            <p className="text-[11px] text-muted">
              {l.n > 0
                ? l.ecs.map((e) => `EC ${label(e.item_id)} ×${e.qty}`).join(", ")
                : "Planning has no lots on this SO yet: set for the SO as a whole."}
            </p>
          </div>
          {which === "base_plate" ? (
            <>
              <BasePlateFields v={l.plate} set={(patch) => set(l.n, { plate: { ...l.plate, ...patch } })} />
              {l.id && <BasePlateHistory orderId={orderId} lotId={l.id} />}
            </>
          ) : (
            <WoodenBoxFields
              required={l.boxRequired}
              setRequired={(v) => set(l.n, { boxRequired: v })}
              boxes={l.boxes}
              setBoxes={(boxes) => set(l.n, { boxes })}
            />
          )}
        </div>
      ))}
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
 * form. With Planning's lots, each lot on a line with its own value; without,
 * the SO's.
 */
export function AlignmentValue({
  alignment,
  which,
  canEdit,
  onOpen,
}: {
  alignment: unknown;
  which: "base_plate" | "wooden_box";
  canEdit: boolean;
  onOpen: () => void;
}) {
  const a = (alignment ?? {}) as Row;
  const lots = alignmentLotsOf(a.lot_data).lots.filter((l) => l.n > 0);
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={onOpen}
      title={canEdit ? (which === "base_plate" ? "Set the base plate" : "Set the wooden box") : undefined}
      className="w-full text-left enabled:hover:opacity-80 disabled:cursor-default"
    >
      {lots.length ? (
        <span className="flex flex-col items-start gap-1.5">
          {lots.map((l) => (
            <span key={l.n} className="flex items-start gap-1.5">
              <span className="pt-0.5 text-[11px] font-semibold text-foreground">L{l.n}</span>
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

/** An EC's base plate on its own row: each of Planning's lots it is in, with that lot's status and day. */
export function EcBasePlate({ alignment, ecId }: { alignment: unknown; ecId: string }) {
  const a = (alignment ?? {}) as Row;
  const lots = alignmentLotsOf(a.lot_data).lots.filter((l) => l.n === 0 || l.ecs.some((e) => e.item_id === ecId));
  const one = (l: Row) => (
    <Value yes={str(l.base_plate)} status={str(l.base_plate_status)} done={DONE.base_plate} date={str(l.base_plate_date)} />
  );
  if (lots.length === 0) return one(a);
  return (
    <span className="flex flex-col items-start gap-1">
      {lots.map((l) => (
        <span key={l.n} className="flex items-start gap-1.5">
          {l.n > 0 && <span className="pt-0.5 text-[11px] font-semibold text-foreground">L{l.n}</span>}
          {one(l as unknown as Row)}
        </span>
      ))}
    </span>
  );
}
