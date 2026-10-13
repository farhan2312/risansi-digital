"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import { dispatchStage } from "@/lib/dispatch-steps";
import { DispatchWizard } from "./dispatch-wizard";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function formatDate(value: unknown): string {
  const s = str(value).slice(0, 10);
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * The SO's packing slips as Dispatch sees them: which dispatch each went on
 * and how far it has got, and which are waiting. Tick one or more waiting
 * slips and New dispatch opens the step-by-step pop-up for them.
 */
export function DispatchSlipPicker({
  orderId,
  slips,
  invoices,
  billType,
  canEdit,
}: {
  orderId: string;
  slips: Row[];
  /** The SO's dispatches, in order — which one a slip went on, and its stage. */
  invoices: Row[];
  billType: unknown;
  canEdit: boolean;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [raising, setRaising] = useState(false);

  const cardNo = new Map(invoices.map((inv, i) => [str(inv.id), i + 1]));
  const cardOf = new Map(invoices.map((inv) => [str(inv.id), inv]));
  const waiting = slips.filter((s) => !str(s.invoice_id));
  const pickedLabel = slips
    .filter((s) => picked.has(str(s.id)))
    .map((s) => str(s.packing_slip_no) || "—")
    .join(", ");

  return (
    <section className="rounded-xl border border-card-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-semibold text-foreground">Packing slips</h3>
          <p className="text-xs text-muted">
            {slips.length === 0
              ? "No packing slip yet."
              : `${slips.length - waiting.length} of ${slips.length} on a dispatch · tick the slips going out together, then raise one dispatch for them.`}
          </p>
        </div>
        {canEdit && waiting.length > 0 && (
          <button
            type="button"
            onClick={() => setRaising(true)}
            disabled={picked.size === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            <Truck className="h-3.5 w-3.5" />
            New dispatch{picked.size > 0 ? ` (${picked.size} slip${picked.size === 1 ? "" : "s"})` : ""}
          </button>
        )}
      </div>
      {slips.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {canEdit && <th className="w-8 px-2 py-1.5" />}
                <th className="px-2 py-1.5">Packing Slip No.</th>
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5">Dispatch</th>
              </tr>
            </thead>
            <tbody>
              {slips.map((s) => {
                const id = str(s.id);
                const on = str(s.invoice_id);
                return (
                  <tr key={id} className="text-foreground">
                    {canEdit && (
                      <td className="px-2 py-1.5">
                        {!on && (
                          <input
                            type="checkbox"
                            aria-label={`Send packing slip ${str(s.packing_slip_no) || id}`}
                            checked={picked.has(id)}
                            onChange={(e) =>
                              setPicked((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(id);
                                else next.delete(id);
                                return next;
                              })
                            }
                          />
                        )}
                      </td>
                    )}
                    <td className="px-2 py-1.5 whitespace-nowrap font-medium">{str(s.packing_slip_no) || "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-muted">{formatDate(s.packing_slip_date)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {on ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          #{cardNo.get(on) ?? "?"} · {cardOf.get(on) ? dispatchStage(cardOf.get(on)!, billType) : "On a dispatch"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Waiting
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {raising && (
        <DispatchWizard
          orderId={orderId}
          billType={billType}
          invoice={null}
          slipIds={[...picked]}
          slipsLabel={`Packing Slip${picked.size > 1 ? "s" : ""} ${pickedLabel}`}
          onClose={() => {
            setRaising(false);
            setPicked(new Set());
          }}
        />
      )}
    </section>
  );
}
