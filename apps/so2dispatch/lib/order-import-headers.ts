/**
 * The daily import sheet's header row, in order. Shared by the client-side
 * import screen (which lists them) and the template download route (which
 * writes them) so the two can't drift apart. Kept out of `order-import.ts`
 * because that module is server-only.
 */
export const TEMPLATE_HEADERS = [
  "Client code",
  "Quotation No",
  "So No",
  "SO Date",
  "Payment Terms Remarks",
  "LD (yes/no)",
  "LD Date",
  "Cust Po no",
  "Po Date",
  "Order Quantity",
  "Order Value",
  "Order Type",
] as const;
