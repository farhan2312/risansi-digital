'use client';

import { useState, useMemo, type CSSProperties } from 'react';
import { MONTHS, parseMonthYear, formatMonthYear } from '@/lib/risansi-month-year';

// Month + year picker for the opportunity "Expected Close" field. Two dropdowns,
// no free text. Emits the canonical "Mon YYYY" string — via a hidden input when
// `name` is given (FormData forms) and/or via onChange (controlled forms).
export function MonthYearSelect({ name, value, onChange, disabled, style }: {
  name?: string;
  value?: string | null;
  onChange?: (v: string) => void;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const parsed = useMemo(() => parseMonthYear(value ?? ''), [value]);
  const [m, setM] = useState<number | ''>(parsed ? parsed.m : '');
  const [y, setY] = useState<number | ''>(parsed ? parsed.y : '');

  // Year options: a window around now, plus the stored year if it falls outside.
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const set = new Set<number>();
    for (let yr = now - 1; yr <= now + 6; yr++) set.add(yr);
    if (parsed) set.add(parsed.y);
    if (typeof y === 'number') set.add(y);
    return [...set].sort((a, b) => a - b);
  }, [parsed, y]);

  const emit = (mm: number | '', yy: number | '') => {
    const out = mm !== '' && yy !== '' ? formatMonthYear(mm, yy) : '';
    onChange?.(out);
  };

  return (
    <div style={{ display: 'flex', gap: 8, ...style }}>
      <select
        value={m} disabled={disabled}
        onChange={e => { const v = e.target.value === '' ? '' : Number(e.target.value); setM(v); emit(v, y); }}
        style={SEL}
      >
        <option value="">Month</option>
        {MONTHS.map((mo, i) => <option key={mo} value={i}>{mo}</option>)}
      </select>
      <select
        value={y} disabled={disabled}
        onChange={e => { const v = e.target.value === '' ? '' : Number(e.target.value); setY(v); emit(m, v); }}
        style={SEL}
      >
        <option value="">Year</option>
        {years.map(yr => <option key={yr} value={yr}>{yr}</option>)}
      </select>
      {name && <input type="hidden" name={name} value={m !== '' && y !== '' ? formatMonthYear(m, y) : ''} />}
    </div>
  );
}

const SEL: CSSProperties = {
  flex: 1, minWidth: 0, padding: '8px 10px', border: '1px solid var(--line-strong)',
  borderRadius: 6, fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-elev)',
  color: 'var(--fg)', outline: 'none', boxSizing: 'border-box', cursor: 'pointer',
};
