'use client';

import {
  createContext, useContext, useState, useEffect, useCallback,
  type ReactNode, type CSSProperties,
} from 'react';

// Pick specific clients, then export just those.
//
// STATE LIVES IN sessionStorage, NOT THE URL. Two reasons. Ticking would
// otherwise be a server round trip per checkbox, which feels broken at the fifth
// click; and "select all" across 2,757 clients cannot be a list of codes in an
// address bar. It survives paging and filtering within the tab, which is the
// journey people actually take — tick a few, narrow the filter, page on, tick
// more — and is deliberately dropped on a hard refresh, because a selection you
// cannot see the extent of is worse than none.
//
// TWO MODES, because "select all across pages" is not a list:
//   explicit   a set of client codes the user ticked
//   all        everything the CURRENT FILTERS match, minus anything unticked
//              since. The server re-runs the filter rather than being handed
//              2,757 codes, so the set stays correct even if the data moves.

const KEY = 'risansi.client-selection.v1';

interface SelectionState {
  mode: 'explicit' | 'all';
  codes: string[];      // picked (explicit) or excluded (all)
}

interface Ctx {
  mode: 'explicit' | 'all';
  has: (code: string) => boolean;
  toggle: (code: string) => void;
  /** How many are selected. In `all` mode this needs the filtered total. */
  count: (filteredTotal: number) => number;
  selectAllMatching: () => void;
  selectPage: (codes: string[]) => void;
  clearPage: (codes: string[]) => void;
  clear: () => void;
  /** Adds sel / selall / selx to a URL, leaving its other params alone. */
  applyTo: (href: string) => string;
  ready: boolean;
}

const SelCtx = createContext<Ctx | null>(null);

export function ClientSelectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SelectionState>({ mode: 'explicit', codes: [] });
  // Rendered empty on the server, filled on mount. Without the flag the bar
  // flashes "0 selected" over a real selection on every page change.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) setState(JSON.parse(raw) as SelectionState);
    } catch { /* private mode, or corrupt — start empty */ }
    setReady(true);
  }, []);

  const write = useCallback((next: SelectionState) => {
    setState(next);
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not fatal */ }
  }, []);

  const set = new Set(state.codes);

  const value: Ctx = {
    mode: state.mode,
    ready,
    // In `all` mode the list holds EXCLUSIONS, so the sense inverts.
    has: (code) => (state.mode === 'all' ? !set.has(code) : set.has(code)),
    toggle: (code) => {
      const next = new Set(set);
      if (next.has(code)) next.delete(code); else next.add(code);
      write({ mode: state.mode, codes: [...next] });
    },
    count: (filteredTotal) =>
      state.mode === 'all' ? Math.max(0, filteredTotal - state.codes.length) : state.codes.length,
    selectAllMatching: () => write({ mode: 'all', codes: [] }),
    selectPage: (codes) => {
      if (state.mode === 'all') {
        // Ticking a whole page in all-mode means removing those exclusions.
        write({ mode: 'all', codes: state.codes.filter(c => !codes.includes(c)) });
      } else {
        write({ mode: 'explicit', codes: [...new Set([...state.codes, ...codes])] });
      }
    },
    clearPage: (codes) => {
      if (state.mode === 'all') {
        write({ mode: 'all', codes: [...new Set([...state.codes, ...codes])] });
      } else {
        write({ mode: 'explicit', codes: state.codes.filter(c => !codes.includes(c)) });
      }
    },
    clear: () => write({ mode: 'explicit', codes: [] }),
    applyTo: (href) => {
      const url = new URL(href, window.location.origin);
      url.searchParams.delete('sel');
      url.searchParams.delete('selall');
      url.searchParams.delete('selx');
      if (state.mode === 'all') {
        url.searchParams.set('selall', '1');
        if (state.codes.length) url.searchParams.set('selx', state.codes.join(','));
      } else if (state.codes.length) {
        url.searchParams.set('sel', state.codes.join(','));
      }
      return url.toString();
    },
  };

  return <SelCtx.Provider value={value}>{children}</SelCtx.Provider>;
}

export function useClientSelection(): Ctx | null {
  return useContext(SelCtx);
}

/** One row's checkbox. */
export function SelectClientBox({ code }: { code: string }) {
  const sel = useClientSelection();
  if (!sel) return null;
  return (
    <input
      type="checkbox"
      checked={sel.ready ? sel.has(code) : false}
      onChange={() => sel.toggle(code)}
      aria-label={`Select ${code}`}
      style={{ width: 14, height: 14, accentColor: 'var(--title)', cursor: 'pointer', verticalAlign: 'middle' }}
    />
  );
}

/** The header checkbox — this page only. Across-all-pages lives in the bar. */
export function SelectPageBox({ codes }: { codes: string[] }) {
  const sel = useClientSelection();
  if (!sel) return null;
  const on = codes.length > 0 && codes.every(c => sel.has(c));
  const some = !on && codes.some(c => sel.has(c));
  return (
    <input
      type="checkbox"
      checked={sel.ready ? on : false}
      ref={el => { if (el) el.indeterminate = sel.ready && some; }}
      onChange={() => (on ? sel.clearPage(codes) : sel.selectPage(codes))}
      aria-label="Select every client on this page"
      style={{ width: 14, height: 14, accentColor: 'var(--title)', cursor: 'pointer', verticalAlign: 'middle' }}
    />
  );
}

/**
 * The bar that appears once something is ticked.
 *
 * It offers "select all N matching" the way a mail client does, because ticking
 * a page and meaning the whole filtered set is the common mistake — and the
 * page checkbox genuinely cannot express it.
 */
export function ClientSelectionBar({ pageCodes, filteredTotal }: {
  pageCodes: string[]; filteredTotal: number;
}) {
  const sel = useClientSelection();
  if (!sel || !sel.ready) return null;
  const n = sel.count(filteredTotal);
  if (n === 0) return null;

  const wholePage = pageCodes.length > 0 && pageCodes.every(c => sel.has(c));
  const canOfferAll = sel.mode === 'explicit' && wholePage && filteredTotal > pageCodes.length;

  return (
    <div style={BAR}>
      <span style={{ fontSize: 12.5 }}>
        <strong style={{ fontFamily: 'var(--font-mono)' }}>{n.toLocaleString('en-IN')}</strong>
        {' '}client{n === 1 ? '' : 's'} selected
        {sel.mode === 'all' && <span style={{ color: 'var(--fg-3)' }}> · everything matching the current filters</span>}
      </span>

      {canOfferAll && (
        <button type="button" onClick={sel.selectAllMatching} style={LINK}>
          Select all {filteredTotal.toLocaleString('en-IN')} matching the filters
        </button>
      )}

      <button type="button" onClick={sel.clear} style={{ ...LINK, marginLeft: 'auto' }}>Clear selection</button>
    </div>
  );
}

const BAR: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
  padding: '9px 14px', marginTop: 8, borderRadius: 'var(--radius)',
  background: 'var(--accent-soft, rgba(26,92,184,0.08))',
  border: '1px solid var(--accent-line, var(--line-strong))',
};
const LINK: CSSProperties = {
  background: 'none', border: 'none', padding: 0, fontSize: 12,
  fontFamily: 'inherit', color: 'var(--accent)', cursor: 'pointer', fontWeight: 500,
};
