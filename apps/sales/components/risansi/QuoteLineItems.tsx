'use client';

import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { formatIndian, parseMoneyInput } from '@/lib/risansi-money';

// The line items on a quotation, as an editable list.
//
// Extracted so the create form and the Quoted gateway draw the same table from
// the same definition. `detailed_specifications` leads because it is the field
// reps actually fill — 99% of 950 stored items carry one, against 61% for pump
// model and 31% for the gearbox price.

export interface QuoteItem {
  pump_model: string;
  pump_qty: string;
  pump_speed: string;
  geared_motor_detail: string;
  motor_price: string;
  gearbox_vbelt_price: string;
  offer_value_inr: string;
  detailed_specifications: string;
}

/**
 * What the lines add up to, in rupees.
 *
 * The one definition. It was inlined in the label below while the server had
 * its own copy, so the figure on screen and the figure that got saved agreed
 * only by coincidence.
 */
export function lineItemsTotal(items: QuoteItem[]): number {
  return items.reduce((sum, r) => {
    const n = parseMoneyInput(r.offer_value_inr ?? '');
    return sum + (n ?? 0);
  }, 0);
}

/**
 * Keep Total Offer in step with the line items, as they are typed.
 *
 * The field is required at every quoted stage, and the form used to leave it
 * to the person: fill four lines, leave the total blank because the hint says
 * blank means "use the sum", and the form refuses to submit. The sum was on
 * screen the whole time. Now it goes in the box.
 *
 * It stops the moment somebody types their own figure — a quoted total is not
 * always the sum of its lines (a discount, a lump-sum freight line, a rounded
 * negotiated number), so a typed value is never overwritten. Clearing the
 * field hands it back to the lines.
 *
 * `apply` is called through a ref so a caller that rebuilds the callback each
 * render cannot turn this into a render loop.
 */
export function useAutoTotal({ items, active, apply, initial = '' }: {
  items: QuoteItem[];
  /** False at stages with no quotation block — nothing to sum into. */
  active: boolean;
  apply: (value: string) => void;
  /**
   * A total the form already had when it opened — an existing opportunity's
   * figure. Treated as somebody's deliberate number from the first render.
   *
   * Not optional in spirit: the stage-move modal seeds the stored total
   * immediately and loads its line items over the network a moment later, so
   * a hook that assumed it started empty would run once against no lines, sum
   * them to zero, and blank out the figure already on screen.
   */
  initial?: string;
}) {
  const edited = useRef(parseMoneyInput(initial) != null);
  const applyRef = useRef(apply);
  useEffect(() => { applyRef.current = apply; });

  useEffect(() => {
    if (!active || edited.current) return;
    const total = lineItemsTotal(items);
    applyRef.current(total > 0 ? formatIndian(Math.round(total)) : '');
  }, [items, active]);

  // Both are stable for the life of the component: they touch nothing but the
  // ref above. That matters because the forms wire every field to a single
  // memoised onChange, and a handler that changed identity each render would
  // rebuild on every keystroke.
  //
  // Stable callbacks rather than a ref holding the whole returned object: the
  // object is rebuilt each render, so keeping it in a ref meant writing to
  // that ref from an effect — which is both a lint error and a worse way of
  // saying "these functions do not change".

  /** Call when the person edits Total Offer themselves. */
  const noteTyped = useCallback((raw: string) => {
    edited.current = raw.trim() !== '';
  }, []);

  /**
   * Call for a total that arrived already filled — an existing opportunity, or
   * a restored draft. A figure that is not the sum of the lines was put there
   * deliberately and is left alone.
   */
  const adoptExisting = useCallback((raw: string, forItems: QuoteItem[]) => {
    const typed = parseMoneyInput(raw);
    if (typed == null) { edited.current = false; return; }
    edited.current = Math.round(typed) !== Math.round(lineItemsTotal(forItems));
  }, []);

  return { noteTyped, adoptExisting };
}

export const emptyItem = (): QuoteItem => ({
  pump_model: '', pump_qty: '', pump_speed: '', geared_motor_detail: '',
  motor_price: '', gearbox_vbelt_price: '', offer_value_inr: '', detailed_specifications: '',
});

const COLS: { key: keyof QuoteItem; label: string; w: string; ph?: string }[] = [
  { key: 'detailed_specifications', label: 'Specification', w: '2.2fr', ph: 'Duty, MOC, application…' },
  { key: 'pump_model',              label: 'Model',         w: '1fr',   ph: 'MX-80' },
  { key: 'pump_qty',                label: 'Qty',           w: '0.5fr', ph: '2' },
  { key: 'pump_speed',              label: 'Speed',         w: '0.7fr', ph: 'RPM' },
  { key: 'geared_motor_detail',     label: 'Geared motor',  w: '1fr' },
  { key: 'motor_price',             label: 'Motor ₹',       w: '0.8fr' },
  { key: 'gearbox_vbelt_price',     label: 'Gearbox ₹',     w: '0.8fr' },
  { key: 'offer_value_inr',         label: 'Offer ₹',       w: '0.9fr' },
];

const GRID = COLS.map(c => c.w).join(' ') + ' 28px';

export function QuoteLineItems({ items, onChange, sumLabel = true }: {
  items: QuoteItem[];
  onChange: (items: QuoteItem[]) => void;
  sumLabel?: boolean;
}) {
  const set = (i: number, key: keyof QuoteItem, v: string) =>
    onChange(items.map((row, n) => (n === i ? { ...row, [key]: v } : row)));

  const total = lineItemsTotal(items);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={TITLE}>Line items</span>
        {sumLabel && total > 0 && (
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
            sums to ₹{Math.round(total).toLocaleString('en-IN')} — Total Offer follows this unless you type over it
          </span>
        )}
      </div>

      {/* The floor below which eight columns stop being readable and the row
          scrolls sideways instead. It was 720, which no form was ever wide
          enough to satisfy — the stage-move modal offered 680 and the create
          modal 600, so this table was in permanent horizontal scroll in both.
          At the current widths (840 and 780 of usable room) it now fits, and
          620 keeps it honest on a tablet rather than pretending it still does. */}
      {/* On a phone (mobile.css) the header row hides, each line becomes a
          card of labelled fields — the .qli-lbl span shows there and nowhere
          else — and the 620px floor comes off. */}
      <div style={{ overflowX: 'auto' }}>
        <div className="qli-min" style={{ minWidth: 620 }}>
          <div className="qli-head" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 6, marginBottom: 4 }}>
            {COLS.map(c => <div key={c.key} style={HEAD}>{c.label}</div>)}
            <div />
          </div>

          {items.map((row, i) => (
            <div key={i} className="qli-row" style={{ display: 'grid', gridTemplateColumns: GRID, gap: 6, marginBottom: 6 }}>
              {COLS.map(c => (
                <label key={c.key} className="qli-cell" style={{ display: 'contents' }}>
                  <span className="qli-lbl">{c.label}</span>
                  <input
                    value={row[c.key]} placeholder={c.ph}
                    onChange={e => set(i, c.key, e.target.value)}
                    style={INPUT}
                  />
                </label>
              ))}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, n) => n !== i))}
                disabled={items.length === 1}
                aria-label="Remove line"
                style={{ ...X, opacity: items.length === 1 ? 0.3 : 1 }}
              >×</button>
            </div>
          ))}
        </div>
      </div>

      <button type="button" onClick={() => onChange([...items, emptyItem()])} style={ADD}>
        + Add line
      </button>
    </div>
  );
}

/** True when nothing has been typed on any line — used to skip sending empties. */
export const itemsAreBlank = (items: QuoteItem[]) =>
  items.every(r => Object.values(r).every(v => !String(v).trim()));

const TITLE: CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--fg-3)',
};
const HEAD: CSSProperties = {
  fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.04em', color: 'var(--fg-3)',
};
const INPUT: CSSProperties = {
  // Defensive, not load-bearing: a grid item defaults to min-width: auto, so a
  // long value or placeholder can push its own track wider than its fr share and
  // shove the row into horizontal scroll. Measured in the browser, the eight
  // tracks resolve well inside the container without it — the scroll this
  // component used to show came from the minWidth floor below, not from here.
  minWidth: 0,
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12,
  fontFamily: 'inherit', background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 5, color: 'var(--fg)', outline: 'none',
};
const X: CSSProperties = {
  border: 'none', background: 'none', color: 'var(--neg)', cursor: 'pointer',
  fontSize: 16, lineHeight: 1, fontFamily: 'inherit', padding: 0,
};
const ADD: CSSProperties = {
  marginTop: 2, background: 'none', border: '1px dashed var(--line-strong)',
  color: 'var(--title)', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
  padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit',
};
