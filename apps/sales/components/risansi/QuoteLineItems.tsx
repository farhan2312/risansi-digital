'use client';

import { type CSSProperties } from 'react';

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

  const total = items.reduce((s, r) => {
    const n = parseFloat((r.offer_value_inr || '').replace(/,/g, ''));
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={TITLE}>Line items</span>
        {sumLabel && total > 0 && (
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
            sums to ₹{Math.round(total).toLocaleString('en-IN')} — leave Total Offer blank to use it
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
