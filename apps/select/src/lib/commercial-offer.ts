/**
 * The Commercial Offer sheet — the Risansi quotation format's commercial part,
 * one column per tag of a drive group, priced from the Commercial Summary:
 *
 *   letterhead · "Risansi Industries Limited - Commercial Offer"
 *   Client Name · Enquiry No. & Date | Quotation No. & Date
 *   Commercial Offer band:
 *     Drive Motor · Gear Box (geared groups) · [VFD] · Mechanical Seal ·
 *     [Strainer · PRV] · DRP with Panel · one row per Other BOI item (by name)
 *     · Pump with Accessories · Unit Price INR (as per scope of supply) ·
 *     Sub-Total Price INR (as per scope of supply)
 *   Scope of supply :- …   (red)
 *   Out Of Scope :- …
 *
 * Every BOI row (motor, gear box, VFD, mechanical seal, strainer, PRV, DRP,
 * each named Other item) shows only when some tag on the sheet has a price
 * for it (user, 2026-10-05).
 * Optional rows (Quantity, BOI total, total of all tags) are ticked per sheet.
 * Edits (projects.commercial_offer_config, per drive group) change the
 * document only — never the saved prices. Each quotation version freezes its
 * sheet edits along with its prices (QuotationSnapshot.offer).
 *
 * Client-safe (no DB / DOM): the modal, print and Excel all build from here.
 */
import { boiNet, boiTotal, otherNet, type CommercialPrices, type DriveGroup, type TagTech } from "./commercial";
import { esc, headerHiddenList, sheetHtml, type HeaderKey, type TechDocHeader, type TechDocRow } from "./tech-doc";

export const OFFER_TITLE = "Commercial Offer";

// Scope of supply / Out of scope: multi-select lists from one item pool (an
// item is in one list or the other, never both). Defaults = the format's two
// lines; Gear Box is only in the default scope of a geared sheet.
export const SCOPE_ITEMS = [
  "Pump With Base-Plate",
  "Pump Pulley",
  "Motor Pulley",
  "Driven Coupling",
  "Foundation & Grouting Bolts",
  "V-Belts",
  "Coupling & Motor Guard",
  "Matching Flange",
  "(For Suc. & Delivery) Gasket & Fasteners",
  "Gear Box",
  "Motor",
  "DRP",
  "Starter",
  "VFD",
  "VFD Panel",
  "3PTC Thermistor",
  "VPI Treatment",
];
export const DEFAULT_OUT_OF_SCOPE_ITEMS = ["Starter", "VFD", "VFD Panel", "3PTC Thermistor", "VPI Treatment"];
/** V-Belt sheets (user's format, 2026-10-08). */
export const VBELT_SCOPE_ITEMS = ["Pump With Base-Plate", "Pump Pulley", "Motor Pulley", "Foundation & Grouting Bolts", "V-Belts", "Motor"];
const VBELT_ONLY = new Set(["Pump Pulley", "Motor Pulley", "V-Belts"]);
/** The default scope of supply for a drive group's sheet. */
export const defaultScopeItems = (group: string | null | undefined): string[] =>
  group === "VB"
    ? VBELT_SCOPE_ITEMS
    : SCOPE_ITEMS.filter(
        (i) => !DEFAULT_OUT_OF_SCOPE_ITEMS.includes(i) && !VBELT_ONLY.has(i) && (isGearedGroup(group) || i !== "Gear Box"),
      );

/** One tag column: its saved prices and totals. */
export interface OfferTag {
  tagId: string;
  tagName: string;
  prices: CommercialPrices;
  quantity: number | null;
  /** Liquid / pump type / pump speed / motor kW (as on the Technical Data Sheet). */
  tech?: TagTech;
  /** The product code (else the pump model) — the "Pump Model" row. */
  pumpModel?: string | null;
  /** Unit price (P&A + all BOI). */
  unit: number;
  /** unit × quantity. */
  sub: number;
}

/** One printable Commercial Offer: one drive group's tags. */
export interface OfferSheet {
  projectCode: string;
  header: TechDocHeader;
  tags: OfferTag[];
  config: OfferConfig;
  /** Gear Box rows/labels apply (GM / GB). */
  geared: boolean;
  /** The sheet's drive group (GM / GB / VB / DD) — picks the default scope. */
  driveGroup?: string;
  /** Drive group code for the file name when the enquiry mixes drives. */
  group?: string;
  /** e.g. "Internal V2" — for the file name of a version's sheet. */
  versionLabel?: string;
}

export const isGearedGroup = (g: DriveGroup | string | null | undefined) => g === "GM" || g === "GB";

/** GET /api/commercial-offer: the sheet header lines and each drive group's saved edits.
 *  The tag columns (prices) come from the Commercial Summary / a version. */
export interface CommercialOfferData {
  projectCode: string;
  clientName: string;
  /** "RIL/EN/26-27/1780, Dt. 24.09.2026" */
  enquiry: string;
  mixed: boolean;
  /** Drive group → "RIL/QT/…/PCP/6000[/GM], Dt. …" (groups with a quotation). */
  quotations: Record<string, string>;
  /** Drive group → the quotation's ERP number (only when an ERP serial is entered). */
  erpNumbers: Record<string, string>;
  configs: Record<string, OfferConfig>;
}

// --- Rows -------------------------------------------------------------------

const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const money = (n: number | null | undefined): string => (n === null || n === undefined ? "" : INR.format(n));

interface OfferField {
  key: string;
  label: (geared: boolean) => string;
  /** Optional row — only when ticked. */
  extra?: boolean;
  /** Only on a geared sheet (Gear Box). */
  gearedOnly?: boolean;
  /** Only when some tag has a value (VFD, Strainer, PRV, Other items). */
  whenPriced?: boolean;
  /** One value for the whole sheet, across the tag columns. */
  span?: boolean;
  value: (t: OfferTag) => string;
  /** span rows: the sheet value from all tags. */
  sheetValue?: (tags: OfferTag[]) => string;
  /** Expands into one row per named Other BOI item. */
  perOther?: boolean;
}

// BOI rows show the QUOTED price (after vendor discount and markup).

/** Row key for a named Other BOI item ("Coupling guard" → "o_coupling_guard"). */
const otherKey = (name: string) =>
  `o_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "item"}`;

/** One row per named Other BOI item across the sheet's tags (first-seen
 *  order); each tag's cell is its quoted price for that item, blank if none. */
function otherItemRows(tags: OfferTag[]): { key: string; name: string; values: string[] }[] {
  const names = new Map<string, string>();
  for (const t of tags) for (const o of t.prices.others ?? []) if (o.name.trim() && !names.has(otherKey(o.name))) names.set(otherKey(o.name), o.name.trim());
  return [...names].map(([key, name]) => ({
    key,
    name,
    values: tags.map((t) => {
      const items = (t.prices.others ?? []).filter((o) => otherKey(o.name) === key && o.price !== null);
      return items.length ? money(items.reduce((sum, o) => sum + (otherNet(t.prices, o) ?? 0), 0)) : "";
    }),
  }));
}

/** In sheet order (the format's rows, with the optional ones in place). */
export const OFFER_FIELDS: OfferField[] = [
  // Technical lines, right after the tag row (user, 2026-10-05).
  { key: "t_liquid", label: () => "Liquid / Application", value: (t) => t.tech?.liquid ?? "" },
  { key: "t_qty", label: () => "Quantity", value: (t) => (t.quantity === null ? "" : String(t.quantity)) },
  { key: "t_pumpModel", label: () => "Pump Model", value: (t) => t.pumpModel ?? "" },
  { key: "t_motorKw", label: () => "Drive Motor Rating", value: (t) => t.tech?.motorKw ?? "" },
  { key: "motor", label: () => "Drive Motor Price In Unit (INR)", whenPriced: true, value: (t) => money(boiNet(t.prices, "motorPrice")) },
  { key: "gearbox", label: () => "Gear Box Price In Unit (INR)", gearedOnly: true, whenPriced: true, value: (t) => money(boiNet(t.prices, "gearboxPrice")) },
  { key: "vfd", label: () => "VFD Price In Unit (INR)", whenPriced: true, value: (t) => money(boiNet(t.prices, "vfdPrice")) },
  { key: "mechSeal", label: () => "Mechanical Seal Price In Unit (INR)", whenPriced: true, value: (t) => money(boiNet(t.prices, "mechSealPrice")) },
  { key: "strainer", label: () => "Strainer Price In Unit (INR)", whenPriced: true, value: (t) => money(boiNet(t.prices, "strainerPrice")) },
  { key: "prv", label: () => "PRV Price In Unit (INR)", whenPriced: true, value: (t) => money(boiNet(t.prices, "prvPrice")) },
  { key: "drp", label: () => "DRP with Panel (Probe type) IN unit Price", whenPriced: true, value: (t) => money(boiNet(t.prices, "drpPrice")) },
  // One row per Other BOI item, by its name ("Coupling guard Price In Unit (INR)").
  { key: "others", label: () => "Other Items", perOther: true, value: () => "" },
  {
    key: "x_boi",
    label: () => "BOI Items Total In Unit (INR)",
    extra: true,
    value: (t) => money(boiTotal({ ...t.prices, others: t.prices.others ?? [] })),
  },
  { key: "pa", label: () => "Pump with Accessories Unit Price (INR)", value: (t) => money(t.prices.paPrice) },
  { key: "unit", label: () => "Unit Price INR (as per scope of supply)", value: (t) => money(t.unit) },
  { key: "qtyPrice", label: () => "Sub-Total Price INR (as per scope of supply)", value: (t) => money(t.sub) },
  {
    key: "x_total",
    label: () => "Total Price (INR)",
    extra: true,
    span: true,
    value: () => "",
    sheetValue: (tags) => money(tags.reduce((s, t) => s + t.sub, 0)),
  },
];

export const OFFER_EXTRAS = OFFER_FIELDS.filter((f) => f.extra);
const OFFER_EXTRA_KEYS = new Set(OFFER_EXTRAS.map((f) => f.key));

// --- Per-sheet customisation -------------------------------------------------

export interface OfferCustomRow {
  id: string;
  section: string;
  label: string;
  values: Record<string, string>;
}

/** Saved per enquiry and drive group. Same edit model as the Technical Data
 *  Sheet (TechDocEditor), plus the two scope lists (null = the default). */
export interface OfferConfig {
  extras: string[];
  hidden: string[];
  labels: Record<string, string>;
  values: Record<string, Record<string, string>>;
  custom: OfferCustomRow[];
  /** Scope of supply items, in order (null = the default). */
  scope: string[] | null;
  /** Out of scope items, in order (null = the default). */
  outOfScope: string[] | null;
  /** Items added by hand to this sheet's pool. */
  scopeExtra: string[];
  /** Header lines typed in for this sheet ("" / absent = automatic). */
  quotationText?: string;
  erpText?: string;
  /** Header lines removed from this sheet. */
  headerHidden?: HeaderKey[];
}

export const EMPTY_OFFER_CONFIG: OfferConfig = {
  extras: [],
  hidden: [],
  labels: {},
  values: {},
  custom: [],
  scope: null,
  outOfScope: null,
  scopeExtra: [],
};

const MAX_TEXT = 300;
const MAX_SCOPE_ITEM = 120;
const MAX_SCOPE_ITEMS = 40;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = MAX_TEXT): string => String(v ?? "").trim().slice(0, max);
const offerCustomKey = (id: string) => `c_${id}`;

export function normalizeOfferConfig(raw: unknown): OfferConfig {
  const r = isObj(raw) ? raw : {};
  const custom: OfferCustomRow[] = (Array.isArray(r.custom) ? r.custom : [])
    .filter(isObj)
    .map((c) => ({
      id: text(c.id).replace(/[^a-z0-9-]/gi, "").slice(0, 40),
      section: OFFER_TITLE,
      label: text(c.label),
      values: Object.fromEntries(Object.entries(isObj(c.values) ? c.values : {}).map(([k, v]) => [k.slice(0, 60), text(v)])),
    }))
    .filter((c) => c.id && c.label)
    .slice(0, 30);
  const fixedKeys = new Set([...OFFER_FIELDS.map((f) => f.key), ...custom.map((c) => offerCustomKey(c.id))]);
  // Other-item rows are keyed by name (o_…), so any such key is valid.
  const validKeys = { has: (k: string) => fixedKeys.has(k) || /^o_[a-z0-9_]{1,40}$/.test(k) };
  const keyList = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((k) => validKeys.has(k)))];
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(isObj(r.labels) ? r.labels : {})) if (validKeys.has(k) && text(v)) labels[k] = text(v);
  const values: Record<string, Record<string, string>> = {};
  for (const [k, perTag] of Object.entries(isObj(r.values) ? r.values : {})) {
    if (!validKeys.has(k) || !isObj(perTag)) continue;
    const m: Record<string, string> = {};
    for (const [tagId, v] of Object.entries(perTag)) m[tagId.slice(0, 60)] = text(v);
    if (Object.keys(m).length) values[k] = m;
  }
  // A list of items; an older free-text line is kept as one item.
  const scopeList = (v: unknown): string[] | null => {
    if (typeof v === "string") return text(v, MAX_SCOPE_ITEM) ? [text(v, MAX_SCOPE_ITEM)] : [];
    if (!Array.isArray(v)) return null;
    return [...new Set(v.map((x) => text(x, MAX_SCOPE_ITEM)).filter(Boolean))].slice(0, MAX_SCOPE_ITEMS);
  };
  return {
    extras: keyList(r.extras).filter((k) => OFFER_EXTRA_KEYS.has(k)),
    hidden: keyList(r.hidden),
    labels,
    values,
    custom,
    scope: scopeList(r.scope),
    outOfScope: scopeList(r.outOfScope),
    scopeExtra: scopeList(r.scopeExtra) ?? [],
    quotationText: text(r.quotationText),
    erpText: text(r.erpText),
    headerHidden: headerHiddenList(r.headerHidden),
  };
}

/** Stored commercial_offer_config ({groups: {GM: …}}) → one config per group. */
export function normalizeOfferConfigs(raw: unknown, groups: string[]): Record<string, OfferConfig> {
  const stored = isObj(raw) && isObj(raw.groups) ? raw.groups : {};
  return Object.fromEntries(groups.map((g) => [g, normalizeOfferConfig(stored[g])]));
}

// --- Build ------------------------------------------------------------------

export interface OfferBlock {
  title: string;
  rows: TechDocRow[];
}

/** The sheet's rows with the customisation applied (TechDocEditor reads the
 *  same row shape). Removed rows only with `includeHidden`. */
export function buildOffer(
  tags: OfferTag[],
  config: OfferConfig,
  geared: boolean,
  opts: { includeHidden?: boolean } = {},
): OfferBlock[] {
  const picked = new Set(config.extras);
  const hidden = new Set(config.hidden);
  const rows: TechDocRow[] = [];
  const finish = (key: string, kind: TechDocRow["kind"], autoLabel: string, autoValues: string[], span?: boolean) => {
    const edits = config.values[key] ?? {};
    // A whole-sheet row keys its one edit by "all".
    const ids = span ? ["all"] : tags.map((t) => t.tagId);
    const edited = ids.map((id) => Object.prototype.hasOwnProperty.call(edits, id));
    rows.push({
      key,
      kind,
      label: config.labels[key] || autoLabel,
      autoLabel,
      values: ids.map((id, i) => (edited[i] ? edits[id] : autoValues[i])),
      autoValues,
      edited,
      hidden: hidden.has(key),
      span,
    });
  };
  for (const f of OFFER_FIELDS) {
    if (f.perOther) {
      // Only items some tag has a price for.
      for (const o of otherItemRows(tags)) if (o.values.some(Boolean)) finish(o.key, "fixed", `${o.name} Price In Unit (INR)`, o.values);
      continue;
    }
    if (f.extra && !picked.has(f.key)) continue;
    if (f.gearedOnly && !geared) continue;
    const auto = f.span ? [f.sheetValue?.(tags) ?? ""] : tags.map(f.value);
    if (f.whenPriced && auto.every((v) => !v)) continue;
    finish(f.key, f.extra ? "extra" : "fixed", f.label(geared), auto, f.span);
  }
  for (const c of config.custom) finish(offerCustomKey(c.id), "custom", c.label, tags.map((t) => c.values[t.tagId] ?? ""));
  return [{ title: OFFER_TITLE, rows: opts.includeHidden ? rows : rows.filter((r) => !r.hidden) }];
}

/** The selected items of each list (the default when not changed). */
export const scopeItems = (c: OfferConfig, group: string | null | undefined): string[] => c.scope ?? defaultScopeItems(group);
export const outOfScopeItems = (c: OfferConfig): string[] => c.outOfScope ?? DEFAULT_OUT_OF_SCOPE_ITEMS;

/** Every item that can be picked: the standard pool, items added by hand, and
 *  anything already selected (e.g. an older free-text line). */
export const scopePool = (c: OfferConfig, group: string | null | undefined): string[] => [
  ...new Set([...SCOPE_ITEMS, ...c.scopeExtra, ...scopeItems(c, group), ...outOfScopeItems(c)]),
];

/** "A, B, C & D" — the scope line as the format writes it. */
export const offerScope = (c: OfferConfig, group: string | null | undefined): string => {
  const items = scopeItems(c, group);
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} & ${items[items.length - 1]}` : (items[0] ?? "");
};
/** "A + B + C" — the out-of-scope line as the format writes it. */
export const offerOutOfScope = (c: OfferConfig): string => outOfScopeItems(c).join(" + ");

// --- HTML (preview + print) ---------------------------------------------------

/** The sheet's drive group; older callers only said geared or not. */
export const sheetGroup = (sheet: OfferSheet): string | null => sheet.driveGroup ?? (sheet.geared ? "GB" : null);

export function buildOfferHtml(sheet: OfferSheet, logoUrl = "/logo.png"): string {
  const n = Math.max(sheet.tags.length, 1);
  const cols = n + 1;
  const [block] = buildOffer(sheet.tags, sheet.config, sheet.geared);
  const tagHead = `<tr class="tags"><th scope="row">Tag No.</th>${sheet.tags.map((t) => `<td>${esc(t.tagName)}</td>`).join("")}</tr>`;
  const rows = block.rows
    .map((r) =>
      r.span
        ? `<tr><th scope="row">${esc(r.label)}</th><td colspan="${n}"><b>${esc(r.values[0] || "-")}</b></td></tr>`
        : `<tr><th scope="row">${esc(r.label)}</th>${r.values.map((v) => `<td>${esc(v || "-")}</td>`).join("")}</tr>`,
    )
    .join("");
  const scope = offerScope(sheet.config, sheetGroup(sheet));
  const out = offerOutOfScope(sheet.config);
  const body =
    `<tr class="offer-band"><td colspan="${cols}">${esc(OFFER_TITLE)}</td></tr>` +
    tagHead +
    rows +
    (scope ? `<tr class="scope"><td colspan="${cols}">Scope of supply :- ${esc(scope)}</td></tr>` : "") +
    (out ? `<tr class="oos"><td colspan="${cols}">Out Of Scope :- ${esc(out)}</td></tr>` : "");
  return sheetHtml({
    projectCode: sheet.projectCode,
    title: OFFER_TITLE,
    header: sheet.header,
    tagCount: sheet.tags.length,
    body,
    logoUrl,
    css: `
  tr.offer-band td { background: #dcebfb; color: #0b3d7e; font-weight: bold; text-align: center; font-size: 10.5pt; padding: 6px; }
  tr.tags td { font-weight: bold; }
  tr.scope td { color: #c00000; font-weight: bold; font-style: italic; text-align: center; font-size: 9.5pt; padding: 6px; }
  tr.oos td { font-style: italic; text-align: center; font-size: 9pt; padding: 6px; }`,
  });
}
