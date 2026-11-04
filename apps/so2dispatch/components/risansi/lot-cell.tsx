"use client";

import { LOT_PACKING_PENDING, type PumpLot } from "@/lib/assembly";
import { lotOnSlip } from "@/lib/ready-lots";

type Row = Record<string, unknown>;

function shortDate(v: string): string {
  const s = v.slice(0, 10);
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const DONE = new Set(["Assembled", "Fully assembled", "Packed", "Fully packed"]);
const PART = new Set(["Partially assembled", "Partial assembled", "Partially packed"]);

/** An assembly or packing status: green done, blue part-way, amber otherwise. */
export function Chip({ label }: { label: string }) {
  const cls = DONE.has(label) ? "bg-emerald-50 text-emerald-700" : PART.has(label) ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700";
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

/**
 * One lot's work, read-only: where it stands, how many of it are assembled
 * and packed, and the days — assembled (or planned) and packed (or planned).
 * Assembly & Packing's Pump view and Planning's show it alike.
 */
/** The Latest Lot column: which lot it is, then its assembly and packing as any lot's. */
export function LatestLot({ lot, slips }: { lot: PumpLot | undefined; slips: Row[] }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      {lot && <span className="text-[11px] font-semibold text-muted">Lot {lot.n}</span>}
      <LotCell lot={lot} slips={slips} />
    </span>
  );
}

export function LotCell({ lot, slips }: { lot: PumpLot | undefined; slips: Row[] }) {
  if (!lot) return <span className="text-muted">—</span>;
  const qty = lot.ecs.reduce((t, e) => t + e.qty, 0);
  const assembled = lot.ecs.reduce((t, e) => t + e.assembled, 0);
  const packed = lot.packed_date ? qty : 0;
  const label = lot.packed_date
    ? "Packed"
    : lot.pack_status === LOT_PACKING_PENDING
      ? LOT_PACKING_PENDING
      : lot.assembled_date
      ? "Assembled"
      : assembled > 0
        ? "Partially assembled"
        : lot.status || "Pending";
  const day = (done: string, plan: string, word: string) =>
    done ? (
      <span className="whitespace-nowrap text-[11px] text-emerald-700">
        {word} {shortDate(done)}
      </span>
    ) : plan ? (
      <span className="whitespace-nowrap text-[11px] text-muted">
        {word} plan {shortDate(plan)}
      </span>
    ) : null;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Chip label={label} />
      {qty > 0 && (
        <span className="whitespace-nowrap text-[11px] text-muted">
          Qty {qty} · Assembled {assembled} · Packed {packed}
        </span>
      )}
      {day(lot.assembled_date, lot.assembly_plan_date, "Assembly")}
      {lot.asm_remarks && (
        <span className={`max-w-[14rem] whitespace-normal text-[11px] ${lot.assembled_date ? "text-muted" : "text-amber-700"}`}>
          Assembly pending: {lot.asm_remarks}
        </span>
      )}
      {day(lot.packed_date, lot.packing_plan_date, "Packing")}
      {lot.pack_remarks && <span className="max-w-[14rem] whitespace-normal text-[11px] text-muted">{lot.pack_remarks}</span>}
      {/* Packed, but on no packing slip yet. */}
      {lot.packed_date && !lotOnSlip(lot.n, slips) && (
        <span className="rounded bg-rose-50 px-1 text-[10.5px] font-semibold text-rose-700">No slip</span>
      )}
    </span>
  );
}
