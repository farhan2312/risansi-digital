'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';

// Dynamic Sales Order entry used wherever a deal is marked Won (the kanban
// completion modal, the New Opportunity Won step, and the Edit drawer's Won
// transition). Emits a hidden `sales_orders_json` field the server parses; at
// least one complete row is required to move to Won. When a final value is
// known it shows live coverage — Won · Open vs Won · Closed — and how much is
// still "order in hand".

export interface SoRow { so_number: string; so_date: string; so_value_inr: string }
const blank = (): SoRow => ({ so_number: '', so_date: '', so_value_inr: '' });

const fmtInr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString('en-IN')}`;

export function SalesOrderList({
  name = 'sales_orders_json',
  finalValueInr = null,
  initialRows,
  onRowsChange,
}: {
  name?: string;
  finalValueInr?: number | null;
  initialRows?: SoRow[];
  /**
   * Reports the rows up so a form holding a draft can keep them. The rows
   * otherwise only ever reach the server through the hidden input below, which
   * no draft can see — and the SO numbers on a Won move are exactly the kind of
   * typing that was being lost.
   */
  onRowsChange?: (rows: SoRow[]) => void;
}) {
  const [rows, setRows] = useState<SoRow[]>(initialRows && initialRows.length ? initialRows : [blank()]);

  // In an effect rather than inside `set`, so every route that changes the rows
  // (add, remove, edit) reports without each having to remember to.
  const report = useRef(onRowsChange);
  useEffect(() => { report.current = onRowsChange; });
  useEffect(() => { report.current?.(rows); }, [rows]);

  const set = (i: number, k: keyof SoRow, v: string) =>
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setRows(rs => [...rs, blank()]);
  const remove = (i: number) =>
    setRows(rs => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [blank()]));

  const total = rows.reduce((a, r) => a + (parseFloat(r.so_value_inr) || 0), 0);
  const hasFinal = finalValueInr != null && finalValueInr > 0;
  const covered = hasFinal && total >= (finalValueInr as number);
  const remaining = hasFinal ? Math.max(0, (finalValueInr as number) - total) : 0;

  // Only fully/partly-typed rows go to the server; a pristine row is dropped.
  const json = JSON.stringify(
    rows.filter(r => r.so_number.trim() || r.so_date.trim() || r.so_value_inr.trim()),
  );

  return (
    <div>
      <input type="hidden" name={name} value={json} />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={LABEL}>Sales Orders *</label>
        <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>at least one required</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 28px', gap: 6, alignItems: 'center' }}>
            <input
              value={r.so_number} onChange={e => set(i, 'so_number', e.target.value)}
              placeholder="SO Number" style={INP}
            />
            <input
              type="date" value={r.so_date} onChange={e => set(i, 'so_date', e.target.value)}
              style={INP}
            />
            <input
              type="number" min={0} inputMode="numeric" value={r.so_value_inr}
              onChange={e => set(i, 'so_value_inr', e.target.value)}
              placeholder="SO Value ₹" style={INP}
            />
            <button
              type="button" onClick={() => remove(i)} aria-label="Remove SO"
              style={{ border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg-3)', borderRadius: 6, cursor: 'pointer', height: 30, fontSize: 15, lineHeight: 1 }}
            >×</button>
          </div>
        ))}
      </div>

      <button
        type="button" onClick={add}
        style={{ marginTop: 8, border: '1px dashed var(--line-strong)', background: 'transparent', color: 'var(--accent)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '6px 10px', fontFamily: 'inherit' }}
      >+ Add another SO</button>

      {hasFinal && (
        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 7, fontSize: 12,
          background: covered ? 'var(--pos-soft)' : 'var(--bg-elev)',
          border: `1px solid ${covered ? 'rgba(6,95,70,0.25)' : 'var(--line)'}`,
          color: covered ? 'var(--pos-strong)' : 'var(--fg-2)',
          display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
        }}>
          <span>SO total <strong>{fmtInr(total)}</strong> of {fmtInr(finalValueInr as number)}</span>
          <span style={{ fontWeight: 700 }}>
            {covered ? 'Won · Closed' : `Won · Open · ${fmtInr(remaining)} in hand`}
          </span>
        </div>
      )}
    </div>
  );
}

const LABEL: CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em',
};
const INP: CSSProperties = {
  width: '100%', padding: '7px 9px', border: '1px solid var(--line-strong)',
  borderRadius: 6, fontSize: 13, background: 'var(--bg-paper)', color: 'var(--fg)',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
