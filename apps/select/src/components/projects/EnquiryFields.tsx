"use client";

import { ORDER_TYPES, type OrderType } from "../../lib/roles";
import type { ClientLookupRow } from "../../services/clientsService";

// Shared by Create and Edit Enquiry: Order Type buttons and the client's reps
// / market type / zone (from Market Intell, filled when a client is picked).

export function OrderTypePicker({ value, onChange }: { value: OrderType; onChange: (v: OrderType) => void }) {
  return (
    <div className="flex gap-2" role="group" aria-label="Order type">
      {ORDER_TYPES.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`rounded-lg border px-4 py-1.5 text-[13px] font-semibold transition-colors ${
              on ? "border-accent bg-accent text-white" : "border-line-strong bg-paper text-fg-2 hover:border-accent hover:text-accent"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export type ClientDetails = {
  clientPrimaryRep: string;
  clientSecondaryReps: string;
  clientMarketType: string;
  clientZone: string;
};

export const EMPTY_CLIENT_DETAILS: ClientDetails = {
  clientPrimaryRep: "",
  clientSecondaryReps: "",
  clientMarketType: "",
  clientZone: "",
};

export const clientDetailsOf = (row: ClientLookupRow): ClientDetails => ({
  clientPrimaryRep: row.primary_rep ?? "",
  clientSecondaryReps: row.secondary_reps ?? "",
  clientMarketType: row.market_type ?? "",
  clientZone: row.zone ?? "",
});

/** Read-only: these come from the client master, not typed here. */
export function ClientDetailsFields({ value }: { value: ClientDetails }) {
  const cell = (label: string, v: string) => (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold tracking-[0.09em] text-fg-3 uppercase">{label}</div>
      <div className={`mt-1 truncate text-[13.5px] ${v ? "text-fg" : "text-fg-4"}`} title={v || undefined}>
        {v || "—"}
      </div>
    </div>
  );
  return (
    <div className="rounded-lg border border-line bg-sunk px-3.5 py-3">
      <div className="mb-2 text-[11.5px] text-fg-3">From the client master (Market Intell) - filled when you pick a client</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        {cell("Primary rep", value.clientPrimaryRep)}
        {cell("Secondary reps", value.clientSecondaryReps)}
        {cell("Market type", value.clientMarketType)}
        {cell("Zone", value.clientZone)}
      </div>
    </div>
  );
}
