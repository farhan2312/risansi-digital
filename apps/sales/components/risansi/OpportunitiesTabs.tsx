'use client';

import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';

// Two views of the same (already server-filtered) opportunity data: a table and
// the kanban board. Filters live above this component and scope both queries, so
// switching tabs never re-fetches — it just swaps which server-rendered slot shows.
// The kanban tab also carries the Win Rate + Lost To panels, side by side beneath it.

const TAB_KEY = 'risansi.opps.tab';

export function OpportunitiesTabs({ table, kanban, winRate, lostTo }: {
  table: ReactNode; kanban: ReactNode; winRate: ReactNode; lostTo: ReactNode;
}) {
  // Default to the table (the primary view). Persist the choice so a filter
  // change — which remounts this component via a server navigation — doesn't
  // bounce the user off the Kanban tab.
  const [tab, setTab] = useState<'table' | 'kanban'>('table');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved === 'kanban' || saved === 'table') setTab(saved);
    } catch { /* localStorage unavailable — keep default */ }
  }, []);

  const pick = (t: 'table' | 'kanban') => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ }
  };

  return (
    <div>
      <div role="tablist" aria-label="Opportunity views" style={TABBAR}>
        <TabButton active={tab === 'table'}  onClick={() => pick('table')}>Table</TabButton>
        <TabButton active={tab === 'kanban'} onClick={() => pick('kanban')}>Kanban</TabButton>
      </div>

      {/* Both slots stay mounted; only the active one is shown. Keeping the kanban
          mounted preserves its per-column search + drag state across tab switches. */}
      <div style={{ display: tab === 'table' ? 'block' : 'none' }} role="tabpanel">
        {table}
      </div>
      <div style={{ display: tab === 'kanban' ? 'block' : 'none' }} role="tabpanel">
        {kanban}
        <div className="r-opps-panels" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          {winRate}
          {lostTo}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button" role="tab" aria-selected={active} onClick={onClick}
      style={{
        ...TAB,
        color: active ? 'var(--fg)' : 'var(--fg-3)',
        fontWeight: active ? 600 : 500,
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >
      {children}
    </button>
  );
}

const TABBAR: CSSProperties = {
  display: 'flex', gap: 2, marginBottom: 14, borderBottom: '1px solid var(--line)',
};
const TAB: CSSProperties = {
  padding: '8px 16px', fontSize: 13, fontFamily: 'inherit', background: 'none',
  border: 'none', cursor: 'pointer', marginBottom: -1,
};
