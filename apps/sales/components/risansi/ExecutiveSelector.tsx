'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { CSSProperties } from 'react';

export interface SelRep { id: string; name: string }

// TSM picker for the Executive Review page. The review is scoped to the current
// fiscal year to date and turnover spans full FYs, so there is no month picker.
//
// The Accounts control decides which of a TSM's clients the whole review counts.
//
// It defaults to OWNED AND COVERED, which is what the Opportunities board has
// always counted. The default used to be owned-only, and the two pages then
// disagreed the moment you landed on them with nothing wrong in the data:
// Akshay Awasthi's quoted pipe read 2.74 Cr over 71 opportunities here and
// 4.72 Cr over 75 on the board, the four extra being three TKIL Industries
// quotes and one Racon, accounts he covers for Sudhir and Aviral.
//
// Showing them is not the same as crediting him with them. Attribution is the
// client's owner, always (lib/risansi-attribution.ts); scope is who the work
// appears for, which includes a covering rep. Both are true at once, and the
// Book & Coverage panel is where the page keeps them visibly apart.
//
// The narrower view is still one click away, because a manager asking "what is
// actually mine" is a fair question — it is just not the question the page
// should open on.
export interface FyOpt { value: string; label: string }

export function ExecutiveSelector({ reps, tsm, scope, fys, fy }: {
  reps: SelRep[]; tsm: string; scope: 'own' | 'all';
  /** Fiscal years to offer, newest first, built on the server. */
  fys: FyOpt[]; fy: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const update = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value); else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  };

  // The review used to be nailed to the current fiscal year, which meant a
  // quotation dated in February and entered in September was on the board and
  // on no view of this page. The year is a choice now; the current one carries
  // no param, so a shared link to "this year" keeps meaning this year.
  const year = (
    <label>
      <span style={LBL}>Fiscal year</span>
      <select
        value={fy}
        onChange={e => update('fy', e.target.value === fys[0]?.value ? '' : e.target.value)}
        style={{ ...SEL, minWidth: 130 }}
      >
        {fys.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
    </label>
  );

  // Owned + covered is the default, so it is the one that carries no param: a
  // shared link with nothing in it means the default, which is what the person
  // who copied the URL was looking at.
  const accounts = (
    <label>
      <span style={LBL}>Accounts</span>
      <select
        value={scope}
        onChange={e => update('scope', e.target.value === 'own' ? 'own' : '')}
        style={{ ...SEL, minWidth: 200 }}
      >
        <option value="all">Owned + covered</option>
        <option value="own">Accounts they own</option>
      </select>
    </label>
  );

  // A rep may only review themselves, so there is nothing to pick — show the
  // name as static text rather than a one-option dropdown. (The server scopes
  // the roster and validates the tsm param; this is presentation only.)
  if (reps.length <= 1) {
    const only = reps[0];
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div>
          <span style={LBL}>TSM</span>
          <div style={{ ...SEL, minWidth: 180, cursor: 'default', background: 'var(--bg-sunk)', color: 'var(--fg-2)' }}>
            {only?.name ?? '—'}
          </div>
        </div>
        {year}
        {accounts}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <label>
        <span style={LBL}>TSM</span>
        <select value={tsm} onChange={e => update('tsm', e.target.value)} style={{ ...SEL, minWidth: 180 }}>
          {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      {year}
      {accounts}
    </div>
  );
}

const LBL: CSSProperties = { display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4 };
const SEL: CSSProperties = { padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', cursor: 'pointer' };
