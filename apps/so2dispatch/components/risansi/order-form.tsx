"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { addOrderChildAction, createOrderAction, updateOrderChildAction } from "@/app/risansi/orders/actions";
import type { NewOrderInput } from "@/lib/orders";
import type { MarketIntellClient } from "@/lib/market-intell";
import { ClientLookup } from "./client-lookup";
import {
  CLEARANCE_HOLD_REASONS,
  CLEARANCE_OPTIONS,
  BILL_MODE_OPTIONS,
  CURRENCY_OPTIONS,
  ORDER_TYPE_OPTIONS,
  YES_NO_OPTIONS,
  withValueRules,
} from "@/lib/order-schema";
import { spareDeliveryDate, spareDeliveryRules } from "@/lib/target-rules";
import { NewOrderTerms, blankTermLine, termLineValues, termLinesError, type NewTermLine } from "./new-order-terms";
import { MultiSelectField } from "./multi-select-field";
import { QC_DOCUMENT_OPTIONS } from "@/lib/order-schema";

type FieldType = "text" | "date" | "number" | "select" | "multiselect";
type Field = {
  name: keyof NewOrderInput;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  // With `not`, the field applies unless the other field holds the value.
  dependsOn?: { name: keyof NewOrderInput; value: string; not?: boolean };
  required?: boolean;
  // Lowest value a number accepts — the browser blocks the submit below it,
  // and createOrderAction refuses it regardless.
  min?: number;
  // A select with this set offers no blank choice and starts on it.
  defaultValue?: string;
};
type Section = { title: string; fields: Field[] };

// Client details come first — they're filled before anything else when
// creating an order. Client Code and Client Type are compulsory.
const SECTIONS: Section[] = [
  {
    title: "Client",
    fields: [
      { name: "client_code", label: "Client Code", type: "text", required: true },
      { name: "client_name", label: "Client Name", type: "text" },
      { name: "industry_type", label: "Industry", type: "text" },
      { name: "client_type", label: "Client Type", type: "text" },
      { name: "market_type", label: "Market Type", type: "text" },
      { name: "zone", label: "Zone", type: "text" },
      { name: "reps", label: "Rep(s)", type: "text" },
    ],
  },
  {
    title: "Purchase Order",
    fields: [
      // When the PO came in. An FR has no PO.
      { name: "po_received_date", label: "PO Receiving Date", type: "date", dependsOn: { name: "bill_mode", value: "FR", not: true } },
      {
        name: "order_type",
        label: "Order Type",
        type: "select",
        options: ORDER_TYPE_OPTIONS,
      },
      {
        name: "bill_mode",
        label: "Bill Mode",
        type: "select",
        options: BILL_MODE_OPTIONS,
      },
      // An FR stands on a complaint, with no quotation or purchase order.
      { name: "complaint_no", label: "Complaint No.", type: "text", dependsOn: { name: "bill_mode", value: "FR" } },
      { name: "complaint_date", label: "Complaint Date", type: "date", dependsOn: { name: "bill_mode", value: "FR" } },
      { name: "complaint_ec_no", label: "Complaint Against EC No.", type: "text", dependsOn: { name: "bill_mode", value: "FR" } },
      { name: "quotation_no", label: "Quotation No.", type: "text", dependsOn: { name: "bill_mode", value: "FR", not: true } },
      { name: "po_no", label: "Purchase Order Number", type: "text", dependsOn: { name: "bill_mode", value: "FR", not: true } },
      { name: "customer_po_date", label: "Purchase Order Date", type: "date", dependsOn: { name: "bill_mode", value: "FR", not: true } },
      {
        name: "order_value",
        label: "Purchase/Sales Order Value (without GST)",
        type: "number",
        min: 0,
      },
      {
        name: "order_currency",
        label: "Currency",
        type: "select",
        options: CURRENCY_OPTIONS,
      },
      { name: "so_no", label: "Sales Order Number", type: "text" },
      { name: "so_date", label: "Sales Order Date", type: "date" },
      {
        name: "total_quantity",
        label: "Sales Order Total Quantity",
        type: "number",
        min: 0,
        // A Spare order is counted by value.
        dependsOn: { name: "order_type", value: "Spare", not: true },
      },
      { name: "file_no", label: "File No.", type: "text" },
      { name: "discount_percent", label: "Discount %", type: "number", min: 0 },
      { name: "packing_forwarding_percent", label: "Packing & Forwarding %", type: "number", min: 0 },
      { name: "gst_percent", label: "GST %", type: "number", min: 0 },
      { name: "taxable_value", label: "Gross Order Value", type: "number", min: 0 },
    ],
  },
  {
    // When the SO went to Operations (Order Making SO) and to PPC (Central).
    title: "Handover",
    fields: [
      { name: "ec_sent_operation_date", label: "SO Sent to Operation Date", type: "date" },
      { name: "so_handover_date", label: "SO Sent to PPC Date", type: "date" },
    ],
  },
  {
    // Until it is Clear, the SO is in no department's queue.
    title: "Clearance",
    fields: [
      { name: "clearance_status", label: "Clearance Status", type: "select", options: CLEARANCE_OPTIONS, defaultValue: "Clear" },
      {
        name: "clearance_hold_reason",
        label: "Hold Reason",
        type: "select",
        options: CLEARANCE_HOLD_REASONS,
        dependsOn: { name: "clearance_status", value: "Hold" },
      },
      {
        name: "clearance_remarks",
        label: "Hold Remarks",
        type: "text",
        dependsOn: { name: "clearance_status", value: "Hold" },
      },
    ],
  },
  {
    title: "Terms & Conditions",
    fields: [
      // A Spare has no bought-out items and no quality documents.
      { name: "boi", label: "BOI", type: "select", options: YES_NO_OPTIONS, dependsOn: { name: "order_type", value: "Spare", not: true } },
      {
        name: "packing_details_required",
        label: "Packing Details Required",
        type: "select",
        options: YES_NO_OPTIONS,
      },
      { name: "qc_required", label: "Quality Required", type: "select", options: YES_NO_OPTIONS, dependsOn: { name: "order_type", value: "Spare", not: true } },
      {
        name: "freight_terms",
        label: "Freight Terms",
        type: "select",
        options: [
          { value: "Paid", label: "Paid" },
          { value: "To Pay", label: "To Pay" },
        ],
      },
      {
        name: "packing_requirement",
        label: "Packing Requirement",
        type: "select",
        options: [
          { value: "Wooden Box", label: "Wooden Box" },
          { value: "Loose", label: "Loose" },
          { value: "Standard Packing", label: "Standard Packing" },
        ],
      },
      {
        name: "delivery_date_as_per_so",
        label: "Delivery date As per SO",
        type: "date",
      },
      // A replacement (FR) is not paid for: no payment terms; its remarks read REPLACEMENT.
      { name: "payment_terms", label: "Payment Terms", type: "text", dependsOn: { name: "bill_mode", value: "FR", not: true } },
      { name: "payment_terms_remarks", label: "Payment Terms Remarks", type: "text" },
      { name: "ld", label: "LD", type: "select", options: YES_NO_OPTIONS },
      {
        name: "ld_date",
        label: "LD Date",
        type: "date",
        dependsOn: { name: "ld", value: "Yes" },
      },
    ],
  },
  {
    // Every pump EC has a GAD; a Performance Curve only when asked for.
    title: "Document Required",
    fields: [
      { name: "performance_curve_required", label: "Performance Curve", type: "select", options: YES_NO_OPTIONS, dependsOn: { name: "order_type", value: "Spare", not: true } },
      // When Quality is needed (Terms & Conditions): which QC documents.
      { name: "qc_documents", label: "QC Documents", type: "multiselect", options: QC_DOCUMENT_OPTIONS, dependsOn: { name: "qc_required", value: "Yes" } },
    ],
  },
  {
    title: "Target Dates",
    fields: [
      // A Spare has no drawing.
      { name: "drg_target_date", label: "Target Date for Drawing", type: "date", dependsOn: { name: "order_type", value: "Spare", not: true } },
      {
        name: "purchase_target_date",
        label: "Target Date for Purchase",
        type: "date",
        dependsOn: { name: "boi", value: "Yes" },
      },
      {
        name: "qc_doc_target_date",
        label: "Quality Target Date",
        type: "date",
        dependsOn: { name: "qc_required", value: "Yes" },
      },
      {
        name: "dispatch_team_target_date",
        label: "Target Date for Packing Team",
        type: "date",
      },
      { name: "dispatch_target_date", label: "Dispatch Target Date", type: "date" },
    ],
  },

  // --- Everything below is commented out, not deleted: the orders table was
  // trimmed to Client + Purchase Order Details columns only, so these fields
  // have no column to save into right now. Restore a section verbatim (and
  // re-add its columns via ALTER TABLE) when that data comes back.
  //
  // {
  //   title: "Order identity",
  //   fields: [
  //     { name: "ec_no", label: "EC No.", type: "text" },
  //     { name: "ec_generated_date", label: "EC Generated Date", type: "date" },
  //     { name: "ec_rcvd_operations_date", label: "EC Received in Operations", type: "date" },
  //     { name: "ec_sent_production_date", label: "EC Sent to Production", type: "date" },
  //     { name: "file_no", label: "File No.", type: "text" },
  //   ],
  // },
  // {
  //   title: "Item",
  //   fields: [
  //     { name: "model_no", label: "Model No.", type: "text" },
  //     { name: "pump_qty", label: "If Pump (Qty)", type: "number" },
  //     { name: "pump_sno", label: "Pump S.No.", type: "text" },
  //     { name: "orientation", label: "Orientation", type: "text" },
  //     { name: "liquid_application", label: "Liquid / Application", type: "text" },
  //     { name: "version", label: "Version", type: "text" },
  //   ],
  // },
  // {
  //   title: "Commercial & Dispatch",
  //   fields: [
  //     { name: "project", label: "Project", type: "select", options: YES_NO_OPTIONS },
  //     {
  //       name: "master_reason_of_delay",
  //       label: "Master Reason of Delay",
  //       type: "text",
  //     },
  //     {
  //       name: "dispatch_target_date",
  //       label: "Dispatch Target Date",
  //       type: "date",
  //     },
  //     {
  //       name: "dispatch_target_revised_date",
  //       label: "Revised Dispatch Target Date",
  //       type: "date",
  //     },
  //     {
  //       name: "drg_target_date",
  //       label: "Target Date for DRG",
  //       type: "date",
  //     },
  //   ],
  // },
];

const inputClass =
  "h-11 w-full rounded-[10px] border border-input-border bg-surface px-[13px] text-[14px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20";

/**
 * A new Spare's dates (lib/target-rules): delivery as per SO = SO date + 2
 * weeks, dispatch target = delivery − 3 days, packing team target = delivery
 * − 5 days. Filled where blank, or where the form filled them before; a date
 * typed by hand is left alone. The server fills the same rule if the form
 * did not.
 */
function withSpareDates(values: NewOrderInput, auto: Set<string>): { values: NewOrderInput; auto: Set<string> } {
  const next = { ...values } as Record<string, string | undefined>;
  const nextAuto = new Set(auto);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const own = (col: string) => !(next[col] ?? "").trim() || nextAuto.has(col);
  const shift = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const delivery = spareDeliveryDate({ order_type: next.order_type, so_date: next.so_date, created_on: today });
  if (delivery && own("delivery_date_as_per_so")) {
    next.delivery_date_as_per_so = delivery;
    nextAuto.add("delivery_date_as_per_so");
  }
  const from = spareDeliveryRules({ order_type: next.order_type, created_on: today }) ? (next.delivery_date_as_per_so ?? "").trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    for (const [col, days] of [["dispatch_target_date", -3], ["dispatch_team_target_date", -5]] as const) {
      if (own(col)) {
        next[col] = shift(from, days);
        nextAuto.add(col);
      }
    }
  }
  return { values: next as NewOrderInput, auto: nextAuto };
}

export function OrderForm() {
  const router = useRouter();
  // Every new SO starts Clear; Central Visibility holds it when needed.
  const [values, setValues] = useState<NewOrderInput>({ clearance_status: "Clear" });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dates the form worked out itself (a new Spare's delivery date and the
  // targets it gives). They follow the SO date until someone types over them.
  const [autoDates, setAutoDates] = useState<Set<string>>(new Set());
  // The payment terms as lines, saved with the SO (not the old free text).
  const [termLines, setTermLines] = useState<NewTermLine[]>([blankTermLine()]);

  function update(name: keyof NewOrderInput, value: string) {
    // Typing a date by hand keeps it: it no longer follows the SO date.
    const typed = new Set(autoDates);
    typed.delete(name);
    const next = withSpareDates(withValueRules(values, name, value), typed);
    setValues(next.values);
    setAutoDates(next.auto);
  }

  // Whether a field applies to the order as filled so far: FR takes a
  // complaint instead of a quotation and PO, a Spare has no total quantity,
  // BOI or Quality, LD Date needs LD = Yes. A field that does not apply is
  // hidden and not sent.
  const applies = (field: Field) =>
    !field.dependsOn ||
    ((values[field.dependsOn.name] ?? "") === field.dependsOn.value) === !field.dependsOn.not;
  // A Challan / FR order is worth 0 INR: its value and currency are set, not typed.
  const challanLocked = (field: Field) =>
    values.bill_mode === "FR" && (field.name === "order_value" || field.name === "order_currency");

  // Picking a client from the Market Intell directory fills the Client
  // section; everything else on the form is left untouched.
  function applyClient(client: MarketIntellClient) {
    setValues((prev) => ({
      ...prev,
      client_code: client.code,
      client_name: client.legal_name ?? "",
      market_type: client.market_type ?? "",
      client_type: client.client_type ?? "",
      industry_type: client.industry ?? "",
      zone: client.zone ?? "",
      reps: client.rep_name ?? "",
    }));
    setError(null);
  }

  function firstMissingRequired(): Field | null {
    for (const section of SECTIONS) {
      for (const field of section.fields) {
        if (field.required && !(values[field.name] ?? "").trim()) return field;
      }
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const missing = firstMissingRequired();
    if (missing) {
      setError(`${missing.label} is required.`);
      document.getElementById(missing.name)?.focus();
      return;
    }

    // An FR order is a replacement: no payment terms.
    const lines = values.bill_mode === "FR" ? [] : termLines.filter((l) => l.term);
    const termsProblem = termLinesError(lines);
    if (termsProblem) {
      setError(termsProblem);
      return;
    }

    setIsSubmitting(true);
    const sending = Object.fromEntries(
      SECTIONS
        .flatMap((sec) => sec.fields)
        .filter((f) => f.name !== "payment_terms" && applies(f) && (values[f.name] ?? "") !== "")
        .map((f) => [f.name, values[f.name]])
    ) as NewOrderInput;
    const result = await createOrderAction(sending);
    if (!result.ok) {
      setIsSubmitting(false);
      setError(result.error);
      return;
    }
    // Each term line, as the SO's own page adds them (Billing and Accounts are told).
    for (const line of lines) {
      const added = await addOrderChildAction(result.id, "order_payment_terms");
      const saved = added.ok && added.id
        ? await updateOrderChildAction(added.id, "order_payment_terms", termLineValues(line), result.id)
        : added;
      if (!saved.ok) {
        setIsSubmitting(false);
        setError(`The order was created, but a payment term could not be saved: ${saved.error ?? "try adding it on the order"}`);
        return;
      }
    }
    router.push("/risansi/orders");
  }

  return (
    <div className="max-w-4xl">
      <ClientLookup onSelect={applyClient} label="Fill client details from directory" />
      <form onSubmit={handleSubmit}>
      {error && (
        <div
          role="alert"
          className="mb-6 rounded-[10px] border border-danger-border bg-danger-bg px-4 py-2.5 text-sm text-danger"
        >
          {error}
        </div>
      )}

      <div className="space-y-8">
        {SECTIONS.map((section) => (
          <section
            key={section.title}
            className="rounded-xl border border-card-border bg-surface p-6 shadow-sm"
          >
            <h2 className="mb-4 font-display text-base font-semibold text-foreground">
              {section.title}
            </h2>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.fields.map((field) => {
                if (!applies(field)) return null;
                // Payment Terms: the lines themselves, the full width of the section.
                if (field.name === "payment_terms") {
                  return (
                    <div key={field.name} className="sm:col-span-2 lg:col-span-3">
                      <p className="mb-1.5 block text-[13px] font-medium text-brand-label">{field.label}</p>
                      <NewOrderTerms lines={termLines} onChange={setTermLines} />
                    </div>
                  );
                }
                const disabled = challanLocked(field);
                return (
                <div key={field.name}>
                  <label
                    htmlFor={field.name}
                    className="mb-1.5 block text-[13px] font-medium text-brand-label"
                  >
                    {field.label}
                    {field.required && <span className="text-danger"> *</span>}
                  </label>
                  {field.type === "multiselect" ? (
                    <MultiSelectField
                      id={field.name}
                      value={values[field.name] ?? ""}
                      options={field.options ?? []}
                      onChange={(v) => update(field.name, v)}
                      disabled={disabled}
                    />
                  ) : field.type === "select" ? (
                    <select
                      id={field.name}
                      name={field.name}
                      value={values[field.name] ?? ""}
                      onChange={(e) => update(field.name, e.target.value)}
                      disabled={disabled}
                      className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {!field.defaultValue && <option value="">—</option>}
                      {field.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={field.name}
                      name={field.name}
                      type={field.type}
                      step={field.type === "number" ? "any" : undefined}
                      min={field.min}
                      value={values[field.name] ?? ""}
                      onChange={(e) => update(field.name, e.target.value)}
                      disabled={disabled}
                      className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
                    />
                  )}
                  {disabled && (
                    <p className="mt-1 text-[11px] text-muted">0 INR on a Challan order</p>
                  )}
                </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex h-11 items-center justify-center gap-2 rounded-[10px] bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-70"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSubmitting ? "Creating..." : "Create order"}
        </button>
        <Link
          href="/risansi/orders"
          className="flex h-11 items-center justify-center rounded-[10px] border border-input-border bg-surface px-6 text-sm font-medium text-foreground transition-colors hover:bg-background"
        >
          Cancel
        </Link>
      </div>
      </form>
    </div>
  );
}
