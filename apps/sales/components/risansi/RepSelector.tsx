'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';

interface Rep {
  id:       string;
  name:     string;
  zone:     string | null;
  route:    string | null;
  rep_code?: string | null;
}

interface Props {
  label:        string;
  paramName:    string;   // hidden input name for id  e.g. 'primary_rep_id'
  nameName:     string;   // hidden input name for rep name
  defaultId?:   number | string | null;
  defaultName?: string | null;
  required?:    boolean;
}

export function RepSelector({ label, paramName, nameName, defaultId, defaultName, required }: Props) {
  const [reps, setReps]             = useState<Rep[]>([]);
  const [query, setQuery]           = useState('');
  const [open, setOpen]             = useState(false);
  const [selId, setSelId]           = useState<string>(defaultId != null ? String(defaultId) : '');
  const [selName, setSelName]       = useState<string>(defaultName ?? '');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/risansi/reps').then(r => r.json()).then(setReps).catch(() => {});
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = query.trim()
    ? reps.filter(r =>
        r.name.toLowerCase().includes(query.toLowerCase()) ||
        (r.zone  ?? '').toLowerCase().includes(query.toLowerCase()) ||
        (r.route ?? '').toLowerCase().includes(query.toLowerCase())
      )
    : reps;

  function select(rep: Rep | null) {
    setSelId(rep?.id ?? '');
    setSelName(rep?.name ?? '');
    setQuery('');
    setOpen(false);
  }

  return (
    <div>
      <label style={LBL}>
        {label}
        {required && <span style={{ color: 'var(--neg)', marginLeft: 2 }}>*</span>}
      </label>

      {/* Hidden fields that get submitted with the form */}
      <input type="hidden" name={paramName} value={selId} />
      <input type="hidden" name={nameName}  value={selName} />

      {selId ? (
        // Selected chip
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            flex: 1, padding: '7px 10px',
            background: 'var(--accent-soft)', border: '1px solid var(--brand-blue)',
            borderRadius: 6, fontSize: 13, color: 'var(--brand-blue)', fontWeight: 500,
          }}>
            {selName}
          </div>
          <button type="button" onClick={() => select(null)} style={CLEAR_BTN} title="Clear">×</button>
        </div>
      ) : (
        <div ref={ref} style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder={`Search ${label.toLowerCase()}…`}
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            style={INP}
          />
          {open && (
            <div style={DROPDOWN}>
              {/* No-rep option */}
              <div
                onClick={() => select(null)}
                style={OPTION_STYLE}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <span style={{ color: 'var(--fg-3)', fontStyle: 'italic', fontSize: 12 }}>— No rep assigned</span>
              </div>

              {filtered.slice(0, 40).map(r => (
                <div
                  key={r.id}
                  onClick={() => select(r)}
                  style={OPTION_STYLE}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{r.name}</span>
                  {(r.zone || r.route) && (
                    <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 6 }}>
                      {[r.zone, r.route].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
              ))}

              {filtered.length === 0 && (
                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--fg-3)', fontStyle: 'italic' }}>
                  No reps found
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── OwnerSelector — multi-select variant ───────────────────────
// Selects multiple users and emits ONE hidden field (named `paramName`)
// holding a JSON array of the selected user ids. Used by ClientFormDrawer
// for the flat multi-owner model. Shares the reps endpoint + styles.

interface OwnerSelectorProps {
  label:       string;
  paramName:   string;            // hidden input name  e.g. 'owner_ids'
  defaultIds?: Array<number | string> | null;
  required?:   boolean;
}

export function OwnerSelector({ label, paramName, defaultIds, required }: OwnerSelectorProps) {
  const [reps, setReps]   = useState<Rep[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen]   = useState(false);
  const [selIds, setSelIds] = useState<string[]>(
    (defaultIds ?? []).map(String),
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/risansi/reps').then(r => r.json()).then(setReps).catch(() => {});
  }, []);

  // Re-seed if the parent supplies ids asynchronously (e.g. fetched on edit).
  // Guard against re-running once the user has started editing the selection:
  // only adopt the parent ids while the local set is still empty.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    if (defaultIds && defaultIds.length) {
      seeded.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelIds(defaultIds.map(String));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(defaultIds)]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const repById = (id: string) => reps.find(r => String(r.id) === id);

  const filtered = (query.trim()
    ? reps.filter(r =>
        r.name.toLowerCase().includes(query.toLowerCase()) ||
        (r.zone  ?? '').toLowerCase().includes(query.toLowerCase()) ||
        (r.route ?? '').toLowerCase().includes(query.toLowerCase()),
      )
    : reps
  ).filter(r => !selIds.includes(String(r.id)));

  function add(rep: Rep) {
    setSelIds(ids => ids.includes(String(rep.id)) ? ids : [...ids, String(rep.id)]);
    setQuery('');
    setOpen(false);
  }
  function remove(id: string) {
    setSelIds(ids => ids.filter(x => x !== id));
  }

  return (
    <div>
      <label style={LBL}>
        {label}
        {required && <span style={{ color: 'var(--neg)', marginLeft: 2 }}>*</span>}
      </label>

      {/* Single hidden field — JSON array of ids */}
      <input type="hidden" name={paramName} value={JSON.stringify(selIds.map(n => parseInt(n, 10)))} />

      {/* Selected chips */}
      {selIds.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {selIds.map(id => {
            const rep = repById(id);
            return (
              <span key={id} style={CHIP}>
                {rep?.name ?? `#${id}`}
                <button type="button" onClick={() => remove(id)} style={CHIP_X} title="Remove">×</button>
              </span>
            );
          })}
        </div>
      )}

      {/* Search + dropdown */}
      <div ref={ref} style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder={selIds.length ? 'Add another owner…' : `Search ${label.toLowerCase()}…`}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          style={INP}
        />
        {open && (
          <div style={DROPDOWN}>
            {filtered.slice(0, 40).map(r => (
              <div
                key={r.id}
                onClick={() => add(r)}
                style={OPTION_STYLE}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <span style={{ fontWeight: 500, fontSize: 13 }}>{r.name}</span>
                {(r.zone || r.route) && (
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 6 }}>
                    {[r.zone, r.route].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--fg-3)', fontStyle: 'italic' }}>
                {reps.length === 0 ? 'Loading…' : 'No more users'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const LBL: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
};

const CHIP: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '4px 6px 4px 10px',
  background: 'var(--accent-soft)', border: '1px solid var(--brand-blue)',
  borderRadius: 14, fontSize: 12, color: 'var(--brand-blue)', fontWeight: 500,
};

const CHIP_X: CSSProperties = {
  width: 16, height: 16, display: 'grid', placeItems: 'center',
  background: 'transparent', border: 'none', color: 'var(--brand-blue)',
  borderRadius: '50%', cursor: 'pointer', fontSize: 14, lineHeight: 1,
};

const INP: CSSProperties = {
  display: 'block', width: '100%', padding: '8px 10px',
  fontSize: 13, fontFamily: 'inherit',
  background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)',
  borderRadius: 6, color: 'var(--fg)', outline: 'none',
  boxSizing: 'border-box',
};

const DROPDOWN: CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6,
  boxShadow: '0 4px 20px rgba(0,0,0,0.12)', maxHeight: 240, overflowY: 'auto',
  marginTop: 2,
};

const OPTION_STYLE: CSSProperties = {
  padding: '9px 12px', cursor: 'pointer',
  borderBottom: '1px solid var(--line)',
  display: 'flex', alignItems: 'center',
  transition: 'background 0.1s',
};

const CLEAR_BTN: CSSProperties = {
  width: 30, height: 34, display: 'grid', placeItems: 'center',
  background: 'transparent', border: '1px solid var(--line-strong)',
  color: 'var(--fg-3)', borderRadius: 6, cursor: 'pointer',
  fontSize: 16, flexShrink: 0,
};
