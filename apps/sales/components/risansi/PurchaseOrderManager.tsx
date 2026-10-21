'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { loadPurchaseOrders, addPurchaseOrder, deletePurchaseOrder } from '@/app/actions/risansi';
import type { PurchaseOrder } from '@/lib/risansi-purchase-orders';

// Customer Purchase Orders for a Won opportunity (shown in the Edit drawer's Won
// view, alongside Sales Orders). A free-standing list — no coverage / Open-Closed
// maths — reads/adds/removes POs directly against the server.

const CR = 10_000_000;
const fmtInr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`;

export function PurchaseOrderManager({ oppId, canEdit }: {
  oppId: number;
  canEdit: boolean;
}) {
  const [pos, setPos]   = useState<PurchaseOrder[] | null>(null);
  /** The PO captured on the Won form that this table does not hold. */
  const [onOpp, setOnOpp] = useState<{ po_number: string; po_date: string | null } | null>(null);
  const [num, setNum]   = useState('');
  const [date, setDate] = useState('');
  const [val, setVal]   = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  useEffect(() => {
    let active = true;
    loadPurchaseOrders(oppId)
      .then(r => { if (!active) return; setPos(r.rows); setOnOpp(r.onOpportunity); })
      .catch(() => { if (active) setPos([]); });
    return () => { active = false; };
  }, [oppId]);

  /**
   * What is wrong with the form right now, field by field.
   *
   * Checked as it is typed rather than on submit, so the Add button can refuse
   * before it writes anything and say which box is the problem. It used to
   * accept any click, send it, and print one sentence above the form — which,
   * in a panel this far down a scrolling drawer, was often off screen.
   */
  const todayIso = new Date().toISOString().slice(0, 10);
  const problems: { field: 'num' | 'date' | 'val'; why: string }[] = [];
  if (!num.trim()) problems.push({ field: 'num', why: 'Enter the PO number exactly as the customer wrote it.' });
  if (!date) problems.push({ field: 'date', why: 'Pick the date on the PO.' });
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push({ field: 'date', why: 'That date is not complete — use the picker, or type it as dd-mm-yyyy.' });
  else if (date > todayIso) problems.push({ field: 'date', why: 'A PO cannot be dated in the future. Check the year.' });
  const valNum = parseFloat(val);
  if (!val.trim()) problems.push({ field: 'val', why: 'Enter the PO value in rupees.' });
  else if (!Number.isFinite(valNum)) problems.push({ field: 'val', why: 'That value is not a number. Digits only — no commas or ₹.' });
  else if (valNum <= 0) problems.push({ field: 'val', why: 'The PO value has to be more than zero.' });
  else if (valNum / 1e7 >= 9_999_999) problems.push({ field: 'val', why: 'That value is unrealistically large — check for an extra zero.' });
  const badField = (f: 'num' | 'date' | 'val') => problems.find(p => p.field === f);
  const blocked = problems.length > 0;
  // Nothing typed yet is not an error, it is an empty form. The reasons appear
  // once somebody has started.
  const started = !!num.trim() || !!date || !!val.trim();

  const totalInr = (pos ?? []).reduce((s, o) => s + Number(o.po_value_cr) * CR, 0);

  const add = async () => {
    // Cannot normally be reached — the button is disabled — but a refusal here
    // must still say which box and why, never "something went wrong".
    if (blocked) { setErr(problems.map(p => p.why).join(' ')); return; }
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.set('po_number', num); fd.set('po_date', date); fd.set('po_value_inr', val);
      // A refusal is a value now: a thrown one is redacted in production, so
      // "Won only", "not permitted" and "unrealistically large" all used to
      // arrive as the same sentence below.
      const res = await addPurchaseOrder(oppId, fd);
      if (!res.ok) { setErr(res.error); return; }
      setPos(res.data); setNum(''); setDate(''); setVal('');
      // It is in the table now, so stop showing it as the Won form's loose PO.
      setOnOpp(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the purchase order.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: number) => {
    setBusy(true); setErr('');
    try {
      const res = await deletePurchaseOrder(id);
      if (!res.ok) { setErr(res.error); return; }
      setPos(res.data);
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not remove the purchase order.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={CARD}>
      <div style={HEAD}>
        <span>Purchase Orders{pos && pos.length > 0 ? ` · ${pos.length}` : ''}</span>
        <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--fg-3)', textTransform: 'none', letterSpacing: 0 }}>customer POs</span>
      </div>

      <div style={BODY}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pos === null ? (
            <div style={{ height: 20, background: 'var(--bg-sunk)', borderRadius: 4 }} />
          ) : pos.length === 0 && !onOpp ? (
            <div style={MUTED}>No purchase orders recorded yet.</div>
          ) : (
            pos.map(o => (
              <div key={o.id} style={ROW}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{o.po_number}</span>
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 8 }}>{o.po_date}</span>
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{fmtInr(Number(o.po_value_cr) * CR)}</span>
                  {canEdit && (
                    <button type="button" onClick={() => remove(o.id)} disabled={busy} aria-label="Remove PO" style={REMOVE}>Remove</button>
                  )}
                </span>
              </div>
            ))
          )}
        </div>

        {/* The PO typed on the Won form, which this table does not hold.
            Saying "nothing recorded yet" over the top of it is what had people
            entering the same PO twice. It is shown as what it is: recorded,
            without a value, because the Won form never asks for one. */}
        {onOpp && (
          <div style={{ ...ROW, alignItems: 'flex-start', background: 'var(--bg-sunk)', borderRadius: 6, padding: '8px 10px' }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{onOpp.po_number}</span>
              {onOpp.po_date && <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 8 }}>{onOpp.po_date}</span>}
              <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>
                Recorded on the Won form. Add it below with its value to carry it into the PO total.
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--fg-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>value not recorded</span>
          </div>
        )}

        {pos !== null && pos.length > 0 && (
          <div style={{ ...ROW, borderTop: '1px solid var(--line)', paddingTop: 8, fontWeight: 600 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>PO total</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{fmtInr(totalInr)}</span>
          </div>
        )}

        {canEdit ? (
          <div style={{ borderTop: '1px dashed var(--line-strong)', paddingTop: 10 }}>
            <div style={{ ...MINI, marginBottom: 6 }}>Record a purchase order</div>
            {/* Prefill from the Won form's PO, so adding its value is typing one
                number rather than copying three. */}
            {onOpp && !num.trim() && !date && (
              <button
                type="button"
                onClick={() => { setNum(onOpp.po_number); if (onOpp.po_date) setDate(onOpp.po_date); }}
                style={{ ...REMOVE, color: 'var(--title)', marginBottom: 8, padding: '4px 9px' }}
              >
                Use {onOpp.po_number}
              </button>
            )}
            <input
              value={num} onChange={e => setNum(e.target.value)} placeholder="PO Number"
              aria-invalid={started && !!badField('num')}
              style={{ ...INP, marginBottom: badField('num') && started ? 2 : 6, ...(started && badField('num') ? BAD : null) }}
            />
            {started && badField('num') && <div style={WHY}>{badField('num')!.why}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div>
                <input
                  type="date" value={date} max={todayIso} onChange={e => setDate(e.target.value)}
                  aria-invalid={started && !!badField('date')}
                  style={{ ...INP, ...(started && badField('date') ? BAD : null) }}
                />
                {started && badField('date') && <div style={WHY}>{badField('date')!.why}</div>}
              </div>
              <div>
                <input
                  type="number" min={0} value={val} onChange={e => setVal(e.target.value)} placeholder="Value ₹"
                  aria-invalid={started && !!badField('val')}
                  style={{ ...INP, ...(started && badField('val') ? BAD : null) }}
                />
                {started && badField('val') && <div style={WHY}>{badField('val')!.why}</div>}
              </div>
            </div>
            {/* Beside the button that is refusing, not above the whole panel —
                in a drawer this long, a message at the top is off screen. */}
            {err && <div style={{ ...WHY, marginTop: 8, fontSize: 12 }} aria-live="polite">{err}</div>}
            <button
              type="button" onClick={add} disabled={busy || blocked}
              title={blocked ? problems.map(p => p.why).join(' ') : undefined}
              style={{ ...BTN_ADD, ...(busy || blocked ? { opacity: 0.5, cursor: 'not-allowed' } : null) }}
            >
              {busy ? 'Adding…' : '+ Add Purchase Order'}
            </button>
          </div>
        ) : (
          <div style={{ ...MUTED, borderTop: '1px dashed var(--line-strong)', paddingTop: 10 }}>
            View only — you’re not on this client’s tour, so you can’t record purchase orders here.
          </div>
        )}
      </div>
    </div>
  );
}

// flexShrink:0 is essential — see the note in SalesOrderManager: an overflow:hidden
// flex item loses its auto min-size and would clip the Add button in the scroll column.
const CARD: CSSProperties = { border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-paper)', flexShrink: 0 };
const HEAD: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '9px 14px', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)',
  fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const BODY: CSSProperties = { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 };
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 };
const MUTED: CSSProperties = { fontSize: 12, color: 'var(--fg-3)', padding: '2px 0' };
const MINI: CSSProperties = { fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' };
const INP: CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)', borderRadius: 6,
  fontSize: 13, background: 'var(--bg-paper)', color: 'var(--fg)', boxSizing: 'border-box', fontFamily: 'inherit',
};
const BTN_ADD: CSSProperties = { marginTop: 8, width: '100%', background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit' };
/** A field the form will not accept, and the sentence saying why. */
// Matches MoneyInput's invalid state: the border, not a fill. There is no
// --neg-tint token, and inventing one here would be the only use of it.
const BAD: CSSProperties = { borderColor: 'var(--neg)' };
const WHY: CSSProperties = { fontSize: 11, color: 'var(--neg-strong)', marginTop: 3, lineHeight: 1.35 };
const REMOVE: CSSProperties = { border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--neg-strong)', borderRadius: 5, fontSize: 11, fontWeight: 600, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' };
