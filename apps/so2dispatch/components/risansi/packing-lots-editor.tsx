"use client";

import { PACKED_FOR, type PackingLot } from "@/lib/ready-lots";

function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * A Spare's readiness lots inside Assembly & Packing's form: Planning's lot
 * (status and ready date) read-only, and when it was packed — the packing
 * status follows the lot (Partially / Fully packed).
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
  return (
    <div className="rounded-xl border border-card-border bg-background/50 p-3 sm:col-span-2">
      <p className="mb-2 text-[13px] font-semibold text-foreground">
        Readiness lots from Planning{" "}
        <span className="font-normal text-muted">· enter when each lot was packed</span>
      </p>
      <div className="space-y-2">
        <div className="grid grid-cols-[3.5rem_1fr_1fr_1fr] gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Lot</span>
          <span>Ready</span>
          <span>Packed on</span>
          <span>Packing</span>
        </div>
        {lots.map((lot, i) => (
          <div key={lot.id || i} className="grid grid-cols-[3.5rem_1fr_1fr_1fr] items-center gap-2 text-[13px]">
            <span className="text-xs font-semibold text-muted-foreground">Lot {i + 1}</span>
            <span className="text-foreground">
              {lot.status || "—"}
              <span className="block text-xs text-muted">{formatDate(lot.ready_date)}</span>
            </span>
            {editing ? (
              <input
                aria-label={`Lot ${i + 1} packed on`}
                type="date"
                value={lot.packed_date}
                min={lot.ready_date || undefined}
                onChange={(e) =>
                  onChange(lots.map((l, k) => (k === i ? { ...l, packed_date: e.target.value } : l)))
                }
                className="h-9 w-full rounded-lg border border-input-border bg-surface px-2.5 text-[13px] text-foreground focus:border-primary focus:outline-none"
              />
            ) : (
              <span className="text-foreground">{formatDate(lot.packed_date)}</span>
            )}
            <span className={lot.packed_date ? "font-medium text-foreground" : "text-muted"}>
              {lot.packed_date ? PACKED_FOR[lot.status] ?? "Packed" : "Not packed"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
