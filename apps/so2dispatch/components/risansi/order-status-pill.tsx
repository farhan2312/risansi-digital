"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setOrderStatusAction } from "@/app/risansi/orders/actions";
import type { OrderStatus } from "@/lib/order-row-view";

const TONE: Record<OrderStatus, string> = {
  Active: "bg-sky-50 text-sky-700 ring-sky-200",
  "Active-Hold": "bg-amber-50 text-amber-800 ring-amber-200",
  Closed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Canceled: "bg-rose-50 text-rose-700 ring-rose-200",
  Diverted: "bg-violet-50 text-violet-700 ring-violet-200",
};

/** The order's own status as a pill. */
export function OrderStatusPill({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE[status]}`}>
      {status}
    </span>
  );
}

/**
 * The order's status in its details pop-up. It follows the order by itself;
 * the one thing done by hand is to cancel or divert it, with the reason (and
 * where it went). Central Visibility and Admin.
 */
export function OrderStatusControl({
  orderId,
  status,
  canSet,
  onChanged,
}: {
  orderId: string;
  status: OrderStatus;
  canSet: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState<"Canceled" | "Diverted" | null>(null);
  const [reason, setReason] = useState("");
  const [divertedTo, setDivertedTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cancel or divert: whichever it is not already.
  const choices = (["Canceled", "Diverted"] as const).filter((c) => c !== status);

  async function save() {
    if (!picking) return;
    if (!reason.trim()) return setError("Say why.");
    if (picking === "Diverted" && !divertedTo.trim()) return setError("Say where it was diverted to.");
    setSaving(true);
    setError(null);
    const res = await setOrderStatusAction(
      orderId,
      picking === "Canceled" ? "Cancelled by client" : "Diverted",
      reason,
      picking === "Diverted" ? divertedTo : ""
    );
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setPicking(null);
    setReason("");
    setDivertedTo("");
    router.refresh();
    onChanged();
  }

  const field =
    "h-9 w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";
  return (
    <span className="inline-flex flex-col items-start gap-1.5">
      <span className="inline-flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Order status</span>
        <OrderStatusPill status={status} />
        {canSet &&
          !picking &&
          choices.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setPicking(c);
                setError(null);
              }}
              className="rounded-full border border-input-border px-2 py-0.5 text-[11px] font-semibold text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              {c === "Canceled" ? "Cancel order" : "Divert"}
            </button>
          ))}
      </span>
      {picking && (
        <span className="flex w-full max-w-md flex-col gap-2 rounded-xl border border-card-border bg-background/60 p-3">
          <span className="text-xs font-semibold text-foreground">{picking === "Canceled" ? "Cancel this order" : "Divert this order"}</span>
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className={field} />
          {picking === "Diverted" && (
            <input value={divertedTo} onChange={(e) => setDivertedTo(e.target.value)} placeholder="Diverted to (SO / client)" className={field} />
          )}
          {error && <span className="text-xs text-rose-600">{error}</span>}
          <span className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPicking(null)}
              disabled={saving}
              className="inline-flex h-8 items-center rounded-lg border border-input-border px-3 text-xs font-medium text-foreground hover:bg-background"
            >
              Back
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {picking === "Canceled" ? "Cancel order" : "Divert order"}
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
