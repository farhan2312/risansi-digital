'use client';

import { localDateStr } from '@/lib/risansi-utils';

export function ExportPdfButton() {
  function handleExport() {
    const originalTitle  = document.title;
    document.title = `Risansi-Dashboard-${localDateStr()}`;
    window.print();
    setTimeout(() => { document.title = originalTitle; }, 1000);
  }

  return (
    <button
      onClick={handleExport}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 11px', fontSize: 12, fontFamily: 'inherit',
        fontWeight: 500, background: 'var(--bg-paper)',
        border: '1px solid var(--line-strong)',
        color: 'var(--fg)', borderRadius: 5, cursor: 'pointer',
      }}
    >
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
      Export PDF
    </button>
  );
}
