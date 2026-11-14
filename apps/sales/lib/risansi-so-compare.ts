/**
 * What was quoted, against what was ordered.
 *
 * CLIENT-SAFE and pure. No database, no React, so the matching rule can be
 * read and argued with in one place rather than being buried in a component.
 *
 * THE TWO SIDES
 *
 * Quoted lines come from `opportunity_items` in this portal — pump model and
 * quantity, as the rep offered them. Ordered lines come from `order_items` in
 * the dispatch portal — model, quantity, EC number and pump serials, as the
 * SO was actually raised. Nothing links them but the model, so that is what
 * the match is made on.
 *
 * WHY THE MODEL HAS TO BE FOLDED FIRST
 *
 * The same pump is written several ways across the two systems, and twice on
 * one SO: SO26/1/949 carries both "RTOH8190ABCN" and "RTOH 8190ABCN", and
 * "RTOHAG8185ABCN" beside "RTOH AG8185 ABCN". Spaces, hyphens and case are
 * decoration here, so they come out before anything is compared. What is left
 * is still the model as somebody typed it — this does not try to parse the
 * model into its parts, because a fold that is too clever silently matches two
 * pumps that differ in the one character that mattered.
 */

export interface QuotedLine {
  model: string | null;
  qty: number | null;
  /** The offer value for the line, in rupees, when it was captured. */
  valueInr?: number | null;
}

export interface OrderedLineIn {
  soNo: string;
  model: string | null;
  qty: number | null;
  ecNo?: string | null;
  serials?: string | null;
}

/**
 * The models in one `pump_model` field.
 *
 * Quoted lines do not hold one model each. Some hold several, separated by a
 * newline or just a space: one line on a real quote reads
 * "RTOH6160L6BBBE-GP RTOH8185L6AB1B1N-GP RTOH8185L6AB1B1N-GP ..." against a
 * single quantity of 21. Treating that whole string as one model produces a
 * row nothing can ever match, which is how a comparison ends up saying
 * "nothing was ordered" about an order that was delivered.
 *
 * Splitting on whitespace alone would be worse: the dispatch portal writes the
 * same pump as "RTOH 8190ABCN" and "RTOHAG8185ABCN", so a space inside one
 * model is ordinary. The rule is therefore: a new model begins where a token
 * starts with letters followed by a digit AND what has been collected so far
 * already contains a digit — i.e. already looks like a whole model. "RTOH"
 * followed by "AG8185" keeps going; "…BBBE-GP" followed by "RTOH8185…" starts
 * a new one.
 */
export function splitModels(raw: string | null | undefined): string[] {
  const text = (raw ?? '').replace(/[,;]+/g, '\n');
  const out: string[] = [];
  for (const line of text.split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let cur = '';
    for (const part of trimmed.split(/\s+/)) {
      if (/^[A-Za-z]{2,}\d/.test(part) && cur && /\d/.test(cur)) { out.push(cur); cur = part; }
      else cur = cur ? `${cur} ${part}` : part;
    }
    if (cur) out.push(cur);
  }
  return out.filter(m => m.length >= 3);
}

/** Spaces, hyphens, dots and case are decoration in a pump model. */
export const foldModel = (m: string | null | undefined): string =>
  (m ?? '').toUpperCase().replace(/[\s\-._/]+/g, '');

export interface CompareRow {
  /** The model as the quote wrote it, or failing that as the SO did. */
  model: string;
  quotedQty: number | null;
  orderedQty: number | null;
  /** Ordered less quoted. Null when one side has nothing to compare. */
  diff: number | null;
  /** 'both', 'quoted-only' (ordered but not on the SO), 'ordered-only'. */
  side: 'both' | 'quoted-only' | 'ordered-only';
  /**
   * The quote listed this model together with others under one quantity, so
   * there is no number to put against it. The model still matches; the
   * quantity is unknown rather than zero.
   */
  quotedGrouped: boolean;
  /**
   * A model on the other side that is one or two characters away from this
   * one. Set on both rows of the pair. Never a match — just the observation
   * that RTOH6170L6AB1B1N-GP and RTOH6170LAB1B1N-GP differ by one character
   * and somebody should look.
   */
  nearMatch?: string;
  /** The SOs this model was ordered on. */
  soNos: string[];
  ecNos: string[];
  serials: string[];
}

/**
 * How many single-character edits turn one string into the other, giving up
 * past `cap`.
 *
 * Models are short and there are rarely more than a few dozen rows, so the
 * plain two-row algorithm is the right amount of machinery. The cap matters
 * more than the speed: past two edits these are different pumps, and a
 * "did you mean" that reaches further is a tool that invents matches.
 */
export function editDistance(a: string, b: string, cap = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], row[j - 1]);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * The size number in a model: RTOH6170L6AB1B1N-GP → "6170".
 *
 * This is what makes a pump that pump. Two models whose size numbers differ
 * are different pumps however few characters separate them — RTOH6170… and
 * RTOH8170… are one edit apart and are not the same thing — so no "did you
 * mean" may cross it.
 */
export function sizeOf(model: string): string {
  const m = foldModel(model).match(/^[A-Z]*([0-9]+)/);
  return m ? m[1] : '';
}

export interface CompareResult {
  rows: CompareRow[];
  quotedQty: number;
  orderedQty: number;
  /** True when every model lines up and the quantities agree. */
  matches: boolean;
  /** Models on one side only, for a one-line summary. */
  quotedOnly: number;
  orderedOnly: number;
  /** Models present on both sides where the quantities differ. */
  quantityDiffers: number;
  /** Pairs that are one or two characters apart — probably the same pump. */
  nearMatches: number;
}

/**
 * Line up the two sides on the folded model.
 *
 * Several quoted lines can carry the same model, and so can several ordered
 * lines across several SOs, so both sides are summed per model rather than
 * paired off row by row. Pairing rows would make the answer depend on the
 * order they happen to come back in, and two lines of the same pump is a
 * perfectly ordinary quote.
 */
export function compareQuotedToOrdered(
  quoted: readonly QuotedLine[],
  ordered: readonly OrderedLineIn[],
): CompareResult {
  type Side = { label: string; qty: number | null; seen: boolean };
  const q = new Map<string, Side>();
  const o = new Map<string, Side & { soNos: Set<string>; ecNos: Set<string>; serials: Set<string> }>();

  const grouped = new Set<string>();

  for (const line of quoted) {
    const models = splitModels(line.model);
    // One quantity against several models cannot be divided between them
    // honestly, so it is not divided at all: the models count, the number
    // says it does not know.
    const share = models.length > 1 ? null : line.qty;
    for (const model of models) {
      const key = foldModel(model);
      if (!key) continue;
      if (models.length > 1) grouped.add(key);
      const at = q.get(key) ?? { label: model.trim(), qty: null, seen: false };
      at.seen = true;
      if (share != null) at.qty = (at.qty ?? 0) + share;
      q.set(key, at);
    }
  }

  for (const line of ordered) {
    const models = splitModels(line.model);
    const share = models.length > 1 ? null : line.qty;
    for (const model of models) {
    const key = foldModel(model);
    if (!key) continue;
    const at = o.get(key) ?? {
      label: model.trim(), qty: null, seen: false,
      soNos: new Set<string>(), ecNos: new Set<string>(), serials: new Set<string>(),
    };
    at.seen = true;
    if (share != null) at.qty = (at.qty ?? 0) + share;
    if (line.soNo) at.soNos.add(line.soNo);
    if (line.ecNo) at.ecNos.add(line.ecNo);
    // Serials arrive as "26-27/1/334,335,336" on one line.
    for (const s of (line.serials ?? '').split(',').map(x => x.trim()).filter(Boolean)) at.serials.add(s);
    o.set(key, at);
    }
  }

  const keys = [...new Set([...q.keys(), ...o.keys()])];
  const rows: CompareRow[] = keys.map(k => {
    const a = q.get(k), b = o.get(k);
    const side: CompareRow['side'] = a && b ? 'both' : a ? 'quoted-only' : 'ordered-only';
    const quotedQty = a?.qty ?? null;
    const orderedQty = b?.qty ?? null;
    return {
      model:   a?.label || b?.label || k,
      quotedQty, orderedQty,
      diff:    quotedQty != null && orderedQty != null ? orderedQty - quotedQty : null,
      side,
      quotedGrouped: grouped.has(k),
      soNos:   [...(b?.soNos ?? [])].sort(),
      ecNos:   [...(b?.ecNos ?? [])].sort(),
      serials: [...(b?.serials ?? [])],
    };
  });

  // A model quoted and not ordered, beside one ordered and not quoted, one
  // character apart: almost always the same pump typed twice rather than two
  // pumps. Saying so turns a page of apparent mismatches into a short list of
  // spellings to settle. Each row is paired at most once, nearest first, so
  // one ordered model cannot be offered as the twin of three quoted ones.
  const loose = rows.filter(r => r.side !== 'both');
  const pairs: { a: CompareRow; b: CompareRow; d: number }[] = [];
  for (const a of loose.filter(r => r.side === 'quoted-only')) {
    for (const b of loose.filter(r => r.side === 'ordered-only')) {
      // Same pump, spelt differently — never a different size.
      if (sizeOf(a.model) !== sizeOf(b.model)) continue;
      const d = editDistance(foldModel(a.model), foldModel(b.model));
      if (d <= 2) pairs.push({ a, b, d });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  const taken = new Set<CompareRow>();
  let nearMatches = 0;
  for (const { a, b } of pairs) {
    if (taken.has(a) || taken.has(b)) continue;
    a.nearMatch = b.model;
    b.nearMatch = a.model;
    taken.add(a); taken.add(b);
    nearMatches++;
  }

  // Differences first: a row that agrees needs no attention, and a long list
  // of agreeing rows is where a disagreement goes unseen.
  const rank = (r: CompareRow) =>
    r.side !== 'both' ? 0 : (r.diff ?? 0) !== 0 ? 1 : 2;
  rows.sort((x, y) => rank(x) - rank(y) || x.model.localeCompare(y.model));

  const sum = (rs: CompareRow[], f: (r: CompareRow) => number | null) =>
    rs.reduce((a, r) => a + (f(r) ?? 0), 0);

  const quotedOnly  = rows.filter(r => r.side === 'quoted-only').length;
  const orderedOnly = rows.filter(r => r.side === 'ordered-only').length;
  const quantityDiffers = rows.filter(r => r.side === 'both' && (r.diff ?? 0) !== 0).length;

  return {
    rows,
    quotedQty:  sum(rows, r => r.quotedQty),
    orderedQty: sum(rows, r => r.orderedQty),
    matches:    quotedOnly === 0 && orderedOnly === 0 && quantityDiffers === 0 && rows.length > 0,
    quotedOnly, orderedOnly, quantityDiffers, nearMatches,
  };
}
