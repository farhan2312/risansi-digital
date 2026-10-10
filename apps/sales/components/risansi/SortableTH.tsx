'use client';

import { type CSSProperties } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { type SortKind, firstDir } from '@/lib/risansi-table-sort';

// ── Types ──────────────────────────────────────────────────────

interface Props {
  col:         string;               // Sort key sent as ?sort=col
  label:       string;               // Display label
  currentSort: string;               // Active sort key (from server searchParams)
  currentDir:  'asc' | 'desc';      // Active direction (from server searchParams)
  /** What the column holds. Decides which way the FIRST click points: a name
   *  opens at A, a value opens at the largest. Defaults to text. */
  kind?:       SortKind;
  style?:      CSSProperties;
  align?:      'left' | 'right' | 'center';
}

// ── Component ──────────────────────────────────────────────────

export function SortableTH({
  col, label, currentSort, currentDir, kind = 'text',
  style, align,
}: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const isActive = currentSort === col;

  function handleClick() {
    // Read current params at click-time to preserve all other filters
    const params = new URLSearchParams(window.location.search);
    if (isActive) {
      params.set('dir', currentDir === 'asc' ? 'desc' : 'asc');
    } else {
      params.set('sort', col);
      // Not always 'asc'. Ascending on a money column opens at the smallest
      // number in the book, which is never the row anyone came to find.
      params.set('dir', firstDir(kind));
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <th
      onClick={handleClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
      role="button"
      tabIndex={0}
      aria-sort={isActive ? (currentDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={`Sort by ${label}`}
      style={{
        cursor:     'pointer',
        userSelect: 'none',
        textAlign:  align ?? 'left',
        ...TH_BASE,
        ...style,
        // After the caller's style, not before. Most tables pass a shared TH
        // object carrying its own colour and alignment, and spreading it last
        // meant an explicit align was ignored and the active header never took
        // the accent — it just stayed the colour of every other header, so the
        // column you had sorted by was the one thing the table did not say.
        ...(align ? { textAlign: align } : {}),
        ...(isActive ? { color: 'var(--accent)' } : {}),
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {label}
        {isActive
          ? <span style={{ fontSize: 8 }}>{currentDir === 'asc' ? '▲' : '▼'}</span>
          : <span style={{ fontSize: 8, opacity: 0.22 }}>↕</span>
        }
      </span>
    </th>
  );
}

// ── Base TH styles (override per-page via style prop) ──────────

const TH_BASE: CSSProperties = {
  padding:       '9px 12px',
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight:    500,
  color:         'var(--fg-3)',
  borderBottom:  '1px solid var(--line)',
  whiteSpace:    'nowrap',
  background:    'var(--bg-elev)',
};
