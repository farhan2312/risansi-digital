'use client';

import { useState, type CSSProperties } from 'react';
import { localDateStr } from '@/lib/risansi-utils';

// Export what is on screen — as a workbook, or on paper.
//
// Both respect the filters for the same reason: they carry the figures the
// page has already drawn, under the rep, financial year, account scope and
// tab that produced them. Neither re-queries anything, so neither can
// disagree with the screen it was taken from.

export interface ExportSheet {
  name: string;
  headers: string[];
  rows: { label: string; vals: (number | string | null)[]; strong?: boolean }[];
  moneyFrom?: number;
}

export function ExecExportButtons({ title, subtitle, sheets }: {
  title: string;
  subtitle?: string;
  sheets: ExportSheet[];
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const fileTitle = `${title} · ${localDateStr()}`;

  async function excel() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/risansi/exec-review/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: fileTitle, subtitle, sheets }),
      });
      if (!res.ok) { setErr(await res.text() || 'Could not build the workbook.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileTitle.replace(/[^\w.-]+/g, '-')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick rather than immediately: Safari has not
      // finished reading the blob when click() returns, and revoking there
      // gives a download of zero bytes.
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  function pdf() {
    // The browser's own print-to-PDF, which prints the page as filtered. The
    // document title becomes the suggested filename.
    const original = document.title;
    document.title = fileTitle;
    window.print();
    setTimeout(() => { document.title = original; }, 1000);
  }

  return (
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} className="no-print">
      <button type="button" onClick={excel} disabled={busy || sheets.length === 0} style={BTN}
        title={sheets.length === 0 ? 'Nothing on this tab to export' : 'Every table on this tab, one sheet each'}>
        <Icon />
        {busy ? 'Building…' : 'Excel'}
      </button>
      <button type="button" onClick={pdf} style={BTN} title="Print this page, as filtered">
        <Icon />
        PDF
      </button>
      {err && <span style={{ fontSize: 11, color: 'var(--neg-strong)' }}>{err}</span>}
    </div>
  );
}

const Icon = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const BTN: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 11px', fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)',
  color: 'var(--fg)', borderRadius: 5, cursor: 'pointer',
};
