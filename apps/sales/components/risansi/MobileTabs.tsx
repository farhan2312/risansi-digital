'use client';

import { useState, type ReactNode } from 'react';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'activity', label: 'Activity' },
  { key: 'contacts', label: 'Contacts' },
] as const;

/**
 * Mobile-only tab switcher for the Client 360 detail page. On a phone the page
 * is a ~6000px scroll; this groups the panels into Overview / Activity /
 * Contacts so a rep reaches any one in a tap. Desktop is unaffected: the tab
 * bar is hidden (CSS) and `.r-tabbed` does no filtering off-mobile, so every
 * panel renders as before. Panels opt into a group via `data-tabgroup`.
 */
export function MobileTabs({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<string>('overview');
  return (
    <>
      <div className="r-detail-tabs" role="tablist" aria-label="Client sections" style={{
        gap: 6, marginBottom: 12, position: 'sticky', top: 0, zIndex: 8,
        background: 'var(--bg)', padding: '6px 0',
      }}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1, minHeight: 40, borderRadius: 8, fontSize: 13, fontWeight: 600,
                fontFamily: 'inherit', cursor: 'pointer',
                border: `1px solid ${active ? 'var(--brand-blue)' : 'var(--line-strong)'}`,
                background: active ? 'var(--brand-blue)' : 'var(--bg-paper)',
                color: active ? '#fff' : 'var(--fg-2)',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="r-tabbed" data-active={tab}>
        {children}
      </div>
    </>
  );
}
