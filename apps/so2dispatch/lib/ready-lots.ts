// A Spare's readiness, lot by lot (order_ready_lots).
//
//   Lot 1  Partial ready  05 Oct
//   Lot 2  Fully ready    12 Oct   ← the EC is now Fully ready, and the lots freeze
//
// Planning records them in the Planning form itself. Once a lot exists, the
// EC's Actual Spare Status and its Readiness Date are no longer typed: they are
// the latest lot's. A Fully ready lot is the last one — nothing is added after
// it, and the lots are locked until Planning chooses to correct them.
//
// Plain module (no server imports): the form and the server action share the
// rules below.

import { READY_LOT_LIMIT, READY_LOT_STATUSES } from "@/lib/order-schema";

export type ReadyLot = { status: string; ready_date: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The lots as the form edits them, from the rows the server sent. */
export function lotsFromRows(rows: unknown): ReadyLot[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      status: String(row.status ?? "").trim(),
      ready_date: String(row.ready_date ?? "").slice(0, 10),
    };
  });
}

/** Whether the lots are closed: the last one says Fully ready. */
export function lotsFrozen(lots: ReadyLot[]): boolean {
  return lots.length > 0 && lots[lots.length - 1].status === "Fully ready";
}

/** The status and readiness date the latest lot gives the EC. */
export function lotsSummary(lots: ReadyLot[]): { status: string; date: string } | null {
  const last = lots[lots.length - 1];
  return last ? { status: last.status, date: last.ready_date } : null;
}

/** The first thing wrong with a set of lots, or null when they can be saved. */
export function lotsError(lots: ReadyLot[]): string | null {
  if (lots.length > READY_LOT_LIMIT) return `A Spare takes at most ${READY_LOT_LIMIT} lots.`;
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    const n = i + 1;
    if (!READY_LOT_STATUSES.includes(lot.status)) return `Lot ${n}: choose Partial ready or Fully ready.`;
    if (!ISO.test(lot.ready_date)) return `Lot ${n}: enter its date.`;
    if (lot.status === "Fully ready" && i < lots.length - 1) {
      return `Lot ${n} is Fully ready, so no lot can come after it.`;
    }
    if (i > 0 && lot.ready_date < lots[i - 1].ready_date) {
      return `Lot ${n}'s date cannot be before Lot ${i}'s.`;
    }
  }
  return null;
}

/** The form field that carries the lots to the server, as JSON. */
export const READY_LOTS_FIELD = "__ready_lots";

// ---------------------------------------------------------------------------
// Packing, lot by lot: Assembly & Packing records when each readiness lot was
// packed. The packing status follows the lot — a Partial ready lot is
// Partially packed, a Fully ready one Fully packed — so they only give a date.
// ---------------------------------------------------------------------------

export const PACKED_FOR: Record<string, string> = {
  "Partial ready": "Partially packed",
  "Fully ready": "Fully packed",
};

/** A lot as Assembly & Packing sees it: Planning's half read-only, theirs to fill. */
export type PackingLot = {
  id: string;
  status: string;
  ready_date: string;
  packed_date: string;
};

export function packingLotsFromRows(rows: unknown): PackingLot[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id ?? ""),
      status: String(row.status ?? "").trim(),
      ready_date: String(row.ready_date ?? "").slice(0, 10),
      packed_date: String(row.packed_date ?? "").slice(0, 10),
    };
  });
}

/** The first thing wrong with the packing dates, or null. */
export function packingError(lots: PackingLot[]): string | null {
  for (let i = 0; i < lots.length; i++) {
    const l = lots[i];
    if (!l.packed_date) continue;
    if (!ISO.test(l.packed_date)) return `Lot ${i + 1}: enter a valid packing date.`;
    if (l.ready_date && l.packed_date < l.ready_date) {
      return `Lot ${i + 1} cannot be packed before it was ready (${l.ready_date.split("-").reverse().join("-")}).`;
    }
  }
  return null;
}

/** The form field that carries the packing dates to the server, as JSON. */
export const PACKING_LOTS_FIELD = "__packing_lots";
