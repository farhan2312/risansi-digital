'use client';

import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { uploadPumps } from '@/app/actions/risansi-pumps';
import { SortTH, useTableSort } from '@/components/risansi/SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';
import type { PumpUploadResult } from '@/app/actions/risansi-pumps';

// ── Types ──────────────────────────────────────────────────────

type RowStatus = 'valid' | 'invalid_code' | 'checking';

interface UploadRow {
  cust:        string;   // raw ERP customer code (CUST)
  code:        string;   // reversed -> clients.code
  custName:    string;   // CUST_NAME (display only)
  ecNo:        string;
  soNo:        string;
  srNo:        string;   // PUMP_SL_NO
  model:       string;
  liquid:      string;
  capacity:    string;
  head:        string;
  status:      RowStatus;
  statusMsg:   string;
  dbClientName?: string;
}

// Problems first when the Status column is clicked. A pump sheet runs to
// hundreds of serials and the handful that match no client are what decides
// whether to import or go back and fix the file; hunting them by eye is the
// work this saves. Unsorted until clicked, so the sheet's own row order — the
// thing you need to correct the spreadsheet — is what you see first.
const STATUS_ORDER = ['invalid_code', 'checking', 'valid'] as const;

const COLS: SortableColumn<UploadRow>[] = [
  { key: 'status', kind: 'status', order: STATUS_ORDER },
  { key: 'cust', kind: 'text' },
  { key: 'dbClientName', kind: 'text', value: r => r.dbClientName ?? r.statusMsg },
  { key: 'model', kind: 'text' },
  { key: 'srNo', kind: 'text' },
  { key: 'ecNo', kind: 'text' },
  { key: 'soNo', kind: 'text' },
  { key: 'liquid', kind: 'text' },
];

type Stage = 'empty' | 'validating' | 'preview' | 'saving' | 'done';

// ERP CUST code -> portal clients.code is a 4-2-4 reversal (A00101HOSH -> HOSH01A001).
function reverseCode(s: string): string {
  const c = (s ?? '').trim().toUpperCase();
  const m = c.match(/^(.{4})(\d\d)(.{4})$/);
  return m ? m[3] + m[2] + m[1] : c;
}
const cell = (v: unknown) => (v == null ? '' : String(v).trim());

const TH = {
  padding: '9px 12px', fontSize: 11, fontWeight: 600,
  color: 'var(--fg-3)', textTransform: 'uppercase' as const,
  letterSpacing: '0.06em', borderBottom: '2px solid var(--line)',
  whiteSpace: 'nowrap' as const, background: 'var(--bg-elev)',
};

// ── Component ─────────────────────────────────────────────────

export function PumpUploadBox() {
  const [dragOver, setDragOver] = useState(false);
  const [rows,     setRows]     = useState<UploadRow[]>([]);
  // Above the stage branches below, because a hook cannot live inside one.
  const { rows: previewRows, sortBy } = useTableSort(rows, COLS);
  const [fileName, setFileName] = useState('');
  const [stage,    setStage]    = useState<Stage>('empty');
  const [result,   setResult]   = useState<PumpUploadResult | null>(null);
  const [error,    setError]    = useState('');

  const processFile = useCallback(async (file: File) => {
    if (!file) return;
    setFileName(file.name);
    setStage('validating');
    setError('');
    setRows([]);

    try {
      const buffer = await file.arrayBuffer();
      const wb     = XLSX.read(buffer, { type: 'array' });
      const ws     = wb.Sheets[wb.SheetNames[0]];
      const raw    = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];

      if (!raw || raw.length < 2) {
        setError('File appears empty or unreadable.');
        setStage('empty');
        return;
      }

      const headers = (raw[0] as string[]).map(h => h?.toString().trim().toLowerCase());
      const find = (pred: (h: string) => boolean) => headers.findIndex(h => pred(h));

      // CUST first (its name column also contains "cust"), then the rest.
      let colCust = find(h => h === 'cust');
      if (colCust < 0) colCust = find(h => (h.includes('cust') || h.includes('code')) && !h.includes('name'));
      const colName     = find(h => h.includes('name') && !h.includes('plate') && !h.includes('model'));
      const colModel    = find(h => h.includes('model'));
      const colSr       = find(h => h.includes('sl') || h.includes('serial'));
      const colEc       = find(h => h.includes('ec'));
      const colSo       = find(h => h.startsWith('so') || (h.includes('so') && h.includes('no')));
      const colLiquid   = find(h => h.includes('liquid'));
      const colCapacity = find(h => h.includes('capacity'));
      const colHead     = find(h => h.includes('head'));

      if (colCust < 0 || colModel < 0) {
        setError(
          'Wrong template format. Expected columns: CUST, CUST_NAME, EC_NO, SO_NO, PUMP_SL_NO, ' +
          'PUMP_MODEL_AS_NAME_PLATE, LIQUID, CAPACITY, HEAD. Please use the official template.',
        );
        setStage('empty');
        return;
      }

      const dataRows = raw.slice(1).filter(row => (row as unknown[])[colCust]?.toString().trim());
      if (dataRows.length === 0) {
        setError('No data rows found. Please fill in the template and try again.');
        setStage('empty');
        return;
      }
      if (dataRows.length > 8000) {
        setError('Too many rows. Maximum 8000 pumps per upload.');
        setStage('empty');
        return;
      }

      const at = (row: unknown[], i: number) => (i >= 0 ? row[i] : '');
      const parsed: UploadRow[] = dataRows.map(r => {
        const row  = r as unknown[];
        const cust = cell(at(row, colCust)).toUpperCase();
        return {
          cust,
          code:     reverseCode(cust),
          custName: cell(at(row, colName)),
          ecNo:     cell(at(row, colEc)),
          soNo:     cell(at(row, colSo)),
          srNo:     cell(at(row, colSr)),
          model:    cell(at(row, colModel)),
          liquid:   cell(at(row, colLiquid)),
          capacity: cell(at(row, colCapacity)),
          head:     cell(at(row, colHead)),
          status:   'checking' as const,
          statusMsg:'Validating…',
        };
      });

      setRows(parsed);

      // Validate the REVERSED codes against clients.code (reuses the generic endpoint).
      const codes = [...new Set(parsed.map(r => r.code))];
      const res   = await fetch('/api/risansi/validate-revenue-codes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ codes }),
      });
      const { found, notFound } = await res.json() as {
        found:    Record<string, { id: string; legal_name: string }>;
        notFound: string[];
      };

      setRows(parsed.map(row => {
        if (notFound.includes(row.code)) {
          return { ...row, status: 'invalid_code' as const, statusMsg: `Code "${row.cust}" (→ ${row.code}) not found` };
        }
        return { ...row, status: 'valid' as const, statusMsg: 'Ready to import', dbClientName: found[row.code]?.legal_name };
      }));
      setStage('preview');

    } catch (err: unknown) {
      setError('Failed to parse file: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setStage('empty');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleSave = async () => {
    const validRows = rows.filter(r => r.status === 'valid');
    if (validRows.length === 0) return;
    setStage('saving');
    try {
      const payload = validRows.map(r => ({
        client_code:   r.code,
        customer_code: r.cust,
        customer_name: r.custName,
        model:         r.model,
        sr_no:         r.srNo,
        ec_no:         r.ecNo,
        so_no:         r.soNo,
        liquid:        r.liquid,
        capacity:      r.capacity,
        head:          r.head,
        filename:      fileName,
      }));
      const res = await uploadPumps(payload);
      setResult(res);
      setStage('done');
    } catch (err: unknown) {
      setError('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
      setStage('preview');
    }
  };

  const reset = () => {
    setRows([]); setFileName(''); setStage('empty'); setResult(null); setError('');
  };

  // ── Stage: empty / validating ─────────────────────────────────

  if (stage === 'empty' || stage === 'validating') {
    return (
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 16 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>
          Upload Installed Pumps
        </div>

        {error && (
          <div style={{ margin: '16px 20px 0', padding: '10px 14px', background: 'var(--neg-soft)', border: '1px solid var(--neg)', borderLeft: '3px solid var(--neg-strong)', borderRadius: 6, color: 'var(--neg-strong)', fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => document.getElementById('pump-file-input')?.click()}
          style={{
            margin: 20,
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--line-strong, #CBD5E1)'}`,
            borderRadius: 10, padding: '48px 24px', textAlign: 'center',
            background: dragOver ? 'var(--accent-soft, #EBF1FB)' : 'var(--bg-elev)',
            transition: 'all 200ms', cursor: stage === 'validating' ? 'default' : 'pointer',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚙️</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg-2)' }}>
            {stage === 'validating' ? 'Validating…' : 'Drop your Excel file here or click to browse'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 6 }}>
            Accepts .xlsx files only · One row per pump serial
          </div>
          <input id="pump-file-input" type="file" accept=".xlsx" style={{ display: 'none' }} onChange={handleFileInput} />
        </div>
      </div>
    );
  }

  // ── Stage: preview ────────────────────────────────────────────

  if (stage === 'preview') {
    const validCount   = rows.filter(r => r.status === 'valid').length;
    const invalidCount = rows.length - validCount;

    return (
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 16 }}>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Preview · {fileName}</span>
            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--fg-3)' }}>{rows.length} rows parsed</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={reset} style={{ padding: '7px 14px', borderRadius: 6, fontFamily: 'inherit', border: '1px solid var(--line-strong, #CBD5E1)', background: 'var(--bg-paper)', cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={validCount === 0} style={{
              padding: '7px 16px', borderRadius: 6, fontFamily: 'inherit',
              background: validCount > 0 ? 'var(--accent)' : 'var(--bg-sunk)',
              color: validCount > 0 ? '#fff' : 'var(--fg-3)', border: 'none',
              cursor: validCount > 0 ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 500,
            }}>
              Save {validCount} pump{validCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>

        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: 'var(--pos-soft)', color: 'var(--pos-strong)' }}>
            ✓ {validCount} ready to import
          </span>
          {invalidCount > 0 && (
            <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: 'var(--neg-soft)', color: 'var(--neg-strong)' }}>
              ✗ {invalidCount} unmatched (skipped)
            </span>
          )}
        </div>

        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <SortTH {...sortBy('status')}       style={TH} align="left">Status</SortTH>
                <SortTH {...sortBy('cust')}         style={TH} align="left">CUST</SortTH>
                <SortTH {...sortBy('dbClientName')} style={TH} align="left">Client (from DB)</SortTH>
                <SortTH {...sortBy('model')}        style={TH} align="left">Model</SortTH>
                <SortTH {...sortBy('srNo')}         style={TH} align="left">Serial</SortTH>
                <SortTH {...sortBy('ecNo')}         style={TH} align="left">EC No</SortTH>
                <SortTH {...sortBy('soNo')}         style={TH} align="left">SO No</SortTH>
                <SortTH {...sortBy('liquid')}       style={TH} align="left">Liquid</SortTH>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i} style={{ background: row.status !== 'valid' ? 'var(--neg-soft)' : 'transparent', borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    {row.status === 'valid'
                      ? <span style={{ color: 'var(--pos-strong)', fontSize: 11, fontWeight: 600 }}>✓ Ready</span>
                      : <span title={row.statusMsg} style={{ color: 'var(--neg-strong)', fontSize: 11, fontWeight: 600, cursor: 'help' }}>✗ No client</span>}
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: row.status !== 'valid' ? 'var(--neg-strong)' : 'var(--fg)' }}>{row.cust}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--fg-2)' }}>
                    {row.dbClientName ?? <span style={{ color: 'var(--neg-strong)', fontStyle: 'italic', fontSize: 11 }}>{row.statusMsg}</span>}
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.model || '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.srNo || '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.ecNo || '—'}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.soNo || '—'}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--fg-2)' }}>{row.liquid || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Stage: saving ─────────────────────────────────────────────

  if (stage === 'saving') {
    return (
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 16, padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--fg)' }}>Saving pump data…</div>
      </div>
    );
  }

  // ── Stage: done ───────────────────────────────────────────────

  if (stage === 'done' && result) {
    return (
      <div style={{ background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 16, padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Upload Complete</div>
        <div style={{ fontSize: 13, color: 'var(--fg-3)', marginBottom: 4 }}>
          <span style={{ color: 'var(--pos-strong)', fontWeight: 600 }}>{result.inserted}</span> inserted ·{' '}
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{result.updated}</span> updated ·{' '}
          <span style={{ color: result.skipped > 0 ? 'var(--neg-strong)' : 'var(--fg-3)', fontWeight: result.skipped > 0 ? 600 : 400 }}>{result.skipped}</span> skipped
        </div>
        {result.skippedCodes.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--neg-strong)' }}>Codes not found: {result.skippedCodes.join(', ')}</div>
        )}
        <button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: '8px 20px', borderRadius: 6, fontFamily: 'inherit', background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
          Upload Another File
        </button>
      </div>
    );
  }

  return null;
}
