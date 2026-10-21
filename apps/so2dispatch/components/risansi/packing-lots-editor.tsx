"use client";

import { PACKED_FOR, PACKING_IN_PROGRESS, PACKING_SHIFTS, PDI_OPTIONS, type PackingLot } from "@/lib/ready-lots";

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const dateInput =
  "h-10 w-full rounded-lg border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";

/** A few choices as buttons — one tap, and the choice is plain to see. Tapping the chosen one clears it. */
function Choice({
  label,
  options,
  value,
  onChange,
  editing,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
  editing: boolean;
}) {
  if (!editing) return <span className="text-sm font-medium text-foreground">{value || "—"}</span>;
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5">
      {options.map((o) => {
        const on = value === o;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? "" : o)}
            className={`h-10 flex-1 rounded-lg border text-sm font-semibold transition-colors ${
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input-border bg-surface text-foreground hover:bg-background"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A Spare's readiness lots inside Assembly & Packing's form, one card per
 * lot: Planning's status and ready date on top, read-only; below, Assembly &
 * Packing's own plan — packing date, shift, PDI — and when it was actually
 * packed. Fits the form's width with no sideways scrolling. Unpacked, a lot
 * is In Progress; packed, its status follows the lot (Partially / Fully
 * packed).
 */
export function PackingLotsEditor({
  lots,
  onChange,
  editing,
}: {
  lots: PackingLot[];
  onChange: (next: PackingLot[]) => void;
  editing: boolean;
}) {
  if (lots.length === 0) return null;
  const set = (i: number, patch: Partial<PackingLot>) =>
    onChange(lots.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-3 sm:col-span-2">
      <p className="text-[13px] font-semibold text-foreground">
        Readiness lots from Planning{" "}
        <span className="font-normal text-muted">· plan when each lot will be packed, then enter when it was</span>
      </p>
      {lots.map((lot, i) => {
        const packed = !!lot.packed_date;
        return (
          <div key={lot.id || i} className="rounded-xl border border-card-border bg-background/50 p-3">
            {/* Planning's lot, and where packing stands. */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-foreground">
                <span className="font-semibold">Lot {i + 1}</span>
                <span className="text-muted"> · {lot.status || "—"} · ready {formatDate(lot.ready_date)}</span>
              </p>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  packed
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                }`}
              >
                {packed ? PACKED_FOR[lot.status] ?? "Packed" : PACKING_IN_PROGRESS}
              </span>
            </div>
            {/* Assembly & Packing's plan, then the actual packing. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-brand-label">
                  Packing date
                  {(lot.plan_moves ?? 0) > 0 && (
                    <span className="ml-1.5 font-semibold text-amber-700">· moved {lot.plan_moves}×</span>
                  )}
                </span>
                {editing ? (
                  <input
                    aria-label={`Lot ${i + 1} packing date`}
                    type="date"
                    value={lot.packing_plan_date}
                    onChange={(e) => set(i, { packing_plan_date: e.target.value })}
                    className={dateInput}
                  />
                ) : (
                  <span className="text-sm font-medium text-foreground">{formatDate(lot.packing_plan_date)}</span>
                )}
              </label>
              <div>
                <span className="mb-1 block text-[12px] font-medium text-brand-label">Shift</span>
                <Choice
                  label={`Lot ${i + 1} shift`}
                  options={PACKING_SHIFTS}
                  value={lot.packing_shift}
                  onChange={(v) => set(i, { packing_shift: v })}
                  editing={editing}
                />
              </div>
              <div>
                <span className="mb-1 block text-[12px] font-medium text-brand-label">PDI</span>
                <Choice
                  label={`Lot ${i + 1} PDI`}
                  options={PDI_OPTIONS}
                  value={lot.pdi}
                  onChange={(v) => set(i, { pdi: v })}
                  editing={editing}
                />
              </div>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-brand-label">Packed on</span>
                {lot.status === "In plan" ? (
                  <span className="text-xs text-muted">Not ready yet — In plan</span>
                ) : editing ? (
                  <input
                    aria-label={`Lot ${i + 1} packed on`}
                    type="date"
                    value={lot.packed_date}
                    min={lot.ready_date || undefined}
                    onChange={(e) => set(i, { packed_date: e.target.value })}
                    className={dateInput}
                  />
                ) : (
                  <span className="text-sm font-medium text-foreground">{formatDate(lot.packed_date)}</span>
                )}
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
