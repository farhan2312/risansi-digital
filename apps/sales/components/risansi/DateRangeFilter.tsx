'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { CSSProperties } from 'react';
import { DATE_PRESETS, presetRange, matchPreset } from '@/lib/risansi-date-presets';

// Server-side date-range filter: two native date inputs that write `fromParam` /
// `toParam` into the URL (preserving every other param). Used by the Visit Feed and
// Visit Reports — both queries are LIMITed, so the range must scope the query itself,
// not just the already-loaded page.

const DATE_INP: CSSProperties = {
  padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line-strong)',
  fontSize: 12, fontFamily: 'inherit', background: 'var(--bg-paper)', color: 'var(--fg)',
  outline: 'none', boxSizing: 'border-box',
};

export function DateRangeFilter({ fromParam, toParam, from, to, label = 'Date', presets = false }: {
  fromParam: string; toParam: string; from: string; to: string; label?: string;
  /** Offer the named ranges — this month, this quarter, this FY — beside the two dates. */
  presets?: boolean;
}) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const set = (key: string, val: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (val) p.set(key, val); else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  };
  const clear = () => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete(fromParam); p.delete(toParam);
    router.push(`${pathname}?${p.toString()}`);
  };

  // Both dates in one push, so a preset is one navigation rather than two.
  const setRange = (f: string, t: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (f) p.set(fromParam, f); else p.delete(fromParam);
    if (t) p.set(toParam, t); else p.delete(toParam);
    router.push(`${pathname}?${p.toString()}`);
  };
  const current = matchPreset(from, to);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)' }}>{label}</span>
      {presets && (
        <select
          value={current ?? ''}
          onChange={e => { const r = presetRange(e.target.value); if (r) setRange(r.from, r.to); else setRange('', ''); }}
          aria-label={`${label} quick select`}
          style={{ ...DATE_INP, cursor: 'pointer', color: current ? 'var(--fg)' : 'var(--fg-3)', borderColor: current ? 'var(--accent)' : 'var(--line-strong)' }}
        >
          <option value="">Quick select…</option>
          {DATE_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      )}
      <input type="date" value={from} max={to || undefined} aria-label="From date"
        onChange={e => set(fromParam, e.target.value)} style={DATE_INP} />
      <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>→</span>
      <input type="date" value={to} min={from || undefined} aria-label="To date"
        onChange={e => set(toParam, e.target.value)} style={DATE_INP} />
      {(from || to) && (
        <button type="button" onClick={clear}
          style={{ fontSize: 11, color: 'var(--neg)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          Clear
        </button>
      )}
    </div>
  );
}
