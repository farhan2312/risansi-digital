// A spare order's quotation (user, 2026-11-04). A spare has no tags or technical
// step: on the Commercial page it has pump models (code built or picked), and per
// model the parts quoted with quantity, unit price and (ticked) reference PO. Stored
// whole on projects.spare_quote, so a new version copies it. Client-safe.
import { type CommercialPrices, type QuotationSnapshot } from "./commercial";
import type { SparePumpKind } from "./spare-parts";
import { SPARE_TERM_IDS, type TermsMarket } from "./spare-terms";

export type SpareLine = {
  partNo: string;
  partName: string;
  /** The part's reference PO (with the Reference PO tick; user, 2026-11-11 - was one
   *  for the whole quote). "" when none. */
  poNo: string;
  /** YYYY-MM-DD, or "". */
  poDate: string;
  qty: number | null;
  unitPrice: number | null;
};

export type SpareModel = {
  id: string;
  /** Picked from the product code list, or typed as it is. */
  productCode: string;
  /** Which parts list this model picks from (OTHER: none, parts typed by hand). */
  pumpKind: SparePumpKind;
  lines: SpareLine[];
};

export type SpareQuote = {
  /** Ticked: each part has its reference PO No. / date, printed per row. Unticked: none. */
  hasPo: boolean;
  /** % off the total of all parts; null = none. */
  discountPct: number | null;
  /** Printed under the totals. */
  note: string;
  /** Which terms and conditions the document uses (lib/spare-terms.ts). */
  termsMarket: TermsMarket;
  /** The terms unticked; all the others print. */
  termsOff: string[];
  models: SpareModel[];
};

/** Edits typed on the document, row by row; a value left out follows the quote.
 *  Document only: the saved quote and its prices don't change. */
export type SpareDocEdits = {
  client?: string;
  enquiry?: string;
  quotation?: string;
  subject?: string;
  greeting?: string;
  opening?: string;
  /** Before 2026-11-11: one PO text for every row (now per row, lines[key].po). Unused. */
  po?: string;
  discount?: string;
  note?: string;
  /** Model id -> the text printed for the model. */
  models?: Record<string, string>;
  /** Line key (spareDocLineKey) -> its cells. */
  lines?: Record<string, { partNo?: string; name?: string; po?: string; qty?: string; unit?: string }>;
  /** Line keys left off the document. */
  removed?: string[];
  /** Term id -> its wording on the document. */
  terms?: Record<string, string>;
};

export const spareDocLineKey = (modelId: string, l: { partNo: string; partName: string }) => `${modelId}|${l.partNo}|${l.partName}`;

export function normalizeSpareDocEdits(raw: unknown): SpareDocEdits {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const out: SpareDocEdits = {};
  for (const k of ["client", "enquiry", "quotation", "po", "discount"] as const) {
    const v = str(r[k], 300);
    if (v !== undefined) out[k] = v;
  }
  for (const k of ["subject", "greeting", "opening", "note"] as const) {
    const v = str(r[k], 2000);
    if (v !== undefined) out[k] = v;
  }
  if (r.models && typeof r.models === "object") {
    const models: Record<string, string> = {};
    for (const [id, v] of Object.entries(r.models as Record<string, unknown>).slice(0, 100)) {
      const s = str(v, 200);
      if (s !== undefined) models[id.slice(0, 60)] = s;
    }
    if (Object.keys(models).length) out.models = models;
  }
  if (r.lines && typeof r.lines === "object") {
    const lines: NonNullable<SpareDocEdits["lines"]> = {};
    for (const [key, v] of Object.entries(r.lines as Record<string, unknown>).slice(0, 2000)) {
      const c = (v ?? {}) as Record<string, unknown>;
      const cell: { partNo?: string; name?: string; po?: string; qty?: string; unit?: string } = {};
      for (const f of ["partNo", "name", "po", "qty", "unit"] as const) {
        const s = str(c[f], 200);
        if (s !== undefined) cell[f] = s;
      }
      if (Object.keys(cell).length) lines[key.slice(0, 320)] = cell;
    }
    if (Object.keys(lines).length) out.lines = lines;
  }
  if (Array.isArray(r.removed)) {
    const removed = r.removed.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 320)).slice(0, 2000);
    if (removed.length) out.removed = removed;
  }
  if (r.terms && typeof r.terms === "object") {
    const terms: Record<string, string> = {};
    for (const [id, v] of Object.entries(r.terms as Record<string, unknown>)) {
      const s = str(v, 6000);
      if (s !== undefined && SPARE_TERM_IDS.has(id)) terms[id] = s;
    }
    if (Object.keys(terms).length) out.terms = terms;
  }
  return out;
}

export const EMPTY_SPARE_QUOTE: SpareQuote = { hasPo: false, discountPct: null, note: "", termsMarket: "domestic", termsOff: [], models: [] };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const amountOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Always read and save through this: keeps only what the quote should hold.
 *  defaultMarket: for a quote that hasn't chosen its terms yet. */
export function normalizeSpareQuote(raw: unknown, defaultMarket: TermsMarket = "domestic"): SpareQuote {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const models = Array.isArray(r.models) ? r.models : [];
  const ymd = (v: unknown) => {
    const s = text(v, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  };
  // Quotes from before the tick: ticked when they have a PO. Quotes from before the
  // PO went per part: the quote's one PO goes on every part.
  const hasPo = r.hasPo === undefined ? Boolean(text(r.poNo, 120)) : r.hasPo === true;
  const oldPoNo = text(r.poNo, 120);
  const oldPoDate = ymd(r.poDate);
  const discountPct = amountOrNull(r.discountPct);
  const termsOff = Array.isArray(r.termsOff) ? r.termsOff.filter((x): x is string => typeof x === "string" && SPARE_TERM_IDS.has(x)) : [];
  return {
    hasPo,
    discountPct: discountPct !== null && discountPct <= 100 ? discountPct : null,
    note: text(r.note, 2000),
    termsMarket: r.termsMarket === "domestic" || r.termsMarket === "export" ? r.termsMarket : defaultMarket,
    termsOff: [...new Set(termsOff)].sort(),
    models: models.slice(0, 100).map((m, i) => {
      const x = (m ?? {}) as Record<string, unknown>;
      const lines = Array.isArray(x.lines) ? x.lines : [];
      return {
        id: text(x.id, 60) || `model-${i}`,
        productCode: text(x.productCode, 100),
        pumpKind: x.pumpKind === "MMP" || x.pumpKind === "OTHER" ? x.pumpKind : ("PCP" as const),
        lines: lines.slice(0, 200).map((l) => {
          const y = (l ?? {}) as Record<string, unknown>;
          return {
            partNo: text(y.partNo, 40),
            partName: text(y.partName, 200),
            poNo: !hasPo ? "" : y.poNo === undefined ? oldPoNo : text(y.poNo, 120),
            poDate: !hasPo ? "" : y.poDate === undefined ? oldPoDate : ymd(y.poDate),
            qty: amountOrNull(y.qty),
            unitPrice: amountOrNull(y.unitPrice),
          };
        }),
      };
    }),
  };
}

export const lineAmount = (l: Pick<SpareLine, "qty" | "unitPrice">): number => (l.qty ?? 0) * (l.unitPrice ?? 0);
export const modelTotal = (m: SpareModel): number => m.lines.reduce((s, l) => s + lineAmount(l), 0);
/** The parts added up, before the discount. */
export const quoteSubtotal = (q: SpareQuote): number => q.models.reduce((s, m) => s + modelTotal(m), 0);
export const quoteDiscount = (q: SpareQuote): number => (quoteSubtotal(q) * (q.discountPct ?? 0)) / 100;
/** The grand total: after the discount. */
export const quoteTotal = (q: SpareQuote): number => quoteSubtotal(q) - quoteDiscount(q);

/** What stops the quote going to the client, or null. */
export function spareQuoteProblem(q: SpareQuote): string | null {
  const parts = q.models.flatMap((m) => m.lines);
  if (q.hasPo && parts.some((l) => Boolean(l.poNo) !== Boolean(l.poDate))) return "Enter both the reference PO No. and date of a part, or neither.";
  if (parts.length === 0) return "Add a model and its parts first.";
  if (q.models.some((m) => m.lines.length === 0)) return "Every model needs at least one part.";
  if (parts.some((l) => !l.qty || l.unitPrice === null)) return "Enter the quantity and unit price of every part.";
  return null;
}

const NO_PRICES: CommercialPrices = {
  paPrice: null,
  motorPrice: null,
  gearboxPrice: null,
  vfdPrice: null,
  mechSealPrice: null,
  strainerPrice: null,
  prvPrice: null,
  drpPrice: null,
  vfdModel: null,
  drpModel: null,
  others: [],
  remarks: "",
};

/** The quote as a quotation version's frozen copy: one row per part, so version
 *  lists and Client Quoted Prices read it like any other quotation. */
export function spareSnapshot(q: SpareQuote, edits?: SpareDocEdits): QuotationSnapshot {
  const tags = q.models.flatMap((m) =>
    m.lines.map((l) => ({
      tagName: [l.partNo, l.partName].filter(Boolean).join(" · "),
      productCode: m.productCode || null,
      model: m.productCode || null,
      quantity: l.qty,
      prices: { ...NO_PRICES, paPrice: l.unitPrice },
      unit: l.unitPrice ?? 0,
      sub: lineAmount(l),
    })),
  );
  return { tags, grandTotal: quoteTotal(q), spare: { quote: q, edits: edits ?? {} } };
}
