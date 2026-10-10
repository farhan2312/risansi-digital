'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';

export interface ExportRep { id: string; name: string }

// Opens the print-friendly planned-visits page (/print/planned-visits) for a
// chosen date range + optional rep, which the browser saves as PDF.
export function PlannedVisitsExport({ reps }: { reps: ExportRep[] }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');
  const [rep, setRep]   = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // Open pre-filled with whatever the page is already filtered to, so the export
  // matches what is on screen instead of quietly asking the same questions again.
  // The feed range (ffrom/fto) wins over the visit-reports range (rfrom/rto);
  // with neither set, the current calendar month. Set client-side to avoid a
  // hydration mismatch.
  const sp = useSearchParams();
  const pageFrom    = sp.get('ffrom') || sp.get('rfrom') || '';
  const pageTo      = sp.get('fto')   || sp.get('rto')   || '';
  const pagePurpose = sp.get('rpurpose') || '';
  const pageSearch  = sp.get('rsearch')  || '';

  useEffect(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    // Local date components (NOT toISOString — that converts to UTC and shifts
    // the day back in +TZ regions like IST/GST).
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrom(pageFrom || iso(first)); setTo(pageTo || iso(last));
  }, [pageFrom, pageTo]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const invalid = !from || !to || from > to;

  // The Excel export now carries the full visit reports, equipment, actions and
  // photo records, so a wide range is a genuinely big file rather than just more
  // rows. Warn on the span rather than counting first — that would cost a round
  // trip on every keystroke to tell the user something the dates already say.
  const spanDays = (!invalid && from && to)
    ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
    : 0;
  const wide = spanDays > 92;

  function generate() {
    if (invalid) return;
    const qs = new URLSearchParams({ from, to });
    if (rep) qs.set('rep', rep);
    window.open(`/print/planned-visits?${qs.toString()}`, '_blank');
    setOpen(false);
  }

  // The workbook carries the page's purpose and search filters too — the print
  // view has no way to express them, which is why the two can differ.
  function generateExcel() {
    if (invalid) return;
    const qs = new URLSearchParams({ from, to });
    if (rep)         qs.set('rep', rep);
    if (pagePurpose) qs.set('purpose', pagePurpose);
    if (pageSearch)  qs.set('search', pageSearch);
    window.location.href = `/api/risansi/visits/export?${qs.toString()}`;
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={BTN}>
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
        Export Visits
      </button>

      {open && (
        <div style={POP}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Export planned visits</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <label style={{ flex: 1 }}>
              <span style={LBL}>From</span>
              <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} style={INP} />
            </label>
            <label style={{ flex: 1 }}>
              <span style={LBL}>To</span>
              <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} style={INP} />
            </label>
          </div>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={LBL}>Rep</span>
            <select value={rep} onChange={e => setRep(e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
              <option value="">All reps</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          {(pagePurpose || pageSearch) && (
            <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginBottom: 10, lineHeight: 1.5 }}>
              Also applying this page&apos;s filters:{' '}
              {[pagePurpose && `purpose “${pagePurpose}”`, pageSearch && `search “${pageSearch}”`].filter(Boolean).join(', ')}.
              <br />Excel only — the PDF route plan cannot express them.
            </div>
          )}
          {wide && (
            <div style={{
              fontSize: 10.5, lineHeight: 1.5, marginBottom: 10, padding: '7px 9px', borderRadius: 6,
              color: 'var(--warn-strong)', background: 'var(--warn-soft)',
              border: '1px solid var(--warn)',
            }}>
              That is {spanDays} days. The Excel file includes every visit report,
              equipment record, action and photo entry in the range, so it may take
              a moment and run large.
            </div>
          )}
          {invalid && <div style={{ fontSize: 11, color: 'var(--neg)', marginBottom: 8 }}>Pick a valid date range (From ≤ To).</div>}
          <button onClick={generateExcel} disabled={invalid} style={{ ...GEN, opacity: invalid ? 0.5 : 1, cursor: invalid ? 'not-allowed' : 'pointer' }}>
            ⤓ Tour summary (Excel)
          </button>
          <button onClick={generate} disabled={invalid} style={{ ...GEN2, opacity: invalid ? 0.5 : 1, cursor: invalid ? 'not-allowed' : 'pointer' }}>
            Route plan (PDF)
          </button>
        </div>
      )}
    </div>
  );
}

const BTN: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', fontSize: 12, fontFamily: 'inherit', fontWeight: 500, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', color: 'var(--fg)', borderRadius: 5, cursor: 'pointer' };
const POP: CSSProperties = { position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100, width: 280, background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 8, boxShadow: '0 8px 28px rgba(10,22,40,0.16)', padding: 14 };
const LBL: CSSProperties = { display: 'block', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4 };
const INP: CSSProperties = { width: '100%', padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', boxSizing: 'border-box' };
const GEN: CSSProperties = { width: '100%', padding: '8px 0', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 6 };
const GEN2: CSSProperties = { width: '100%', marginTop: 7, padding: '7px 0', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', background: 'var(--bg-paper)', color: 'var(--fg)', border: '1px solid var(--line-strong)', borderRadius: 6 };
