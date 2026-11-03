// A spare order's quotation (user, 2026-11-04). A spare has no tags or technical
// step: on the Commercial page it has a reference PO, then pump models (code built
// or picked), and per model the parts quoted with quantity and unit price. Stored
// whole on projects.spare_quote, so a new version copies it. Client-safe.
import { type CommercialPrices, type QuotationSnapshot } from "./commercial";
import { partsFromFieldsOrNull, type CodeParts } from "./pump-code";

export type SpareLine = {
  partNo: string;
  partName: string;
  qty: number | null;
  unitPrice: number | null;
};

export type SpareModel = {
  id: string;
  productCode: string;
  /** The code's parts when it was built with the code builder, else null. */
  codeParts: CodeParts | null;
  /** Which parts list this model picks from. */
  pumpKind: "PCP" | "MMP";
  lines: SpareLine[];
};

export type SpareQuote = {
  poNo: string;
  /** YYYY-MM-DD, or "". */
  poDate: string;
  models: SpareModel[];
};

export const EMPTY_SPARE_QUOTE: SpareQuote = { poNo: "", poDate: "", models: [] };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const amountOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Always read and save through this: keeps only what the quote should hold. */
export function normalizeSpareQuote(raw: unknown): SpareQuote {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const models = Array.isArray(r.models) ? r.models : [];
  const poDate = text(r.poDate, 10);
  return {
    poNo: text(r.poNo, 120),
    poDate: /^\d{4}-\d{2}-\d{2}$/.test(poDate) ? poDate : "",
    models: models.slice(0, 100).map((m, i) => {
      const x = (m ?? {}) as Record<string, unknown>;
      const lines = Array.isArray(x.lines) ? x.lines : [];
      return {
        id: text(x.id, 60) || `model-${i}`,
        productCode: text(x.productCode, 100),
        codeParts: partsFromFieldsOrNull(x.codeParts),
        pumpKind: x.pumpKind === "MMP" ? ("MMP" as const) : ("PCP" as const),
        lines: lines.slice(0, 200).map((l) => {
          const y = (l ?? {}) as Record<string, unknown>;
          return {
            partNo: text(y.partNo, 40),
            partName: text(y.partName, 200),
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
export const quoteTotal = (q: SpareQuote): number => q.models.reduce((s, m) => s + modelTotal(m), 0);

/** What stops the quote going to the client, or null. */
export function spareQuoteProblem(q: SpareQuote): string | null {
  const parts = q.models.flatMap((m) => m.lines);
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
export function spareSnapshot(q: SpareQuote): QuotationSnapshot {
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
  return { tags, grandTotal: quoteTotal(q), spare: { poNo: q.poNo, poDate: q.poDate } };
}
