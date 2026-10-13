// How an SO's first target dates are worked out from its own dates.
//
//   SO date                 →  Dispatch target   = SO date + 3 weeks (Pump)
//                                                 = SO date + 2 weeks (Spare)
//   Delivery date as per SO →  Packing target    = delivery − 4 days
//                              Quality target    = delivery − 7 days
//   SO Hand Over date       →  Drawing target    = hand-over + 2 days (up to 4 qty)
//                                                 = hand-over + 3 days (5 qty or more)
//
// Only a target that has never been set is filled: once a date exists, every
// change to it is a revision someone makes on purpose, with a reason. Days are
// calendar days.
//
// Plain module (no server imports), so the form can say what will be filled
// and the server fills it by the same rule.

import type { TargetKey } from "@/lib/target-dates";

/** The SO facts the rules read. */
export type TargetInputs = {
  so_date?: unknown;
  /** Pump or Spare — sets how long Dispatch is given from the SO date. */
  order_type?: unknown;
  delivery_date_as_per_so?: unknown;
  so_handover_date?: unknown;
  total_quantity?: unknown;
  qc_required?: unknown;
  /** Whether Drawing has any work on the order (not Spares only). */
  drawing_involved?: boolean;
};

export type AutoTarget = {
  key: TargetKey;
  date: string;
  /** Why this date — recorded as the revision's reason, and quoted in the notice. */
  reason: string;
};

/** Days from the SO date to the dispatch target, by order type. */
export const DISPATCH_DAYS_FROM_SO: Record<string, number> = { pump: 21, spare: 14 };

/** Drawing gets a day more once an order runs to this many pumps. */
export const DRAWING_LARGE_QTY = 5;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: unknown): string | null {
  const s = value == null ? "" : String(value).trim().slice(0, 10);
  if (!ISO.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function readable(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Every first target the SO's dates give, whether or not it is set yet. */
export function autoTargets(o: TargetInputs): AutoTarget[] {
  const out: AutoTarget[] = [];

  // Dispatch works to the SO date; without an order type there is no telling
  // which allowance applies.
  const soDate = isoDate(o.so_date);
  const type = String(o.order_type ?? "").trim().toLowerCase();
  const dispatchDays = DISPATCH_DAYS_FROM_SO[type];
  if (soDate && dispatchDays) {
    out.push({
      key: "dispatch",
      date: shift(soDate, dispatchDays),
      reason: `Auto: ${dispatchDays / 7} weeks after SO date (${readable(soDate)}), ${String(o.order_type).trim()}`,
    });
  }

  const delivery = isoDate(o.delivery_date_as_per_so);
  if (delivery) {
    const from = `Delivery date as per SO (${readable(delivery)})`;
    out.push({ key: "packing", date: shift(delivery, -4), reason: `Auto: 4 days before ${from}` });
    // Quality's target only applies when the order needs QC documents.
    if (String(o.qc_required ?? "").trim().toLowerCase() === "yes") {
      out.push({ key: "quality", date: shift(delivery, -7), reason: `Auto: 7 days before ${from}` });
    }
  }

  const handover = isoDate(o.so_handover_date);
  const qty = Number(String(o.total_quantity ?? "").trim());
  // Drawing works to the hand-over, and only where there is something to
  // draw; without a quantity there is no telling which allowance applies.
  if (handover && o.drawing_involved !== false && Number.isFinite(qty) && qty > 0) {
    const days = qty >= DRAWING_LARGE_QTY ? 3 : 2;
    out.push({
      key: "drawing",
      date: shift(handover, days),
      reason: `Auto: ${days} days after SO hand-over (${readable(handover)}), qty ${qty}`,
    });
  }

  return out;
}
