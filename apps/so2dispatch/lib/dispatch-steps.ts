// A dispatch is raised in three steps — Invoice (or Challan) → Dispatch →
// Docket & LR — each a group of the invoice card's fields. A step is done when
// its key fields are in:
//
//   Invoice       Invoice No. + Invoice Date   (a Challan order: Challan No. + Date)
//   Dispatch      Delivery Mode
//   Docket & LR   Docket No.
//
// Plain module (no server imports): the pop-up, the summary cards and the
// packing-slip list read one definition.

import { INVOICE_FIELDS, type OrderField } from "@/lib/order-schema";

export type DispatchStepKey = "invoice" | "dispatch" | "docket";

export const DISPATCH_STEPS: { key: DispatchStepKey; label: string; group: string }[] = [
  { key: "invoice", label: "Invoice", group: "Invoice" },
  { key: "dispatch", label: "Dispatch", group: "Dispatch" },
  { key: "docket", label: "Docket & LR", group: "Docket" },
];

/** A step's fields, in the card's own order. */
export function stepFields(step: DispatchStepKey): OrderField[] {
  const group = DISPATCH_STEPS.find((s) => s.key === step)!.group;
  return INVOICE_FIELDS.filter((f) => f.group === group);
}

type Row = Record<string, unknown>;
const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

/** Which steps of a dispatch are done. */
export function stepsDone(inv: Row, billType: unknown): Record<DispatchStepKey, boolean> {
  const challan = String(billType ?? "").trim() === "Challan";
  return {
    invoice: challan
      ? has(inv.challan_no) && has(inv.challan_date)
      : has(inv.invoice_no) && has(inv.invoice_date),
    dispatch: has(inv.delivery_mode),
    docket: has(inv.docket_no),
  };
}

/**
 * Where an SO stands in the three steps, as one stage — its least advanced
 * slip or dispatch: a numbered slip not yet invoiced (or challaned) is
 * Invoice pending; a dispatch with no Delivery Mode, Dispatch pending; one
 * with no Docket No., Docket & LR pending. Worked out in SQL
 * (dispatchStageSql in lib/orders.ts).
 */
export const DISPATCH_STAGES = ["Invoice pending", "Dispatch pending", "Docket & LR pending", "Docket & LR done"];

/** Where a dispatch stands, in one word for the slip list. */
export function dispatchStage(inv: Row, billType: unknown): string {
  const done = stepsDone(inv, billType);
  if (done.invoice && done.dispatch && done.docket) return "Docket & LR done";
  if (done.dispatch) return "Dispatched";
  if (done.invoice) return String(billType ?? "").trim() === "Challan" ? "Challan made" : "Invoiced";
  return "Started";
}

/** The first step not yet done — where Continue opens. */
export function nextStep(inv: Row, billType: unknown): DispatchStepKey {
  const done = stepsDone(inv, billType);
  return (DISPATCH_STEPS.find((s) => !done[s.key])?.key ?? "docket") as DispatchStepKey;
}
