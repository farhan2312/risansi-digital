"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2, Pencil, Trash2 } from "lucide-react";
import { deleteOrderChildAction } from "@/app/risansi/orders/actions";
import { nextStep, stepsDone, type DispatchStepKey } from "@/lib/dispatch-steps";
import { DispatchWizard } from "./dispatch-wizard";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function day(v: unknown): string {
  const s = str(v).slice(0, 10);
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** "a · b · c", skipping the blanks. */
const line = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ");

/** The slips a dispatch covers, as its header says them. */
export function slipsOf(inv: Row): string {
  const slips = Array.isArray(inv.slips) ? (inv.slips as Row[]) : [];
  const nos = slips.length ? slips.map((s) => str(s.packing_slip_no) || "—") : [str(inv.packing_slip_no)].filter(Boolean);
  return nos.length ? `Packing Slip${nos.length > 1 ? "s" : ""} ${nos.join(", ")}` : "No packing slip";
}

/**
 * The SO's dispatches as short cards: which slips each covers, how far it
 * has got (Invoice → Dispatch → Docket & LR) and what was entered at each
 * step. Continue opens the pop-up at the first step not yet done.
 */
export function DispatchList({
  orderId,
  invoices,
  billType,
  canEdit,
}: {
  orderId: string;
  invoices: Row[];
  billType: unknown;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<{ inv: Row; step: DispatchStepKey } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const challan = str(billType) === "Challan";

  async function remove(inv: Row, n: number) {
    if (!confirm(`Delete dispatch #${n}? Its packing slips go back to waiting.`)) return;
    setDeleting(str(inv.id));
    const res = await deleteOrderChildAction(str(inv.id), "order_invoices", orderId);
    setDeleting(null);
    if (!res.ok) alert(res.error);
    else router.refresh();
  }

  if (invoices.length === 0) {
    return <p className="text-sm text-muted">No dispatch yet — tick packing slips above and click New dispatch.</p>;
  }

  return (
    <div className="space-y-3">
      {invoices.map((inv, i) => {
        const n = i + 1;
        const done = stepsDone(inv, billType);
        const all = done.invoice && done.dispatch && done.docket;
        const invoiceLine = challan
          ? line(str(inv.challan_no) && `Challan ${str(inv.challan_no)}`, day(inv.challan_date),
              str(inv.challan_value) && `₹${money.format(Number(inv.challan_value))}`,
              str(inv.challan_quantity) && `Qty ${str(inv.challan_quantity)}`, str(inv.fr_reason))
          : line(str(inv.invoice_no) && `Invoice ${str(inv.invoice_no)}`, day(inv.invoice_date),
              str(inv.invoice_value) && `₹${money.format(Number(inv.invoice_value))}`,
              str(inv.invoice_quantity) && `Qty ${str(inv.invoice_quantity)}`);
        const dispatchLine = line(
          str(inv.delivery_mode),
          str(inv.transporter_name),
          str(inv.vehicle_no),
          str(inv.courier_mode),
          str(inv.delivery_type),
          str(inv.freight_value) && `Freight ₹${money.format(Number(inv.freight_value))}`
        );
        const docketLine = line(
          str(inv.docket_no) && `Docket ${str(inv.docket_no)}`,
          str(inv.docket_type),
          day(inv.booking_date) && `booked ${day(inv.booking_date)}`,
          day(inv.delivery_date) && `delivered ${day(inv.delivery_date)}`
        );
        const lr = str(inv.lr_link);
        const lrHref = /^https?:\/\//i.test(lr) ? lr : "";
        const rows: { key: DispatchStepKey; label: string; text: string }[] = [
          { key: "invoice", label: challan ? "Challan" : "Invoice", text: invoiceLine },
          { key: "dispatch", label: "Dispatch", text: dispatchLine },
          { key: "docket", label: "Docket & LR", text: docketLine },
        ];
        return (
          <div
            key={str(inv.id) || i}
            className={`rounded-xl border p-3 ${all ? "border-emerald-300 bg-emerald-50/40" : "border-card-border bg-surface"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                Dispatch #{n} <span className="font-normal text-muted">· {slipsOf(inv)}</span>
              </p>
              {canEdit && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setOpen({ inv, step: all ? "invoice" : nextStep(inv, billType) })}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-input-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
                  >
                    <Pencil className="h-3 w-3" />
                    {all ? "Edit" : "Continue"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(inv, n)}
                    disabled={deleting === str(inv.id)}
                    aria-label={`Delete dispatch #${n}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                  >
                    {deleting === str(inv.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                </div>
              )}
            </div>
            <ul className="mt-2 space-y-1">
              {rows.map((r) => (
                <li key={r.key} className="flex items-start gap-2 text-xs">
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                      done[r.key] ? "bg-emerald-500 text-white" : "border border-card-border bg-background"
                    }`}
                    aria-hidden
                  >
                    {done[r.key] && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span className="w-20 shrink-0 font-medium text-muted-foreground">{r.label}</span>
                  <span className={r.text || (r.key === "docket" && lrHref) ? "text-foreground" : "text-muted"}>
                    {r.text || (r.key === "docket" && lrHref ? "" : "Not filled yet")}
                    {r.key === "docket" && lrHref && (
                      <>
                        {r.text && " · "}
                        <a
                          href={lrHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
                        >
                          LR copy
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {open && (
        <DispatchWizard
          orderId={orderId}
          billType={billType}
          invoice={open.inv}
          slipsLabel={slipsOf(open.inv)}
          startStep={open.step}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

