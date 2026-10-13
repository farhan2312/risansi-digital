"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import {
  createItemAction,
  createSpareItemAction,
} from "@/app/risansi/orders/actions";
import {
  ADD_ON_SPARE_FIELDS,
  BOI_ITEM_OPTIONS,
  isAddOnOptional,
  addOnFieldsFor,
  firstMissingAddOnField,
  selectOptionsFor,
} from "@/lib/order-schema";
import { cleanBoiRows } from "@/lib/order-validation";
import type { NewItemInput } from "@/lib/orders";

const inputClass =
  "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";

// One bought-out item as the form holds it. Central Visibility lists what is
// bought out for the EC; Purchase records what happens to each afterwards.
type BoiRow = {
  boi_item: string;
  boi_item_other: string;
  boi_make: string;
  boi_description: string;
};

const blankBoiRow = (): BoiRow => ({
  boi_item: "",
  boi_item_other: "",
  boi_make: "",
  boi_description: "",
});

export function AddOnForm({
  orderId,
  soLabel,
  orderType,
  boiFlag,
  onClose,
}: {
  orderId: string;
  soLabel: string;
  // The SO's Order Type (Pump/Spare) drives which form is rendered. Falls back
  // to Pump when the SO hasn't set an Order Type yet.
  orderType?: string | null;
  // The SO's BOI field. The bought-out list is offered only when it is Yes —
  // on any other SO there is nothing bought out to list.
  boiFlag?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const isSpare = orderType === "Spare";
  const fields = addOnFieldsFor(orderType);
  const [values, setValues] = useState<Record<string, string>>({});
  const [boi, setBoi] = useState<BoiRow[]>([]);
  const listsBoi = (boiFlag ?? "") === "Yes";
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();

    // Every field on the Add-On is mandatory — only the Spare's Order Copy
    // file is optional. Checked again server-side.
    const missing = firstMissingAddOnField(orderType, values);
    if (missing) {
      setError(`${missing.label} is required.`);
      document.getElementById(`addon-${missing.column}`)?.focus();
      return;
    }

    // The same check the action runs, so a bad row is caught before the EC
    // is created rather than after.
    const rows = cleanBoiRows(listsBoi ? boi : []);
    if (!rows.ok) {
      setError(rows.error);
      return;
    }

    setSaving(true);
    setError(null);

    let ok: boolean;
    let err: string | undefined;
    if (isSpare) {
      const fd = new FormData();
      for (const f of ADD_ON_SPARE_FIELDS) fd.append(f.column, values[f.column] ?? "");
      // FormData carries only strings, so the rows travel as JSON.
      if (rows.rows.length > 0) fd.append("boi", JSON.stringify(rows.rows));
      if (file) fd.append("order_copy", file);
      const res = await createSpareItemAction(orderId, fd);
      ok = res.ok;
      err = res.ok ? undefined : res.error;
    } else {
      const res = await createItemAction(
        orderId,
        values as NewItemInput,
        rows.rows
      );
      ok = res.ok;
      err = res.ok ? undefined : res.error;
    }

    setSaving(false);
    if (!ok) {
      setError(err ?? "Something went wrong.");
      return;
    }
    router.refresh();
    onClose();
  }

  const title = isSpare ? "Add spare order" : "Add pump order";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-card-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:p-6 sm:pb-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
        <p className="mb-5 text-sm text-muted">
          EC under {soLabel}
          {orderType ? ` · Type: ${orderType}` : ""}
        </p>

        <form onSubmit={submit}>
          {error && (
            <div className="mb-4 rounded-[10px] border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.column}>
                <label
                  htmlFor={`addon-${field.column}`}
                  className="mb-1.5 block text-[13px] font-medium text-brand-label"
                >
                  {field.label}
                  {isAddOnOptional(orderType, field.column) ? (
                    <span className="font-normal text-muted"> (optional)</span>
                  ) : (
                    <span className="text-danger"> *</span>
                  )}
                </label>
                {field.type === "select" ? (
                  <select
                    id={`addon-${field.column}`}
                    required={!isAddOnOptional(orderType, field.column)}
                    value={values[field.column] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [field.column]: e.target.value }))
                    }
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="">—</option>
                    {selectOptionsFor(field, values[field.column] ?? "").map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`addon-${field.column}`}
                    required={!isAddOnOptional(orderType, field.column)}
                    type={
                      field.type === "date"
                        ? "date"
                        : field.type === "text"
                          ? "text"
                          : "number"
                    }
                    step={field.type === "number" ? "any" : undefined}
                    value={values[field.column] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [field.column]: e.target.value }))
                    }
                    className={inputClass}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Bought-out items: optional, and the only part of this form that
              is a list rather than one value per EC. Offered only on an SO
              whose BOI is Yes — the flag is what puts them in front of
              Purchase, so without it there is nothing to list. */}
          {listsBoi && (
          <div className="mt-6 rounded-[10px] border border-card-border bg-surface/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-medium text-brand-label">
                  Bought-out items
                  <span className="ml-1 font-normal text-muted-foreground">
                    (optional)
                  </span>
                </p>
                <p className="text-xs text-muted">
                  What is bought out for this EC. Purchase records the expected
                  and actual receipt dates against each.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBoi((r) => [...r, blankBoiRow()])}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-background"
              >
                <Plus className="h-3.5 w-3.5" />
                Add item
              </button>
            </div>

            {boi.length > 0 && (
              <div className="mt-3 space-y-3">
                {boi.map((row, i) => {
                  const set = (patch: Partial<BoiRow>) =>
                    setBoi((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
                  return (
                    <div
                      key={i}
                      className="rounded-[10px] border border-card-border bg-surface p-3"
                    >
                      <div className="flex items-start gap-2">
                        <div className="grid flex-1 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
                          <div>
                            <label
                              htmlFor={`boi-item-${i}`}
                              className="mb-1.5 block text-[12px] font-medium text-brand-label"
                            >
                              Item
                            </label>
                            <select
                              id={`boi-item-${i}`}
                              value={row.boi_item}
                              onChange={(e) => set({ boi_item: e.target.value })}
                              className={`${inputClass} cursor-pointer`}
                            >
                              <option value="">—</option>
                              {BOI_ITEM_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label
                              htmlFor={`boi-make-${i}`}
                              className="mb-1.5 block text-[12px] font-medium text-brand-label"
                            >
                              BOI Make
                            </label>
                            <input
                              id={`boi-make-${i}`}
                              type="text"
                              value={row.boi_make}
                              onChange={(e) => set({ boi_make: e.target.value })}
                              className={inputClass}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`boi-desc-${i}`}
                              className="mb-1.5 block text-[12px] font-medium text-brand-label"
                            >
                              Description
                            </label>
                            <input
                              id={`boi-desc-${i}`}
                              type="text"
                              value={row.boi_description}
                              onChange={(e) => set({ boi_description: e.target.value })}
                              className={inputClass}
                            />
                          </div>
                          {/* Others has to say which item it actually is. */}
                          {row.boi_item === "Others" && (
                            <div className="sm:col-span-3">
                              <label
                                htmlFor={`boi-other-${i}`}
                                className="mb-1.5 block text-[12px] font-medium text-brand-label"
                              >
                                Item (Others)
                              </label>
                              <input
                                id={`boi-other-${i}`}
                                type="text"
                                value={row.boi_item_other}
                                onChange={(e) => set({ boi_item_other: e.target.value })}
                                className={inputClass}
                              />
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setBoi((rs) => rs.filter((_, j) => j !== i))}
                          aria-label="Remove this bought-out item"
                          className="mt-7 shrink-0 rounded-lg border border-input-border p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {isSpare && (
            // Spare form's Order Copy file upload — the one field on either
            // Add-On that is not mandatory.
            <div className="mt-5">
              <label className="mb-1.5 block text-[13px] font-medium text-brand-label">
                Order Copy (file)
                <span className="ml-1 font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-input-border bg-surface px-4 py-3 text-sm transition-colors hover:bg-background">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">
                  {file ? file.name : "Choose a file (PDF/image/doc, up to 8MB)"}
                </span>
                {file && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="text-xs font-medium text-danger hover:underline"
                  >
                    Remove
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-[10px] border border-input-border bg-surface text-sm font-medium text-foreground transition-colors hover:bg-background"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-70"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Adding…" : "Add EC"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
