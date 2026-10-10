'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────

type OptionItem = string | {
  value: string;
  label: string;
  count?: number;
  /** Drawn as a heading above this option whenever it differs from the one before. */
  group?: string;
  /**
   * Write this option into a different URL param than the menu's own. One
   * dropdown can then carry two questions that live in different columns —
   * Client Type (clients.client_type) and Client Status (clients.status) — which
   * the server ANDs, so picking OEM and Active asks for OEM clients that are
   * active rather than handing back an empty board.
   */
  param?: string;
};

interface Props {
  param:    string;        // URL search param key  (e.g. 'industry')
  label:    string;        // Button label
  options:  OptionItem[];  // All available options (string or {value,label,count})
  selected: string[];      // Currently selected (parsed server-side from searchParams)
}

function optValue(o: OptionItem): string { return typeof o === 'string' ? o : o.value; }
function optLabel(o: OptionItem): string { return typeof o === 'string' ? o : o.label; }
function optCount(o: OptionItem): number | undefined { return typeof o === 'string' ? undefined : o.count; }
function optGroup(o: OptionItem): string | undefined { return typeof o === 'string' ? undefined : o.group; }
function optParam(o: OptionItem): string | undefined { return typeof o === 'string' ? undefined : o.param; }

// ── Component ──────────────────────────────────────────────────

export function MultiSelectFilter({ param, label, options, selected }: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const close = () => { setOpen(false); setQuery(''); };

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Longer option lists get a search box to filter down to a match.
  const searchable = options.length > 5;
  const q = query.trim().toLowerCase();
  const shown = searchable && q
    ? options.filter(o => optLabel(o).toLowerCase().includes(q) || optValue(o).toLowerCase().includes(q))
    : options;

  // The current selection is read back out of the URL rather than off the
  // `selected` prop, because when a menu spans two params that prop is the union
  // of both — writing the union into one of them would drag every Status pick
  // into the Client Type param.
  function toggle(opt: OptionItem) {
    const value  = optValue(opt);
    const key    = optParam(opt) ?? param;
    const params = new URLSearchParams(window.location.search);
    const cur    = (params.get(key) ?? '').split(',').filter(Boolean);
    const next   = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
    if (next.length === 0) params.delete(key); else params.set(key, next.join(','));
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  const count = selected.length;
  const isActive = count > 0;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="r-tap"
        onClick={() => (open ? close() : setOpen(true))}
        style={{
          display:     'inline-flex',
          alignItems:  'center',
          gap:         5,
          padding:     '5px 10px',
          height:      30,
          fontSize:    12,
          fontFamily:  'inherit',
          background:  isActive ? 'var(--accent-soft)' : 'var(--bg-paper)',
          border:      `1px solid ${isActive ? 'var(--brand-blue)' : 'var(--line-strong)'}`,
          color:       isActive ? 'var(--brand-blue)' : 'var(--fg-2)',
          borderRadius: 5,
          cursor:      'pointer',
          whiteSpace:  'nowrap',
        }}
      >
        {label}
        {isActive && (
          <span style={{
            display:        'inline-flex',
            alignItems:     'center',
            justifyContent: 'center',
            minWidth:       16,
            height:         16,
            borderRadius:   8,
            background:     'var(--title)',
            color:          '#fff',
            fontSize:       9,
            fontWeight:     700,
            padding:        '0 4px',
          }}>
            {count}
          </span>
        )}
        <span style={{ fontSize: 9, opacity: 0.55 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && options.length > 0 && (
        <div className="r-filter-menu" style={{
          position:  'absolute',
          top:       'calc(100% + 4px)',
          left:      0,
          zIndex:    200,
          background: 'var(--bg-paper)',
          border:    '1px solid var(--line-strong)',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          minWidth:  180,
          maxHeight: 280,
          overflowY: 'auto',
        }}>
          {searchable && (
            <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-paper)', padding: 8, borderBottom: '1px solid var(--line-strong)' }}>
              <input
                autoFocus
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                style={{
                  width: '100%', padding: '5px 8px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box',
                  background: 'var(--bg-sunk)', color: 'var(--fg)', border: '1px solid var(--line-strong)',
                  borderRadius: 4, outline: 'none',
                }}
              />
            </div>
          )}
          {shown.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--fg-3)', textAlign: 'center' }}>No matches</div>
          ) : shown.map((opt, i) => {
            const val     = optValue(opt);
            const lbl     = optLabel(opt);
            const cnt     = optCount(opt);
            const checked = selected.includes(val);
            // A heading only where the group changes, and only against what is
            // actually on screen — searching the list must not leave a heading
            // standing over nothing.
            const grp     = optGroup(opt);
            const header  = grp && grp !== (i > 0 ? optGroup(shown[i - 1]) : undefined) ? grp : null;
            return (
              <div key={val}>
              {header && (
                <div style={{
                  padding: '6px 12px 4px', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: 'var(--fg-3)', background: 'var(--bg-sunk)',
                  borderBottom: '1px solid var(--line)',
                }}>
                  {header}
                </div>
              )}
              <label
                style={{
                  display:    'flex',
                  alignItems: 'center',
                  gap:        8,
                  padding:    '7px 12px',
                  fontSize:   12,
                  cursor:     'pointer',
                  background: checked ? 'var(--accent-soft)' : 'transparent',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  style={{ accentColor: 'var(--brand-blue)', flexShrink: 0 }}
                />
                <span style={{ color: 'var(--fg)', flex: 1 }}>{lbl}</span>
                {cnt != null && (
                  <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{cnt}</span>
                )}
              </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
