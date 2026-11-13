"use client";

import { useEffect, useState } from "react";
import { CircleCheck, Clock, Info, RefreshCw } from "lucide-react";

import PageHeader from "../../components/ui/PageHeader";
import { parseUsdRate } from "../../lib/commercial";
import { getUsdInrSetting, saveUsdInrRate, type UsdInrSetting } from "../../services/settingsService";
// shadcn/ui (user, 2026-11-13: the new look, branch select-shadcn).
import { Button } from "@/components/shadcn/button";
import { Card } from "@/components/shadcn/card";
import { Alert, Field } from "@/components/shadcn/field";
import { cn } from "@/lib/utils";

// USD to INR (sidebar, every user): the one exchange rate for the portal. An enquiry that
// switches on Quote in USD (Commercial page) fixes the rate at that moment,
// so a change here applies to enquiries switched to USD from now on (or
// re-taken there with "Use current rate").

const fmtWhen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

/** A card's title row. */
const CardHead = ({ children }: { children: React.ReactNode }) => (
  <div className="border-b border-border px-4 py-3 text-[13px] font-semibold text-foreground">{children}</div>
);

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
  const invalid = draft.trim() !== "" && parsed === undefined;

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
    <div className="min-h-full bg-background">
      <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-10 sm:px-6 2xl:px-8">
        <PageHeader icon={<CurrencyIcon />} title="USD to INR" subtitle="Exchange rate for quotations in USD" />

        {loadError ? (
          <Alert className="flex items-center gap-2">
            {loadError}
            <Button variant="outline" size="sm" className="ml-auto" onClick={load}>
              <RefreshCw /> Retry
            </Button>
          </Alert>
        ) : !setting ? (
          <Card className="p-6 text-[13px] text-muted-foreground">Loading…</Card>
        ) : (
          // Three cards side by side on a wide screen (the rate, changing it, how it is used),
          // so the page fills its width without stretching a single input.
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {/* Current rate */}
            <Card className="overflow-hidden">
              <CardHead>Current rate</CardHead>
              <div className="px-4 py-5">
                {setting.rate === null ? (
                  <p className="text-[14px] font-medium text-warning">Not set yet</p>
                ) : (
                  <p className="flex items-baseline gap-2 text-foreground">
                    <span className="text-[13px] text-muted-foreground">1 USD =</span>
                    <span className="font-mono text-[30px] leading-none font-semibold tabular-nums">
                      ₹{setting.rate.toLocaleString("en-IN", { maximumFractionDigits: 4 })}
                    </span>
                  </p>
                )}
                {setting.updatedAt && (
                  <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <Clock className="size-3.5 shrink-0" />
                    Updated {fmtWhen(setting.updatedAt)}
                    {setting.updatedByName ? ` by ${setting.updatedByName}` : ""}
                  </p>
                )}
              </div>
            </Card>

            {/* Change it */}
            <Card className="overflow-hidden">
              <CardHead>Change the rate</CardHead>
              <form
                className="flex flex-col gap-3 px-4 py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (changed) save();
                }}
              >
                <Field label="New rate (₹ for 1 USD)" htmlFor="usd-inr-rate" error={invalid ? "Enter a number above 0 and up to 1000." : undefined}>
                  <div
                    className={cn(
                      "flex h-9 max-w-[240px] items-center rounded-md border bg-card shadow-xs transition-[box-shadow,border-color] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25",
                      invalid ? "border-destructive/60" : "border-input",
                    )}
                  >
                    <span className="pl-3 text-[13.5px] text-muted-foreground">₹</span>
                    <input
                      id="usd-inr-rate"
                      type="text"
                      inputMode="decimal"
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setState("");
                        setSaveError("");
                      }}
                      placeholder="e.g. 84.25"
                      className="w-full bg-transparent px-2 font-mono text-[14px] text-foreground tabular-nums outline-none placeholder:text-muted-foreground/80"
                    />
                  </div>
                </Field>
                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={!changed || state === "saving"}>
                    {state === "saving" ? "Saving…" : "Save rate"}
                  </Button>
                  {state === "saved" && (
                    <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-success">
                      <CircleCheck className="size-3.5" /> Saved
                    </span>
                  )}
                </div>
                {saveError && <Alert>{saveError}</Alert>}
              </form>
            </Card>

            {/* How it is used */}
            <Card className="overflow-hidden lg:col-span-2 2xl:col-span-1">
              <CardHead>
                <span className="inline-flex items-center gap-1.5">
                  <Info className="size-3.5 text-info" /> How the rate is used
                </span>
              </CardHead>
              <p className="px-4 py-4 text-[12.5px] leading-relaxed text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
                Prices are always entered in INR. When <b>Quote in USD</b> is switched on for an enquiry on the
                Commercial page, this rate is fixed on that enquiry and its Commercial Offer shows USD. Changing the rate
                here does not change enquiries already in USD; they can take the new rate with <b>Use current rate</b>.
              </p>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

const CurrencyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 4v16M4 7h6a3 3 0 0 1 0 6H4" />
    <path d="M17 4v16M14 8.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5-1.3 2.2-3 2.5-3 1.1-3 2.5 1.3 2.5 3 2.5 3-1.1 3-2.5" />
  </svg>
);
