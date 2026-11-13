"use client";

import type { QuoteFx } from "../../lib/commercial";

/** "Quote in USD" switch with the rate it is fixed at, and "Use current rate" when
 *  today's rate differs (as on the pump Commercial Summary). Prices stay in INR. */
export default function UsdToggle({
  fx,
  rateNow,
  busy,
  onChange,
}: {
  fx: QuoteFx | undefined;
  /** Today's USD to INR rate (null: not set; undefined: loading). */
  rateNow: number | null | undefined;
  busy: boolean;
  onChange: (currency: "INR" | "USD", refreshRate?: boolean) => void;
}) {
  const rate = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 4 });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[12px] text-muted-foreground">
        {fx ? (
          <>
            Entered in INR · quoted in USD at <b className="font-mono font-semibold text-foreground tabular-nums">1 USD = ₹{rate(fx.rate)}</b>
          </>
        ) : (
          "Prices in INR"
        )}
      </span>
      {fx && rateNow && rateNow !== fx.rate && (
        <button
          type="button"
          className="text-[12px] font-medium text-primary hover:underline disabled:opacity-50"
          disabled={busy}
          onClick={() => onChange("USD", true)}
          title="Fix today's USD to INR rate on this enquiry instead"
        >
          Use current rate (₹{rate(rateNow)})
        </button>
      )}
      <label
        className={`inline-flex items-center gap-2 text-[12.5px] font-medium ${fx ? "text-primary" : "text-foreground"} ${
          busy || (!fx && !rateNow) ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
        title={
          !fx && rateNow === null
            ? "Set the USD to INR rate first (sidebar > USD to INR)"
            : fx
              ? "Back to INR"
              : "Show the totals and the quotation document in USD at the current rate (fixed for this enquiry)"
        }
      >
        <button
          type="button"
          role="switch"
          aria-checked={!!fx}
          disabled={busy || (!fx && !rateNow)}
          onClick={() => onChange(fx ? "INR" : "USD")}
          className={`relative h-5 w-9 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed ${fx ? "bg-primary" : "bg-input"}`}
        >
          <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.25)] transition-transform ${fx ? "translate-x-4" : ""}`} />
        </button>
        Quote in USD
      </label>
    </div>
  );
}
