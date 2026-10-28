"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { saveAlignmentAction, type Alignment } from "@/app/risansi/orders/assembly-actions";
import { BASE_PLATE_STATUSES, WOODEN_BOX_SOURCES, WOODEN_BOX_STATUSES } from "@/lib/assembly";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

/** The status each item is done at. */
const DONE = { base_plate: "Manufactured", wooden_box: "Received" } as const;

function shortDate(v: string): string {
  const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** One Alignment item on the front: its status (Pending until set) and the day, No, or not set. */
function Value({ yes, status, done, date = "", note = "" }: { yes: string; status: string; done: string; date?: string; note?: string }) {
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
      {note && <span className="whitespace-nowrap text-[11px] text-muted">{note}</span>}
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

/**
 * The Alignment form, for one SO: the base plate when an EC needs one, the
 * wooden box when the SO is packed in one.
 */
export function AlignmentForm({
  orderId,
  soLabel,
  alignment,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  alignment: unknown;
  onClose: () => void;
}) {
  const router = useRouter();
  const a = (alignment ?? {}) as Row;
  const plate = str(a.base_plate) === "Yes";
  const box = str(a.wooden_box) === "Yes";
  const [v, setV] = useState<Alignment>({
    base_plate_status: str(a.base_plate_status) || "Pending",
    base_plate_date: str(a.base_plate_date).slice(0, 10),
    base_plate_remarks: str(a.base_plate_remarks),
    wooden_box_source: Array.isArray(a.wooden_box_source) ? a.wooden_box_source.map(String) : [],
    wooden_box_required_qty: str(a.wooden_box_required_qty),
    wooden_box_stock_qty: str(a.wooden_box_stock_qty),
    wooden_box_status: str(a.wooden_box_status) || "Pending",
    wooden_box_received_date: str(a.wooden_box_received_date).slice(0, 10),
    wooden_box_received_qty: str(a.wooden_box_received_qty),
    wooden_box_remarks: str(a.wooden_box_remarks),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Alignment>) => setV((p) => ({ ...p, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await saveAlignmentAction(orderId, v);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  const pill = (on: boolean) =>
    `rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
      on ? "border-primary bg-primary text-primary-foreground" : "border-input-border text-muted hover:bg-background"
    }`;
  const pills = (options: string[], on: (o: string) => boolean, pick: (o: string) => void) => (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => pick(o)} className={pill(on(o))}>
          {o}
        </button>
      ))}
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Alignment"
      className="fixed inset-0 z-50 flex items-end justify-center whitespace-normal bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && onClose()}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 text-left shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Alignment</h2>
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
        <div className="space-y-3">
          {plate && (
            <section className="space-y-3 rounded-xl border border-card-border p-4">
              <p className="text-sm font-semibold text-foreground">Base Plate</p>
              <Field label="Status" required group>
                {pills(BASE_PLATE_STATUSES, (o) => v.base_plate_status === o, (o) => set({ base_plate_status: o }))}
              </Field>
              <Field label="Date" required={v.base_plate_status !== "Pending"}>
                <input type="date" value={v.base_plate_date} onChange={(e) => set({ base_plate_date: e.target.value })} className={input} />
              </Field>
              <Field label="Remarks">
                <input type="text" value={v.base_plate_remarks} onChange={(e) => set({ base_plate_remarks: e.target.value })} className={input} />
              </Field>
            </section>
          )}
          {box && (
            <section className="space-y-3 rounded-xl border border-card-border p-4">
              <p className="text-sm font-semibold text-foreground">Wooden Box</p>
              <Field label="In house / Bought out" required group>
                {pills(
                  WOODEN_BOX_SOURCES,
                  (o) => v.wooden_box_source.includes(o),
                  (o) =>
                    set({
                      wooden_box_source: v.wooden_box_source.includes(o)
                        ? v.wooden_box_source.filter((x) => x !== o)
                        : WOODEN_BOX_SOURCES.filter((x) => x === o || v.wooden_box_source.includes(x)),
                    })
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Required Quantity" required>
                  <input type="number" min={0} step={1} value={v.wooden_box_required_qty} onChange={(e) => set({ wooden_box_required_qty: e.target.value })} className={input} />
                </Field>
                <Field label="Stock Quantity">
                  <input type="number" min={0} step={1} value={v.wooden_box_stock_qty} onChange={(e) => set({ wooden_box_stock_qty: e.target.value })} className={input} />
                </Field>
              </div>
              <Field label="Status" required group>
                {pills(WOODEN_BOX_STATUSES, (o) => v.wooden_box_status === o, (o) => set({ wooden_box_status: o }))}
              </Field>
              {/* Received on a day, in a quantity. */}
              {v.wooden_box_status === "Received" && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Received Date" required>
                    <input type="date" value={v.wooden_box_received_date} onChange={(e) => set({ wooden_box_received_date: e.target.value })} className={input} />
                  </Field>
                  <Field label="Received Quantity" required>
                    <input type="number" min={1} step={1} value={v.wooden_box_received_qty} onChange={(e) => set({ wooden_box_received_qty: e.target.value })} className={input} />
                  </Field>
                </div>
              )}
              <Field label="Remarks">
                <input type="text" value={v.wooden_box_remarks} onChange={(e) => set({ wooden_box_remarks: e.target.value })} className={input} />
              </Field>
            </section>
          )}
          {!plate && !box && (
            <p className="rounded-xl border border-card-border p-4 text-sm text-muted">
              This SO needs neither a base plate (no EC says Yes) nor a wooden box (Packing Requirement is not Wooden Box).
            </p>
          )}
        </div>
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
          {(plate || box) && (
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** One Alignment cell on the front (Base Plate or Wooden Box), opening the form when the SO needs it. */
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
  const status = str(a[`${which}_status`]);
  const plate = which === "base_plate";
  const required = str(a.wooden_box_required_qty);
  const got = str(a.wooden_box_received_qty);
  return (
    <button
      type="button"
      disabled={!canEdit || !needed}
      onClick={onOpen}
      title={canEdit && needed ? "Set the alignment" : undefined}
      className="w-full text-left enabled:hover:opacity-80 disabled:cursor-default"
    >
      <Value
        yes={str(a[which])}
        status={status}
        done={DONE[which]}
        date={plate ? str(a.base_plate_date) : status === "Received" ? str(a.wooden_box_received_date) : ""}
        note={plate || !required ? "" : status === "Received" ? `${got || 0} of ${required}` : `${required} required`}
      />
    </button>
  );
}
