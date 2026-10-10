'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { CSSProperties } from 'react';

// The filters over the Sales Projection tab. Every control writes the URL,
// so the chart and the table read the same state and a view can be sent as
// a link. Multi-selects are comma-joined in one param.

export interface ProjectionOptions {
  reps: { id: number; name: string }[]; prodTypes: string[]; industries: string[]; ctypes: string[]; stages: string[]; probs: string[]; markets: string[];
}

export function ProjectionFilters({ options, value }: { options: ProjectionOptions; value: Record<string, string | undefined> }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const set = (key: string, v: string | undefined) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(key, v); else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  };
  const active = ['prep', 'pptype', 'pind', 'pctype', 'pstage', 'pprob', 'pmarket', 'pmin'].filter(k => value[k]).length;
  const clear = () => {
    const p = new URLSearchParams(sp.toString());
    for (const k of ['prep', 'pptype', 'pind', 'pctype', 'pstage', 'pprob', 'pmarket', 'pmin']) p.delete(k);
    router.push(`${pathname}?${p.toString()}`);
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', margin: '0 0 14px' }}>
      <Field label="Rep">
        <select value={value.prep ?? ''} onChange={e => set('prep', e.target.value || undefined)} style={{ ...SEL, minWidth: 170 }}>
          <option value="">All reps</option>
          {options.reps.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
        </select>
      </Field>
      <Multi label="Stage" k="pstage" opts={options.stages} value={value.pstage} onChange={set} />
      <Multi label="Product type" k="pptype" opts={options.prodTypes} value={value.pptype} onChange={set} />
      <Multi label="Industry" k="pind" opts={options.industries} value={value.pind} onChange={set} />
      <Multi label="Client type" k="pctype" opts={options.ctypes} value={value.pctype} onChange={set} />
      <Multi label="Probability" k="pprob" opts={options.probs} value={value.pprob} onChange={set} />
      <Multi label="Market" k="pmarket" opts={options.markets} value={value.pmarket} onChange={set} />
      <Field label="Min value">
        <select value={value.pmin ?? ''} onChange={e => set('pmin', e.target.value || undefined)} style={{ ...SEL, minWidth: 120 }}>
          <option value="">Any</option>
          <option value="500000">₹5 L+</option>
          <option value="1000000">₹10 L+</option>
          <option value="2500000">₹25 L+</option>
          <option value="5000000">₹50 L+</option>
          <option value="10000000">₹1 Cr+</option>
        </select>
      </Field>
      {active > 0 && <button type="button" onClick={clear} style={CLEAR}>Clear {active} filter{active === 1 ? '' : 's'}</button>}
    </div>
  );
}

// A multi-select as a dropdown of checkboxes would need state; a native
// <select multiple> is awkward on a phone. A single select with the chosen
// values shown, and "+ add" appending, keeps it to plain controls.
function Multi({ label, k, opts, value, onChange }: { label: string; k: string; opts: string[]; value?: string; onChange: (k: string, v: string | undefined) => void }) {
  const chosen = value ? value.split(',').filter(Boolean) : [];
  const remaining = opts.filter(o => !chosen.includes(o));
  return (
    <Field label={label}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        {chosen.map(c => (
          <button key={c} type="button" onClick={() => onChange(k, chosen.filter(x => x !== c).join(',') || undefined)} title="Remove"
            style={CHIP}>{c} ×</button>
        ))}
        <select value="" onChange={e => { if (e.target.value) onChange(k, [...chosen, e.target.value].join(',')); }}
          style={{ ...SEL, minWidth: chosen.length ? 60 : 130, color: chosen.length ? 'var(--fg-3)' : 'var(--fg-2)' }}>
          <option value="">{chosen.length ? '+ add' : `Any ${label.toLowerCase()}`}</option>
          {remaining.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={LBL}>{label}</span>{children}</label>;
}

const LBL: CSSProperties = { display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4 };
const SEL: CSSProperties = { padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', cursor: 'pointer', height: 34 };
const CHIP: CSSProperties = { padding: '6px 9px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, cursor: 'pointer', height: 34 };
const CLEAR: CSSProperties = { height: 34, padding: '0 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-paper)', color: 'var(--accent)', cursor: 'pointer' };
