// Revised-offer history for a quotation. A quote can be re-priced any number of
// times; each re-price is one row here, with the date it happened on. See
// migration 0041.
//
// Values are RUPEES on the wire and in the DB, matching
// opportunities.offer_value_inr. (Crores are only used for value_cr /
// final_value_cr.)

export interface OfferRevisionInput {
  value_inr: number;
  revised_on: string;   // YYYY-MM-DD
  note: string | null;
}

export interface OfferRevision {
  id: number;
  value_inr: number;
  revised_on: string;
  note: string | null;
  created_by: string | null;
  created_at: string | null;
}

/** Loose shape the forms post — every field a string, straight off the inputs. */
export interface OfferRevisionRow {
  value_inr: string;
  revised_on: string;
  note: string;
}

export const blankOfferRevision = (): OfferRevisionRow => ({ value_inr: '', revised_on: '', note: '' });

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Parse the `offer_revisions_json` a quotation form submits: an array of
 * { value_inr, revised_on, note }. A wholly untouched row is dropped; a row
 * with an amount but no date (or the reverse) is an error, because a revision
 * without its date isn't a history. Rows come back sorted oldest-first so the
 * last one is always the current price.
 */
export function parseOfferRevisionsJson(raw: unknown): { rows: OfferRevisionInput[]; error: string | null } {
  let arr: unknown[] = [];
  try { const p = JSON.parse(typeof raw === 'string' ? raw : '[]'); if (Array.isArray(p)) arr = p; } catch { /* ignore */ }

  const rows: OfferRevisionInput[] = [];
  for (const it of arr) {
    const o    = (it ?? {}) as Record<string, unknown>;
    const date = String(o.revised_on ?? '').trim();
    const note = String(o.note ?? '').trim();
    const inr  = parseFloat(String(o.value_inr ?? '').replace(/[^0-9.\-]/g, ''));
    const hasInr = Number.isFinite(inr);

    if (!hasInr && !date && !note) continue;                  // an untouched row
    if (!hasInr || inr <= 0) {
      return { rows: [], error: 'Every revised offer needs an amount greater than zero.' };
    }
    if (!ISO_DATE.test(date)) {
      return { rows: [], error: 'Every revised offer needs a valid date (YYYY-MM-DD).' };
    }
    // offer_value_inr is a bare numeric, but an absurd figure is far more likely
    // to be a typo (an extra zero) than a real quote.
    if (inr >= 1e13) {
      return { rows: [], error: 'That revised offer is unrealistically large — please check it.' };
    }
    rows.push({ value_inr: inr, revised_on: date, note: note || null });
  }

  rows.sort((a, b) => (a.revised_on < b.revised_on ? -1 : a.revised_on > b.revised_on ? 1 : 0));
  return { rows, error: null };
}

/** The current price: the newest revision if there is one, else the original offer. */
export function currentOfferInr(
  offerInr: number | null | undefined,
  revisions: { value_inr: number }[],
): number | null {
  if (revisions.length) return revisions[revisions.length - 1].value_inr;
  return offerInr ?? null;
}

/** Percentage move from one figure to the next, or null when it can't be computed. */
export function revisionDeltaPct(from: number | null | undefined, to: number): number | null {
  if (from == null || !Number.isFinite(from) || from <= 0) return null;
  return ((to - from) / from) * 100;
}

/** Rupees → a compact USD string at the given rate. Mirrors fmtUsdFromCr's shape. */
export function fmtUsdFromInr(inr: number | null | undefined, rate: number): string {
  const n = Number(inr ?? 0);
  if (!n || !Number.isFinite(n) || !rate || rate <= 0) return '—';
  const usd = n / rate;
  if (usd >= 1_000_000) return '$' + (usd / 1_000_000).toFixed(2) + 'M';
  if (usd >= 1_000)     return '$' + (usd / 1_000).toFixed(1) + 'K';
  return '$' + Math.round(usd).toLocaleString('en-US');
}
