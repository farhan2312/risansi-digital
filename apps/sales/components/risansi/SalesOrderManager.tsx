'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { listSalesOrders, addSalesOrder, deleteSalesOrder, updateWonFinalValue } from '@/app/actions/risansi';
import type { SalesOrder } from '@/lib/risansi-sales-orders';

// Live Sales Order management for an existing Won opportunity (shown in the Edit
// drawer's Won view). The core deal is locked once Won, but SOs keep moving until
// they cover the final value — so this reads/adds/removes SOs directly against
// the server and shows a coverage bar with Won · Open vs Won · Closed.

const CR = 10_000_000;
const fmtInr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`;

export function SalesOrderManager({ oppId, finalValueCr, canEdit }: {
  oppId: number;
  finalValueCr: number | null;
  canEdit: boolean;
}) {
  const [sos, setSos]   = useState<SalesOrder[] | null>(null);
  const [num, setNum]   = useState('');
  const [date, setDate] = useState('');
  const [val, setVal]   = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  // The final value drives Open/Closed alongside the SOs, so it stays editable
  // on a Won (the deal is otherwise frozen).
  const [finalCr, setFinalCr]     = useState<number | null>(finalValueCr);
  const [finalStr, setFinalStr]   = useState(finalValueCr != null ? String(Math.round(finalValueCr * CR)) : '');
  const [savingFinal, setSavingFinal] = useState(false);

  useEffect(() => {
    let active = true;
    listSalesOrders(oppId)
      .then(r => { if (active) setSos(r); })
      .catch(() => { if (active) setSos([]); });
    return () => { active = false; };
  }, [oppId]);

  const saveFinal = async () => {
    const inr = parseFloat(finalStr.replace(/[^0-9.\-]/g, ''));
    if (!(inr > 0)) { setErr('Enter a final value greater than zero.'); return; }
    setSavingFinal(true); setErr('');
    try {
      const fd = new FormData(); fd.set('final_value_inr', String(inr));
      const res = await updateWonFinalValue(oppId, fd);
      if (!res.ok) { setErr(res.error); return; }
      setFinalCr(inr / CR);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not update the final value.'); }
    finally { setSavingFinal(false); }
  };
  const finalDirty = (() => {
    const inr = parseFloat(finalStr.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(inr) && inr > 0 && Math.round(inr) !== Math.round((finalCr ?? 0) * CR);
  })();

  const totalInr  = (sos ?? []).reduce((s, o) => s + Number(o.so_value_cr) * CR, 0);
  const finalInr  = finalCr != null ? finalCr * CR : null;
  const hasFinal  = finalInr != null && finalInr > 0;
  const covered   = hasFinal && totalInr >= (finalInr as number);
  const remaining = hasFinal ? Math.max(0, (finalInr as number) - totalInr) : 0;
  const pct       = hasFinal ? Math.min(100, (totalInr / (finalInr as number)) * 100) : 0;

  const add = async () => {
    if (!num.trim() || !date || !(parseFloat(val) > 0)) { setErr('SO Number, Date and a Value greater than zero are all required.'); return; }
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.set('so_number', num); fd.set('so_date', date); fd.set('so_value_inr', val);
      const res = await addSalesOrder(oppId, fd);
      if (!res.ok) { setErr(res.error); return; }
      setSos(res.data); setNum(''); setDate(''); setVal('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the sales order.'); }
    finally { setBusy(false); }
  };
  const remove = async (id: number) => {
    setBusy(true); setErr('');
    try {
      const res = await deleteSalesOrder(id);
      if (!res.ok) { setErr(res.error); return; }
      setSos(res.data);
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not remove the sales order.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={CARD}>
      <div style={HEAD}>
        <span>Sales Orders{sos && sos.length > 0 ? ` · ${sos.length}` : ''}</span>
        {hasFinal && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
            background: covered ? 'var(--pos-soft)' : 'var(--warn-soft)',
            color: covered ? 'var(--pos-strong)' : 'var(--warn)',
          }}>
            {covered ? 'Won · Closed' : 'Won · Open'}
          </span>
        )}
      </div>

      <div style={BODY}>
        {/* Final value + coverage */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={MINI}>Final Value</span>
            {canEdit ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="number" min={0} inputMode="numeric" value={finalStr} onChange={e => setFinalStr(e.target.value)} placeholder="₹" style={{ ...INP, maxWidth: 150, textAlign: 'right' }} />
                {finalDirty && (
                  <button type="button" onClick={saveFinal} disabled={savingFinal} style={BTN_SM}>
                    {savingFinal ? '…' : 'Save'}
                  </button>
                )}
              </div>
            ) : (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{finalInr != null ? fmtInr(finalInr) : '—'}</span>
            )}
          </div>
          {hasFinal && (
            <div style={{ marginTop: 8 }}>
              <div style={{ height: 6, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: covered ? 'var(--pos)' : 'var(--accent)', transition: 'width 200ms' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--fg-3)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                <span>{fmtInr(totalInr)} in SOs</span>
                <span style={{ color: covered ? 'var(--pos-strong)' : 'var(--fg-3)', fontWeight: covered ? 600 : 400 }}>
                  {covered ? 'Fully covered ✓' : `${fmtInr(remaining)} in hand`}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* SO list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sos === null ? (
            <div style={{ height: 20, background: 'var(--bg-sunk)', borderRadius: 4 }} />
          ) : sos.length === 0 ? (
            <div style={MUTED}>No sales orders recorded yet.</div>
          ) : (
            sos.map(o => (
              <div key={o.id} style={ROW}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{o.so_number}</span>
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 8 }}>{o.so_date}</span>
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{fmtInr(Number(o.so_value_cr) * CR)}</span>
                  {canEdit && (
                    <button type="button" onClick={() => remove(o.id)} disabled={busy} aria-label="Remove SO" style={REMOVE}>Remove</button>
                  )}
                </span>
              </div>
            ))
          )}
        </div>

        {err && <div style={{ fontSize: 12, color: 'var(--neg-strong)' }}>{err}</div>}

        {/* Add block — always visible while editable, so it's never buried. */}
        {canEdit ? (
          <div style={{ borderTop: '1px dashed var(--line-strong)', paddingTop: 10 }}>
            <div style={{ ...MINI, marginBottom: 6 }}>Record a sales order</div>
            <input value={num} onChange={e => setNum(e.target.value)} placeholder="SO Number" style={{ ...INP, marginBottom: 6 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={INP} />
              <input type="number" min={0} value={val} onChange={e => setVal(e.target.value)} placeholder="Value ₹" style={INP} />
            </div>
            <button type="button" onClick={add} disabled={busy} style={BTN_ADD}>
              {busy ? 'Adding…' : '+ Add Sales Order'}
            </button>
          </div>
        ) : (
          <div style={{ ...MUTED, borderTop: '1px dashed var(--line-strong)', paddingTop: 10 }}>
            View only — you’re not on this client’s tour, so you can’t record sales orders here.
          </div>
        )}
      </div>
    </div>
  );
}

// flexShrink:0 is essential: this card is a flex item in the modal's scrollable
// column, and `overflow: hidden` disables a flex item's automatic min-size, so
// without it the card gets squeezed shorter than its content and clips the Add
// button. Keeping overflow:hidden rounds the header corners.
const CARD: CSSProperties = { border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-paper)', flexShrink: 0 };
const HEAD: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '9px 14px', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)',
  fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const BODY: CSSProperties = { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 };
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 };
const MUTED: CSSProperties = { fontSize: 12, color: 'var(--fg-3)', padding: '2px 0' };
const MINI: CSSProperties = { fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' };
const INP: CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)', borderRadius: 6,
  fontSize: 13, background: 'var(--bg-paper)', color: 'var(--fg)', boxSizing: 'border-box', fontFamily: 'inherit',
};
const BTN_SM: CSSProperties = { background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit' };
const BTN_ADD: CSSProperties = { marginTop: 8, width: '100%', background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, padding: '9px 12px', cursor: 'pointer', fontFamily: 'inherit' };
const REMOVE: CSSProperties = { border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--neg-strong)', borderRadius: 5, fontSize: 11, fontWeight: 600, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' };
