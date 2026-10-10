'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { addComplaintNote, deleteComplaint } from '@/app/actions/risansi-complaints-v2';

// The running notes on a complaint — anything anyone wants on the record that
// is not a field: a phone call, a site update, a customer's mood. The status
// moves are not here; they are the lifecycle above. Admins also delete from
// here, because it is the one place nobody reaches by accident.

export interface NoteRow { body: string; created_by: string | null; created_at: string; author?: string | null }

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export function ComplaintNotes({ complaintId, notes, isAdmin }: { complaintId: number; notes: NoteRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();

  const send = () => {
    setErr('');
    start(async () => {
      const res = await addComplaintNote(complaintId, text);
      if (!res.ok) { setErr(res.error); return; }
      setText(''); router.refresh();
    });
  };
  const remove = () => {
    if (!confirm('Delete this complaint for good? The stage history and files go with it. This cannot be undone.')) return;
    start(async () => {
      const res = await deleteComplaint(complaintId);
      if (!res.ok) { setErr(res.error); return; }
      router.push('/risansi/complaints');
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="Add a note — a call, a site update, anything worth having on the record."
          style={{ flex: 1, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-sunk)', color: 'var(--fg)', resize: 'vertical', boxSizing: 'border-box' }}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && text.trim()) send(); }} />
        <button type="button" onClick={send} disabled={pending || !text.trim()} style={{ ...BTN, opacity: text.trim() ? 1 : 0.5 }}>{pending ? '…' : 'Add note'}</button>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--neg)' }}>{err}</div>}
      {notes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {notes.map((n, i) => (
            <div key={i} style={{ fontSize: 12.5, padding: '8px 0', borderBottom: '1px solid var(--line-2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginBottom: 2 }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{when(n.created_at)}</span>{(n.author || n.created_by) ? ` · ${n.author || n.created_by}` : ''}
              </div>
              {n.body}
            </div>
          ))}
        </div>
      )}
      {isAdmin && (
        <div style={{ marginTop: 18, paddingTop: 10, borderTop: '1px dashed var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={remove} disabled={pending} style={{ ...BTN, background: 'transparent', color: 'var(--neg)', borderColor: 'transparent', fontSize: 11 }}>Delete this complaint</button>
        </div>
      )}
    </div>
  );
}

const BTN: CSSProperties = { padding: '8px 14px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer', background: 'var(--accent-fill)', color: 'var(--on-accent)', border: '1px solid var(--accent-fill)', whiteSpace: 'nowrap' };
