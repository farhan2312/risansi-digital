'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { deleteComplaintAttachment } from '@/app/actions/risansi-complaints-v2';

// The files on a complaint, by slot. The CAPA slot is the one that matters:
// for an S1 or S2 complaint, nothing closes until something sits in it.

export interface AttachmentMeta {
  id: number; category: string; file_name: string; mime_type: string; byte_size: number;
  caption: string | null; uploaded_by: string | null; uploaded_at: string;
}

export const SLOTS: { key: string; label: string; hint: string }[] = [
  { key: 'complaint', label: 'Complaint attachments', hint: 'Photos, videos, emails and documents from the customer.' },
  { key: 'photo',     label: 'Photos',                hint: 'Of the part, the site, the damage.' },
  { key: 'capa',      label: 'CAPA document',         hint: 'The RIL/MKT/03 report, done in its workbook and attached here. Closes an S1 or S2.' },
  { key: 'customer',  label: 'Customer communication', hint: 'Letters, emails, confirmations.' },
  { key: 'other',     label: 'Other documents (MOM)', hint: '' },
];

const fmtSize = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export function ComplaintAttachments({ complaintId, files, canEdit, canEditCapa, only }: {
  complaintId: number;
  files: AttachmentMeta[];
  canEdit: boolean;
  canEditCapa: boolean;
  /** Restrict to these slots (page 1 shows complaint files; page 6 shows all). */
  only?: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [, start] = useTransition();

  const upload = async (category: string, picked: File[]) => {
    if (!picked.length) return;
    setBusy(category); setErr('');
    for (const f of picked) {
      const fd = new FormData();
      fd.set('file', f); fd.set('category', category);
      const res = await fetch(`/api/risansi/complaints/${complaintId}/attachments`, { method: 'POST', body: fd });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Could not upload ${f.name}.`); break; }
    }
    setBusy(null);
    router.refresh();
  };

  const remove = (id: number) => {
    if (!confirm('Remove this file? It cannot be recovered.')) return;
    start(async () => {
      const res = await deleteComplaintAttachment(id);
      if (!res.ok) { setErr(res.error); return; }
      router.refresh();
    });
  };

  const slots = only ? SLOTS.filter(s => only.includes(s.key)) : SLOTS;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
      {slots.map(slot => {
        const mine = files.filter(f => f.category === slot.key);
        const may = slot.key === 'capa' ? canEditCapa : canEdit;
        const isCapa = slot.key === 'capa';
        return (
          <div key={slot.key} style={{ ...SLOT, borderColor: isCapa ? (mine.length ? 'var(--pos)' : 'var(--warn, #B45309)') : 'var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{slot.label}</span>
              <span style={{ fontSize: 10.5, color: 'var(--fg-3)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>{mine.length || (isCapa ? 'missing' : '—')}</span>
            </div>
            {slot.hint && <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 2, lineHeight: 1.4 }}>{slot.hint}</div>}
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {mine.map(f => (
                <li key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <a href={`/api/risansi/complaint-attachment/${f.id}`} target="_blank" rel="noreferrer"
                    style={{ color: 'var(--brand-blue, #1A5CB8)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={f.file_name}>
                    {/^image\//.test(f.mime_type) ? '🖼' : f.mime_type === 'application/pdf' ? '📄' : '📎'} {f.file_name}
                  </a>
                  <span style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{fmtSize(f.byte_size)}</span>
                  {may && <button type="button" onClick={() => remove(f.id)} title="Remove" style={X}>×</button>}
                </li>
              ))}
            </ul>
            {may && (
              <label style={{ ...UP, marginTop: 8, cursor: busy ? 'wait' : 'pointer', opacity: busy && busy !== slot.key ? 0.6 : 1 }}>
                {busy === slot.key ? 'Uploading…' : '⤒ Add file'}
                <input type="file" multiple disabled={!!busy} style={{ display: 'none' }}
                  accept={isCapa ? '.pdf,.xlsx,.xls,.docx,.doc,image/*' : undefined}
                  onChange={e => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; upload(slot.key, picked); }} />
              </label>
            )}
          </div>
        );
      })}
      {err && <div style={{ gridColumn: '1 / -1', padding: '8px 11px', borderRadius: 6, background: 'var(--neg-soft)', border: '1px solid var(--neg)', color: 'var(--neg-strong, var(--neg))', fontSize: 12 }}>{err}</div>}
    </div>
  );
}

const SLOT: CSSProperties = { padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg-paper)' };
const UP: CSSProperties = { display: 'inline-block', padding: '5px 10px', fontSize: 11.5, fontWeight: 600, border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-paper)', color: 'var(--fg)' };
const X: CSSProperties = { border: 'none', background: 'transparent', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' };
