"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, ExternalLink, Loader2, Pencil, Trash2, Truck } from "lucide-react";
import { deleteOrderChildAction } from "@/app/risansi/orders/actions";
import { nextStep, stepsDone, type DispatchStepKey } from "@/lib/dispatch-steps";
import { DispatchWizard } from "./dispatch-wizard";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function day(v: unknown): string {
  const s = str(v).slice(0, 10);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

/**
 * Dispatch's view of an SO, on the queue row itself: one line per dispatch —
 * the packing slips it carries, then its Invoice (or Challan), Dispatch and
 * Docket & LR, each filled in or "—" — and one line per packing slip still
 * waiting, with a tick. Tick the slips going out together and New dispatch
 * opens the step-by-step pop-up; Continue picks a dispatch up where it stopped.
 */
export function DispatchInline({
  orderId,
  slips,
  invoices,
  billType,
  canEdit,
}: {
  orderId: string;
  slips: Row[];
  invoices: Row[];
  billType: unknown;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [wizard, setWizard] = useState<
    { invoice: Row | null; slipIds?: string[]; label: string; step?: DispatchStepKey } | null
  >(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const challan = str(billType) === "Challan";

  const waiting = slips.filter((s) => !str(s.invoice_id));
  const slipName = (s: Row) => str(s.packing_slip_no) || "—";
  const slipsOf = (inv: Row) => {
    const own = Array.isArray(inv.slips) ? (inv.slips as Row[]) : [];
    return own.length ? own.map(slipName).join(", ") : "—";
  };

  async function remove(inv: Row, n: number) {
    if (!confirm(`Delete dispatch #${n}? Its packing slips go back to waiting.`)) return;
    setDeleting(str(inv.id));
    const res = await deleteOrderChildAction(str(inv.id), "order_invoices", orderId);
    setDeleting(null);
    if (!res.ok) alert(res.error);
    else router.refresh();
  }

  if (slips.length === 0 && invoices.length === 0) {
    return <span className="text-xs text-muted">No packing slip yet</span>;
  }

  // One step of a dispatch: a tick and what was filled in, or a hollow
  // circle and "Pending".
  const step = (done: boolean, main: string, sub?: ReactNode) => (
    <div className="flex items-start gap-1.5">
      {done ? (
        <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
      ) : (
        <Circle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
      )}
      <div className="min-w-0">
        {main ? (
          <div className="break-words font-medium text-foreground">{main}</div>
        ) : (
          <div className="text-amber-700">Pending</div>
        )}
        {sub && <div className="text-[11px] text-muted">{sub}</div>}
      </div>
    </div>
  );

  return (
    <div className="w-[44rem]">
      <table className="w-full table-fixed text-xs">
        <colgroup>
          <col className="w-[8rem]" />
          <col className="w-[8.5rem]" />
          <col className="w-[8.5rem]" />
          <col className="w-[7.5rem]" />
          <col className="w-[6.5rem]" />
          <col />
        </colgroup>
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="pb-1.5 pl-2 pr-2 whitespace-nowrap">Dispatch</th>
            <th className="pb-1.5 pr-2 whitespace-nowrap">1 · {challan ? "Challan" : "Invoice"}</th>
            <th className="pb-1.5 pr-2 whitespace-nowrap">2 · Sent</th>
            <th className="pb-1.5 pr-2 whitespace-nowrap">3 · Docket / LR</th>
            <th className="pb-1.5 pr-2 whitespace-nowrap">Status</th>
            <th className="pb-1.5" />
          </tr>
        </thead>
        <tbody className="[&>tr:nth-child(odd)]:bg-slate-100/70 dark:[&>tr:nth-child(odd)]:bg-white/[0.04]">
          {invoices.map((inv, i) => {
            const n = i + 1;
            const done = stepsDone(inv, billType);
            const all = done.invoice && done.dispatch && done.docket;
            const docNo = challan ? str(inv.challan_no) : str(inv.invoice_no);
            const docDate = day(challan ? inv.challan_date : inv.invoice_date);
            const lr = str(inv.lr_link);
            const lrHref = /^https?:\/\//i.test(lr) ? lr : "";
            const next = nextStep(inv, billType);
            const nextLabel =
              next === "invoice" ? (challan ? "Challan" : "Invoice") : next === "dispatch" ? "Sending" : "Docket / LR";
            return (
              <tr key={str(inv.id) || i} className="align-top">
                <td className="rounded-l-md py-2 pl-2 pr-2">
                  <div className="font-semibold text-foreground">Dispatch #{n}</div>
                  <div className="break-words text-[11px] text-muted">Slip {slipsOf(inv)}</div>
                </td>
                <td className="py-2 pr-2">{step(done.invoice, docNo, docDate)}</td>
                <td className="py-2 pr-2">
                  {step(
                    done.dispatch,
                    str(inv.delivery_mode),
                    str(inv.transporter_name) || str(inv.courier_mode) || str(inv.vehicle_no) || undefined
                  )}
                </td>
                <td className="py-2 pr-2">
                  {step(
                    done.docket,
                    str(inv.docket_no),
                    lrHref || day(inv.delivery_date) ? (
                      <>
                      {day(inv.delivery_date) && <span className="block">Delivered {day(inv.delivery_date)}</span>}
                      {lrHref && (
                      <a
                        href={lrHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
                      >
                        LR copy
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      )}
                      </>
                    ) : undefined
                  )}
                </td>
                <td className="py-2 pr-2">
                  {all ? (
                    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                      Dispatched
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                      Next: {nextLabel}
                    </span>
                  )}
                </td>
                <td className="rounded-r-md py-2 pr-1.5 text-right whitespace-nowrap">
                  {canEdit && (
                    <span className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          setWizard({
                            invoice: inv,
                            label: `Dispatch #${n} · Packing Slip ${slipsOf(inv)}`,
                            step: all ? "invoice" : nextStep(inv, billType),
                          })
                        }
                        title={all ? "Edit dispatch" : "Continue dispatch"}
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-input-border px-1.5 text-[11px] font-medium text-foreground hover:bg-background"
                      >
                        <Pencil className="h-3 w-3" />
                        {all ? "Edit" : "Continue"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(inv, n)}
                        disabled={deleting === str(inv.id)}
                        aria-label={`Delete dispatch #${n}`}
                        className="rounded p-0.5 text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {deleting === str(inv.id) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          {/* Packing slips not on a dispatch yet. */}
          {waiting.map((s) => {
            const id = str(s.id);
            return (
              <tr key={id} className="align-top">
                <td className="rounded-l-md py-2 pl-2 pr-2">
                  <label className="flex items-start gap-1.5">
                  {canEdit && (
                    <input
                      type="checkbox"
                      aria-label={`Send packing slip ${slipName(s)}`}
                      checked={picked.has(id)}
                      onChange={(e) =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(id);
                          else next.delete(id);
                          return next;
                        })
                      }
                      className="mt-px h-3.5 w-3.5 shrink-0 accent-primary"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block break-words font-semibold text-foreground">Slip {slipName(s)}</span>
                    {day(s.packing_slip_date) && (
                      <span className="block text-[11px] text-muted">{day(s.packing_slip_date)}</span>
                    )}
                  </span>
                  </label>
                </td>
                <td colSpan={3} className="py-2 pr-2 text-[11px] text-muted">
                  {canEdit ? "Tick to send it on a new dispatch" : "Not on a dispatch yet"}
                </td>
                <td colSpan={2} className="rounded-r-md py-2 pr-2">
                  <span className="inline-flex rounded-full border border-slate-300 bg-surface px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-white/20 dark:text-slate-300">
                    Waiting
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {canEdit && waiting.length > 0 && (
        <button
          type="button"
          onClick={() => {
            const ids = [...picked];
            setWizard({
              invoice: null,
              slipIds: ids,
              label: `Packing Slip${ids.length > 1 ? "s" : ""} ${waiting
                .filter((s) => picked.has(str(s.id)))
                .map(slipName)
                .join(", ")}`,
            });
          }}
          disabled={picked.size === 0}
          className="mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          <Truck className="h-3.5 w-3.5" />
          {picked.size > 0 ? `New dispatch (${picked.size} slip${picked.size === 1 ? "" : "s"})` : "Tick slips for a new dispatch"}
        </button>
      )}

      {wizard && (
        <DispatchWizard
          orderId={orderId}
          billType={billType}
          invoice={wizard.invoice}
          slipIds={wizard.slipIds}
          slipsLabel={wizard.label}
          startStep={wizard.step}
          onClose={() => {
            setWizard(null);
            setPicked(new Set());
          }}
        />
      )}
    </div>
  );
}
