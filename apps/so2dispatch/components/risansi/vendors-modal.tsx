"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, Search, Trash2, Truck, X } from "lucide-react";
import { deleteVendorAction, saveVendorAction } from "@/app/risansi/orders/vendor-actions";
import type { BoiVendor } from "@/lib/orders";
import { BOI_ITEM_OPTIONS } from "@/lib/order-schema";

const ITEMS = BOI_ITEM_OPTIONS.map((o) => o.value);
const input =
  "h-9 w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";

/**
 * Purchase's vendor list in a pop-up: each vendor with the bought-out items it
 * supplies. Purchase / Central / Admin add, change and remove them here. Opened
 * from an item's form, it starts on that item and a new vendor is picked for it.
 */
export function VendorsModal({
  vendors,
  canEdit,
  presetItem,
  startAdding = false,
  onClose,
  onSaved,
}: {
  vendors: BoiVendor[];
  canEdit: boolean;
  /** The item the list is opened for: shown first, and ticked on a new vendor. */
  presetItem?: string;
  /** Open straight on the Add form. */
  startAdding?: boolean;
  onClose: () => void;
  onSaved?: (vendor: BoiVendor) => void;
}) {
  const router = useRouter();
  const [list, setList] = useState(vendors);
  const [term, setTerm] = useState("");
  const [item, setItem] = useState<string | null>(presetItem && ITEMS.includes(presetItem) ? presetItem : null);
  const [editing, setEditing] = useState<BoiVendor | "new" | null>(startAdding && canEdit ? "new" : null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [items, setItems] = useState<string[]>(presetItem && ITEMS.includes(presetItem) ? [presetItem] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function edit(v: BoiVendor | "new") {
    setEditing(v);
    setError(null);
    setName(v === "new" ? "" : v.name);
    setCode(v === "new" ? "" : v.vendor_code ?? "");
    setItems(v === "new" ? (item ? [item] : []) : v.items);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    // Opened from an item's form: its submit must not reach that form too.
    e.stopPropagation();
    setBusy(true);
    setError(null);
    const res = await saveVendorAction({ id: editing === "new" ? null : editing?.id, name, vendor_code: code, items });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setList((l) =>
      [...l.filter((v) => v.id !== res.vendor.id), res.vendor].sort((a, b) => a.name.localeCompare(b.name))
    );
    setEditing(null);
    router.refresh();
    onSaved?.(res.vendor);
  }

  async function remove(v: BoiVendor) {
    if (!confirm(`Remove ${v.name} from the vendor list? Items already ordered from it keep the name.`)) return;
    setBusy(true);
    const res = await deleteVendorAction(v.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setList((l) => l.filter((x) => x.id !== v.id));
    router.refresh();
  }

  const t = term.trim().toLowerCase();
  const shown = list.filter((v) => (!item || v.items.includes(item)) && (!t || v.name.toLowerCase().includes(t)));
  const countFor = (i: string) => list.filter((v) => v.items.includes(i)).length;

  // On the page's body, not inside whatever opened it (an item's form holds a form of its own).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vendors"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Truck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">Vendors</h2>
              <p className="text-xs text-muted">{list.length} vendors · who each bought-out item is bought from</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && editing === null && (
              <button
                type="button"
                onClick={() => edit("new")}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                <Plus className="h-4 w-4" />
                Add vendor
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {editing !== null && (
          <form onSubmit={save} className="mb-4 space-y-3 rounded-xl border border-primary/30 bg-primary/[0.03] p-4">
            <p className="text-sm font-semibold text-foreground">{editing === "new" ? "New vendor" : `Edit ${editing.name}`}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Vendor name</span>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={input} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Vendor code (optional)</span>
                <input value={code} onChange={(e) => setCode(e.target.value)} className={input} />
              </label>
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Supplies</span>
              <div className="flex flex-wrap gap-1.5">
                {ITEMS.map((i) => {
                  const on = items.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setItems((cur) => (on ? cur.filter((x) => x !== i) : [...cur, i]))}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input-border text-foreground hover:bg-background"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}
                      {i}
                    </button>
                  );
                })}
              </div>
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={busy}
                className="h-9 rounded-lg border border-input-border px-3 text-sm font-medium text-foreground hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </button>
            </div>
          </form>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search vendors…" className={`${input} pl-9`} />
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setItem(null)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
              item === null ? "border-primary bg-primary/10 text-primary" : "border-input-border text-muted hover:text-foreground"
            }`}
          >
            All items
          </button>
          {ITEMS.filter((i) => countFor(i) > 0 || i === item).map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setItem(i)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                item === i ? "border-primary bg-primary/10 text-primary" : "border-input-border text-muted hover:text-foreground"
              }`}
            >
              {i} <span className="opacity-70">{countFor(i)}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-card-border">
          {shown.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">No vendors{item ? ` for ${item}` : ""} yet.</p>
          ) : (
            <ul className="divide-y divide-card-border">
              {shown.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{v.name}</p>
                    {v.vendor_code && <p className="text-[11px] text-muted">Code {v.vendor_code}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {v.items.map((i) => (
                      <span key={i} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        {i}
                      </span>
                    ))}
                  </div>
                  {canEdit && (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => edit(v)}
                        aria-label={`Edit ${v.name}`}
                        className="rounded-lg p-1.5 text-muted hover:bg-background hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(v)}
                        aria-label={`Remove ${v.name}`}
                        className="rounded-lg p-1.5 text-muted hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
