"use client";

import { useEffect, useState } from "react";

import PageHeader from "../../components/ui/PageHeader";
import { parseUsdRate } from "../../lib/commercial";
import { getUsdInrSetting, saveUsdInrRate, type UsdInrSetting } from "../../services/settingsService";

// Admin > USD to INR: the one exchange rate for the portal. An enquiry that
// switches on Quote in USD (Commercial page) fixes the rate at that moment,
// so a change here applies to enquiries switched to USD from now on (or
// re-taken there with "Use current rate").

const fmtWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

export default function UsdInrPage() {
  const [setting, setSetting] = useState<UsdInrSetting | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"" | "saving" | "saved">("");
  const [saveError, setSaveError] = useState("");

  const load = () => {
    setLoadError("");
    getUsdInrSetting()
      .then((s) => {
        setSetting(s);
        setDraft(s.rate === null ? "" : String(s.rate));
      })
      .catch(() => setLoadError("Couldn't load the rate."));
  };
  useEffect(load, []);

  const parsed = parseUsdRate(draft);
  const changed = parsed !== undefined && parsed !== setting?.rate;

  const save = async () => {
    if (parsed === undefined) return;
    setState("saving");
    setSaveError("");
    try {
      const s = await saveUsdInrRate(parsed);
      setSetting(s);
      setDraft(s.rate === null ? "" : String(s.rate));
      setState("saved");
    } catch (e) {
      setState("");
      setSaveError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Couldn't save the rate.");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 py-5 sm:px-6">
      <PageHeader icon={<CurrencyIcon />} title="USD to INR" subtitle="Exchange rate for quotations in USD" />

      <section className="rounded-xl border border-line bg-paper p-5">
        {loadError ? (
          <p className="text-[13.5px] text-neg">
            {loadError}{" "}
            <button type="button" className="font-semibold text-accent underline" onClick={load}>
              Retry
            </button>
          </p>
        ) : !setting ? (
          <p className="text-[13.5px] text-fg-3">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-[11.5px] font-semibold tracking-[0.06em] text-fg-3 uppercase">Current rate</p>
              <p className="mt-1 font-mono text-[22px] font-bold text-fg">
                {setting.rate === null ? (
                  <span className="text-[14px] font-medium text-warn">Not set yet</span>
                ) : (
                  <>1 USD = ₹{setting.rate.toLocaleString("en-IN", { maximumFractionDigits: 4 })}</>
                )}
              </p>
              {setting.updatedAt && (
                <p className="mt-0.5 text-[12px] text-fg-3">
                  Updated {fmtWhen(setting.updatedAt)}
                  {setting.updatedByName ? ` by ${setting.updatedByName}` : ""}
                </p>
              )}
            </div>

            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (changed) save();
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-fg-2">New rate (₹ for 1 USD)</span>
                <div className="flex items-center rounded-lg border border-line bg-paper focus-within:border-accent">
                  <span className="pl-3 text-[13.5px] text-fg-3">₹</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setState("");
                      setSaveError("");
                    }}
                    placeholder="e.g. 84.25"
                    className="w-40 bg-transparent px-2 py-2 font-mono text-[14px] text-fg outline-none"
                  />
                </div>
              </label>
              <button
                type="submit"
                disabled={!changed || state === "saving"}
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state === "saving" ? "Saving…" : "Save rate"}
              </button>
              {state === "saved" && <span className="pb-2 text-[12.5px] font-medium text-pos">Saved</span>}
            </form>
            {draft.trim() !== "" && parsed === undefined && (
              <p className="text-[12.5px] text-neg">Enter a number above 0 and up to 1000.</p>
            )}
            {saveError && <p className="text-[12.5px] text-neg">{saveError}</p>}

            <p className="rounded-lg bg-sunk px-3 py-2.5 text-[12.5px] leading-relaxed text-fg-2">
              Prices are always entered in INR. When <b>Quote in USD</b> is switched on for an enquiry on the
              Commercial page, this rate is fixed on that enquiry and its Commercial Offer shows USD. Changing the rate
              here does not change enquiries already in USD; they can take the new rate with <b>Use current rate</b>.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

const CurrencyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 4v16M4 7h6a3 3 0 0 1 0 6H4" />
    <path d="M17 4v16M14 8.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5-1.3 2.2-3 2.5-3 1.1-3 2.5 1.3 2.5 3 2.5 3-1.1 3-2.5" />
  </svg>
);
