// BOI Master, VFD tab: the editable fields of a boi_vfd row and the body
// validation shared by POST /api/boi-master/vfd and PATCH …/[id].
// Client-safe (no DB import) — the admin page uses the same field list.
import { type BoiFieldDef, parseBoiBody } from "./boi-master";

/** In the order of the ABB price list's columns, then the list details. */
export const VFD_FIELDS: BoiFieldDef[] = [
  { key: "driveDescription", label: "Drive Description", kind: "text", required: true, max: 100 },
  { key: "frame", label: "Frame", kind: "text", max: 20 },
  { key: "pnKw", label: "Nominal P_N (kW)", kind: "number" },
  { key: "inA", label: "Nominal I_N (A)", kind: "number" },
  { key: "pldKw", label: "Light Duty P_LD (kW)", kind: "number" },
  { key: "ildA", label: "Light Duty I_LD (A)", kind: "number" },
  { key: "phdKw", label: "Heavy Duty P_HD (kW)", kind: "number" },
  { key: "ihdA", label: "Heavy Duty I_HD (A)", kind: "number" },
  { key: "listPrice", label: "List Price (INR)", kind: "number" },
  { key: "discountPct", label: "Discount (%)", kind: "number", below: 100 },
  { key: "bopExtra", label: "BOP Extra per VFD (INR)", kind: "number" },
  { key: "make", label: "Make", kind: "text", required: true, max: 100 },
  { key: "series", label: "Series", kind: "text", max: 100 },
  { key: "supply", label: "Supply", kind: "text", max: 100 },
  { key: "priceListDate", label: "Price List Date", kind: "date" },
  { key: "remarks", label: "Remarks", kind: "text", max: 500 },
];

/** "ABB ACS560-01-017A-4" — names the row in audit entries. */
export const vfdLabel = (r: { make?: string | null; driveDescription?: string | null }): string =>
  [r.make, r.driveDescription].filter(Boolean).join(" ") || "row";

export const parseVfdBody = (body: Record<string, unknown>, create: boolean) =>
  parseBoiBody(VFD_FIELDS, body, create);
