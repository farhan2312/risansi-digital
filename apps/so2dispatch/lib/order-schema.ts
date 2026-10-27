// Shared definition of the order's editable sections/fields. Used by the
// detail/edit UI (client) and the update logic (server), so column names and
// types stay in one place. Plain module — safe to import anywhere.

export type OrderTable =
  | "orders"
  | "order_items"
  | "order_billing"
  | "order_accounts"
  | "order_drawing"
  | "order_purchase"
  | "order_qc"
  | "order_planning"
  | "order_assembly_dispatch"
  | "order_dispatch";

// SO-level tables are keyed by order_id (one row per sales order); item-level
// tables are keyed by item_id (one row per EC/pump). Drives which reader/writer
// path and which detail page a section belongs to.
export type SectionScope = "so" | "item";

export type OrderFieldType = "text" | "date" | "int" | "number" | "select" | "multiselect";

/** A multiselect's value as its choices: "MTC, IIR" → ["MTC", "IIR"]. */
export function splitMulti(value: unknown): string[] {
  return [...new Set(String(value ?? "").split(",").map((v) => v.trim()).filter(Boolean))];
}
/** …and back, as it is stored. */
export function joinMulti(values: string[]): string {
  return values.join(", ");
}

export type OrderField = {
  column: string;
  label: string;
  type: OrderFieldType;
  options?: { value: string; label: string }[];
  // When set, the field only applies while every listed condition holds
  // (AND-ed). A condition passes when the column equals `value`, or — when
  // `value` is a list — matches any entry (e.g. Transporter Name applies to
  // both "Transport" and "By BUS" delivery modes).
  // `not` turns the gate round: the field applies unless the column holds
  // one of the values (e.g. every order type but Spare) — so a blank still
  // shows it.
  dependsOn?: { column: string; value: string | string[]; not?: boolean }[];
  // When true, only Central Visibility / Admin may edit this field; the owning
  // department sees it read-only (e.g. LD in the Planning section).
  centralOnly?: boolean;
  // When true, the field is never editable — it's derived and displayed only
  // (e.g. Balance of Payment = order value − amount received, set server-side).
  computed?: boolean;
  // Rendered as read-only text even when the row is editable — for values a
  // department fills that another department needs to see (e.g. EC / Packing
  // Slip No. / Qty copied from the actual packing slip onto its invoice).
  readOnly?: boolean;
  // Optional visual grouping inside a section — consecutive fields sharing
  // the same `group` label are rendered together under one subheading.
  group?: string;
  // Child lists only: hide this field on the first row. The first drawing
  // issue has no revision number; only re-issues (2nd row onward) do.
  hideOnFirstRow?: boolean;
  // Context-field lists only: which table the value is read from. Defaults to
  // `orders` (SO-level context); name an item-keyed table to surface another
  // department's field, e.g. Assembly seeing Planning's Assembly Date.
  from?: OrderTable;
  // Number fields only: the lowest value accepted. Enforced on save
  // (lib/order-validation.ts) and set on the input so its arrows stop there.
  min?: number;
  // The value a blank stands for — shown and saved in its place (Clearance
  // Status is Clear unless held, GST is 18% unless changed). A select with it
  // offers no blank choice.
  defaultValue?: string;
  // Shown and edited in the form, but not given a column in the department's
  // list (Accounts' GST %).
  listHidden?: boolean;
};

/** Turn a list of strings into { value, label } option objects. */
function opts(values: string[]): { value: string; label: string }[] {
  return values.map((v) => ({ value: v, label: v }));
}

const YES_NO = opts(["Yes", "No"]);
export const YES_NO_OPTIONS = YES_NO;

/** The QC documents an SO can ask for, any of them (lib/qc-docs.ts QC_DOC_TYPES). */
export const QC_DOCUMENT_OPTIONS = opts(["MTC", "IIR", "Dimensional Report", "QAP", "Test Report", "Photos", "Packing Details"]);
export const QC_DOC_FIELDS: OrderField[] = [
  { column: "qc_documents", label: "QC Documents", type: "multiselect", options: QC_DOCUMENT_OPTIONS },
];

export const INDUSTRY_TYPE_OPTIONS = opts(["Sugar", "Non Sugar"]);
export const CURRENCY_OPTIONS = opts(["INR", "USD"]);
export const ITEM_OPTIONS = opts(["Pump", "Spare", "ROLB"]);
// SO-level Order Type; each EC/Add-On inherits it as its item_type.
export const ORDER_TYPE_OPTIONS = opts(["Pump", "Spare", "ROLB"]);
// ROLB is handled exactly like a Pump (same Add-On form, same per-EC fields);
// only the name differs. Pump-only gates accept either.
export const PUMP_LIKE = ["Pump", "ROLB"];

// A pump's name plate: what is stamped on it, captured on the Pump Add-On.
export const CAPACITY_UNIT_OPTIONS = opts(["M³/hr", "LPH", "LPM", "GPM", "KLPD", "TPH"]);
export const HEAD_UNIT_OPTIONS = opts(["MWC", "MLC", "Bar", "Kg/cm²"]);
export const MOTOR_RATING_UNIT_OPTIONS = opts(["KW", "HP"]);
export const NAME_PLATE_GROUP = "Name Plate Details";
export const NAME_PLATE_FIELDS: OrderField[] = [
  { column: "capacity", label: "Capacity", type: "number", min: 0, group: NAME_PLATE_GROUP },
  { column: "capacity_unit", label: "Capacity Unit", type: "select", options: CAPACITY_UNIT_OPTIONS, group: NAME_PLATE_GROUP },
  { column: "head", label: "Head", type: "number", min: 0, group: NAME_PLATE_GROUP },
  { column: "head_unit", label: "Head Unit", type: "select", options: HEAD_UNIT_OPTIONS, group: NAME_PLATE_GROUP },
  { column: "drive_motor_rating", label: "Drive Motor Rating", type: "number", min: 0, group: NAME_PLATE_GROUP },
  { column: "drive_motor_rating_unit", label: "Drive Motor Rating Unit", type: "select", options: MOTOR_RATING_UNIT_OPTIONS, group: NAME_PLATE_GROUP },
  { column: "drive_motor_speed", label: "Drive Motor Speed (RPM)", type: "number", min: 0, group: NAME_PLATE_GROUP },
  { column: "pump_speed", label: "Pump Speed (RPM)", type: "number", min: 0, group: NAME_PLATE_GROUP },
  { column: "liquid", label: "Liquid", type: "text", group: NAME_PLATE_GROUP },
  { column: "tag_no", label: "Tag No.", type: "text", group: NAME_PLATE_GROUP },
];
// Per-EC pump family, only shown on Pump Add-Ons.
export const PUMP_TYPE_OPTIONS = opts(["PCP", "MMP", "RBL", "OLB"]);
// Bill Type (SO-level) — decides which billing document fields apply to each
// PI: Tax Invoice → PI No./Date/Value; Challan → Challan No./Date/Value + FR.
export const BILL_TYPE_OPTIONS = opts(["Tax Invoice", "Challan"]);
// Whether the order is billed, or an FR — which carries no quotation or PO.
// Bill Mode is the one choice: Billing goes with a Tax Invoice, FR with a
// Challan. The bill type is kept on the order, set from it (BILL_TYPE_FOR_MODE),
// for the rules that read it — the Challan's 0 value, Billing and Accounts.
export const BILL_MODE_OPTIONS = [
  { value: "Billing", label: "Billing / Tax Invoice" },
  { value: "FR", label: "Challan / FR" },
];
export const BILL_TYPE_FOR_MODE: Record<string, string> = { Billing: "Tax Invoice", FR: "Challan" };

/** How an SO's Bill Mode reads ("Billing / Tax Invoice"), from either column. */
export function billModeLabel(billMode: unknown, billType?: unknown): string {
  const mode =
    String(billMode ?? "").trim() ||
    (String(billType ?? "").trim() === "Challan" ? "FR" : String(billType ?? "").trim() === "Tax Invoice" ? "Billing" : "");
  return BILL_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? "";
}

// Clearance: Central Visibility releases an SO to the departments (Clear) or
// holds it, with the reason kept for regular review.
export const CLEARANCE_OPTIONS = opts(["Clear", "Hold"]);
export const CLEARANCE_HOLD_REASONS = opts([
  "Hold by Client",
  "Client Indent pending",
  "Client Order Awaited",
  "Client amended Order Awaited",
  "Dispatch Instructions Awaited from client",
]);
// FR (financial reconciliation) reason for a Challan.
export const FR_REASON_OPTIONS = opts([
  "Wrong supply",
  "Short supply",
  "Damage",
  "FOC",
]);
// Bought-out items Purchase can add under an EC when the SO's BOI = Yes.
export const BOI_ITEM_OPTIONS = opts([
  "Gear Box",
  "Motor",
  "VFD",
  "Panel",
  "Strainers",
  "Mechanical seal",
  "Gland Packing",
  "Pulley",
  "Dosing Pump",
  "Stator",
  "Others",
]);
// Planning records status on one of three columns (pump, spare, or the free
// text one); these are the values its two selects offer, deduped, for anything
// that needs the vocabulary rather than the fields.
/** Where a Pump EC stands in Planning (Actual Pump Status). */
/** Planning's fields that are each pump EC's own; the rest are set for the whole SO. */
export const PUMP_EC_PLANNING_COLUMNS = ["actual_pump_status", "ready_qty"];

/**
 * A pump EC's status, worked out from its Ready Qty against its quantity:
 * Pending until something is ready, Fully ready once all of it is, and
 * Partially ready between. Never typed; saved by syncPumpEcStatus.
 */
export const PUMP_EC_STATUSES = ["Pending", "Partially ready", "Fully ready"];
export function pumpEcStatus(readyQty: unknown, quantity: unknown): string {
  const ready = Number(readyQty ?? 0) || 0;
  const qty = Number(quantity ?? 0) || 0;
  if (ready <= 0) return "Pending";
  return qty > 0 && ready >= qty ? "Fully ready" : "Partially ready";
}

// The same four as a Spare: a pump SO is planned as a Spare is. (Older
// values — Assembled, Packed… — still show where they were recorded.)
export const PUMP_PLANNING_STATUSES = ["Date awaited", "In plan", "Partial ready", "Fully ready"];
/** Where a Spare EC stands in Planning (Actual Spare Status). */
export const SPARE_PLANNING_STATUSES = ["Date awaited", "Partial ready", "In plan", "Fully ready"];

/**
 * Planning's form for a pump SO, as a Spare SO's: the SO's status (kept, as
 * a Spare's, in actual_spare_status — on a pump EC that is the SO's readiness,
 * while Actual Pump Status is the EC's own), its readiness date, remarks; and
 * the readiness lots once it is Partial or Fully ready.
 */
export const PUMP_SO_PLANNING_FIELDS: OrderField[] = [
  // A new pump SO starts Date awaited.
  { column: "actual_spare_status", label: "Status", type: "select", options: opts(SPARE_PLANNING_STATUSES), defaultValue: "Date awaited" },
  {
    column: "planning_readiness_date",
    label: "Assembly Readiness Date",
    type: "date",
    dependsOn: [{ column: "actual_spare_status", value: "Date awaited", not: true }],
  },
  { column: "pump_readiness_remarks", label: "Remarks", type: "text" },
];
/** Every Planning status, Pump and Spare together — the queue's Status filter. */
export const PLANNING_STATUS_VALUES = [
  ...new Set([...PUMP_PLANNING_STATUSES, ...SPARE_PLANNING_STATUSES, ...PUMP_EC_STATUSES]),
];

export const DISPATCH_STATUS_OPTIONS = opts([
  "Pending",
  "LOT dispatch",
  "Fully dispatch",
]);

/**
 * Every order status: the three the invoices give, and the two only Central
 * Visibility can set — which close the order. See orderStatusSql.
 */
export const ORDER_STATUS_OPTIONS = opts([
  "Pending",
  "LOT dispatch",
  "Fully dispatch",
  // Dispatch holds it, for one of DISPATCH_HOLD_REASONS.
  "Hold",
  "Cancelled by client",
  "Diverted",
]);

/** Why Dispatch holds an SO — the reason is required with Hold. */
export const DISPATCH_HOLD_REASONS = [
  "Dispatch instructions Awaited",
  "Debit Note Confirmation",
  "Payment Awaited Against PI",
  "Freight Confirmation Awaited",
  "Transportation Confirmation awaited",
  "Dispatch along with other orders",
];

/** A dispatch hold as saved: its reason, then any remarks after " · ". */
export function joinHoldReason(reason: string, remarks: string): string {
  const r = remarks.trim();
  return r ? `${reason} · ${r}` : reason;
}

/** …and back: the reason from the list, and the remarks typed with it. */
export function splitHoldReason(saved: unknown): { reason: string; remarks: string } {
  const s = String(saved ?? "").trim();
  const reason = DISPATCH_HOLD_REASONS.find((r) => s === r || s.startsWith(`${r} · `)) ?? "";
  return { reason, remarks: reason ? s.slice(reason.length).replace(/^ · /, "") : s };
}

// --- Dispatch: dispatch/docket vocabularies ---------------------------------
export const DELIVERY_TYPE_OPTIONS = opts(["Door delivery", "Godown delivery"]);
export const DELIVERY_MODE_OPTIONS = opts([
  "Transport",
  "Direct Vehicle",
  "By BUS",
  "By Courier",
]);
export const COURIER_MODE_OPTIONS = opts(["Normal", "By Air"]);
export const DOCKET_TYPE_OPTIONS = opts(["Export", "Direct", "Hundi", "COD"]);

// Payment status values. "Outstanding hold" is the escalation trigger.
export const PAYMENT_HOLD_VALUE = "Outstanding hold";
export const PAYMENT_STATUS_OPTIONS = opts([
  "Outstanding hold",
  "Payment Rcvd",
  "Advance Rcvd",
  "Advance Rcvd & Balance payment Awaited",
  "Payment Awaited",
  "After Receipt",
]);

export type OrderSection = {
  key: string;
  title: string;
  table: OrderTable;
  scope: SectionScope;
  fields: OrderField[];
  // A section may render a 1:many child list instead of / alongside flat
  // fields (e.g. Purchase → BOI items). Shown only when childGate is satisfied
  // by the parent SO/EC data. `value` requires exact match; `present: true`
  // just requires the column to hold any non-empty value.
  childTable?: ChildTable;
  childGate?:
    | { column: string; value: string }
    | { column: string; present: true };
  // When the child table is shared by two sections (packing slips: Planning
  // files 'tentative', Packing files 'actual'), this pins which rows the
  // section sees and what new rows are created as.
  childKind?: string;
  /**
   * An SO-level list kept by an EC-level department: Assembly & Packing's
   * packing slips belong to the SO, not to each EC. Shown once per SO — in
   * the department's queue, and on the SO page / overview.
   */
  soChild?: {
    table: ChildTable;
    title: string;
    kind?: string;
    gate?: { column: string; present: true };
  };
};

export const ORDER_SECTIONS: OrderSection[] = [
  {
    key: "core",
    title: "Order details",
    table: "orders",
    scope: "so",
    // The order's payment terms, one line per slice — see PAYMENT_TERM_FIELDS.
    childTable: "order_payment_terms",
    fields: [
      // Clearance — Central Visibility's call; until an SO is Clear no
      // department sees it.
      { column: "clearance_status", label: "Clearance Status", type: "select", options: CLEARANCE_OPTIONS, defaultValue: "Clear", group: "Clearance" },
      {
        column: "clearance_hold_reason",
        label: "Hold Reason",
        type: "select",
        options: CLEARANCE_HOLD_REASONS,
        dependsOn: [{ column: "clearance_status", value: "Hold" }],
        group: "Clearance",
      },
      {
        column: "clearance_remarks",
        label: "Hold Remarks",
        type: "text",
        dependsOn: [{ column: "clearance_status", value: "Hold" }],
        group: "Clearance",
      },
      // Independent of Clear / Hold: Yes keeps the SO on Order Making and the
      // Orders list alone — no department sees it (lib/dept-view onlyBillingSql).
      { column: "only_billing", label: "Only Billing", type: "select", options: YES_NO, group: "Clearance" },
      { column: "only_billing_remarks", label: "Only Billing Remarks", type: "text", dependsOn: [{ column: "only_billing", value: "Yes" }], group: "Clearance" },

      // Order Making's own Clear / Hold, before Central's clearance: an SO
      // Order Making holds goes to no department (lib/dept-view releasedSql).
      { column: "om_status", label: "Order Making Status", type: "select", options: CLEARANCE_OPTIONS, defaultValue: "Clear", group: "Order Making Hold" },
      // Typed: Order Making says why in its own words.
      {
        column: "om_hold_reason",
        label: "Order Making Reason of Delay",
        type: "text",
        dependsOn: [{ column: "om_status", value: "Hold" }],
        group: "Order Making Hold",
      },
      // Remarks on a Clear too; every Clear / Hold is kept in
      // order_om_status_history.
      {
        column: "om_hold_remarks",
        label: "Order Making Remarks",
        type: "text",
        group: "Order Making Hold",
      },

      // Client — client_code and client_type are compulsory at creation.
      { column: "client_code", label: "Client Code", type: "text", group: "Client" },
      { column: "client_name", label: "Client Name", type: "text", group: "Client" },
      { column: "industry_type", label: "Industry", type: "text", group: "Client" },
      { column: "client_type", label: "Client Type", type: "text", group: "Client" },
      { column: "market_type", label: "Market Type", type: "text", group: "Client" },
      { column: "zone", label: "Zone", type: "text", group: "Client" },
      { column: "reps", label: "Rep(s)", type: "text", group: "Client" },

      // Purchase Order Details — SO Order Type is inherited by every EC.
      // First: when the PO (or, on a Challan / FR, the order) came in.
      { column: "po_received_date", label: "PO Receiving Date", type: "date", group: "Purchase Order" },
      {
        column: "order_type",
        label: "Order Type",
        type: "select",
        options: ORDER_TYPE_OPTIONS,
        group: "Purchase Order",
      },
      // Billed, or an FR. An FR has no quotation or purchase order behind it.
      {
        column: "bill_mode",
        label: "Bill Mode",
        type: "select",
        options: BILL_MODE_OPTIONS,
        group: "Purchase Order",
      },
      // An FR stands on a complaint instead.
      { column: "complaint_no", label: "Complaint No.", type: "text", dependsOn: [{ column: "bill_mode", value: "FR" }], group: "Purchase Order" },
      { column: "complaint_date", label: "Complaint Date", type: "date", dependsOn: [{ column: "bill_mode", value: "FR" }], group: "Purchase Order" },
      // Which EC the complaint is about: the earlier supply this FR replaces.
      { column: "complaint_ec_no", label: "Complaint Against EC No.", type: "text", dependsOn: [{ column: "bill_mode", value: "FR" }], group: "Purchase Order" },
      { column: "quotation_no", label: "Quotation No.", type: "text", dependsOn: [{ column: "bill_mode", value: "FR", not: true }], group: "Purchase Order" },
      { column: "po_no", label: "Purchase Order Number", type: "text", dependsOn: [{ column: "bill_mode", value: "FR", not: true }], group: "Purchase Order" },
      { column: "customer_po_date", label: "Purchase Order Date", type: "date", dependsOn: [{ column: "bill_mode", value: "FR", not: true }], group: "Purchase Order" },
      {
        column: "order_value",
        label: "Purchase/Sales Order Value (without GST)",
        type: "number",
        min: 0,
        group: "Purchase Order",
      },
      {
        column: "order_currency",
        label: "Currency",
        type: "select",
        options: CURRENCY_OPTIONS,
        group: "Purchase Order",
      },
      // An order priced in USD carries its value in INR too — the figure the
      // totals across orders are added up in. Worked out on save from the rate
      // set on the Settings page, and kept with the rate it used.
      {
        column: "order_value_inr",
        label: "Order Value in INR (conversion)",
        type: "number",
        computed: true,
        dependsOn: [{ column: "order_currency", value: "USD" }],
        group: "Purchase Order",
      },
      {
        column: "order_fx_rate",
        label: "USD → INR rate used",
        type: "number",
        computed: true,
        dependsOn: [{ column: "order_currency", value: "USD" }],
        group: "Purchase Order",
      },
      { column: "so_no", label: "Sales Order Number", type: "text", group: "Purchase Order" },
      { column: "so_date", label: "Sales Order Date", type: "date", group: "Purchase Order" },
      // A Spare order is counted by value, not by a total quantity.
      { column: "total_quantity", label: "Sales Order Total Quantity", type: "int", min: 0, dependsOn: [{ column: "order_type", value: "Spare", not: true }], group: "Purchase Order" },
      // More of the Sales Order. Taxable Value is worked out as the figures
      // are typed (see withValueRules) and can still be typed over.
      { column: "file_no", label: "File No.", type: "text", group: "Purchase Order" },
      { column: "discount_percent", label: "Discount %", type: "number", min: 0, group: "Purchase Order" },
      { column: "packing_forwarding_percent", label: "Packing & Forwarding %", type: "number", min: 0, group: "Purchase Order" },
      { column: "gst_percent", label: "GST %", type: "number", min: 0, group: "Purchase Order" },
      { column: "taxable_value", label: "Gross Order Value", type: "number", min: 0, group: "Purchase Order" },

      // Handover: when the SO went to Operations (Order Making SO fills it).
      // When it went to PPC is the SO Hand Over Date, below — Central's.
      { column: "ec_sent_operation_date", label: "SO Sent to Operation Date", type: "date", group: "Handover" },
      // When the SO went to PPC: the SO Hand Over Date, now under Handover.
      // Drawing's first target is counted from it — see lib/target-rules.ts.
      // Central Visibility's alone: not shown to Order Making. Planning sees it
      // as a column (PLANNING_CONTEXT_FIELDS).
      {
        column: "so_handover_date",
        label: "SO Sent to PPC Date",
        type: "date",
        centralOnly: true,
        group: "Handover",
      },

      // Terms & Conditions — customer requirements + freight/packing + commercial
      // terms rolled into one section. Visible read-only to Billing.
      // BOI (bought-out items) flag — Purchase sees it read-only and, when Yes,
      // adds the individual BOI items per EC.
      // A Spare order has no bought-out items and no quality documents: it is
      // supplied as it is, so Purchase and Quality (and Drawing) have no work
      // on it. Both read No for a Spare — see withValueRules.
      { column: "boi", label: "BOI", type: "select", options: YES_NO, dependsOn: [{ column: "order_type", value: "Spare", not: true }], group: "Terms & Conditions" },
      // Whether the customer requires packing details for this order.
      {
        column: "packing_details_required",
        label: "Packing Details Required",
        type: "select",
        options: YES_NO,
        group: "Terms & Conditions",
      },
      // 'No' means the QC department isn't involved for this order — its ECs
      // are skipped by the QC workspace and QC reminders. Yes asks, under
      // Document Required, which QC documents the client needs.
      {
        column: "qc_required",
        label: "Quality Required",
        type: "select",
        options: YES_NO,
        dependsOn: [{ column: "order_type", value: "Spare", not: true }],
        group: "Terms & Conditions",
      },
      {
        column: "freight_terms",
        label: "Freight Terms",
        type: "select",
        options: opts(["Paid", "To Pay"]),
        group: "Terms & Conditions",
      },
      {
        column: "packing_requirement",
        label: "Packing Requirement",
        type: "select",
        options: opts(["Wooden Box", "Loose", "Standard Packing"]),
        group: "Terms & Conditions",
      },
      {
        column: "delivery_date_as_per_so",
        label: "Delivery date As per SO",
        type: "date",
        group: "Terms & Conditions",
      },
      // The prose the PO used, kept as written. The terms the workflow acts on
      // are the lines beneath it (PaymentTermsControl), so this is never typed
      // into the section form — the same arrangement target dates have, where
      // the value shows here and every change goes through its own control.
      {
        column: "payment_terms",
        label: "Payment Terms",
        type: "text",
        readOnly: true,
        // A replacement (FR) is not paid for: no payment terms.
        dependsOn: [{ column: "bill_mode", value: "FR", not: true }],
        group: "Terms & Conditions",
      },
      // The terms as the PO worded them, in free text — kept beside the
      // structured lines above rather than squeezed into them.
      {
        column: "payment_terms_remarks",
        label: "Payment Terms Remarks",
        type: "text",
        group: "Terms & Conditions",
      },
      { column: "ld", label: "LD", type: "select", options: YES_NO, group: "Terms & Conditions" },
      {
        column: "ld_date",
        label: "LD Date",
        type: "date",
        dependsOn: [{ column: "ld", value: "Yes" }],
        group: "Terms & Conditions",
      },

      // The drawings the client wants. Every pump EC has a GAD, so it is not
      // asked; a Yes here gives each EC of the SO a Performance Curve in Drawing.
      {
        column: "performance_curve_required",
        label: "Performance Curve",
        type: "select",
        options: YES_NO,
        dependsOn: [{ column: "order_type", value: "Spare", not: true }],
        group: "Document Required",
      },
      ...QC_DOC_FIELDS.map((f) => ({
        ...f,
        dependsOn: [{ column: "order_type", value: "Spare", not: true }, { column: "qc_required", value: "Yes" }],
        group: "Document Required",
      })),

      // Target dates (per SO — the same target applies across every EC on
      // this order). Set by Central Visibility at intake; departments see them
      // read-only in their workspaces.
      { column: "drg_target_date", label: "Target Date for Drawing", type: "date", readOnly: true, dependsOn: [{ column: "order_type", value: "Spare", not: true }], group: "Target Dates" },
      // Purchase target is only meaningful when BOI = Yes (there's nothing
      // for Purchase to do otherwise).
      {
        column: "purchase_target_date",
        label: "Target Date for Purchase",
        type: "date",
        readOnly: true,
        dependsOn: [{ column: "boi", value: "Yes" }],
        group: "Target Dates",
      },
      // QC target date is only relevant when QC is needed for this order.
      {
        column: "qc_doc_target_date",
        label: "Quality Target Date",
        type: "date",
        readOnly: true,
        dependsOn: [{ column: "qc_required", value: "Yes" }],
        group: "Target Dates",
      },
      {
        column: "dispatch_team_target_date",
        label: "Target Date for Packing Team",
        type: "date",
        readOnly: true,
        group: "Target Dates",
      },
      // Holds the latest value; earlier ones are in its history.
      { column: "dispatch_target_date", label: "Dispatch Target Date", type: "date", readOnly: true, group: "Target Dates" },


      // --- Everything below is commented out, not deleted: the orders table
      // was trimmed to Client + Purchase Order Details columns only, and
      // these columns don't exist right now. Restore a block verbatim (and
      // re-add its column via ALTER TABLE) when that data comes back.
      //
      // // Order identity.
      // { column: "ec_no", label: "EC No.", type: "text" },
      // { column: "ec_generated_date", label: "EC Generated Date", type: "date" },
      // { column: "ec_rcvd_operations_date", label: "EC Received in Operations", type: "date" },
      // { column: "ec_sent_production_date", label: "EC Sent to Production", type: "date" },
      // { column: "file_no", label: "File No.", type: "text" },
      //
      // // Item (remaining columns).
      // { column: "model_no", label: "Model No.", type: "text" },
      // { column: "pump_qty", label: "If Pump (Qty)", type: "int" },
      // { column: "pump_sno", label: "Pump S.No.", type: "text" },
      // { column: "orientation", label: "Orientation", type: "text" },
      // { column: "liquid_application", label: "Liquid / Application", type: "text" },
      // { column: "version", label: "Version", type: "text" },
      //
      // // Commercial & dispatch (remaining columns).
      // { column: "project", label: "Project", type: "select", options: YES_NO },
      // { column: "master_reason_of_delay", label: "Master Reason of Delay", type: "text" },
      // { column: "dispatch_target_date", label: "Dispatch Target Date", type: "date" },
      // {
      //   column: "dispatch_target_revised_date",
      //   label: "Revised Dispatch Target Date",
      //   type: "date",
      // },
      // { column: "drg_target_date", label: "Target Date for DRG", type: "date" },
    ],
  },
  {
    // The EC / pump-or-spare line item under an SO. Central Visibility fills
    // this on the Add-On form; it carries the per-EC intake attributes and the
    // target dates each department works to.
    key: "item",
    title: "EC order",
    table: "order_items",
    scope: "item",
    fields: [
      { column: "ec_no", label: "EC No.", type: "text" },
      { column: "ec_date", label: "EC Date", type: "date" },
      {
        column: "item_type",
        label: "Type",
        type: "select",
        options: ITEM_OPTIONS,
      },
      // Everything below is pump-specific — a Spare only carries EC identity +
      // model + quantity (matching the Spare Add-On form), so these are gated
      // on Type = Pump and stay hidden for Spares.
      {
        column: "pump_type",
        label: "Pump Type",
        type: "select",
        options: PUMP_TYPE_OPTIONS,
        dependsOn: [{ column: "item_type", value: PUMP_LIKE }],
      },
      { column: "model_no", label: "Model No.", type: "text" },
      // Captured on both Pump and Spare Add-On forms, so not gated.
      { column: "internal_model", label: "Internal Model", type: "text" },
      { column: "version", label: "Series Version", type: "text" },
      { column: "quantity", label: "Quantity", type: "int" },
      { column: "suction", label: "Suction", type: "text", dependsOn: [{ column: "item_type", value: PUMP_LIKE }] },
      { column: "delivery", label: "Delivery", type: "text", dependsOn: [{ column: "item_type", value: PUMP_LIKE }] },
      { column: "pump_sno", label: "Pump Serial No.", type: "text", dependsOn: [{ column: "item_type", value: PUMP_LIKE }] },
      { column: "application", label: "Application", type: "text", dependsOn: [{ column: "item_type", value: PUMP_LIKE }] },
      // A pump's name plate (not a Spare's).
      ...NAME_PLATE_FIELDS.map((f) => ({ ...f, dependsOn: [{ column: "item_type", value: PUMP_LIKE }] })),
      // Whether this pump has bought-out items (its list is Purchase's to work).
      { column: "boi", label: "BOI", type: "select", options: YES_NO, group: "BOI", dependsOn: [{ column: "item_type", value: PUMP_LIKE }] },
    ],
  },
  {
    // Tax Invoice orders keep the PI list here (the "Operation" card).
    // Challan orders skip Operation entirely — their challan fields live
    // inside each Dispatch invoice card (see INVOICE_FIELDS).
    key: "billing",
    title: "Proforma Invoice",
    table: "order_billing",
    scope: "so",
    fields: [],
    childTable: "order_billing_docs",
    childGate: { column: "bill_type", value: "Tax Invoice" },
  },
  {
    // Accounts is per-SO. The PI list is view-only here (a "View PIs" button
    // on the edit form opens Billing's PI list). Balance of Payment auto =
    // order value − amount received, recomputed on save.
    key: "accounts",
    title: "Accounts",
    table: "order_accounts",
    scope: "so",
    fields: [
      {
        column: "payment_status",
        label: "Payment Status",
        type: "select",
        options: PAYMENT_STATUS_OPTIONS,
      },
      { column: "payment_confirmed_date", label: "Payment Confirmed Date", type: "date" },
      // The GST Accounts applies to the order value: 18% unless changed.
      { column: "gst_rate", label: "GST %", type: "number", min: 0, defaultValue: "18", listHidden: true },
      // With GST. It may run past the order value — what came in is recorded.
      { column: "amount_received", label: "Amount Received", type: "number", min: 0 },
      {
        column: "balance_of_payment",
        label: "Balance of Payment",
        type: "number",
        computed: true,
      },
      {
        column: "hold_reason",
        label: "Hold Reason (escalation)",
        type: "text",
        // Escalation note is only meaningful when the order is actually on hold.
        dependsOn: [{ column: "payment_status", value: PAYMENT_HOLD_VALUE }],
      },
    ],
  },
  {
    key: "drawing",
    title: "Drawing",
    table: "order_drawing",
    scope: "item",
    // Drawing is tracked as a list of revisions (add-on) rather than flat
    // fields — see DRAWING_REVISION_FIELDS. The legacy drg_* columns are
    // retained in the DB but no longer surfaced.
    fields: [],
    childTable: "order_drawing_revisions",
  },
  {
    // Purchase is now a per-EC list of bought-out items (order_boi_items),
    // shown only when the SO's BOI = Yes. No flat fields of its own.
    key: "purchase",
    title: "Purchase",
    table: "order_purchase",
    scope: "item",
    fields: [],
    childTable: "order_boi_items",
    childGate: { column: "boi", value: "Yes" },
  },
  {
    key: "qc",
    title: "Quality",
    table: "order_qc",
    scope: "item",
    fields: [
      // Filled by Central Visibility, read-only to QC. (The QC target date is
      // now an EC attribute — see the item section / QC_CONTEXT_FIELDS.)
      // Worked out from the documents' links: the day the last needed one
      // was submitted (lib/qc-docs.ts). The needed documents are on the SO.
      { column: "qc_doc_actual_date", label: "Actual Date of Doc. Submission", type: "date", computed: true },
      { column: "remarks", label: "Remarks", type: "text" },
    ],
  },
  {
    key: "planning",
    title: "Planning",
    table: "order_planning",
    scope: "item",
    fields: [
      // (Documents-required field removed — replaced by SO-level
      // "Packing Details Required" in Purchase Order Details.)
      // Filled by Planning. (Purchase target date moved to the SO — Central
      // Visibility sets it in Purchase Order Details.)
      // A Spare starts from where it stands.
      {
        column: "actual_spare_status",
        label: "Actual Spare Status",
        type: "select",
        options: opts(SPARE_PLANNING_STATUSES),
        dependsOn: [{ column: "item_type", value: "Spare" }],
      },
      // Readiness remarks — one field per item type, gated so only the
      // relevant one shows on an EC.
      {
        column: "pump_readiness_remarks",
        label: "Pump Readiness Remarks",
        type: "text",
        dependsOn: [{ column: "item_type", value: PUMP_LIKE }],
      },
      {
        column: "spare_readiness_remarks",
        label: "Spare Readiness Remarks",
        type: "text",
        dependsOn: [{ column: "item_type", value: "Spare" }],
      },
      // No readiness date to give while a Spare's date is still awaited.
      {
        column: "planning_readiness_date",
        label: "Readiness Date Rcvd from Planning",
        type: "date",
        dependsOn: [{ column: "actual_spare_status", value: "Date awaited", not: true }],
      },
      // A Spare is ready or it isn't: no planning status, assembly or
      // assembled quantity to plan for it.
      { column: "planning_status", label: "Planning Status", type: "text", dependsOn: [{ column: "item_type", value: "Spare", not: true }] },
      {
        column: "actual_pump_status",
        label: "Actual Pump Status",
        type: "select",
        options: opts(PUMP_EC_STATUSES),
        // Worked out from Ready Qty against the EC's quantity (pumpEcStatus).
        computed: true,
        defaultValue: "Pending",
        dependsOn: [{ column: "item_type", value: PUMP_LIKE }],
      },
      // How many of the EC's pumps are ready — with the status, each EC's own.
      { column: "ready_qty", label: "Ready Qty", type: "int", min: 0, dependsOn: [{ column: "item_type", value: PUMP_LIKE }] },
      { column: "assembled_packed_qty", label: "Assembled / Packed Qty", type: "text", dependsOn: [{ column: "item_type", value: "Spare", not: true }] },

      // Assembly is planned for every item type; packing only for pumps — a
      // spare is ready or it isn't, there's no separate packing stage to plan.
      // Assembly Date is what Assembly & Packing works to, so it's mirrored
      // read-only into their workspace and notifies them when it's set.
      { column: "assembly_date", label: "Assembly Date", type: "date", dependsOn: [{ column: "item_type", value: "Spare", not: true }] },
      { column: "assembly_remarks", label: "Assembly Remarks", type: "text", dependsOn: [{ column: "item_type", value: "Spare", not: true }] },
      {
        column: "packing_date",
        label: "Packing Date",
        type: "date",
        dependsOn: [{ column: "item_type", value: PUMP_LIKE }],
      },
      {
        column: "packing_remarks",
        label: "Packing Remarks",
        type: "text",
        dependsOn: [{ column: "item_type", value: PUMP_LIKE }],
      },
    ],
    // (Planning no longer files tentative packing slips; only Assembly &
    // Packing records the actual ones.)
  },
  {
    key: "assembly_dispatch",
    title: "Assembly & Packing",
    table: "order_assembly_dispatch",
    scope: "item",
    fields: [
      // (Documents-required field removed — replaced by SO-level "Packing
      // Details Required"; Target Date for Dispatch Team moved to the SO's
      // Target Dates — both in Purchase Order Details / Order details.)
      // A Spare is packed lot by lot against Planning's readiness lots (see
      // lib/ready-lots.ts); its packing date follows them.
      { column: "final_packing_dispatch_date", label: "Final Date for Packing & Dispatch", type: "date", dependsOn: [{ column: "item_type", value: "Spare", not: true }] },
      { column: "actual_packing_date", label: "Actual Material Packing Date", type: "date", dependsOn: [{ column: "item_type", value: "Spare", not: true }] },
      { column: "delay_remarks", label: "Remarks / Reason of Delay", type: "text" },
      // (Dispatch Status is no longer hand-entered — it's derived on the SO
      // from invoiced quantity/value vs the SO's own. See recomputeDispatchStatus.)
    ],
    // Packing files the ACTUAL packing slips — one list per SO, not per EC.
    // Available once the SO has a Market Type; the detail columns gate on
    // Packing Details Required = Yes.
    soChild: {
      table: "order_packing_slips",
      title: "Packing slips",
      kind: "actual",
      gate: { column: "market_type", present: true },
    },
  },
  {
    // Dispatch: last in the order, after Assembly & Packing has packed. Its
    // work is the invoice-and-dispatch cards (order_invoices) — invoice or
    // challan, transporter and vehicle, docket and charges, the LR — one per
    // dispatch. Raising them is what moves the SO's dispatch status, which is
    // derived from them rather than typed (see recomputeDispatchStatus).
    key: "dispatch",
    title: "Dispatch",
    table: "order_dispatch",
    scope: "so",
    // No fields of its own: like Billing & Operations, the section exists to
    // own its list. The table behind it is what nav and permissions key off.
    fields: [],
    childTable: "order_invoices",
  },
];

export const SECTION_BY_TABLE = new Map<OrderTable, OrderSection>(
  ORDER_SECTIONS.map((s) => [s.table, s])
);

// SO-level sections (keyed by order_id) shown on the order "Open" detail;
// item-level sections (keyed by item_id) shown on an EC's detail page.
export const SO_SECTIONS = ORDER_SECTIONS.filter((s) => s.scope === "so");

/**
 * Order Making fills an SO's Client and Purchase Order details — those groups
 * of the Order details form, the same columns Central Visibility edits.
 */
export const ORDER_MAKING_GROUPS = ["Client", "Purchase Order", "Handover", "Order Making Hold"];
export const ORDER_MAKING_FIELDS: OrderField[] = (
  ORDER_SECTIONS.find((s) => s.table === "orders")?.fields ?? []
  // Central Visibility's own (SO Sent to PPC Date) is not Order Making's to see.
).filter((f) => ORDER_MAKING_GROUPS.includes(f.group ?? "") && !f.centralOnly);
/** The ones Order Making types into — not the worked-out INR value or rate. */
export const ORDER_MAKING_EDITABLE: OrderField[] = ORDER_MAKING_FIELDS.filter(
  // Not Central's own either: EC Sent to PPC Date is Central Visibility's.
  (f) => !f.computed && !f.readOnly && !f.centralOnly
);
/**
 * The Sales Order details: what an Order Making SO member fills on an SO
 * assigned to them. The rest of Order Making's fields are the PO's.
 */
export const SO_DETAIL_COLUMNS = [
  "so_no", "so_date", "order_value", "order_currency", "total_quantity",
  "file_no", "discount_percent", "packing_forwarding_percent", "gst_percent", "taxable_value",
];
/**
 * The Sales Order details an SO must have for them to count as filled. The
 * later additions (File No., Discount %, GST %, Taxable Value) are shown and
 * filled under the same heading but do not hold an SO back: every SO before
 * them would otherwise read as unfilled overnight.
 */
const SO_REQUIRED_COLUMNS = ["so_no", "so_date", "order_value", "order_currency", "total_quantity"];
/** What Order Making SO types into — and Clear / Hold on the SOs assigned to them. */
export const ORDER_MAKING_SO_EDITABLE: OrderField[] = ORDER_MAKING_EDITABLE.filter(
  (f) => SO_DETAIL_COLUMNS.includes(f.column) || f.column === "ec_sent_operation_date" || f.group === "Order Making Hold"
);
/** The Sales Order details that must be in for the SO's details to count as filled. */
export const SO_DETAIL_FIELDS: OrderField[] = ORDER_MAKING_FIELDS.filter(
  (f) => SO_REQUIRED_COLUMNS.includes(f.column) && !f.computed
);
export const ITEM_SECTIONS = ORDER_SECTIONS.filter((s) => s.scope === "item");

/**
 * For a select field, the option value that matches `raw` case-insensitively;
 * otherwise `raw` trimmed. Lets a stored value like "yes" or "PUMP" (from an
 * import with loose casing) resolve to the canonical option "Yes" / "Pump", so
 * the dropdown shows it and a save writes it back cleanly. Non-select fields
 * and unmatched values are returned unchanged.
 */
export function canonicalSelectValue(field: OrderField, raw: string): string {
  const t = (raw ?? "").trim();
  if (field.type !== "select" || !field.options || t === "") return t;
  const match = field.options.find(
    (o) => o.value.toLowerCase() === t.toLowerCase()
  );
  return match ? match.value : t;
}

/**
 * The option list to render for a select, with the current value appended when
 * it isn't already one of the defined options — so an unrecognized stored value
 * still displays (and is preserved on save) rather than showing blank.
 */
export function selectOptionsFor(
  field: OrderField,
  current: string
): { value: string; label: string }[] {
  const opts = field.options ?? [];
  const t = (current ?? "").trim();
  if (t !== "" && !opts.some((o) => o.value === t)) {
    return [...opts, { value: t, label: t }];
  }
  return opts;
}

// 1:many children: dispatch lots, BOI items and packing slips (per EC);
// PIs and invoices (per SO).
export type ChildTable =
  | "order_payment_terms"
  | "order_lots"
  | "order_boi_items"
  | "order_billing_docs"
  | "order_packing_slips"
  | "order_invoices"
  | "order_drawing_revisions"
  | "order_ready_lots";

// A packing slip under an EC. Planning files the tentative set, Packing files
// the actual set (same shape, different `kind` — see PACKING_SLIP_KINDS).
// Section visibility (see ITEM_SECTIONS below): shown whenever the SO's Market
// Type is set (Domestic or Export) — at that point just the number + date.
// The full detail block (box / weights / marking …) unlocks only when the SO
// has Packing Details Required = Yes.
const PACKING_DETAILS_YES = [
  { column: "packing_details_required", value: "Yes" },
];
export const PACKING_SLIP_FIELDS: OrderField[] = [
  { column: "packing_slip_no", label: "Packing Slip No.", type: "text" },
  { column: "packing_slip_date", label: "Packing Slip Date", type: "date" },
  { column: "box_size", label: "Box Size", type: "text", dependsOn: PACKING_DETAILS_YES },
  { column: "marking_on_case", label: "Marking on Case", type: "text", dependsOn: PACKING_DETAILS_YES },
  { column: "description", label: "Description", type: "text", dependsOn: PACKING_DETAILS_YES },
  { column: "quantity", label: "Qty", type: "int", dependsOn: PACKING_DETAILS_YES },
  { column: "item_weight", label: "Item Weight", type: "number", dependsOn: PACKING_DETAILS_YES },
  { column: "gross_weight", label: "Gross Weight", type: "number", dependsOn: PACKING_DETAILS_YES },
  { column: "net_weight", label: "Net Weight", type: "number", dependsOn: PACKING_DETAILS_YES },
];

export const PACKING_SLIP_KINDS = {
  tentative: { value: "tentative", label: "Tentative (Planning)" },
  actual: { value: "actual", label: "Actual (Packing)" },
} as const;

// An invoice under an SO — Dispatch's three phases on one row. The dispatch
// fields that apply depend on Delivery Mode. EC / Packing Slip No. / Packing
// Qty live only in the add-on's card header (see OrderChildList's
// `rowHeader`); they mirror the packing slip and Dispatch can't edit them,
// so they don't appear in the invoice form itself.
export const INVOICE_FIELDS: OrderField[] = [
  // Phase 1 — the "Invoice" phase. Two field sets share this slot:
  //   • Tax Invoice orders → invoice_no / _date / _value / _quantity
  //   • Challan orders     → challan_no / _date / _value / _quantity / fr_reason
  // The correct set is chosen at render time via `bill_type` in the parent
  // SO's context (passed to OrderChildList as `context.bill_type`).
  { column: "invoice_no",       label: "Invoice No.",   type: "text",   group: "Invoice", dependsOn: [{ column: "bill_type", value: "Tax Invoice" }] },
  { column: "invoice_date",     label: "Invoice Date",  type: "date",   group: "Invoice", dependsOn: [{ column: "bill_type", value: "Tax Invoice" }] },
  { column: "invoice_value",    label: "Invoice Value", type: "number", group: "Invoice", dependsOn: [{ column: "bill_type", value: "Tax Invoice" }] },
  { column: "invoice_quantity", label: "Invoice Qty",   type: "int",    group: "Invoice", dependsOn: [{ column: "bill_type", value: "Tax Invoice" }] },
  { column: "challan_no",       label: "Challan No.",   type: "text",   group: "Invoice", dependsOn: [{ column: "bill_type", value: "Challan" }] },
  { column: "challan_date",     label: "Challan Date",  type: "date",   group: "Invoice", dependsOn: [{ column: "bill_type", value: "Challan" }] },
  { column: "challan_value",    label: "Challan Value", type: "number", group: "Invoice", dependsOn: [{ column: "bill_type", value: "Challan" }] },
  // What the challan sends — without it a Challan order could never read as
  // fully dispatched.
  { column: "challan_quantity", label: "Challan Qty",   type: "int",    group: "Invoice", dependsOn: [{ column: "bill_type", value: "Challan" }] },
  { column: "fr_reason",        label: "FR Reason",     type: "select", options: FR_REASON_OPTIONS, group: "Invoice", dependsOn: [{ column: "bill_type", value: "Challan" }] },

  // Phase 2 — dispatch details.
  {
    column: "delivery_type",
    label: "Delivery Type",
    type: "select",
    options: DELIVERY_TYPE_OPTIONS,
    group: "Dispatch",
  },
  {
    column: "delivery_mode",
    label: "Delivery Mode",
    type: "select",
    options: DELIVERY_MODE_OPTIONS,
    group: "Dispatch",
  },
  // Transport → name / freight. By BUS → name / vehicle no / freight.
  // Direct Vehicle → weight / size / vehicle no / freight. (The delivery date
  // is filled with the docket, once the goods have reached.)
  // By Courier → courier mode / docket no / freight.
  {
    column: "transporter_name",
    label: "Transporter Name",
    type: "text",
    dependsOn: [{ column: "delivery_mode", value: ["Transport", "By BUS"] }],
    group: "Dispatch",
  },
  {
    column: "vehicle_weight",
    label: "Vehicle Weight",
    type: "text",
    dependsOn: [{ column: "delivery_mode", value: "Direct Vehicle" }],
    group: "Dispatch",
  },
  {
    column: "vehicle_size",
    label: "Vehicle Size",
    type: "text",
    dependsOn: [{ column: "delivery_mode", value: "Direct Vehicle" }],
    group: "Dispatch",
  },
  {
    column: "vehicle_no",
    label: "Vehicle No.",
    type: "text",
    dependsOn: [{ column: "delivery_mode", value: ["Direct Vehicle", "By BUS"] }],
    group: "Dispatch",
  },
  {
    column: "courier_mode",
    label: "Mode of Courier",
    type: "select",
    options: COURIER_MODE_OPTIONS,
    dependsOn: [{ column: "delivery_mode", value: "By Courier" }],
    group: "Dispatch",
  },
  { column: "freight_value", label: "Freight Value", type: "number", group: "Dispatch" },

  // Phase 3 — docket / LR details.
  {
    column: "docket_type",
    label: "Docket Type",
    type: "select",
    options: DOCKET_TYPE_OPTIONS,
    group: "Docket",
  },
  { column: "docket_no", label: "Docket No.", type: "text", group: "Docket" },
  { column: "booking_date", label: "Booking Date", type: "date", group: "Docket" },
  { column: "material_weight", label: "Weight of Material", type: "number", group: "Docket" },
  { column: "per_kg_rate", label: "Per KG Rate", type: "number", group: "Docket" },
  { column: "so_freight_terms", label: "LR Freight Terms", type: "text", group: "Docket" },
  { column: "delivery_date", label: "Delivery Date", type: "date", group: "Docket" },
  { column: "lr_link", label: "LR Link (SharePoint)", type: "text", group: "Docket" },
];

/**
 * True when a field's dependsOn conditions all hold for the given values.
 * Comparison is case-insensitive and trimmed: some gating columns are free
 * text (Market Type is typed as "EXPORT" / "Export"), and the dropdown-backed
 * ones are canonicalised anyway, so this only ever makes a gate more forgiving.
 */
export function dependsOnSatisfied(
  field: OrderField,
  read: (column: string) => string
): boolean {
  if (!field.dependsOn) return true;
  const norm = (s: string) => (s ?? "").trim().toLowerCase();
  return field.dependsOn.every((d) => {
    const current = norm(read(d.column));
    const match = Array.isArray(d.value)
      ? d.value.some((v) => norm(v) === current)
      : norm(d.value) === current;
    return d.not ? !match : match;
  });
}

// A PI under an SO (Tax Invoice bill type only). Billing owns these fields;
// each save fires a "PI created" notification to Accounts (see actions.ts).
// ---------------------------------------------------------------------------
// Add-On forms (new EC under an SO)
//
// Shared by the form and by createItemAction, so "every field is required" is
// enforced in one place rather than trusted to the browser. The Spare form's
// Order Copy file is deliberately NOT here — it is the one optional input.
// ---------------------------------------------------------------------------

/** Pump / ROLB Add-On: the full EC attribute set. */
export const ADD_ON_PUMP_FIELDS: OrderField[] = [
  { column: "ec_no", label: "EC No.", type: "text" },
  { column: "ec_date", label: "EC Date", type: "date" },
  {
    column: "pump_type",
    label: "Pump Type",
    type: "select",
    options: PUMP_TYPE_OPTIONS,
  },
  { column: "model_no", label: "Model No.", type: "text" },
  { column: "internal_model", label: "Internal Model", type: "text" },
  { column: "quantity", label: "Quantity", type: "int" },
  { column: "suction", label: "Suction", type: "text" },
  { column: "delivery", label: "Delivery", type: "text" },
  { column: "pump_sno", label: "Pump Serial No.", type: "text" },
  { column: "application", label: "Application", type: "text" },
  { column: "version", label: "Series Version", type: "text" },
  ...NAME_PLATE_FIELDS,
  // Yes opens the bought-out item list on the form (item, make, description).
  { column: "boi", label: "BOI", type: "select", options: YES_NO, group: "BOI" },
];

/** Spare Add-On: EC identity + model/version + quantity. */
export const ADD_ON_SPARE_FIELDS: OrderField[] = [
  { column: "ec_no", label: "EC No.", type: "text" },
  { column: "ec_date", label: "EC Date", type: "date" },
  { column: "model_no", label: "Model No.", type: "text" },
  { column: "internal_model", label: "Internal Model", type: "text" },
  { column: "version", label: "Series Version", type: "text" },
  { column: "quantity", label: "Quantity", type: "int" },
];

/** What an FR (replacement) order's Payment Terms Remarks say. */
export const FR_PAYMENT_TERMS_REMARKS = "REPLACEMENT";

// --- Zone: one spelling each -------------------------------------------------
// Typed, or filled from the client directory, a zone comes in any case
// ("NORTH", "north india"); it is saved as one of these.
export const ZONES = ["North", "South", "East", "West", "Central", "Export"];

/** "NORTH" / "north india" → "North"; a zone not among ZONES is kept as typed. */
export function canonicalZone(value: unknown): string {
  const v = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!v) return "";
  const bare = v.replace(/\s+india$/i, "").trim().toLowerCase();
  return ZONES.find((z) => z.toLowerCase() === bare) ?? v;
}

// --- Client fields: one spelling each -----------------------------------------
// Typed, or filled from the client directory in capitals, Market Type, Client
// Type and Industry are saved in the portal's own spelling, matched without
// regard to case. A value not among them is kept as typed.
const CLIENT_FIELD_VALUES: Record<string, string[]> = {
  market_type: ["Domestic", "Export"],
  client_type: ["End User", "Group (Mills)", "OEM", "Merchant Exporter", "Trader", "Channel Partner", "Unclassified"],
  industry_type: [
    "Sugar", "Non Sugar", "Distillery", "Paper", "CBG", "ETP/STP/WTP", "Cattle Feed", "Food & Beverages", "Chemicals",
    "Pharma", "Engineering", "Bio-Fuel", "Manufacturing", "Oil & Gas", "Agriculture", "Dairy", "Metals & Minerals",
    "Biogas", "Adhesive", "EPC", "FMCG", "Other",
  ],
};

/** Zone, Market Type, Client Type, Industry as saved: one spelling each; other columns as given. */
export function canonicalClientField(column: string, value: unknown): string {
  if (column === "zone") return canonicalZone(value);
  const list = CLIENT_FIELD_VALUES[column];
  const v = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!list || !v) return list ? v : String(value ?? "");
  return list.find((x) => x.toLowerCase() === v.toLowerCase()) ?? v;
}
const CLIENT_FIELDS = new Set(["zone", ...Object.keys(CLIENT_FIELD_VALUES)]);
/** Whether a column is saved through canonicalClientField. */
export const isClientField = (column: string) => CLIENT_FIELDS.has(column);

// --- SO No. and EC No.: SO<yy>/1/<no.> and EC/<yy>/1/<SO no.>/<EC no.> -------
// A new one opens with all but its own number filled in; the whole stays
// editable, and a box left at the prefix alone is saved as blank.

/** Two digits of the year: the SO Date's, else this year's. */
function yearOf(soDate?: unknown): string {
  const m = /^(\d{4})-/.exec(String(soDate ?? ""));
  return (m ? m[1] : String(new Date().getFullYear())).slice(2);
}

/** "SO26/1/" — what a new SO No. opens with. */
export function soNoPrefix(soDate?: unknown): string {
  return `SO${yearOf(soDate)}/1/`;
}

/** "EC/26/1/1833/" from the SO No. ("SO26/1/1833"); "EC/26/1/" when the SO No. is not in the usual form. */
export function ecNoPrefix(soNo?: unknown, soDate?: unknown): string {
  const m = /^SO(\d{2})\/1\/(\d+)$/.exec(String(soNo ?? "").trim());
  return m ? `EC/${m[1]}/1/${m[2]}/` : `EC/${yearOf(soDate)}/1/`;
}

const SO_NO_PREFIX_ONLY = /^SO\d{2}\/1\/$/;
const EC_NO_PREFIX_ONLY = /^EC\/\d{2}\/1\/(\d+\/)?$/;

/** The SO No. or EC No. as saved: blank when nothing past its prefix was typed. */
export function withoutBarePrefix(column: string, value: unknown): string {
  const v = String(value ?? "").trim();
  if (column === "so_no" && SO_NO_PREFIX_ONLY.test(v)) return "";
  if (column === "ec_no" && EC_NO_PREFIX_ONLY.test(v)) return "";
  return v;
}

/** A new SO No. still at its prefix alone — it follows the SO Date's year. */
export function isBareSoNoPrefix(value: unknown): boolean {
  return SO_NO_PREFIX_ONLY.test(String(value ?? "").trim());
}

/** A note when an SO No. / EC No. strays from the usual form — a warning, never a block. */
export function numberFormatNote(column: string, value: unknown): string | null {
  const v = String(value ?? "").trim();
  if (!v || withoutBarePrefix(column, v) === "") return null;
  if (column === "so_no" && !/^SO\d{2}\/1\/\d+$/.test(v)) return "Doesn't follow SO<yy>/1/<no.> — it will still save.";
  if (column === "ec_no" && !/^EC\/\d{2}\/1\/\d+\/\d+$/.test(v)) return "Doesn't follow EC/<yy>/1/<SO no.>/<EC no.> — it will still save.";
  return null;
}

/** An FR order is worth nothing: no discount, packing, GST or gross value — each 0. */
export const FR_ZERO_COLUMNS = ["discount_percent", "packing_forwarding_percent", "gst_percent", "taxable_value"];

/** An FR SO's blank figures as 0 — what its form opens with. */
export function withFrZeros<T extends Record<string, unknown>>(values: T): T {
  if (String(values.bill_mode ?? "") !== "FR") return values;
  const next: Record<string, unknown> = { ...values };
  for (const c of FR_ZERO_COLUMNS) if (String(next[c] ?? "").trim() === "") next[c] = "0";
  return next as T;
}

/**
 * One field's new value, with what it implies for the others: a Challan
 * carries no value, so picking it sets the order value to 0 INR.
 */
export function withValueRules<T extends Record<string, unknown>>(
  prev: T,
  column: string,
  value: string
): T {
  const next: Record<string, unknown> = { ...prev, [column]: value };
  // Bill Mode carries the bill type with it.
  if (column === "bill_mode") {
    next.bill_type = BILL_TYPE_FOR_MODE[value] ?? "";
  }
  if ((column === "bill_type" && value === "Challan") || (column === "bill_mode" && value === "FR")) {
    next.order_value = "0";
    next.order_currency = "INR";
  }
  if (column === "bill_mode" && value === "FR") {
    for (const c of FR_ZERO_COLUMNS) next[c] = "0";
  }
  // A new SO No. still at its prefix follows the SO Date's year.
  if (column === "so_date" && isBareSoNoPrefix(next.so_no)) {
    next.so_no = soNoPrefix(value);
  }
  // An FR order is a replacement: its terms say so.
  if (column === "bill_mode" && value === "FR" && !String(next.payment_terms_remarks ?? "").trim()) {
    next.payment_terms_remarks = FR_PAYMENT_TERMS_REMARKS;
  }
  // A Spare has no bought-out items and no quality documents.
  if (column === "order_type" && value === "Spare") {
    next.boi = "No";
    next.qc_required = "No";
  }
  // Taxable Value, worked out as the figures are typed: the value less the
  // discount, plus packing & forwarding on that, plus GST on that. Typing
  // into Taxable Value itself overrides it until one of these changes again.
  if (TAXABLE_INPUTS.includes(column)) {
    const taxable = taxableValueOf(next);
    if (taxable !== null) next.taxable_value = taxable;
  }
  return next as T;
}

const TAXABLE_INPUTS = ["order_value", "discount_percent", "packing_forwarding_percent", "gst_percent"];

/** Value × (1 − Discount %) × (1 + P&F %) × (1 + GST %), to 2 places; null without a value. */
export function taxableValueOf(v: Record<string, unknown>): string | null {
  const num = (k: string) => {
    const s = String(v[k] ?? "").trim();
    return s === "" ? null : Number(s);
  };
  const value = num("order_value");
  if (value === null || !Number.isFinite(value)) return null;
  const pct = (k: string) => {
    const n = num(k);
    return n !== null && Number.isFinite(n) ? n / 100 : 0;
  };
  const t = value * (1 - pct("discount_percent")) * (1 + pct("packing_forwarding_percent")) * (1 + pct("gst_percent"));
  return (Math.round(t * 100) / 100).toFixed(2);
}

/** Which Add-On field set an SO's order type uses. */
export function addOnFieldsFor(orderType?: string | null): OrderField[] {
  return orderType === "Spare" ? ADD_ON_SPARE_FIELDS : ADD_ON_PUMP_FIELDS;
}

/** Add-On fields that may be left blank; every other one is mandatory — the name plate included. */
export const ADD_ON_OPTIONAL = new Set<string>(["version"]);

/** A Spare EC needs only its EC No. and EC Date; the rest may be filled later. */
const SPARE_ADD_ON_REQUIRED = new Set<string>(["ec_no", "ec_date"]);

/** Whether an Add-On field may be left blank on an EC of this order type. */
export function isAddOnOptional(orderType: string | null | undefined, column: string): boolean {
  if (orderType === "Spare") return !SPARE_ADD_ON_REQUIRED.has(column);
  return ADD_ON_OPTIONAL.has(column);
}

/**
 * The first mandatory Add-On field left blank, or null when the EC is
 * complete.
 */
export function firstMissingAddOnField(
  orderType: string | null | undefined,
  values: Record<string, unknown>
): OrderField | null {
  for (const f of addOnFieldsFor(orderType)) {
    if (isAddOnOptional(orderType, f.column)) continue;
    // An EC No. left at its prefix ("EC/26/1/1833/") is not filled in.
    const v = f.column === "ec_no" ? withoutBarePrefix("ec_no", values[f.column]) : values[f.column];
    if (v === null || v === undefined || String(v).trim() === "") return f;
  }
  return null;
}

// How an order is to be paid, one line per slice: "30% Advance Against ABG",
// "40% Before Dispatch", "30% After Receipt, 45 days". An order carries as
// many lines as its terms have parts, and they are added to rather than
// revised — a term that changes is a new agreement, not a correction.
export const PAYMENT_TERM_OPTIONS = opts([
  "Advance Against PI",
  "Advance Against ABG",
  "Before Dispatch",
  "Balance Against PBG",
  "After Receipt",
  "Payment Against Documents",
  "Cheque on Delivery",
  "Letter of Credit",
]);

// The documents a Payment Against Documents line can wait on — Central
// Visibility's list.
export const PAYMENT_AGAINST_DOCUMENTS = "Payment Against Documents";
export const PAYMENT_DOCUMENT_OPTIONS = opts([
  "Pump Technical Datasheet",
  "GA Drawing",
  "QAP",
  "Performance Curve",
  "Motor Datasheet",
  "Material Test Certificate",
  "Pump Test Report",
  "Spares List",
  "Painting Procedure",
  "Inspection Test Plan",
  "Manufacturing Schedule",
]);

// Only After Receipt is counted from the client receiving the material and
// carries a credit period; the rest fall due on the event itself.
export const AFTER_RECEIPT_TERMS = ["After Receipt"];
// The terms that carry a number of days: After Receipt's credit period, and a
// Letter of Credit's usance (e.g. LC 45 days).
export const TERMS_WITH_DAYS = [...AFTER_RECEIPT_TERMS, "Letter of Credit"];

/**
 * Nothing is due before the client has the material: the order has payment
 * terms and every one of them is counted from receipt. That is what used to be
 * answered by hand as "Paid after Receipt" — it is now simply what the terms
 * say. A term line with nothing chosen yet leaves the answer no, since the
 * terms are not fully stated.
 */
export function isAfterReceiptOnly(
  terms: { term?: unknown }[] | null | undefined
): boolean {
  if (!terms || terms.length === 0) return false;
  return terms.every((t) =>
    AFTER_RECEIPT_TERMS.includes(String(t?.term ?? "").trim())
  );
}

/**
 * An SO's payment terms in one line — "30% Advance + 70% After Receipt, 45
 * days" — from its term lines, or the terms as written on an older SO that
 * has no lines.
 */
export function paymentTermsText(
  lines: { term?: unknown; percent?: unknown; days?: unknown; documents?: unknown }[] | null | undefined,
  written?: unknown
): string {
  const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
  const parts = (lines ?? [])
    .map((l) => {
      const head = [blank(l.percent) ? "" : `${Number(l.percent)}%`, String(l.term ?? "").trim()]
        .filter(Boolean)
        .join(" ");
      const withDocs = head && !blank(l.documents) ? `${head} (${String(l.documents).trim()})` : head;
      return withDocs && !blank(l.days) ? `${withDocs}, ${Number(l.days)} days` : withDocs;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" + ") : String(written ?? "").trim();
}

export const PAYMENT_TERM_FIELDS: OrderField[] = [
  {
    column: "term",
    label: "Term",
    type: "select",
    options: PAYMENT_TERM_OPTIONS,
  },
  { column: "percent", label: "%", type: "number", min: 0 },
  {
    column: "days",
    label: "Days",
    type: "int",
    min: 0,
    dependsOn: [{ column: "term", value: TERMS_WITH_DAYS }],
  },
  // Which documents a Payment Against Documents line waits on.
  {
    column: "documents",
    label: "Required Documents",
    type: "text",
    dependsOn: [{ column: "term", value: PAYMENT_AGAINST_DOCUMENTS }],
  },
];

export const BILLING_DOC_FIELDS: OrderField[] = [
  { column: "pi_no", label: "PI No.", type: "text" },
  { column: "pi_date", label: "PI Date", type: "date" },
  { column: "pi_value", label: "PI Value", type: "number" },
];

/**
 * A Spare's readiness, lot by lot — up to READY_LOT_LIMIT of them, once its
 * Actual Spare Status is Partial ready or Fully ready. Planning records them;
 * Assembly & Packing reads them to know what can be packed.
 */
export const READY_LOT_LIMIT = 3;
// A lot can be planned before it is ready ("In plan", with its planned date);
// only a Partial or Fully ready lot is ready — what Assembly & Packing takes.
export const READY_LOT_STATUSES = ["In plan", "Partial ready", "Fully ready"];
export const LOT_READY_STATUSES = ["Partial ready", "Fully ready"];
export const READY_LOT_FIELDS: OrderField[] = [
  { column: "status", label: "Status", type: "select", options: opts(READY_LOT_STATUSES) },
  { column: "ready_date", label: "Date", type: "date" },
];

/** Whether a Spare EC's status opens its readiness lots. */
export function readyLotsOpen(actualSpareStatus: unknown): boolean {
  // In plan too: a lot can be planned before any is ready.
  return READY_LOT_STATUSES.includes(String(actualSpareStatus ?? "").trim());
}

export const LOT_FIELDS: OrderField[] = [
  { column: "lot_no", label: "Lot No.", type: "text" },
  { column: "lot_dispatch_date", label: "Lot Wise Dispatch Date", type: "date" },
  { column: "packing_slip_remark", label: "Packing Slip Remark", type: "text" },
  { column: "invoice_date", label: "Invoice Date", type: "date" },
];

// A bought-out item. Central Visibility decides *what* is bought out (the item
// and its make/description); Purchase only records what happened to it — so
// the first three are centralOnly and Purchase sees them read-only.
// One bought-out item. The item itself comes with the EC (item, make, qty,
// description — Central's, read-only to Purchase). Purchase covers its qty two
// ways: RIL stock allocated, and — for what stock cannot cover — an order
// placed with a vendor, tracked to its receipt. With a vendor order the item
// stands where that order does; without one, where its RIL stock does
// (boiReceivedSql, boiStatus).
export const BOI_ITEM_FIELDS: OrderField[] = [
  {
    column: "boi_item",
    label: "Item",
    type: "select",
    options: BOI_ITEM_OPTIONS,
    centralOnly: true,
    group: "Item",
  },
  {
    column: "boi_item_other",
    label: "Item (Others)",
    type: "text",
    dependsOn: [{ column: "boi_item", value: "Others" }],
    centralOnly: true,
    group: "Item",
  },
  { column: "boi_make", label: "BOI Make", type: "text", centralOnly: true, group: "Item" },
  { column: "boi_qty", label: "Qty", type: "int", min: 0, centralOnly: true, group: "Item" },
  { column: "boi_description", label: "Description", type: "text", centralOnly: true, group: "Item" },

  // Purchase: what RIL already has in stock for it.
  { column: "stock_allocated_qty", label: "Allocated Qty", type: "int", min: 0, group: "In stock (RIL allocated)" },

  // Purchase: what is not in stock is ordered from a vendor.
  { column: "vendor_order", label: "Order placed to vendor", type: "select", options: YES_NO, group: "Order placed to vendor" },
  ...(
    [
      { column: "vendor_code", label: "Vendor Code", type: "text" },
      { column: "vendor_name", label: "Vendor Name", type: "text" },
      { column: "ril_po_no", label: "RIL PO No.", type: "text" },
      { column: "ril_po_date", label: "RIL PO Date", type: "date" },
      { column: "vendor_so_no", label: "Vendor SO No.", type: "text" },
      { column: "vendor_so_date", label: "Vendor SO Date", type: "date" },
      { column: "order_qty", label: "Order Qty", type: "int", min: 0 },
      // Every change is kept (order_boi_expected_history).
      { column: "expected_receipt_date", label: "Vendor Expected Date", type: "date" },
      { column: "rate_per_unit", label: "Rate per Unit", type: "number", min: 0 },
      // Rate x Order Qty, worked out by the database.
      { column: "total_value", label: "Total Value", type: "number", computed: true },
      { column: "received_qty", label: "Received Qty", type: "int", min: 0 },
      { column: "receipt_date", label: "Received Date", type: "date" },
      // Pending, Partially received or Fully received — from the quantities.
      { column: "vendor_status", label: "Status", type: "text", computed: true },
    ] as OrderField[]
  ).map((f) => ({ ...f, group: "Order placed to vendor", dependsOn: [{ column: "vendor_order", value: "Yes" }] })),

  { column: "remarks", label: "Remarks", type: "text", group: "Remarks" },
];

// Drawing's documents for a pump EC: a GAD always, and a Performance Curve
// when the SO asks for one (orders.performance_curve_required). Each is kept
// as versions — rows of order_drawing_revisions with that doc_type, the
// version number in revision_no. A version is sent to the client, who
// approves it or sends it back to resubmit as a new version; an approved GAD
// is then issued to Planning. Status follows (drawingDocStatus).
export const DRAWING_DOC_TYPES = ["GAD", "Performance Curve"] as const;
export type DrawingDocType = (typeof DRAWING_DOC_TYPES)[number];

/** What the client said of a version: approved, or comments to resubmit. */
export const CLIENT_RESPONSE_OPTIONS = [
  { value: "Yes", label: "Approved" },
  { value: "No", label: "Resubmit" },
];

export const DRAWING_REVISION_FIELDS: OrderField[] = [
  { column: "doc_type", label: "Document", type: "text", readOnly: true, group: "Version" },
  { column: "revision_no", label: "Version", type: "text", readOnly: true, group: "Version" },
  { column: "issued_to_client", label: "Sent to Client", type: "select", options: YES_NO, group: "Client" },
  { column: "issued_to_client_date", label: "Sent to Client Date", type: "date", group: "Client" },
  {
    column: "approved",
    label: "Client Response",
    type: "select",
    options: CLIENT_RESPONSE_OPTIONS,
    group: "Client",
    dependsOn: [{ column: "issued_to_client", value: "Yes" }],
  },
  {
    column: "approved_date",
    label: "Response Date",
    type: "date",
    group: "Client",
    dependsOn: [{ column: "issued_to_client", value: "Yes" }],
  },
  // A GAD's last step: the approved drawing goes to Planning, with its
  // SharePoint link — Planning sees both under the EC.
  {
    column: "issued_to_production",
    label: "Issued to Planning",
    type: "select",
    options: YES_NO,
    group: "Planning",
    dependsOn: [{ column: "approved", value: "Yes" }, { column: "doc_type", value: "GAD" }],
  },
  {
    column: "issued_to_production_date",
    label: "Issued to Planning Date",
    type: "date",
    group: "Planning",
    dependsOn: [{ column: "approved", value: "Yes" }, { column: "doc_type", value: "GAD" }],
  },
  {
    column: "planning_link",
    label: "SharePoint Link",
    type: "text",
    group: "Planning",
    dependsOn: [{ column: "issued_to_production", value: "Yes" }, { column: "doc_type", value: "GAD" }],
  },
  { column: "remarks", label: "Remarks", type: "text", group: "Remarks" },
];

export const CHILD_FIELDS: Record<ChildTable, OrderField[]> = {
  order_payment_terms: PAYMENT_TERM_FIELDS,
  order_drawing_revisions: DRAWING_REVISION_FIELDS,
  order_lots: LOT_FIELDS,
  order_boi_items: BOI_ITEM_FIELDS,
  order_billing_docs: BILLING_DOC_FIELDS,
  order_packing_slips: PACKING_SLIP_FIELDS,
  order_invoices: INVOICE_FIELDS,
  order_ready_lots: READY_LOT_FIELDS,
};

// SO-level context every department sees read-only, so each team knows when
// the order was raised and whether it's a Pump or Spare order. Prepended to
// each department's own context fields below.
export const SO_CONTEXT_FIELDS: OrderField[] = [
  { column: "so_date", label: "Sales Order Date", type: "date" },
  {
    column: "order_type",
    label: "Order Type",
    type: "select",
    options: ORDER_TYPE_OPTIONS,
  },
];

// Payment Terms (owned by Central Visibility) shown read-only in the Accounts
// workspace.
export const PAYMENT_TERMS_CONTEXT_FIELDS: OrderField[] = [
  // Who the SO is for, beside the client's name.
  { column: "client_code", label: "Client Code", type: "text" },
  ...SO_CONTEXT_FIELDS,
  { column: "payment_terms", label: "Payment Terms", type: "text" },
  // What the payments are counted against: the value, and with GST at the
  // rate Accounts set (18% unless changed).
  { column: "order_value", label: "Order Value", type: "number" },
  { column: "order_value_gst", label: "Order Value (+GST)", type: "number" },
];


// Target Date for Drawing — an EC attribute (order_items) shown read-only in
// the Drawing workspace.
export const DRAWING_CONTEXT_FIELDS: OrderField[] = [
  ...SO_CONTEXT_FIELDS,
  { column: "drg_target_date", label: "Target Date for Drawing", type: "date" },
  // Drawing's own: when it says the SO's drawings will be ready (set on its page, with history).
  { column: "drg_readiness_date", label: "Drawing Readiness Date", type: "date" },
  { column: "performance_curve_required", label: "Performance Curve", type: "select", options: YES_NO },
  // The EC itself, beside its drawings.
  { column: "ec_date", label: "EC Date", type: "date", from: "order_items" },
  { column: "pump_type", label: "Pump Type", type: "text", from: "order_items" },
  { column: "model_no", label: "Model No.", type: "text", from: "order_items" },
];

// QC target date — SO-level, in Purchase Order Details. Shown read-only in
// the QC workspace.
export const QC_CONTEXT_FIELDS: OrderField[] = [
  ...SO_CONTEXT_FIELDS,
  { column: "qc_doc_target_date", label: "Quality Target Date", type: "date" },
  // Which documents the SO needs, and the EC itself.
  ...QC_DOC_FIELDS,
  { column: "ec_date", label: "EC Date", type: "date", from: "order_items" },
  { column: "pump_type", label: "Pump Type", type: "text", from: "order_items" },
  { column: "model_no", label: "Model No.", type: "text", from: "order_items" },
];

// BOI, Purchase target, and LD / LD Date (all SO-level, on orders) shown
// read-only in the Purchase workspace.
export const PURCHASE_CONTEXT_FIELDS: OrderField[] = [
  ...SO_CONTEXT_FIELDS,
  { column: "boi", label: "BOI", type: "select", options: YES_NO },
  { column: "purchase_target_date", label: "Target Date for Purchase", type: "date" },
  { column: "ld", label: "LD", type: "select", options: YES_NO },
  { column: "ld_date", label: "LD Date", type: "date" },
];

// Target Date for Packing Team (SO-level) shown read-only in the Assembly &
// Packing workspace.
export const ASSEMBLY_CONTEXT_FIELDS: OrderField[] = [
  ...SO_CONTEXT_FIELDS,
  {
    column: "dispatch_team_target_date",
    label: "Target Date for Packing Team",
    type: "date",
  },
  // Billing / Tax Invoice or Challan / FR — what the SO goes out on.
  { column: "bill_mode", label: "Bill Mode", type: "select", options: BILL_MODE_OPTIONS },
  // Planning schedules the assembly; Assembly & Packing works to that date, so
  // it's mirrored here read-only (they're also notified when it's set).
  // A Spare has no assembly to plan: it is packed against its readiness lots.
  {
    column: "assembly_date",
    label: "Assembly Date",
    type: "date",
    from: "order_planning",
    dependsOn: [{ column: "item_type", value: "Spare", not: true }],
  },
  {
    column: "assembly_remarks",
    label: "Assembly Remarks",
    type: "text",
    from: "order_planning",
    dependsOn: [{ column: "item_type", value: "Spare", not: true }],
  },
];

// Dispatch dates (SO-level, on orders) shown read-only in the Planning
// workspace, so Planning sees the dates it must schedule to.
export const PLANNING_CONTEXT_FIELDS: OrderField[] = [
  ...SO_CONTEXT_FIELDS,
  { column: "dispatch_target_date", label: "Dispatch Target Date", type: "date" },
  // Liquidated damages and the bought-out flag drive how Planning schedules an
  // SO — an LD date is a hard deadline, and BOI = Yes means waiting on Purchase.
  { column: "ld", label: "LD", type: "select", options: YES_NO },
  { column: "ld_date", label: "LD Date", type: "date" },
  { column: "boi", label: "BOI", type: "select", options: YES_NO },
  // Billing / Tax Invoice or Challan / FR — what the SO goes out on.
  { column: "bill_mode", label: "Bill Mode", type: "select", options: BILL_MODE_OPTIONS },
  // When the SO reached PPC (Central fills it under Handover).
  { column: "so_handover_date", label: "SO Sent to PPC Date", type: "date" },
];

/** Coerce a raw form string to the storable value for a field type. */
export function coerceField(
  type: OrderFieldType,
  raw: string | undefined
): string | number | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  if (type === "int") {
    const n = Number.parseInt(trimmed, 10);
    return Number.isNaN(n) ? null : n;
  }
  if (type === "number") {
    const n = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (type === "multiselect") return joinMulti(splitMulti(trimmed)) || null;
  return trimmed; // text, select, or date as 'YYYY-MM-DD'
}
