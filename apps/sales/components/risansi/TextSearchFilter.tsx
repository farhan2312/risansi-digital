'use client';

import type { CSSProperties } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSearchBox } from '@/lib/risansi-search-box';

// A server-side text search: a debounced input that writes `param` into the URL
// (preserving every other param), so the query itself is scoped rather than just
// the already-loaded page. Used on Opportunities to find a quote by number/name.

export function TextSearchFilter({ param, placeholder = 'Search…', width = 180 }: {
  param: string; placeholder?: string; width?: number;
}) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const current      = searchParams.get(param) ?? '';

  // This used to adopt `current` on every change, which meant a round trip
  // that finished a keystroke late wrote its older value straight over what
  // was being typed. useSearchBox keeps the box with the typist until the URL
  // agrees with it.
  const { value, onChange, commit } = useSearchBox(current, val => {
    const p = new URLSearchParams(searchParams.toString());
    if (val.trim()) p.set(param, val.trim()); else p.delete(param);
    p.delete('page');
    router.push(`${pathname}?${p.toString()}`);
  }, 350);

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <input
        type="search" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        style={{ ...INP, width }}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => commit('')} style={CLEAR}>×</button>
      )}
    </div>
  );
}

const INP: CSSProperties = {
  height: 30, padding: '5px 26px 5px 10px', fontSize: 12, fontFamily: 'inherit',
  background: 'var(--bg-paper)', color: 'var(--fg)',
  border: '1px solid var(--line-strong)', borderRadius: 5, outline: 'none', boxSizing: 'border-box',
};
const CLEAR: CSSProperties = {
  position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--fg-3)', fontSize: 15, lineHeight: 1, padding: 0,
};
