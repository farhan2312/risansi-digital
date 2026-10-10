'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { listPurchaseOrders, addPurchaseOrder, deletePurchaseOrder } from '@/app/actions/risansi';
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
  const [num, setNum]   = useState('');
  const [date, setDate] = useState('');
  const [val, setVal]   = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  useEffect(() => {
    let active = true;
    listPurchaseOrders(oppId)
      .then(r => { if (active) setPos(r); })
      .catch(() => { if (active) setPos([]); });
    return () => { active = false; };
  }, [oppId]);

  const totalInr = (pos ?? []).reduce((s, o) => s + Number(o.po_value_cr) * CR, 0);

  const add = async () => {
    if (!num.trim() || !date || !(parseFloat(val) > 0)) { setErr('PO Number, Date and a Value greater than zero are all required.'); return; }
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
          ) : pos.length === 0 ? (
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

        {pos !== null && pos.length > 0 && (
          <div style={{ ...ROW, borderTop: '1px solid var(--line)', paddingTop: 8, fontWeight: 600 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>PO total</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{fmtInr(totalInr)}</span>
          </div>
        )}

        {err && <div style={{ fontSize: 12, color: 'var(--neg-strong)' }}>{err}</div>}

        {canEdit ? (
          <div style={{ borderTop: '1px dashed var(--line-strong)', paddingTop: 10 }}>
            <div style={{ ...MINI, marginBottom: 6 }}>Record a purchase order</div>
            <input value={num} onChange={e => setNum(e.target.value)} placeholder="PO Number" style={{ ...INP, marginBottom: 6 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={INP} />
              <input type="number" min={0} value={val} onChange={e => setVal(e.target.value)} placeholder="Value ₹" style={INP} />
            </div>
            <button type="button" onClick={add} disabled={busy} style={BTN_ADD}>
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
const REMOVE: CSSProperties = { border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--neg-strong)', borderRadius: 5, fontSize: 11, fontWeight: 600, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' };
