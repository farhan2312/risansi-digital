"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import {
  saveEcBoiItemsAction,
  boiItemsAction,
  createItemAction,
  createSpareItemAction,
  updateOrderSectionAction,
} from "@/app/risansi/orders/actions";
import {
  ADD_ON_SPARE_FIELDS,
  BOI_ITEM_OPTIONS,
  isAddOnOptional,
  addOnFieldsFor,
  firstMissingAddOnField,
  selectOptionsFor,
  ecNoPrefix,
  numberFormatNote,
} from "@/lib/order-schema";
import { cleanBoiRows } from "@/lib/order-validation";
import type { NewItemInput } from "@/lib/orders";

const inputClass =
  "h-10 w-full rounded-[10px] border border-input-border bg-surface px-3 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";

// One bought-out item as the form holds it. Central Visibility lists what is
// bought out for the EC; Purchase records what happens to each afterwards.
type BoiRow = {
  /** A row already saved on the EC (editing); none on a new one. */
  id?: string;
  boi_item: string;
  boi_item_other: string;
  boi_make: string;
  boi_qty: string;
  boi_description: string;
};

const blankBoiRow = (): BoiRow => ({
  boi_item: "",
  boi_item_other: "",
  boi_make: "",
  boi_qty: "",
  boi_description: "",
});

export function AddOnForm({
  orderId,
  soLabel,
  orderType,
  boiFlag,
  item,
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
  /** An existing EC to edit: its Add-On fields, and more bought-out items when its BOI is Yes (no file). */
  item?: Record<string, unknown> | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const isSpare = orderType === "Spare";
  const fields = addOnFieldsFor(orderType);
  const editing = !!item;
  // EC No. opens with all but its own number: "EC/26/1/1833/" from the SO
  // No. (soLabel is it, when the SO has one). The whole stays editable.
  const ecStart = ecNoPrefix(soLabel);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = item
      ? Object.fromEntries(
          fields.map((f) => [f.column, item[f.column] == null ? "" : String(item[f.column]).slice(0, f.type === "date" ? 10 : undefined)])
        )
      : // A new pump: BOI No until said otherwise (the SO's own answer, if Yes).
        isSpare
        ? {}
        : { boi: (boiFlag ?? "") === "Yes" ? "Yes" : "No" };
    if (!String(start.ec_no ?? "").trim()) start.ec_no = ecStart;
    // A pump's Base Plate is No until said Yes.
    if (!isSpare && !start.base_plate) start.base_plate = "No";
    return start;
  });
  const [boi, setBoi] = useState<BoiRow[]>([]);
  // A pump's BOI Yes opens its bought-out item list — adding the EC, or
  // editing one (its saved items load as rows to change or remove).
  const listsBoi = !isSpare && values.boi === "Yes";
  const itemId = item ? String(item.id) : null;
  const [existingBoi, setExistingBoi] = useState<Record<string, unknown>[] | null>(null);
  useEffect(() => {
    if (!itemId || isSpare) return;
    let live = true;
    boiItemsAction(itemId).then((res) => {
      if (!live || !res.ok) return;
      setExistingBoi(res.rows);
      const s = (v: unknown) => (v == null ? "" : String(v));
      setBoi((rows) => [
        ...res.rows.map((r) => ({
          id: s(r.id),
          boi_item: s(r.boi_item),
          boi_item_other: s(r.boi_item_other),
          boi_make: s(r.boi_make),
          boi_qty: s(r.boi_qty),
          boi_description: s(r.boi_description),
        })),
        ...rows,
      ]);
    });
    return () => {
      live = false;
    };
  }, [itemId, isSpare]);
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
    // BOI Yes needs its bought-out items: at least one.
    if (listsBoi && rows.rows.length === 0) {
      setError("BOI is Yes: add the bought-out items.");
      if (boi.length === 0) setBoi([blankBoiRow()]);
      return;
    }

    // Editing an EC whose BOI is now No: its saved items go, once confirmed.
    const hadItems = (existingBoi?.length ?? 0) > 0;
    if (item && !isSpare && !listsBoi && hadItems && !window.confirm("BOI is No: remove this EC's bought-out items (and Purchase's details on them)?")) {
      return;
    }

    setSaving(true);
    setError(null);

    let ok: boolean;
    let err: string | undefined;
    if (item) {
      const res = await updateOrderSectionAction(
        String(item.id),
        "order_items",
        Object.fromEntries(fields.map((f) => [f.column, values[f.column] ?? ""]))
      );
      ok = res.ok;
      err = res.ok ? undefined : res.error;
      // Then its bought-out items as the form leaves them: changed, added,
      // removed — all of them gone when BOI is now No.
      if (ok && !isSpare && (listsBoi || hadItems)) {
        const saved = await saveEcBoiItemsAction(String(item.id), listsBoi ? boi : []);
        ok = saved.ok;
        err = saved.ok ? undefined : saved.error;
      }
    } else if (isSpare) {
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

  const title = editing
    ? `Edit EC ${String(item?.ec_no ?? "")}`.trim()
    : isSpare
      ? "Add spare order"
      : "Add pump order";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      {/* A pump has many fields (name plate, BOI): a wide form, several to a row. */}
      <div className={`relative max-h-[92vh] w-full ${isSpare ? "max-w-2xl" : "max-w-6xl"} overflow-y-auto rounded-t-2xl border border-card-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl sm:p-6 sm:pb-6`}>
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

          <div className={`grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 ${isSpare ? "" : "lg:grid-cols-3 xl:grid-cols-4"}`}>
            {fields.map((field, i) => (
              <Fragment key={field.column}>
              {/* A pump's name plate, under its own heading. */}
              {field.group && field.group !== fields[i - 1]?.group && (
                <h3 className="col-span-full mt-2 border-t border-card-border pt-4 text-sm font-semibold text-foreground">
                  {field.group}
                </h3>
              )}
              <div>
                <label
                  htmlFor={`addon-${field.column}`}
                  className="mb-1.5 block text-[13px] font-medium text-brand-label"
                >
                  {field.label}
                  {!isAddOnOptional(orderType, field.column) && <span className="text-danger"> *</span>}
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
                {/* EC No.: a note when it strays from the usual form; it still saves. */}
                {field.column === "ec_no" && numberFormatNote("ec_no", values.ec_no) && (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{numberFormatNote("ec_no", values.ec_no)}</p>
                )}
              </div>
              </Fragment>
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
                              Item <span className="text-danger">*</span>
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
                              BOI Make <span className="text-danger">*</span>
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
                              htmlFor={`boi-qty-${i}`}
                              className="mb-1.5 block text-[12px] font-medium text-brand-label"
                            >
                              Qty <span className="text-danger">*</span>
                            </label>
                            <input
                              id={`boi-qty-${i}`}
                              type="number"
                              min={0}
                              step={1}
                              value={row.boi_qty}
                              onChange={(e) => set({ boi_qty: e.target.value })}
                              className={inputClass}
                            />
                          </div>
                          <div className="sm:col-span-full">
                            <label
                              htmlFor={`boi-desc-${i}`}
                              className="mb-1.5 block text-[12px] font-medium text-brand-label"
                            >
                              Description <span className="text-danger">*</span>
                            </label>
                            <textarea
                              id={`boi-desc-${i}`}
                              rows={2}
                              value={row.boi_description}
                              onChange={(e) => set({ boi_description: e.target.value })}
                              className="w-full rounded-[10px] border border-input-border bg-surface px-3 py-2 text-[14px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
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
                          onClick={() => {
                            // A saved item takes Purchase's details on it with it.
                            if (row.id && !window.confirm(`Remove ${row.boi_item === "Others" ? row.boi_item_other || "this item" : row.boi_item || "this item"}? Purchase's details on it go too (on Save).`)) return;
                            setBoi((rs) => rs.filter((_, j) => j !== i));
                          }}
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

          {isSpare && !editing && (
            // Spare form's Order Copy file upload — the one field on either
            // Add-On that is not mandatory.
            <div className="mt-5">
              <label className="mb-1.5 block text-[13px] font-medium text-brand-label">
                Order Copy (file)
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
              {saving ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Add EC"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
