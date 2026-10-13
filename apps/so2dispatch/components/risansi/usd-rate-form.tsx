"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { saveUsdInrRateAction } from "@/app/risansi/settings/actions";

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      });
}

/** The USD → INR rate: what it is, who set it, and the form to change it. */
export function UsdRateForm({
  rate,
  updatedAt,
  updatedBy,
  unconverted,
}: {
  rate: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  unconverted: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(rate ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await saveUsdInrRateAction(value);
    setSaving(false);
    if (!res.ok) {
      setMessage({ ok: false, text: res.error });
      return;
    }
    setMessage({ ok: true, text: "Saved." });
    router.refresh();
  }

  return (
    <section className="max-w-2xl rounded-xl border border-card-border bg-surface p-6 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">USD → INR conversion rate</h2>
      <p className="mt-1 text-sm text-muted">
        A USD order&apos;s value in INR is worked out from this when the order is
        saved, and the rate it used is kept with the order — so changing the rate
        here does not re-price orders already converted.
      </p>

      <form onSubmit={save} className="mt-5 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-foreground">₹ per 1 USD</span>
          <input
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 88.25"
            className="h-10 w-40 rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save rate
        </button>
        {message && (
          <span role="status" className={`text-sm ${message.ok ? "text-emerald-600" : "text-danger"}`}>
            {message.text}
          </span>
        )}
      </form>

      <p className="mt-4 text-xs text-muted">
        {rate
          ? `Current rate ₹${rate}${updatedBy ? ` · set by ${updatedBy}` : ""}${updatedAt ? ` on ${when(updatedAt)}` : ""}.`
          : "No rate set yet — USD orders are not converted until one is."}
        {unconverted > 0 &&
          ` ${unconverted} USD ${unconverted === 1 ? "order has" : "orders have"} no conversion yet; each is converted the next time its Order details are saved.`}
      </p>
    </section>
  );
}
