"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import {
  createDispatchAction,
  updateOrderChildAction,
} from "@/app/risansi/orders/actions";
import { INVOICE_FIELDS, dependsOnSatisfied, selectOptionsFor } from "@/lib/order-schema";
import {
  DISPATCH_STEPS,
  stepFields,
  stepsDone,
  type DispatchStepKey,
} from "@/lib/dispatch-steps";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const inputClass =
  "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";

/**
 * Raising or continuing a dispatch, one step at a time: Invoice (or Challan)
 * → Dispatch → Docket & LR. Each step saves on its own — Save & next, or Save
 * & close to come back later. A new dispatch is created on its first save, so
 * closing early leaves nothing behind.
 */
export function DispatchWizard({
  orderId,
  billType,
  invoice,
  slipIds,
  slipsLabel,
  startStep = "invoice",
  onClose,
}: {
  orderId: string;
  billType: unknown;
  /** The dispatch being continued; null for a new one. */
  invoice: Row | null;
  /** A new dispatch: the packing slips it covers. */
  slipIds?: string[];
  slipsLabel: string;
  startStep?: DispatchStepKey;
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<DispatchStepKey>(startStep);
  const [invoiceId, setInvoiceId] = useState<string | null>(invoice ? str(invoice.id) : null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(INVOICE_FIELDS.map((f) => [f.column, str(invoice?.[f.column]).slice(0, f.type === "date" ? 10 : undefined)]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const read = (col: string) => (col === "bill_type" ? str(billType) : values[col] ?? "");
  const fields = useMemo(
    () => stepFields(step).filter((f) => dependsOnSatisfied(f, read)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, values, billType]
  );
  const done = stepsDone(values, billType);
  const idx = DISPATCH_STEPS.findIndex((s) => s.key === step);

  function close() {
    if (saved) router.refresh();
    onClose();
  }

  async function save(next: boolean) {
    setSaving(true);
    setError(null);
    let id = invoiceId;
    if (!id) {
      const made = await createDispatchAction(orderId, slipIds ?? []);
      if (!made.ok) {
        setSaving(false);
        setError(made.error);
        return;
      }
      id = made.id;
      setInvoiceId(id);
    }
    const link = (values.lr_link ?? "").trim();
    if (step === "docket" && link && !/^https?:\/\//i.test(link)) {
      setSaving(false);
      setError("LR Link must be a web link starting with https://");
      return;
    }
    const stepValues = Object.fromEntries(fields.map((f) => [f.column, (values[f.column] ?? "").trim()]));
    const res = await updateOrderChildAction(id, "order_invoices", stepValues, orderId);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
    if (next && idx < DISPATCH_STEPS.length - 1) setStep(DISPATCH_STEPS[idx + 1].key);
    else {
      router.refresh();
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Dispatch"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={() => !saving && close()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              {invoice ? "Dispatch" : "New dispatch"}
            </h2>
            <p className="text-xs text-muted">{slipsLabel}</p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The steps: done ones ticked; once the dispatch exists, any can be opened. */}
        <ol className="my-4 flex items-center gap-2">
          {DISPATCH_STEPS.map((s, i) => {
            const here = s.key === step;
            return (
              <li key={s.key} className="flex flex-1 items-center gap-2">
                <button
                  type="button"
                  disabled={!invoiceId || saving}
                  onClick={() => setStep(s.key)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors disabled:cursor-default ${
                    here ? "border-primary bg-primary/5 text-foreground" : "border-card-border text-muted"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      done[s.key] ? "bg-emerald-500 text-white" : here ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
                    }`}
                  >
                    {done[s.key] ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  {s.key === "invoice" && str(billType) === "Challan" ? "Challan" : s.label}
                </button>
              </li>
            );
          })}
        </ol>

        {error && (
          <div className="mb-3 rounded-[10px] border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
          {fields.map((f) => (
            <label key={f.column} className="block text-sm">
              <span className="mb-1 block text-[13px] font-medium text-brand-label">{f.label}</span>
              {f.type === "select" ? (
                <select
                  value={values[f.column] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.column]: e.target.value }))}
                  className={`${inputClass} cursor-pointer`}
                >
                  <option value="">—</option>
                  {selectOptionsFor(f, values[f.column] ?? "").map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === "date" ? "date" : f.type === "text" ? "text" : "number"}
                  step={f.type === "number" ? "any" : undefined}
                  min={f.min}
                  placeholder={f.column === "lr_link" ? "Paste the SharePoint link" : undefined}
                  value={values[f.column] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.column]: e.target.value }))}
                  className={inputClass}
                />
              )}
            </label>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-lg border border-input-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-background"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save(false)}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-lg border border-primary/40 px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 disabled:opacity-60"
          >
            Save &amp; close
          </button>
          {idx < DISPATCH_STEPS.length - 1 && (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save &amp; next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
