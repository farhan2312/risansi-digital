"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Boxes, CheckCircle2, Loader2, Plus, Truck, Warehouse } from "lucide-react";
import { BOI_ITEM_OPTIONS } from "@/lib/order-schema";
import { boiStatus } from "@/lib/dept-view";
import { updateOrderChildAction } from "@/app/risansi/orders/actions";
import type { BoiVendor } from "@/lib/orders";
import { VendorsModal } from "./vendors-modal";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const day = (v: unknown) => str(v).slice(0, 10);

// Purchase's own fields on a bought-out item (Central's are the item itself).
const PURCHASE_FIELDS = [
  "stock_allocated_qty",
  "vendor_order",
  "vendor_code",
  "vendor_name",
  "ril_po_no",
  "ril_po_date",
  "vendor_so_no",
  "vendor_so_date",
  "order_qty",
  "expected_receipt_date",
  "rate_per_unit",
  "received_qty",
  "receipt_date",
  "remarks",
] as const;
const ITEM_FIELDS = ["boi_item", "boi_item_other", "boi_make", "boi_qty", "boi_description"] as const;

const input =
  "h-10 w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-foreground transition-shadow focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:bg-background disabled:text-muted";

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

function Panel({
  icon,
  title,
  aside,
  tone = "neutral",
  children,
}: {
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  tone?: "neutral" | "accent";
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border p-4 ${tone === "accent" ? "border-primary/30 bg-primary/[0.03]" : "border-card-border bg-surface"}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "done" | "part" | "pending" }) {
  const cls =
    tone === "done"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "part"
        ? "bg-sky-50 text-sky-700 ring-sky-200"
        : "bg-amber-50 text-amber-700 ring-amber-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${cls}`}>
      {tone === "done" && <CheckCircle2 className="h-3 w-3" />}
      {label}
    </span>
  );
}

/**
 * One bought-out item, as Purchase fills it: the item (Central's, read-only
 * here), what RIL stock covers, and the order placed with a vendor — with the
 * total and the status worked out as it is typed.
 */
export function BoiItemForm({
  item,
  ecId,
  canEdit,
  canEditItem,
  vendors = [],
}: {
  /** Purchase's vendor list: the item's own vendors are offered first. */
  vendors?: BoiVendor[];
  item: Row;
  /** The EC the item belongs to (the list's id for the save). */
  ecId: string;
  canEdit: boolean;
  /** Central Visibility: the item itself is theirs. */
  canEditItem: boolean;
}) {
  const router = useRouter();
  const initial = () =>
    Object.fromEntries(
      [...ITEM_FIELDS, ...PURCHASE_FIELDS].map((k) => [k, k.endsWith("_date") ? day(item[k]) : str(item[k])])
    ) as Record<string, string>;
  const [v, setV] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // A vendor added from here joins the list at once (the page catches up on refresh).
  const [added, setAdded] = useState<BoiVendor[]>([]);
  const [addingVendor, setAddingVendor] = useState(false);
  const allVendors = [...vendors, ...added.filter((a) => !vendors.some((x) => x.id === a.id))];
  const set = (k: string, value: string) => {
    setV((p) => ({ ...p, [k]: value }));
    setSaved(false);
  };
  const dirty = JSON.stringify(v) !== JSON.stringify(initial());

  const num = (k: string) => (v[k].trim() === "" ? null : Number(v[k]));
  const vendor = v.vendor_order === "Yes";
  const total = num("rate_per_unit") != null && num("order_qty") != null ? num("rate_per_unit")! * num("order_qty")! : null;
  // Worked out as boiStatus does on the server's values.
  const live = boiStatus({
    ...v,
    boi_qty: num("boi_qty"),
    stock_allocated_qty: num("stock_allocated_qty"),
    order_qty: num("order_qty"),
    received_qty: num("received_qty"),
    vendor_status: !vendor
      ? null
      : (num("order_qty") ?? 0) > 0 && (num("received_qty") ?? 0) >= (num("order_qty") ?? 0)
        ? "Fully received"
        : (num("received_qty") ?? 0) > 0
          ? "Partially received"
          : "Pending",
  });
  const qty = num("boi_qty") ?? 0;
  const stock = num("stock_allocated_qty") ?? 0;
  const ro = !canEdit;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    // Purchase sends its own, and the item's Make and Description it may correct.
    const keys = canEditItem ? [...ITEM_FIELDS, ...PURCHASE_FIELDS] : ["boi_make", "boi_description", ...PURCHASE_FIELDS];
    const res = await updateOrderChildAction(
      str(item.id),
      "order_boi_items",
      Object.fromEntries(keys.map((k) => [k, v[k]])),
      ecId
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const itemName = v.boi_item === "Others" ? v.boi_item_other || "Others" : v.boi_item || "Item";

  return (
    <form onSubmit={save} className="space-y-4">
      {/* Outside the field's label, so a click in the pop-up stays in it. */}
      {addingVendor && (
        <VendorsModal
          vendors={allVendors}
          canEdit={canEdit}
          presetItem={v.boi_item}
          startAdding
          onClose={() => setAddingVendor(false)}
          onSaved={(nv) => {
            setAdded((a) => [...a.filter((x) => x.id !== nv.id), nv]);
            set("vendor_name", nv.name);
            if (nv.vendor_code) set("vendor_code", nv.vendor_code);
            setAddingVendor(false);
          }}
        />
      )}
      {/* The item, as listed with the EC. */}
      <section className="rounded-xl border border-card-border bg-background/50 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Boxes className="h-4 w-4" />
            </span>
            <div>
              <p className="text-base font-semibold text-foreground">{itemName}</p>
              <p className="text-xs text-muted">{[v.boi_make, qty ? `Qty ${qty}` : ""].filter(Boolean).join(" · ") || "—"}</p>
            </div>
          </div>
          <StatusPill label={live.label} tone={live.tone} />
        </div>
        {canEditItem && canEdit ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Item">
              <select value={v.boi_item} onChange={(e) => set("boi_item", e.target.value)} className={`${input} cursor-pointer`}>
                <option value="">—</option>
                {BOI_ITEM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            {v.boi_item === "Others" && (
              <Field label="Item name">
                <input value={v.boi_item_other} onChange={(e) => set("boi_item_other", e.target.value)} className={input} />
              </Field>
            )}
            <Field label="Make">
              <input value={v.boi_make} onChange={(e) => set("boi_make", e.target.value)} className={input} />
            </Field>
            <Field label="Qty">
              <input type="number" min={0} step={1} value={v.boi_qty} onChange={(e) => set("boi_qty", e.target.value)} className={input} />
            </Field>
            <Field label="Description" wide>
              <textarea
                rows={2}
                value={v.boi_description}
                onChange={(e) => set("boi_description", e.target.value)}
                className="w-full rounded-lg border border-input-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </Field>
          </div>
        ) : canEdit ? (
          // Purchase: the item and qty as listed, its Make and Description to correct.
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Make">
              <input value={v.boi_make} onChange={(e) => set("boi_make", e.target.value)} className={input} />
            </Field>
            <Field label="Description" wide>
              <textarea
                rows={2}
                value={v.boi_description}
                onChange={(e) => set("boi_description", e.target.value)}
                className="w-full rounded-lg border border-input-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </Field>
          </div>
        ) : (
          v.boi_description && <p className="rounded-lg bg-surface px-3 py-2 text-sm text-foreground">{v.boi_description}</p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* What RIL already has. */}
        <Panel
          icon={<Warehouse className="h-4 w-4" />}
          title="In stock (RIL allocated)"
          aside={
            qty > 0 ? (
              <span className={`text-xs font-semibold ${stock >= qty ? "text-emerald-700" : "text-muted"}`}>
                {stock}/{qty}
              </span>
            ) : null
          }
        >
          <Field label="Allocated Qty" hint={qty > 0 ? `of ${qty} needed` : undefined}>
            <input
              type="number"
              min={0}
              step={1}
              disabled={ro}
              value={v.stock_allocated_qty}
              onChange={(e) => set("stock_allocated_qty", e.target.value)}
              className={input}
            />
          </Field>
          {qty > 0 && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-background">
              <div
                className={`h-full rounded-full ${stock >= qty ? "bg-emerald-500" : "bg-primary"}`}
                style={{ width: `${Math.min(100, Math.round((stock / qty) * 100))}%` }}
              />
            </div>
          )}
        </Panel>

        {/* What is ordered from a vendor. */}
        <div className="lg:col-span-2">
          <Panel
            icon={<Truck className="h-4 w-4" />}
            title="Order placed to vendor"
            tone={vendor ? "accent" : "neutral"}
            aside={
              <div role="group" aria-label="Order placed to vendor" className="inline-flex rounded-lg border border-input-border p-0.5">
                {(["No", "Yes"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={ro}
                    aria-pressed={(v.vendor_order || "No") === k}
                    onClick={() => set("vendor_order", k)}
                    className={`h-7 rounded-md px-3 text-xs font-semibold transition-colors ${
                      (v.vendor_order || "No") === k ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            }
          >
            {!vendor ? (
              <p className="text-sm text-muted">No order placed. Choose Yes when what is not in stock is ordered from a vendor.</p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Vendor Code">
                    <input disabled={ro} value={v.vendor_code} onChange={(e) => set("vendor_code", e.target.value)} className={input} />
                  </Field>
                  <Field label="Vendor Name">
                    {(() => {
                      const kind = v.boi_item;
                      const own = allVendors.filter((x) => kind && x.items.includes(kind));
                      const rest = allVendors.filter((x) => !own.includes(x));
                      const all = allVendors;
                      const pick = (name: string) => {
                        set("vendor_name", name);
                        const code = all.find((x) => x.name === name)?.vendor_code;
                        if (code) set("vendor_code", code);
                      };
                      return (
                        <span className="flex gap-2">
                          <select disabled={ro} value={v.vendor_name} onChange={(e) => pick(e.target.value)} className={input}>
                            <option value="">Choose a vendor</option>
                            {own.length > 0 && (
                              <optgroup label={`${kind} vendors`}>
                                {own.map((x) => (
                                  <option key={x.id} value={x.name}>{x.name}</option>
                                ))}
                              </optgroup>
                            )}
                            {rest.length > 0 && (
                              <optgroup label={own.length ? "Other vendors" : "Vendors"}>
                                {rest.map((x) => (
                                  <option key={x.id} value={x.name}>{x.name}</option>
                                ))}
                              </optgroup>
                            )}
                            {/* A name typed before the list existed stays as it is. */}
                            {v.vendor_name && !all.some((x) => x.name === v.vendor_name) && (
                              <option value={v.vendor_name}>{v.vendor_name}</option>
                            )}
                          </select>
                          {!ro && (
                            <button
                              type="button"
                              onClick={() => setAddingVendor(true)}
                              title="Add a vendor to the list"
                              aria-label="Add a vendor"
                              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input-border text-primary hover:bg-primary/10"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                        </span>
                      );
                    })()}
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <Field label="RIL PO No.">
                    <input disabled={ro} value={v.ril_po_no} onChange={(e) => set("ril_po_no", e.target.value)} className={input} />
                  </Field>
                  <Field label="RIL PO Date">
                    <input type="date" disabled={ro} value={v.ril_po_date} onChange={(e) => set("ril_po_date", e.target.value)} className={input} />
                  </Field>
                  <Field label="Vendor SO No.">
                    <input disabled={ro} value={v.vendor_so_no} onChange={(e) => set("vendor_so_no", e.target.value)} className={input} />
                  </Field>
                  <Field label="Vendor SO Date">
                    <input type="date" disabled={ro} value={v.vendor_so_date} onChange={(e) => set("vendor_so_date", e.target.value)} className={input} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Order Qty">
                    <input type="number" min={0} step={1} disabled={ro} value={v.order_qty} onChange={(e) => set("order_qty", e.target.value)} className={input} />
                  </Field>
                  <Field label="Rate per Unit">
                    <input type="number" min={0} step="any" disabled={ro} value={v.rate_per_unit} onChange={(e) => set("rate_per_unit", e.target.value)} className={input} />
                  </Field>
                  <Field label="Total Value">
                    <div className="flex h-10 items-center rounded-lg bg-background px-3 text-sm font-semibold tabular-nums text-foreground">
                      {total == null ? "—" : total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    </div>
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-3 border-t border-card-border pt-4 sm:grid-cols-3">
                  <Field label="Vendor Expected Date" hint="Every change is kept">
                    <input
                      type="date"
                      disabled={ro}
                      value={v.expected_receipt_date}
                      onChange={(e) => set("expected_receipt_date", e.target.value)}
                      className={input}
                    />
                  </Field>
                  <Field label="Received Qty" hint={num("order_qty") ? `of ${num("order_qty")} ordered` : undefined}>
                    <input type="number" min={0} step={1} disabled={ro} value={v.received_qty} onChange={(e) => set("received_qty", e.target.value)} className={input} />
                  </Field>
                  <Field label="Received Date">
                    <input type="date" disabled={ro} value={v.receipt_date} onChange={(e) => set("receipt_date", e.target.value)} className={input} />
                  </Field>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Field label="Remarks">
        <textarea
          rows={2}
          disabled={ro}
          value={v.remarks}
          onChange={(e) => set("remarks", e.target.value)}
          className="w-full rounded-lg border border-input-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:bg-background"
        />
      </Field>

      {error && (
        <div role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      {canEdit && (
        <div className="flex items-center justify-end gap-3 border-t border-card-border pt-4">
          {saved && !dirty && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <button
            type="submit"
            disabled={!dirty || saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      )}
    </form>
  );
}
