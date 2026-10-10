// Reading an amount the way a person actually typed it.
//
// Two faults sat on top of each other here, and together they made the money
// fields lose or corrupt entry:
//
// 1. The inputs were `type="number"`. Per the HTML value-sanitisation algorithm,
//    a number input whose content isn't a valid floating-point number reports
//    "" — and browsers discard it when the field loses focus. Indian amounts are
//    written 1,50,000. So typing a real figure and pressing Tab wiped it. That
//    is the "data gets removed when I press Tab" report, exactly.
//
// 2. When a comma-bearing value did survive (a paste, or one of the text inputs
//    in the line-item grid), the server read it with a bare parseFloat.
//    parseFloat("1,50,000") is 1. Five opportunities are sitting in the database
//    with offer_value_inr = 1 because of this, four of them from the last ten
//    days. Silent, and worse than the clearing.
//
// Both are fixed by never using type="number" for money (see MoneyInput) and by
// routing every amount through parseMoneyInput on the way in.

/**
 * Parse an amount as typed: rupee signs, thousands separators (Western or
 * Indian grouping), stray spaces and non-breaking spaces all tolerated.
 *
 * Returns null for anything with no digits in it, so an empty field stays empty
 * rather than becoming 0 — a quote of ₹0 and a quote nobody filled in are
 * different facts.
 */
export function parseMoneyInput(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw)
    .replace(/[  \s]/g, '')   // spaces, incl. non-breaking / narrow
    .replace(/[₹$,'_]/g, '');           // currency marks and every grouping char
  if (!s || !/\d/.test(s)) return null;
  // Keep one leading sign, digits and a single decimal point.
  const m = s.match(/^-?\d*\.?\d*/);
  const f = parseFloat(m?.[0] ?? '');
  return Number.isFinite(f) ? f : null;
}

/** Same, but for a value that must be positive to count as filled. */
export function parsePositiveMoney(raw: unknown): number | null {
  const v = parseMoneyInput(raw);
  return v != null && v > 0 ? v : null;
}

const CR = 10_000_000;

/** Rupees as typed → crores, for the value_cr / final_value_cr columns. */
export function moneyToCr(raw: unknown): number | null {
  const v = parsePositiveMoney(raw);
  return v == null ? null : v / CR;
}

/**
 * Indian digit grouping — 1,50,000 not 150,000. Used for the live echo under a
 * money field so the figure being saved is legible while it is being typed.
 */
export function formatIndian(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  const neg = n < 0;
  const [whole, dec] = Math.abs(n).toFixed(2).replace(/\.00$/, '').split('.');
  // Last three digits, then pairs.
  const head = whole.slice(0, -3);
  const tail = whole.slice(-3);
  const grouped = head ? head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + tail : tail;
  return `${neg ? '-' : ''}${grouped}${dec ? '.' + dec : ''}`;
}
