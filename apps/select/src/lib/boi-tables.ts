// BOI Master — the simple editable tables (everything except VFD, which has
// its own route/tab): which tab each sits on, its fields and how a row is
// named in the audit log. Shared by /api/boi-master/table/[table] and the
// admin page. Client-safe.
import type { BoiFieldDef } from "./boi-master";

export type BoiTableKey = "drp-probe" | "drp-panel" | "shaft-dia" | "mech-seal";
export type BoiTableTab = "drp" | "shaft" | "mechseal";

export type BoiTableDef = {
  key: BoiTableKey;
  tab: BoiTableTab;
  title: string;
  subtitle: string;
  fields: BoiFieldDef[];
  /** Names a row in audit entries. */
  label: (r: Record<string, unknown>) => string;
};

export const BOI_TABLES: BoiTableDef[] = [
  {
    key: "drp-probe",
    tab: "drp",
    title: "RTD Probe",
    subtitle: "RTD Probe With thread + 5 MTR. Wire — rate per nos by size. The smallest size ≥ the model's shaft dia is used.",
    fields: [
      { key: "srNo", label: "Sr No", kind: "integer" },
      { key: "description", label: "Description", kind: "text", required: true, max: 200 },
      { key: "sizeMm", label: "Size (MM)", kind: "number", required: true },
      { key: "ratePerNos", label: "Rate per Nos (INR)", kind: "number" },
      { key: "wefDate", label: "W.E.F", kind: "date" },
    ],
    label: (r) => `RTD probe ${Number(r.sizeMm)} mm`,
  },
  {
    key: "drp-panel",
    tab: "drp",
    title: "RTD Panel",
    subtitle: "One panel with every DRP, whatever the probe size.",
    fields: [
      { key: "srNo", label: "Sr No", kind: "integer" },
      { key: "description", label: "Description", kind: "text", required: true, max: 200 },
      { key: "appliesTo", label: "Applies To", kind: "text", max: 200 },
      { key: "ratePerNos", label: "Rate per Nos (INR)", kind: "number" },
      { key: "wefDate", label: "W.E.F", kind: "date" },
    ],
    label: (r) => String(r.description ?? "RTD panel"),
  },
  {
    key: "shaft-dia",
    tab: "shaft",
    title: "Shaft Dia by Pump Model",
    subtitle: "One row per pump model. Blank = not known yet (DRP can't be suggested for that model).",
    fields: [
      { key: "model", label: "Model", kind: "text", required: true, max: 100 },
      { key: "shaftDia", label: "Shaft Dia (mm)", kind: "number" },
    ],
    label: (r) => String(r.model ?? "model"),
  },
  {
    key: "mech-seal",
    tab: "mechseal",
    title: "Mechanical Seal",
    subtitle:
      "ACME price list (25-03-2026). Picked by the seal type (SCG, DCG, MSA → N SERIES, MSK → K SERIES) and the pump's shaft dia.",
    fields: [
      { key: "make", label: "Make", kind: "text", required: true, max: 60 },
      { key: "series", label: "Series", kind: "text", required: true, max: 30 },
      { key: "drawingNo", label: "Drawing No.", kind: "text", required: true, max: 60 },
      { key: "shaftSizeInch", label: "Shaft (inch)", kind: "text", max: 20 },
      { key: "shaftSizeMm", label: "Shaft (mm)", kind: "number", required: true },
      { key: "type", label: "Type", kind: "text", max: 20 },
      { key: "material304", label: "Material /304", kind: "text", max: 60 },
      { key: "price304", label: "Price /304 (INR)", kind: "number" },
      { key: "material316", label: "Material /316", kind: "text", max: 60 },
      { key: "price316", label: "Price /316 (INR)", kind: "number" },
      { key: "priceListDate", label: "Price List Date", kind: "date" },
    ],
    label: (r) => `${r.make} ${r.drawingNo}`,
  },
];

export const boiTable = (key: string) => BOI_TABLES.find((t) => t.key === key) ?? null;
