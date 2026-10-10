'use client';

import { useState, useRef, useCallback } from 'react';
import { uploadRevenue } from '@/app/actions/risansi-admin-revenue';
import { parseMonthYear } from '@/lib/risansi-month-year';
import { SortTH, useTableSort } from '@/components/risansi/SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';

interface ParsedRow {
  client_code:  string;
  client_name:  string;
  month:        string;
  pump_value:   number;
  spare_value:  number;
  total_value:  number;
  status:       'found' | 'not_found' | 'duplicate';
  client_id?:   number;
}

interface UploadResult { inserted: number; skipped: number; }

// Problems first when Status is clicked: a code that matched nothing, then a
// duplicate, then the rows that are fine. Until a header is clicked the sheet's
// own row order stands, which is the order you need to correct the file in.
const STATUS_ORDER = ['not_found', 'duplicate', 'found'] as const;

/**
 * Month sorts chronologically. The cell shows the sheet's own text ("May-2026",
 * or "May-2026 H1" for a fortnight), and as text that orders Apr, Aug, Dec —
 * the alphabet, which is not an order any month has. The H1/H2 suffix is kept
 * on the end of the key so the first half of a month precedes the second.
 */
const monthKey = (raw: string): string | null => {
  const p = parseMonthYear(raw);
  if (!p) return null;
  const half = /H2/i.test(raw) ? '2' : /H1/i.test(raw) ? '1' : '0';
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${half}`;
};

const COLS: SortableColumn<ParsedRow>[] = [
  { key: 'client_code', kind: 'text' },
  { key: 'client_name', kind: 'text' },
  { key: 'month', kind: 'date', value: r => monthKey(r.month) },
  { key: 'pump_value', kind: 'number' },
  { key: 'spare_value', kind: 'number' },
  { key: 'total_value', kind: 'number' },
  { key: 'status', kind: 'status', order: STATUS_ORDER },
];

const HEADERS: { key: string; label: string; align: 'left' | 'right' }[] = [
  { key: 'client_code', label: 'Code',        align: 'left'  },
  { key: 'client_name', label: 'Client Name', align: 'left'  },
  { key: 'month',       label: 'Month',       align: 'left'  },
  { key: 'pump_value',  label: 'Pump ₹',  align: 'right' },
  { key: 'spare_value', label: 'Spare ₹', align: 'right' },
  { key: 'total_value', label: 'Total ₹', align: 'right' },
  { key: 'status',      label: 'Status',      align: 'left'  },
];

const MONTHS: Record<string, string> = {
  jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
};

function fmtInr(n: number) {
  if (n === 0) return '—';
  if (n >= 1e7) return `₹${(n/1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n/1e5).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export function RevenueUploadClient({ existingCodes }: { existingCodes: Set<string> }) {
  const [rows,    setRows]    = useState<ParsedRow[] | null>(null);
  // Above the early returns below, because a hook cannot live inside one.
  const { rows: previewRows, sortBy } = useTableSort(rows ?? [], COLS);
  const [file,    setFile]    = useState<File | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [result,  setResult]  = useState<UploadResult | null>(null);
  const [error,   setError]   = useState('');
  const [dragging,setDragging]= useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (f: File) => {
    setFile(f);
    setRows(null);
    setResult(null);
    setError('');
    try {
      const XLSX = await import('xlsx');
      const buf  = await f.arrayBuffer();
      const wb   = XLSX.read(buf, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const raw  = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      // Header matching is normalised, not exact.
      //
      // It used to be exact, and the template shipped from this very page has
      // headers that don't match: it says "Client Code" and "Pump Value" while
      // the parser looked for "Code" and "Pump Value (₹)". So anyone who
      // downloaded the template, filled it in and uploaded it had every row
      // silently dropped by the .filter() below, and saw "0 valid rows" with no
      // explanation. Fold case, strip spaces, punctuation and the currency
      // suffix, then match on aliases.
      const norm = (k: string) => k.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');
      const pick = (row: Record<string, unknown>, aliases: string[]): string => {
        for (const [k, v] of Object.entries(row)) {
          if (aliases.includes(norm(k))) return String(v ?? '').trim();
        }
        return '';
      };
      const money = (v: string) => Number(v.replace(/[₹,\s]/g, '')) || 0;

      const parsed: ParsedRow[] = raw.map(r => {
        const code       = pick(r, ['code', 'clientcode']).toUpperCase();
        const clientName = pick(r, ['clientname', 'client', 'name']);
        const month      = pick(r, ['month', 'period']);
        const pump       = money(pick(r, ['pumpvalue', 'pump']));
        const spare      = money(pick(r, ['sparevalue', 'spare', 'spares']));
        const total      = pump + spare;
        const found      = existingCodes.has(code);
        return {
          client_code: code,
          client_name: clientName,
          month,
          pump_value:  pump,
          spare_value: spare,
          total_value: total,
          status: (found ? 'found' : 'not_found') as ParsedRow['status'],
        };
      }).filter(r => r.client_code);

      // Silence is what hid the header bug for so long: rows vanished into the
      // filter and the page just showed nothing. If the file had data but not
      // one client code came out of it, say which columns were actually found.
      if (parsed.length === 0 && raw.length > 0) {
        const seen = Object.keys(raw[0] ?? {}).join(' · ') || '(none)';
        setError(
          `Read ${raw.length} row${raw.length === 1 ? '' : 's'} but couldn't find a client code in any of them. ` +
          `Columns in your file: ${seen}. A "Client Code" (or "Code") column is required.`,
        );
        return;
      }

      setRows(parsed);
    } catch (err) {
      setError(`Failed to parse file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [existingCodes]);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  }

  async function handleSave() {
    if (!rows) return;
    const toSave = rows.filter(r => r.status === 'found');
    setSaving(true); setError('');
    try {
      const res = await uploadRevenue(toSave.map(r => ({
        client_code:  r.client_code,
        month:        r.month,
        pump_value:   r.pump_value,
        spare_value:  r.spare_value,
      })));
      setResult(res);
      setRows(null); setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const validRows   = rows?.filter(r => r.status === 'found').length ?? 0;
  const invalidRows = rows?.filter(r => r.status === 'not_found').length ?? 0;

  return (
    <div>
      {/* Template download */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
        <a
          href="/revenue_upload_template.xlsx"
          download
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', fontSize: 12, fontWeight: 500,
            background: 'var(--bg-elev)', border: '1px solid var(--line-strong)',
            borderRadius: 5, color: 'var(--fg)', textDecoration: 'none',
          }}
        >
          ⬇ Download Template
        </a>
        <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
          Expected columns: Client Code · Client Name · Month · Pump Value · Spare Value &nbsp;·&nbsp; Month format: May-2026 for a whole month, or May-2026 H1 (days 1–15) / May-2026 H2 (16 to month end) for a fortnight
        </span>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--line-strong)'}`,
          borderRadius: 8, padding: '32px 24px', textAlign: 'center',
          background: dragging ? 'var(--accent-soft)' : 'var(--bg)',
          cursor: 'pointer', transition: 'all 0.15s', marginBottom: 16,
        }}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={onFileChange} />
        <div style={{ fontSize: 32, marginBottom: 8 }}>📤</div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>
          {file ? file.name : 'Drag and drop or click to upload .xlsx'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>Supports .xlsx and .xls files</div>
      </div>

      {/* Success result */}
      {result && (
        <div style={{
          padding: '12px 16px', marginBottom: 16,
          background: 'var(--pos-soft)', border: '1px solid rgba(5,150,105,0.25)',
          borderRadius: 6, fontSize: 13, color: 'var(--pos-strong)',
        }}>
          ✓ {result.inserted} row{result.inserted !== 1 ? 's' : ''} saved
          {result.skipped > 0 && `, ${result.skipped} skipped (code not found)`}
        </div>
      )}

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: 'var(--neg-soft)', border: '1px solid rgba(220,38,38,0.2)',
          borderRadius: 6, fontSize: 12, color: 'var(--neg-strong)',
        }}>
          {error}
        </div>
      )}

      {/* Preview table */}
      {rows && rows.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              Preview — {rows.length} rows
              {invalidRows > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--neg)' }}>
                  {invalidRows} code{invalidRows !== 1 ? 's' : ''} not found
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setRows(null); setFile(null); }} style={{
                padding: '6px 14px', fontSize: 12, fontFamily: 'inherit',
                border: '1px solid var(--line-strong)', borderRadius: 5,
                background: 'transparent', cursor: 'pointer', color: 'var(--fg)',
              }}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || validRows === 0}
                style={{
                  padding: '6px 16px', fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
                  background: (saving || validRows === 0) ? '#9CA3AF' : 'var(--accent-fill)',
                  color: 'var(--on-accent)', border: 'none', borderRadius: 5,
                  cursor: (saving || validRows === 0) ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving…' : `Confirm & Save ${validRows} row${validRows !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev)' }}>
                  {HEADERS.map(h => (
                    <SortTH key={h.key} {...sortBy(h.key)} align={h.align} style={{
                      padding: '8px 12px', fontSize: 10,
                      textTransform: 'uppercase', letterSpacing: '0.07em',
                      color: 'var(--fg-3)', borderBottom: '1px solid var(--line)',
                      whiteSpace: 'nowrap',
                    }}>{h.label}</SortTH>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                      {row.client_code}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{row.client_name || '—'}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.month}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmtInr(row.pump_value)}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmtInr(row.spare_value)}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right', fontWeight: 500 }}>{fmtInr(row.total_value)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {row.status === 'found'     && <span style={{ color: 'var(--pos)', fontSize: 11, fontWeight: 500 }}>✓ Client found</span>}
                      {row.status === 'not_found' && <span style={{ color: 'var(--neg)', fontSize: 11, fontWeight: 500 }}>✗ Code not found</span>}
                      {row.status === 'duplicate' && <span style={{ color: 'var(--warn)', fontSize: 11, fontWeight: 500 }}>⚠ Duplicate</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
