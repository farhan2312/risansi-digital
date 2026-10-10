'use client';

// Sorting, for a table that has no header to tap.
//
// On a phone the wider tables stop being tables: `table.r-cards` turns every
// row into a card and hides the header row entirely (app/mobile.css). That is
// the right call for reading — six columns of a complaint do not fit across a
// handset — but it took the sort controls with it, so every one of those tables
// was sortable at a desk and fixed in one order on the device the reps actually
// carry. This is the header row, in the only shape that fits.
//
// Two ways in, because the portal sorts two ways:
//
//   <MobileSort {...mobile} />            a table sorted in memory; `mobile`
//                                         comes straight off useTableSort
//   <MobileSortUrl options={…} … />       a table sorted by the server, which
//                                         sorts by writing ?sort= and ?dir=
//
// Both render the same control. Only where the answer is applied differs.

import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { firstDir, type SortKind } from '@/lib/risansi-table-sort';

export interface MobileSortOption { key: string; label: string }

export interface MobileSortProps {
  options: MobileSortOption[];
  /** The column in force, or null when the table is in its own order. */
  sort: string | null;
  dir: 'asc' | 'desc';
  onPick: (key: string) => void;
  /** Shown when nothing is chosen. Defaults to saying so. */
  restingLabel?: string;
}

export function MobileSort({ options, sort, dir, onPick, restingLabel }: MobileSortProps) {
  const [open, setOpen] = useState(false);
  // Where to put the menu, measured from the button when it opens.
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // The menu is positioned against the viewport rather than against this button,
  // because several of these tables sit inside a panel with overflow hidden or
  // an overflow-x wrapper, and an absolutely positioned menu is clipped by both
  // — on a short table it would be cut off at the panel's edge, which is the one
  // place a sort menu has to work. Fixed positioning escapes every such ancestor.
  // It has to be measured rather than declared, so it is read when the menu
  // opens, and the menu closes on a scroll instead of drifting away from its
  // button.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (r) setAt({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    place();
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  // A table with one sortable column does not need a menu to choose from.
  if (!options.length) return null;

  const active = options.find(o => o.key === sort);
  const label = active?.label ?? restingLabel ?? 'the page order';

  return (
    <div ref={ref} className="r-mobile-only" style={{ position: 'relative' }}>
      <button ref={btn} type="button" onClick={() => setOpen(o => !o)} style={TRIGGER}>
        ↕ Sort: <strong style={{ fontWeight: 600, color: 'var(--fg)' }}>{label}</strong>
        {active && <span style={{ opacity: 0.6 }}>{dir === 'asc' ? '↑' : '↓'}</span>}
      </button>

      {open && at && (
        <div style={{ ...MENU, top: at.top, left: at.left, minWidth: Math.max(at.width, 200) }}>
          {options.map(o => {
            const on = o.key === sort;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => { onPick(o.key); setOpen(false); }}
                style={{
                  ...ROW,
                  background: on ? 'var(--accent-soft)' : 'transparent',
                  color: on ? 'var(--accent)' : 'var(--fg)',
                  fontWeight: on ? 600 : 400,
                }}
              >
                {o.label}
                {on && <span>{dir === 'asc' ? '↑' : '↓'}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The same control for a server-sorted table, which is any table showing one
 * page of a longer query: the order has to be decided in SQL, so choosing a
 * column means asking the server again rather than reordering what is on screen.
 *
 * `kinds` says what each column holds, so the first tap points the way the
 * desktop header would — a value column opens at the largest, not the smallest.
 */
export function MobileSortUrl({ options, currentSort, currentDir, kinds, restingLabel }: {
  options: MobileSortOption[];
  currentSort: string;
  currentDir: 'asc' | 'desc';
  kinds?: Record<string, SortKind>;
  restingLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const apply = (key: string) => {
    const p = new URLSearchParams(window.location.search);
    // `dir`, the same parameter the desktop headers write. This sheet used to
    // write `order`, which the pages had stopped reading, so a sort chosen on a
    // phone did nothing at all; and once both existed, whichever the page read
    // first won and the other silently lost.
    if (key === currentSort) {
      p.set('dir', currentDir === 'asc' ? 'desc' : 'asc');
    } else {
      p.set('sort', key);
      p.set('dir', firstDir(kinds?.[key] ?? 'text'));
    }
    p.delete('order');
    p.delete('page');
    router.push(`${pathname}?${p.toString()}`);
  };

  return (
    <MobileSort
      options={options}
      sort={currentSort || null}
      dir={currentDir}
      onPick={apply}
      restingLabel={restingLabel}
    />
  );
}

const TRIGGER: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44,
  padding: '0 12px', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
  borderRadius: 7, color: 'var(--fg-2)', whiteSpace: 'nowrap',
};

const MENU: CSSProperties = {
  position: 'fixed', zIndex: 200,
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 8,
  boxShadow: '0 4px 16px rgba(0,0,0,0.14)', overflow: 'hidden',
  maxHeight: '60vh', overflowY: 'auto',
};

const ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
  minHeight: 44, padding: '0 14px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
  border: 'none', borderBottom: '1px solid var(--line-2)', textAlign: 'left',
};
