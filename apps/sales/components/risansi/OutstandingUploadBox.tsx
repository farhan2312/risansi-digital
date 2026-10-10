'use client';

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import * as XLSX from 'xlsx';
import { uploadOutstanding, type OutstandingUploadResult } from '@/app/actions/risansi-outstanding';
import { SortTH, useTableSort } from '@/components/risansi/SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';

type RowStatus = 'valid' | 'invalid_code';

interface UploadRow {
  code:          string;
  debtor:        string;
  clientName:    string;   // from sheet (display)
  amount:        number;
  status:        RowStatus;
  dbClientName?: string;
}

type Stage = 'empty' | 'validating' | 'preview' | 'saving' | 'done';

// Sorting the preview is how you find the rows that will not import. A sheet
// of 900 debtors has its bad codes scattered through it, and reading for them
// is the job the Status column can just do. 'invalid_code' before 'valid' so
// one click puts the problems on top; until then the sheet's own row order
// holds, which is what you need to go back and fix the file.
const STATUS_ORDER = ['invalid_code', 'valid'] as const;

const COLS: SortableColumn<UploadRow>[] = [
  { key: 'status', kind: 'status', order: STATUS_ORDER },
  { key: 'code', kind: 'text' },
  { key: 'dbClientName', kind: 'text', value: r => r.dbClientName ?? r.clientName },
  { key: 'debtor', kind: 'text' },
  { key: 'amount', kind: 'number' },
];

const TH: CSSProperties = {
  padding: '9px 12px', fontSize: 11, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em',
  borderBottom: '2px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)',
};
const num = (v: unknown) => parseFloat(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;

export function OutstandingUploadBox() {
  const [dragOver, setDragOver] = useState(false);
  const [rows,   setRows]   = useState<UploadRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [asOf,   setAsOf]   = useState('');   // YYYY-MM-DD
  const [stage,  setStage]  = useState<Stage>('empty');
  const [result, setResult] = useState<OutstandingUploadResult | null>(null);
  const [error,  setError]  = useState('');
  // Above the stage branches below, because a hook cannot live inside one.
  const { rows: previewRows, sortBy } = useTableSort(rows, COLS);

  // Default the as-of date to today (set client-side to avoid a hydration mismatch).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAsOf(new Date().toISOString().slice(0, 10)); }, []);

  const processFile = useCallback(async (file: File) => {
    if (!file) return;
    setFileName(file.name); setStage('validating'); setError(''); setRows([]);
    try {
      const wb  = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];
      if (!raw || raw.length < 2) { setError('File appears empty or unreadable.'); setStage('empty'); return; }

      const headers = (raw[0] as string[]).map(h => h?.toString().trim().toLowerCase());
      const colCode   = headers.findIndex(h => h.includes('subledger') || h.includes('code'));
      const colDebtor = headers.findIndex(h => h.includes('debtor'));
      const colName   = headers.findIndex(h => h.includes('name'));
      const colAmount = headers.findIndex(h => h.includes('outstanding') || h.includes('amount') || h.includes('total'));
      if (colCode < 0 || colAmount < 0) {
        setError('Wrong template. Expected columns: Subledger Code, Debtor, Name, Total Outstanding. Please use the official template.');
        setStage('empty'); return;
      }

      const dataRows = (raw.slice(1) as string[][]).filter(r => r[colCode]?.toString().trim());
      if (dataRows.length === 0) { setError('No data rows found.'); setStage('empty'); return; }
      if (dataRows.length > 2000) { setError('Too many rows. Maximum 2000 per upload.'); setStage('empty'); return; }

      const parsed: UploadRow[] = dataRows.map(r => ({
        code:       r[colCode]?.toString().trim().toUpperCase() ?? '',
        debtor:     colDebtor >= 0 ? (r[colDebtor]?.toString().trim().toUpperCase() ?? '') : '',
        clientName: colName   >= 0 ? (r[colName]?.toString().trim() ?? '') : '',
        amount:     num(r[colAmount]),
        status:     'valid',
      }));
      setRows(parsed);

      const codes = [...new Set(parsed.map(r => r.code))];
      const res = await fetch('/api/risansi/validate-revenue-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes }),
      });
      const { found, notFound } = await res.json() as {
        found: Record<string, { id: string; legal_name: string }>; notFound: string[];
      };
      setRows(parsed.map(r => notFound.includes(r.code)
        ? { ...r, status: 'invalid_code' as const }
        : { ...r, status: 'valid' as const, dbClientName: found[r.code]?.legal_name }));
      setStage('preview');
    } catch (err) {
      setError('Failed to parse file: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setStage('empty');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0]; if (f) processFile(f);
  }, [processFile]);

  const handleSave = async () => {
    const valid = rows.filter(r => r.status === 'valid');
    if (!valid.length || !asOf) return;
    setError('');
    setStage('saving');
    try {
      const res = await uploadOutstanding(
        valid.map(r => ({ client_code: r.code, debtor: r.debtor, amount: r.amount })),
        asOf, fileName,
      );
      if (!res.ok) {
        // A returned failure carries the real reason; only a THROWN one is
        // redacted. Show it, with the Postgres code and constraint when present.
        setError('Save failed: ' + res.error
          + (res.code ? ` [${res.code}]` : '')
          + (res.detail ? ` — ${res.detail}` : ''));
        setStage('preview');
        return;
      }
      setResult(res); setStage('done');
    } catch (err) {
      // Next.js redacts server-action errors in production, so the real message
      // never reaches the browser — it arrives as "An unexpected response was
      // received from the server". Saying that verbatim tells the user nothing,
      // so a redacted failure gets the explanation that actually fits: the save
      // is one transaction, so nothing was half-written and it is safe to retry.
      const raw = err instanceof Error ? err.message : '';
      const redacted = /unexpected response/i.test(raw)
        || Boolean((err as { digest?: string })?.digest);
      setError(redacted
        ? 'Save failed on the server. Nothing was changed — the upload is a single transaction, so the previous snapshot is still intact. Try again, and if it keeps failing send this file over.'
        : 'Save failed: ' + (raw || 'Unknown error'));
      setStage('preview');
    }
  };

  const reset = () => { setRows([]); setFileName(''); setStage('empty'); setResult(null); setError(''); };

  // ── empty / validating ──
  if (stage === 'empty' || stage === 'validating') {
    return (
      <div style={CARD}>
        <div style={CARD_H}>Upload Outstanding Data</div>
        <div style={{ padding: '14px 20px 0' }}>
          <div style={WARN}>
            ⚠ Each upload <b>replaces all</b> existing outstanding data. The previous month is cleared and this sheet becomes the current snapshot.
          </div>
          <label style={{ display: 'block', marginTop: 14, fontSize: 12, fontWeight: 600, color: 'var(--fg-2)' }}>
            Outstanding as of
            <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
              style={{ display: 'block', marginTop: 5, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
                background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)' }} />
          </label>
        </div>
        {error && <div style={{ margin: '14px 20px 0', ...ERR }}>⚠ {error}</div>}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('out-file-input')?.click()}
          style={{ margin: 20, border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--line-strong)'}`,
            borderRadius: 10, padding: '44px 24px', textAlign: 'center',
            background: dragOver ? 'var(--accent-soft)' : 'var(--bg-elev)', transition: 'all 200ms',
            cursor: stage === 'validating' ? 'default' : 'pointer' }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>💰</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-2)' }}>
            {stage === 'validating' ? 'Validating…' : 'Drop the outstanding Excel here or click to browse'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 6 }}>.xlsx only · matched on subledger (client) code</div>
          <input id="out-file-input" type="file" accept=".xlsx" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
        </div>
      </div>
    );
  }

  // ── preview ──
  if (stage === 'preview') {
    const valid   = rows.filter(r => r.status === 'valid');
    const invalid = rows.length - valid.length;
    // Deduplicated, because that is what the save does and what the database
    // ends up holding: one row per client code, the last occurrence winning.
    // Summing every row instead double-counts a client listed twice and shows a
    // total the snapshot will never match.
    const byCode  = new Map<string, number>();
    for (const r of valid) byCode.set(r.code.trim().toUpperCase(), r.amount);
    const validCount = byCode.size;
    const dupes      = valid.length - byCode.size;
    const total      = [...byCode.values()].reduce((sum, a) => sum + a, 0);
    return (
      <div style={CARD}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Preview · {fileName}</span>
            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--fg-3)' }}>{rows.length} rows · as of {asOf || '—'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={reset} style={BTN_GHOST}>Cancel</button>
            <button onClick={handleSave} disabled={validCount === 0 || !asOf}
              style={{ ...BTN_PRIMARY, background: (validCount && asOf) ? 'var(--accent)' : 'var(--bg-sunk)', color: (validCount && asOf) ? '#fff' : 'var(--fg-3)', cursor: (validCount && asOf) ? 'pointer' : 'not-allowed' }}>
              Replace with {validCount} row{validCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
        {error && <div style={{ margin: '14px 20px 0', ...ERR }}>⚠ {error}</div>}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={CHIP_POS}>✓ {validCount} ready</span>
          {invalid > 0 && <span style={CHIP_NEG}>✗ {invalid} unmatched (skipped)</span>}
          {dupes > 0 && (
            <span style={CHIP_NEG} title="The same client code appears more than once in the sheet. The last figure for each client is the one stored.">
              ⚠ {dupes} duplicate code{dupes !== 1 ? 's' : ''} — last value wins
            </span>
          )}
          <span style={CHIP_MONO}>Total: ₹{total.toLocaleString('en-IN')}</span>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <SortTH {...sortBy('status')}       style={TH} align="left">Status</SortTH>
                <SortTH {...sortBy('code')}         style={TH} align="left">Code</SortTH>
                <SortTH {...sortBy('dbClientName')} style={TH} align="left">Client (DB)</SortTH>
                <SortTH {...sortBy('debtor')}       style={TH} align="left">Debtor</SortTH>
                <SortTH {...sortBy('amount')}       style={TH} align="right">Outstanding ₹</SortTH>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, i) => (
                <tr key={i} style={{ background: r.status !== 'valid' ? 'var(--neg-soft)' : 'transparent', borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    {r.status === 'valid'
                      ? <span style={{ color: 'var(--pos-strong)', fontSize: 11, fontWeight: 600 }}>✓ Ready</span>
                      : <span style={{ color: 'var(--neg-strong)', fontSize: 11, fontWeight: 600 }}>✗ Code not found</span>}
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.code}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--fg-2)' }}>{r.dbClientName ?? <span style={{ color: 'var(--neg-strong)', fontStyle: 'italic', fontSize: 11 }}>{r.clientName || '—'}</span>}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>{r.debtor || '—'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.amount ? r.amount.toLocaleString('en-IN') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (stage === 'saving') {
    return <div style={{ ...CARD, padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>Replacing outstanding data…</div>
    </div>;
  }

  if (stage === 'done' && result) {
    return <div style={{ ...CARD, padding: '32px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Outstanding Replaced</div>
      <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
        <b style={{ color: 'var(--pos-strong)' }}>{result.matched}</b> clients updated ·{' '}
        <b style={{ color: result.skipped > 0 ? 'var(--neg-strong)' : 'var(--fg-3)' }}>{result.skipped}</b> skipped ·{' '}
        total ₹{result.grandTotal.toLocaleString('en-IN')}
      </div>
      {result.skippedCodes.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--neg-strong)' }}>Codes not found: {result.skippedCodes.slice(0, 30).join(', ')}{result.skippedCodes.length > 30 ? '…' : ''}</div>
      )}
      <button onClick={() => window.location.reload()} style={{ ...BTN_PRIMARY, marginTop: 20 }}>Done</button>
    </div>;
  }
  return null;
}

const CARD: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 16 };
const CARD_H: CSSProperties = { padding: '14px 20px', borderBottom: '1px solid var(--line)', fontSize: 14, fontWeight: 600, color: 'var(--fg)' };
const WARN: CSSProperties = { padding: '10px 14px', background: 'var(--warn-soft)', border: '1px solid var(--warn)', borderRadius: 6, color: 'var(--warn)', fontSize: 12.5, lineHeight: 1.5 };
const ERR: CSSProperties = { padding: '10px 14px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderRadius: 6, color: 'var(--neg-strong)', fontSize: 13 };
const BTN_PRIMARY: CSSProperties = { padding: '7px 16px', borderRadius: 6, fontFamily: 'inherit', background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500 };
const BTN_GHOST: CSSProperties = { padding: '7px 14px', borderRadius: 6, fontFamily: 'inherit', border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg-2)', cursor: 'pointer', fontSize: 13 };
const CHIP_POS: CSSProperties = { padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: 'var(--pos-soft)', color: 'var(--pos-strong)' };
const CHIP_NEG: CSSProperties = { padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: 'var(--neg-soft)', color: 'var(--neg-strong)' };
const CHIP_MONO: CSSProperties = { padding: '4px 10px', borderRadius: 20, fontSize: 12, background: 'var(--bg-elev)', color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' };
