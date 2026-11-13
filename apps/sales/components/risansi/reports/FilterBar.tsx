'use client';

// The page filter bar: one date range and five account filters.
//
// These are the filters that apply to EVERY card on the page, which is the
// whole point of them — a management report is read by changing one thing and
// watching ten numbers move together. A card whose table cannot answer one of
// them says so on its own frame rather than silently ignoring it.
//
// Deliberately NOT in the URL. The viewer's filters are a reading position,
// not a destination: a shared report link should open on the filters its
// author saved, and the reader's own poking about should not rewrite the link
// they were sent. The one thing a link does carry is which report.

import { useEffect, useRef, useState } from 'react';
import { DATE_PRESETS } from '@/lib/risansi-date-presets';
import type { PageFilters } from '@/lib/custom-analytics/types';

export interface FilterOptions {
  states: string[];
  industries: string[];
  clientTypes: string[];
  tiers: string[];
  reps: { id: number; name: string }[];
}

export function FilterBar({ value, options, onChange, saved }: {
  value: PageFilters;
  options: FilterOptions;
  onChange: (f: PageFilters) => void;
  /** The page's own saved filters, so "Reset" means back to those. */
  saved: PageFilters;
}) {
  const set = (patch: Partial<PageFilters>) => onChange({ ...value, ...patch });
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <select
        value={value.datePreset ?? (value.dateFrom || value.dateTo ? 'Custom' : '')}
        onChange={e => {
          const v = e.target.value;
          if (!v) set({ datePreset: undefined, dateFrom: undefined, dateTo: undefined });
          else if (v === 'Custom') set({ datePreset: 'Custom' });
          else set({ datePreset: v, dateFrom: undefined, dateTo: undefined });
        }}
        style={SELECT}
      >
        <option value="">All time</option>
        {DATE_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
        <option value="Custom">Custom…</option>
      </select>

      {value.datePreset === 'Custom' && (
        <>
          <input type="date" value={value.dateFrom ?? ''} style={SELECT}
                 onChange={e => set({ dateFrom: e.target.value || undefined })} />
          <span style={{ color: 'var(--fg-4)', fontSize: 11 }}>to</span>
          <input type="date" value={value.dateTo ?? ''} style={SELECT}
                 onChange={e => set({ dateTo: e.target.value || undefined })} />
        </>
      )}

      <MultiPick label="State" options={options.states.map(s => ({ v: s, l: s }))}
                 selected={(value.states ?? []).map(String)}
                 onChange={v => set({ states: v.length ? v : undefined })} />
      <MultiPick label="Industry" options={options.industries.map(s => ({ v: s, l: s }))}
                 selected={(value.industries ?? []).map(String)}
                 onChange={v => set({ industries: v.length ? v : undefined })} />
      <MultiPick label="Direct / OEM" options={options.clientTypes.map(s => ({ v: s, l: s }))}
                 selected={(value.clientTypes ?? []).map(String)}
                 onChange={v => set({ clientTypes: v.length ? v : undefined })} />
      <MultiPick label="Tier" options={options.tiers.map(s => ({ v: s, l: s }))}
                 selected={(value.tiers ?? []).map(String)}
                 onChange={v => set({ tiers: v.length ? v : undefined })} />
      <MultiPick label="Sales rep" options={options.reps.map(r => ({ v: String(r.id), l: r.name }))}
                 selected={(value.reps ?? []).map(String)}
                 onChange={v => set({ reps: v.length ? v.map(Number) : undefined })} />

      {dirty && (
        <button type="button" onClick={() => onChange(saved)} style={{ ...SELECT, cursor: 'pointer', color: 'var(--fg-3)' }}>
          Reset filters
        </button>
      )}
    </div>
  );
}

/** A small dropdown of checkboxes. Shows how many are on, so the bar reads at a glance. */
function MultiPick({ label, options, selected, onChange }: {
  label: string; options: { v: string; l: string }[]; selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  if (!options.length) return null;
  const on = new Set(selected);
  const shown = q ? options.filter(o => o.l.toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (v: string) => {
    const next = new Set(on);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange([...next]);
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ ...SELECT, cursor: 'pointer',
                 borderColor: on.size ? 'var(--accent-line)' : 'var(--line)',
                 color: on.size ? 'var(--fg)' : 'var(--fg-2)' }}>
        {label}{on.size ? ` · ${on.size}` : ''} <span style={{ color: 'var(--fg-4)' }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 40,
          minWidth: 210, maxHeight: 290, overflowY: 'auto',
          background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
          borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 6,
        }}>
          {options.length > 8 && (
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
                   style={{ ...SELECT, width: '100%', marginBottom: 4 }} />
          )}
          {on.size > 0 && (
            <button type="button" onClick={() => onChange([])}
              style={{ ...LINK, marginBottom: 4 }}>Clear {on.size}</button>
          )}
          {shown.map(o => (
            <label key={o.v} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 4px',
                                      fontSize: 12, color: 'var(--fg-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={on.has(o.v)} onChange={() => toggle(o.v)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.l}</span>
            </label>
          ))}
          {!shown.length && <div style={{ fontSize: 11, color: 'var(--fg-4)', padding: 4 }}>Nothing matches.</div>}
        </div>
      )}
    </div>
  );
}

const SELECT: React.CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 5,
  padding: '4px 8px', fontSize: 11.5, color: 'var(--fg-2)', fontFamily: 'inherit',
};

const LINK: React.CSSProperties = {
  background: 'none', border: 'none', padding: '2px 4px', fontSize: 11,
  color: 'var(--accent)', cursor: 'pointer', textAlign: 'left', width: '100%',
};
