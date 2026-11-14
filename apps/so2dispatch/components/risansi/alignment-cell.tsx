"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";
import {
  basePlateHistoryAction,
  saveBasePlateAction,
  type BasePlateEvent,
  saveWoodenBoxAction,
  type AssemblyResult,
  type BasePlate,
  type WoodenBox,
} from "@/app/risansi/orders/assembly-actions";
import { BASE_PLATE_STATUSES, WOODEN_BOX_SOURCES, WOODEN_BOX_STATUSES } from "@/lib/assembly";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

/** The SO's wooden boxes, a row per way (in house, bought out). */
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

/** The pop-up either form sits in: its title, Save and Cancel. */
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
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
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

type FormProps = { orderId: string; soLabel: string; alignment: unknown; onClose: () => void };

/** The base plate's form, for one SO: its own person, its own Save. */
export function BasePlateForm({ orderId, soLabel, alignment, onClose }: FormProps) {
  const a = (alignment ?? {}) as Row;
  const [v, setV] = useState<BasePlate>({
    required: str(a.base_plate),
    status: str(a.base_plate_status) || "Pending",
    date: str(a.base_plate_date).slice(0, 10),
    remarks: str(a.base_plate_remarks),
  });
  const set = (patch: Partial<BasePlate>) => setV((p) => ({ ...p, ...patch }));
  return (
    <AlignmentDialog title="Base Plate" soLabel={soLabel} save={() => saveBasePlateAction(orderId, v)} onClose={onClose}>
      <Field label="Base Plate" required group>
        <Pills options={YES_NO} on={(o) => v.required === o} pick={(o) => set({ required: o })} />
      </Field>
      {v.required === "Yes" && (
        <>
          <Field label="Status" required group>
            <Pills options={BASE_PLATE_STATUSES} on={(o) => v.status === o} pick={(o) => set({ status: o })} />
          </Field>
          <Field label="Date" required={v.status !== "Pending"}>
            <input type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} className={input} />
          </Field>
          <Field label="Remarks">
            <input type="text" value={v.remarks} onChange={(e) => set({ remarks: e.target.value })} className={input} />
          </Field>
        </>
      )}
      <BasePlateHistory orderId={orderId} />
    </AlignmentDialog>
  );
}

/** The base plate's steps so far: each status with its day, who set it and when. */
function BasePlateHistory({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<BasePlateEvent[] | null>(null);
  useEffect(() => {
    let live = true;
    basePlateHistoryAction(orderId)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [orderId]);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-card-border/70 p-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">History</p>
      <ul className="space-y-1">
        {rows.map((h, i) => (
          <li key={i} className="text-xs">
            <span className="font-semibold text-foreground">{h.status}</span>
            {h.stage_date && <span className="text-foreground"> · {shortDate(h.stage_date)}</span>}
            {h.prev_status && h.prev_status !== h.status && <span className="text-muted"> (from {h.prev_status})</span>}
            {h.remarks && <span className="text-muted"> · {h.remarks}</span>}
            <span className="block text-[11px] text-muted">
              {[h.changed_by_name, shortDate(h.changed_at)].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The wooden boxes' form, for one SO: its own person, its own Save. */
export function WoodenBoxForm({ orderId, soLabel, alignment, onClose }: FormProps) {
  const a = (alignment ?? {}) as Row;
  const [required, setRequired] = useState(str(a.wooden_box));
  const [boxes, setBoxes] = useState<WoodenBox[]>(() =>
    boxesOf(a).map((b) => ({
      source: str(b.source),
      required_qty: str(b.required_qty),
      stock_qty: str(b.stock_qty),
      status: str(b.status) || "Pending",
      received_date: str(b.received_date).slice(0, 10),
      received_qty: str(b.received_qty),
      remarks: str(b.remarks),
    }))
  );
  const has = (source: string) => boxes.some((b) => b.source === source);
  const setBox = (source: string, patch: Partial<WoodenBox>) =>
    setBoxes((p) => p.map((b) => (b.source === source ? { ...b, ...patch } : b)));
  return (
    <AlignmentDialog title="Wooden Box" soLabel={soLabel} save={() => saveWoodenBoxAction(orderId, required, boxes)} onClose={onClose}>
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
      {required === "Yes" && boxes.map((b) => (
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
          <Field label="Status" required group>
            <Pills options={WOODEN_BOX_STATUSES} on={(o) => b.status === o} pick={(o) => setBox(b.source, { status: o })} />
          </Field>
          {/* Received on a day, in a quantity. */}
          {b.status === "Received" && (
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
      ))}
    </AlignmentDialog>
  );
}

/** One Alignment cell on the front (Base Plate or Wooden Box), opening its own form: Yes or No is theirs to change. */
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
  const needed = str(a[which]) === "Yes";
  const boxes = which === "wooden_box" && needed ? boxesOf(a) : [];
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={onOpen}
      title={canEdit ? (which === "base_plate" ? "Set the base plate" : "Set the wooden box") : undefined}
      className="w-full text-left enabled:hover:opacity-80 disabled:cursor-default"
    >
      {boxes.length ? (
        // In house and bought out together, each on a line with its status,
        // then its required, stock and received quantities.
        <span className="flex flex-col items-start gap-1.5">
          {boxes.map((b) => {
            const st = str(b.status) || "Pending";
            const n = (v: unknown) => str(v) || "0";
            return (
              <span key={str(b.source)} className="flex flex-col items-start gap-0.5">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-[11px] font-semibold text-foreground">{str(b.source)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      st === DONE.wooden_box ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {st}
                  </span>
                </span>
                <span className="whitespace-nowrap text-[11px] text-muted">
                  Required {n(b.required_qty)} · Stock {n(b.stock_qty)} · Received {n(b.received_qty)}
                </span>
                {st === "Received" && str(b.received_date) && (
                  <span className="whitespace-nowrap text-[11px] text-muted">{shortDate(str(b.received_date))}</span>
                )}
              </span>
            );
          })}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          <Value yes={str(a[which])} status={str(a[`${which}_status`])} done={DONE[which]} date={which === "base_plate" ? str(a.base_plate_date) : ""} />
          {/* The steps before this one, each with its day. */}
          {which === "base_plate" && needed && Array.isArray(a.base_plate_steps) && (a.base_plate_steps as Row[]).length > 1 && (
            <span className="ml-1 flex flex-col items-start gap-0.5 border-l border-card-border pl-2">
              {(a.base_plate_steps as Row[])
                .filter((s) => str(s.status) !== str(a.base_plate_status))
                .map((s) => (
                  <span key={str(s.status)} className="whitespace-nowrap text-[11px] text-muted">
                    {str(s.status)} {str(s.date) ? shortDate(str(s.date)) : ""}
                  </span>
                ))}
            </span>
          )}
          {canEdit && !needed && <Pencil className="h-3 w-3 text-muted" aria-hidden />}
        </span>
      )}
    </button>
  );
}
