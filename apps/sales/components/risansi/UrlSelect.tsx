'use client';

import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';

export interface UrlSelectOption { value: string; label: string; href: string; }

/**
 * A native <select> that navigates to the chosen option's href. Used to collapse
 * long chip rows (FY, months) into a compact dropdown on mobile.
 */
export function UrlSelect({
  value, options, ariaLabel, prefix,
}: {
  value: string;
  options: UrlSelectOption[];
  ariaLabel?: string;
  prefix?: string;
}) {
  const router = useRouter();
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      {prefix && (
        <span style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, flexShrink: 0 }}>
          {prefix}
        </span>
      )}
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={e => {
          const opt = options.find(o => o.value === e.target.value);
          if (opt) router.push(opt.href);
        }}
        style={SELECT}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

const SELECT: CSSProperties = {
  flex: 1, width: '100%', padding: '9px 12px', fontSize: 13, fontFamily: 'inherit',
  background: 'var(--bg-paper)', color: 'var(--fg)',
  border: '1px solid var(--line-strong)', borderRadius: 8, outline: 'none',
};
