// How an SO's first target dates are worked out from its own dates.
//
//   SO date                 →  Dispatch target   = SO date + 3 weeks (Pump)
//                                                 = SO date + 2 weeks (Spare)
//   Delivery date as per SO →  Packing target    = delivery − 4 days
//                              Quality target    = delivery − 7 days
//   SO Hand Over date       →  Drawing target    = hand-over + 2 days (up to 4 qty)
//                                                 = hand-over + 3 days (5 qty or more)
//
// A Spare SO created on or after SPARE_DELIVERY_RULES_FROM works from its
// delivery date instead:
//   SO date                 →  Delivery date as per SO = SO date + 2 weeks (if blank)
//   Delivery date as per SO →  Dispatch target   = delivery − 3 days
//                              Packing target    = delivery − 5 days
//
// …and a Pump (or ROLB) SO created on or after PUMP_DELIVERY_RULES_FROM:
//   SO date                 →  Delivery date as per SO = SO date + 3 weeks (if blank)
//   Delivery date as per SO →  Dispatch target   = delivery − 3 days
//                              Packing target    = delivery − 5 days
//                              Purchase target   = delivery − 7 days (BOI Yes)
//                              Quality target    = delivery − 5 days (QC Yes)
//   SO Hand Over date       →  Drawing target, as above
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
  /** Whether the SO has bought-out items — Purchase's target needs them. */
  boi?: unknown;
  /** When the SO was created (IST date) — the Spare delivery rules apply from SPARE_DELIVERY_RULES_FROM. */
  created_on?: unknown;
};

/** The day the Spare delivery-date rules start: SOs created before it keep the older rules. */
export const SPARE_DELIVERY_RULES_FROM = "2026-10-14";
/** A new Spare's delivery date as per SO, from its SO date. */
export const SPARE_DELIVERY_DAYS_FROM_SO = 14;
/** The day the Pump delivery-date rules start. */
export const PUMP_DELIVERY_RULES_FROM = "2026-10-27";
/** A new Pump's delivery date as per SO, from its SO date. */
export const PUMP_DELIVERY_DAYS_FROM_SO = 21;

const isPump = (t: unknown) => ["pump", "rolb"].includes(String(t ?? "").trim().toLowerCase());

/** Whether an SO is a Spare under the delivery-date rules. */
export function spareDeliveryRules(o: Pick<TargetInputs, "order_type" | "created_on">): boolean {
  const created = isoDate(o.created_on);
  return String(o.order_type ?? "").trim().toLowerCase() === "spare" && !!created && created >= SPARE_DELIVERY_RULES_FROM;
}

/** Whether an SO is a Pump under the delivery-date rules. */
export function pumpDeliveryRules(o: Pick<TargetInputs, "order_type" | "created_on">): boolean {
  const created = isoDate(o.created_on);
  return isPump(o.order_type) && !!created && created >= PUMP_DELIVERY_RULES_FROM;
}

/**
 * A new SO's delivery date as per SO: SO date + 2 weeks (Spare) or + 3 weeks
 * (Pump), or null when neither rule applies.
 */
export function spareDeliveryDate(o: Pick<TargetInputs, "order_type" | "created_on" | "so_date">): string | null {
  const soDate = isoDate(o.so_date);
  if (!soDate) return null;
  if (spareDeliveryRules(o)) return shift(soDate, SPARE_DELIVERY_DAYS_FROM_SO);
  if (pumpDeliveryRules(o)) return shift(soDate, PUMP_DELIVERY_DAYS_FROM_SO);
  return null;
}

/** Days before the delivery date each target falls, under the delivery-date rules (form and server alike). */
export const DELIVERY_OFFSETS = {
  spare: { dispatch: -3, packing: -5 },
  pump: { dispatch: -3, packing: -5, purchase: -7, quality: -5 },
} as const;

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
  const delivery = isoDate(o.delivery_date_as_per_so);
  // A new Spare: Dispatch and Packing both work back from the delivery date.
  if (spareDeliveryRules(o)) {
    if (delivery) {
      const from = `Delivery date as per SO (${readable(delivery)})`;
      out.push({ key: "dispatch", date: shift(delivery, -3), reason: `Auto: 3 days before ${from}, Spare` });
      out.push({ key: "packing", date: shift(delivery, -5), reason: `Auto: 5 days before ${from}, Spare` });
    }
    return out;
  }
  // A new Pump: everything but Drawing works back from the delivery date.
  if (pumpDeliveryRules(o)) {
    if (delivery) {
      const from = `Delivery date as per SO (${readable(delivery)})`;
      const d = DELIVERY_OFFSETS.pump;
      out.push({ key: "dispatch", date: shift(delivery, d.dispatch), reason: `Auto: 3 days before ${from}, Pump` });
      out.push({ key: "packing", date: shift(delivery, d.packing), reason: `Auto: 5 days before ${from}, Pump` });
      if (String(o.boi ?? "").trim().toLowerCase() === "yes") {
        out.push({ key: "purchase", date: shift(delivery, d.purchase), reason: `Auto: 7 days before ${from}, Pump` });
      }
      if (String(o.qc_required ?? "").trim().toLowerCase() === "yes") {
        out.push({ key: "quality", date: shift(delivery, d.quality), reason: `Auto: 5 days before ${from}, Pump` });
      }
    }
    pushDrawing(out, o);
    return out;
  }
  if (soDate && dispatchDays) {
    out.push({
      key: "dispatch",
      date: shift(soDate, dispatchDays),
      reason: `Auto: ${dispatchDays / 7} weeks after SO date (${readable(soDate)}), ${String(o.order_type).trim()}`,
    });
  }

  if (delivery) {
    const from = `Delivery date as per SO (${readable(delivery)})`;
    out.push({ key: "packing", date: shift(delivery, -4), reason: `Auto: 4 days before ${from}` });
    // Quality's target only applies when the order needs QC documents.
    if (String(o.qc_required ?? "").trim().toLowerCase() === "yes") {
      out.push({ key: "quality", date: shift(delivery, -7), reason: `Auto: 7 days before ${from}` });
    }
  }

  pushDrawing(out, o);
  return out;
}

/** Drawing works to the hand-over, and only where there is something to draw; without a quantity there is no telling which allowance applies. */
function pushDrawing(out: AutoTarget[], o: TargetInputs) {
  const handover = isoDate(o.so_handover_date);
  const qty = Number(String(o.total_quantity ?? "").trim());
  if (handover && o.drawing_involved !== false && Number.isFinite(qty) && qty > 0) {
    const days = qty >= DRAWING_LARGE_QTY ? 3 : 2;
    out.push({
      key: "drawing",
      date: shift(handover, days),
      reason: `Auto: ${days} days after SO hand-over (${readable(handover)}), qty ${qty}`,
    });
  }
}
