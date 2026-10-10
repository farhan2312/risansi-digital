'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { CSSProperties } from 'react';

export interface NameOpt { value: string; label: string }

// View / Client-Type / Name picker for the Account Review side of the
// Executive Review page. Writes to the URL so the server component re-queries.
export function AccountSelector({ ctype, name, options, typeOptions }: {
  ctype: string; name: string; options: NameOpt[];
  /** Client types that actually hold clients this viewer can see, with counts. */
  typeOptions: NameOpt[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const push = (next: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    router.push(`${pathname}?${p.toString()}`);
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label>
        <span style={LBL}>View</span>
        <select value="account" onChange={e => push({ view: e.target.value === 'tsm' ? '' : 'account' })} style={SEL}>
          <option value="tsm">TSM Review</option>
          <option value="account">Account Review</option>
        </select>
      </label>
      <label>
        <span style={LBL}>Client Type</span>
        {/* Changing type clears the name so the server picks that type's first option. */}
        <select value={ctype} onChange={e => push({ ctype: e.target.value, name: '' })} style={SEL}>
          {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label>
        <span style={LBL}>{ctype === 'group' ? 'Group' : 'Client'}</span>
        <select value={name} onChange={e => push({ name: e.target.value })} style={{ ...SEL, minWidth: 260 }}>
          {options.length === 0 && <option value="">— none —</option>}
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    </div>
  );
}

// Small view switch reused on the TSM side.
export function ViewSwitch() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <label>
      <span style={LBL}>View</span>
      <select
        value="tsm"
        onChange={e => {
          const p = new URLSearchParams(sp.toString());
          if (e.target.value === 'account') p.set('view', 'account'); else p.delete('view');
          router.push(`${pathname}?${p.toString()}`);
        }}
        style={SEL}
      >
        <option value="tsm">TSM Review</option>
        <option value="account">Account Review</option>
      </select>
    </label>
  );
}

const LBL: CSSProperties = { display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4 };
const SEL: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', cursor: 'pointer' };
