'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import type { CSSProperties } from 'react';
import { useSearchBox } from '@/lib/risansi-search-box';

interface FilterBarProps {
  q:      string;
  sugar:  string;   // '' | 'true' | 'false'
}

const FIELD: CSSProperties = {
  height: 30, padding: '0 8px',
  fontSize: 12, fontFamily: 'inherit',
  background: 'var(--bg-paper)',
  border: '1px solid var(--line-strong)',
  borderRadius: 5,
  color: 'var(--fg)',
  outline: 'none',
  cursor: 'pointer',
};

export function FilterBar({ q: initQ, sugar }: FilterBarProps) {
  const router   = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // The guard this used to carry compared `initQ` against the single most
  // recent push, so a *stale* echo — the round trip for "bal" landing while
  // "bala" was on screen — read as somebody else's change and overwrote the
  // box. useSearchBox owns the box from the first keystroke instead.
  const { value: search, onChange: setSearch } = useSearchBox(initQ, v => {
    const p = new URLSearchParams(window.location.search);
    if (v) p.set('q', v); else p.delete('q');
    p.delete('page');
    startTransition(() => router.replace(`${pathname}?${p.toString()}`));
  }, 280);

  const updateParam = (key: string, value: string) => {
    const p = new URLSearchParams(window.location.search);
    if (value) p.set(key, value);
    else       p.delete(key);
    p.delete('page');
    startTransition(() => router.replace(`${pathname}?${p.toString()}`));
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      opacity: pending ? 0.6 : 1, transition: 'opacity 0.15s',
    }}>

      {/* Search — grows to fill the row */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: '1 1 220px', minWidth: 180 }}>
        <svg style={{ position: 'absolute', left: 10, pointerEvents: 'none', color: 'var(--fg-3)' }}
          width="14" height="14" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="7" cy="7" r="5"/><path d="M14 14l-3.5-3.5"/>
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search code or client name…"
          style={{ ...FIELD, height: 34, paddingLeft: 32, width: '100%', cursor: 'text', borderRadius: 7 }}
        />
      </div>

      {/* Sugar toggle */}
      <div style={{
        display: 'flex', background: 'var(--bg-paper)', flexShrink: 0,
        border: '1px solid var(--line-strong)', borderRadius: 7, overflow: 'hidden', height: 34,
      }}>
        {([
          { value: '',      label: 'All'       },
          { value: 'true',  label: 'Sugar'     },
          { value: 'false', label: 'Non-Sugar' },
        ] as const).map(opt => (
          <button
            key={opt.value || 'all'}
            onClick={() => updateParam('sugar', opt.value)}
            style={{
              padding: '0 14px', fontSize: 12, fontFamily: 'inherit',
              cursor: 'pointer', border: 'none',
              borderRight: opt.value === 'false' ? 'none' : '1px solid var(--line-strong)',
              background: sugar === opt.value ? 'var(--accent)' : 'transparent',
              color:      sugar === opt.value ? '#fff'          : 'var(--fg-2)',
              fontWeight: sugar === opt.value ? 600             : 400,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
