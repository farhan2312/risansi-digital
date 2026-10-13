"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import {
  getOrderPisAction,
  type ViewPisPayload,
} from "@/app/risansi/orders/actions";

type Row = Record<string, unknown>;

function fmtDate(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const numberFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
function fmtValue(v: unknown): string {
  if (v == null || String(v).trim() === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? numberFmt.format(n) : String(v);
}

/**
 * Read-only popup of the billing docs Billing has recorded for an SO.
 *  • Tax Invoice → the PI list.
 *  • Challan     → the flat challan row.
 */
export function ViewPisModal({
  orderId,
  onClose,
}: {
  orderId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ViewPisPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getOrderPisAction(orderId).then((d) => {
      if (!active) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [orderId]);

  const isChallan = data?.bill_type === "Challan";
  const title = isChallan ? "Challan — filed by Billing" : "PIs — filed by Billing";
  const empty = isChallan
    ? !data?.challan || !data.challan.challan_no
    : !data?.pis || data.pis.length === 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-card-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:p-6 sm:pb-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="mb-1 font-display text-lg font-semibold text-foreground">
          {title}
        </h2>
        <p className="mb-4 text-sm text-muted">Read-only view.</p>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted">
            <FileText className="h-6 w-6 text-muted-foreground" />
            {isChallan ? "No challan recorded yet." : "No PIs recorded yet."}
          </div>
        ) : isChallan && data?.challan ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Challan No." value={String(data.challan.challan_no ?? "—") || "—"} />
            <Field label="Challan Date" value={fmtDate(data.challan.challan_date)} />
            <Field label="Challan Value" value={fmtValue(data.challan.challan_value)} />
            <Field label="FR Reason" value={String(data.challan.fr_reason ?? "—") || "—"} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">PI No.</th>
                  <th className="px-3 py-2">PI Date</th>
                  <th className="px-3 py-2 text-right">PI Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {(data?.pis ?? []).map((r: Row) => (
                  <tr key={String(r.id)} className="text-foreground">
                    <td className="px-3 py-2 font-medium">
                      {String(r.pi_no ?? "—") || "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">
                      {fmtDate(r.pi_date)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtValue(r.pi_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-[14px] text-foreground">{value}</div>
    </div>
  );
}
