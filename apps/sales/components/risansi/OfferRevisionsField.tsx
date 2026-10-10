'use client';

import { useState, type CSSProperties } from 'react';
import { MoneyInput } from './MoneyInput';
import { parseMoneyInput } from '@/lib/risansi-money';
import {
  blankOfferRevision, fmtUsdFromInr, revisionDeltaPct,
  type OfferRevision, type OfferRevisionRow,
} from '@/lib/risansi-offer-revisions';

// The revised-offer history on a quotation form. Each row is one re-price, with
// the date it happened on; "+ Add revision" appends another. The whole list
// rides along in a hidden `offer_revisions_json` input, so the parent form saves
// it in the same round-trip as the rest of the quote.
//
// USD is never entered — it's derived from the settings rate and shown as
// sub-text, so there is only ever one number to keep correct.

const today = () => new Date().toISOString().slice(0, 10);

export function OfferRevisionsField({
  initial, baseOfferInr, usdRate, fieldName = 'offer_revisions_json',
}: {
  initial?: OfferRevision[];
  /** The original Total Offer, for the "vs original" delta on the first revision. */
  baseOfferInr?: number | null;
  usdRate: number;
  fieldName?: string;
}) {
  const [rows, setRows] = useState<OfferRevisionRow[]>(() =>
    (initial ?? []).map(r => ({
      value_inr: r.value_inr == null ? '' : String(r.value_inr),
      revised_on: r.revised_on ?? '',
      note: r.note ?? '',
    })));

  const set = (idx: number, key: keyof OfferRevisionRow, val: string) =>
    setRows(p => p.map((r, i) => (i === idx ? { ...r, [key]: val } : r)));
  const add    = () => setRows(p => [...p, { ...blankOfferRevision(), revised_on: today() }]);
  const remove = (idx: number) => setRows(p => p.filter((_, i) => i !== idx));

  // Each revision is measured against the one before it, and the first against
  // the original offer — that's the movement a rep actually cares about.
  const prevOf = (idx: number): number | null => {
    for (let i = idx - 1; i >= 0; i--) {
      const v = parseMoneyInput(rows[i].value_inr) ?? NaN;
      if (Number.isFinite(v) && v > 0) return v;
    }
    return baseOfferInr ?? null;
  };

  const latest = (() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const v = parseMoneyInput(rows[i].value_inr) ?? NaN;
      if (Number.isFinite(v) && v > 0) return v;
    }
    return null;
  })();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg)' }}>
          Revised Offers ({rows.length})
        </span>
        {latest != null && (
          <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
            current ₹{latest.toLocaleString('en-IN')} · {fmtUsdFromInr(latest, usdRate)}
          </span>
        )}
        <button type="button" onClick={add} style={{ ...ADD_BTN, marginLeft: 'auto' }}>+ Add revision</button>
      </div>

      {rows.length === 0 ? (
        <div style={{
          fontSize: 11, color: 'var(--fg-3)', padding: '9px 11px',
          background: 'var(--bg-sunk)', border: '1px dashed var(--line-strong)', borderRadius: 7,
        }}>
          No revisions yet — the Total Offer above is the current price. Add one each time the
          quote is re-priced, and the history stays here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r, idx) => {
            const val   = parseMoneyInput(r.value_inr) ?? NaN;
            const hasV  = Number.isFinite(val) && val > 0;
            const delta = hasV ? revisionDeltaPct(prevOf(idx), val) : null;
            const up    = (delta ?? 0) > 0;
            return (
              <div key={idx} style={{
                border: '1px solid var(--line)', borderRadius: 8, padding: 10,
                background: 'var(--bg-elev)', borderLeft: '3px solid var(--accent-line)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7, gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)' }}>Revision {idx + 1}</span>
                  {delta != null && Math.abs(delta) >= 0.05 && (
                    <span style={{
                      fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--font-mono)',
                      color: up ? 'var(--pos)' : 'var(--neg)',
                    }}>
                      {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% vs {idx === 0 ? 'original' : `revision ${idx}`}
                    </span>
                  )}
                  <button type="button" onClick={() => remove(idx)} style={{ ...DEL_BTN, marginLeft: 'auto' }}>Remove</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 2fr', gap: 8 }}>
                  <div>
                    <label style={SUBLBL}>Revised Amount (₹)</label>
                    <MoneyInput
                      value={r.value_inr} onChange={v => set(idx, 'value_inr', v)}
                      placeholder="e.g. 850000" usdRate={usdRate} style={INP}
                    />
                  </div>
                  <div>
                    <label style={SUBLBL}>Revised On</label>
                    <input type="date" value={r.revised_on} onChange={e => set(idx, 'revised_on', e.target.value)} style={INP} />
                  </div>
                  <div>
                    <label style={SUBLBL}>Why (optional)</label>
                    <input
                      value={r.note} onChange={e => set(idx, 'note', e.target.value)}
                      placeholder="e.g. scope increased to 4 pumps" style={INP}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <input type="hidden" name={fieldName} value={JSON.stringify(rows)} />
    </div>
  );
}

/** Read-only history, for surfaces that display a quote rather than edit it. */
export function OfferRevisionsList({
  revisions, baseOfferInr, usdRate, compact,
}: {
  revisions: OfferRevision[];
  baseOfferInr?: number | null;
  usdRate: number;
  compact?: boolean;
}) {
  if (!revisions.length) return null;
  const fmt = (n: number) => '₹' + Number(n).toLocaleString('en-IN');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 3 : 5 }}>
      {baseOfferInr != null && baseOfferInr > 0 && (
        <RevLine
          label="Original" amount={fmt(baseOfferInr)} usd={fmtUsdFromInr(baseOfferInr, usdRate)}
          compact={compact}
        />
      )}
      {revisions.map((r, i) => {
        const prev  = i === 0 ? (baseOfferInr ?? null) : revisions[i - 1].value_inr;
        const delta = revisionDeltaPct(prev, r.value_inr);
        return (
          <RevLine
            key={r.id ?? i}
            label={r.revised_on}
            amount={fmt(r.value_inr)}
            usd={fmtUsdFromInr(r.value_inr, usdRate)}
            delta={delta}
            note={r.note}
            compact={compact}
          />
        );
      })}
    </div>
  );
}

function RevLine({ label, amount, usd, delta, note, compact }: {
  label: string; amount: string; usd: string;
  delta?: number | null; note?: string | null; compact?: boolean;
}) {
  const up = (delta ?? 0) > 0;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: compact ? 10 : 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', minWidth: 74 }}>{label}</span>
      <span style={{ fontSize: compact ? 11 : 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{amount}</span>
      <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{usd}</span>
      {delta != null && Math.abs(delta) >= 0.05 && (
        <span style={{ fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)', color: up ? 'var(--pos)' : 'var(--neg)' }}>
          {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
        </span>
      )}
      {note && <span style={{ fontSize: 10.5, color: 'var(--fg-3)', fontStyle: 'italic' }}>{note}</span>}
    </div>
  );
}

const SUBLBL: CSSProperties = { fontSize: 9.5, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 };
const INP: CSSProperties = { width: '100%', padding: '7px 9px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 12.5, background: 'var(--bg-sunk)', color: 'var(--fg)', boxSizing: 'border-box', fontFamily: 'inherit' };
const ADD_BTN: CSSProperties = { padding: '5px 11px', fontSize: 12, fontWeight: 600, background: 'var(--accent-soft)', color: 'var(--title)', border: '1px solid var(--accent-line)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const DEL_BTN: CSSProperties = { padding: '3px 9px', fontSize: 11, background: 'none', border: '1px solid var(--line-strong)', color: 'var(--neg)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' };
