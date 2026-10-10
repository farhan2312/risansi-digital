'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { addClientComment, updateClientComment, deleteClientComment } from '@/app/actions/risansi';

export interface CommentRow {
  id: number;
  body: string;
  author_email: string;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

interface Me { id: number | null; email: string | null; role: string }

// Guard the parse (matches fmtDate in ComplaintDetail) so a bad value degrades
// to the raw string instead of rendering "Invalid Date".
const fmt = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
};

// Free-form comments / notes on a client. Anyone who can see the client may add
// one; only the original author gets Edit / Delete (also enforced server-side).
export function ClientComments({ comments, me, clientId }: {
  comments: CommentRow[]; me: Me; clientId: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding]     = useState(false);
  const [draft, setDraft]       = useState('');
  const [editingId, setEditing] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [error, setError]       = useState('');

  const myEmail = (me.email ?? '').toLowerCase();
  const mine = (c: CommentRow) => !!myEmail && c.author_email.toLowerCase() === myEmail;

  // Takes an action that returns its refusal, and shows it. The catch below is
  // only for a request that never arrived — a refusal comes back as a value.
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after: () => void) => {
    setError('');
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) { setError(res.error); return; }
        after();
        router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); }
    });
  };

  const submitNew = () => {
    if (!draft.trim()) return;
    setError('');
    start(async () => {
      try {
        const res = await addClientComment(clientId, draft);
        if (!res.ok) { setError(res.error); return; }
        setDraft(''); setAdding(false); router.refresh();
      } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); }
    });
  };
  const submitEdit = (id: number) => {
    if (!editDraft.trim()) return;
    run(() => updateClientComment(id, editDraft), () => { setEditing(null); setEditDraft(''); });
  };
  const remove = (id: number) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this comment? This cannot be undone.')) return;
    run(() => deleteClientComment(id), () => {});
  };

  return (
    <div data-tabgroup="activity" style={PANEL}>
      <div style={PANEL_H}>
        <span style={PANEL_TITLE}>Comments</span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{comments.length}</span>
        {!adding && (
          <button type="button" onClick={() => { setAdding(true); setError(''); }} style={{ ...ADD_BTN, marginLeft: 'auto' }}>
            ＋ Add comment
          </button>
        )}
      </div>

      {adding && (
        <div style={{ padding: 12, borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
          <textarea
            autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            placeholder="Add a note about this client…" rows={3} style={TA}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" disabled={pending || !draft.trim()} onClick={submitNew} style={{ ...PRIMARY, opacity: pending || !draft.trim() ? 0.6 : 1 }}>
              {pending ? 'Saving…' : 'Save comment'}
            </button>
            <button type="button" onClick={() => { setAdding(false); setDraft(''); setError(''); }} style={GHOST}>Cancel</button>
          </div>
        </div>
      )}

      {error && <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--neg-strong)', background: 'var(--neg-soft)' }}>{error}</div>}

      {comments.length === 0 && !adding ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>No comments yet.</div>
      ) : (
        <div>
          {comments.map((c, i) => (
            <div key={c.id} style={{ padding: '11px 14px', borderBottom: i < comments.length - 1 ? '1px solid var(--line)' : 'none' }}>
              {editingId === c.id ? (
                <>
                  <textarea autoFocus value={editDraft} onChange={e => setEditDraft(e.target.value)} rows={3} style={TA} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" disabled={pending || !editDraft.trim()} onClick={() => submitEdit(c.id)} style={{ ...PRIMARY, opacity: pending || !editDraft.trim() ? 0.6 : 1 }}>
                      {pending ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => { setEditing(null); setEditDraft(''); setError(''); }} style={GHOST}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                      {c.author_name || c.author_email} · {fmt(c.created_at)}
                      {c.updated_at !== c.created_at && <span style={{ fontStyle: 'italic' }}> · edited</span>}
                    </span>
                    {mine(c) && (
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button type="button" onClick={() => { setEditing(c.id); setEditDraft(c.body); setError(''); }} style={LINK_BTN}>Edit</button>
                        <button type="button" onClick={() => remove(c.id)} style={{ ...LINK_BTN, color: 'var(--neg)' }}>Delete</button>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 12, fontWeight: 500 };
const ADD_BTN: CSSProperties = { padding: '5px 11px', fontSize: 12, fontWeight: 600, background: 'var(--accent-soft)', color: 'var(--title)', border: '1px solid var(--accent-line)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' };
const TA: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--line-strong)', borderRadius: 6, fontSize: 13, background: 'var(--bg-sunk)', color: 'var(--fg)', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 };
const PRIMARY: CSSProperties = { padding: '7px 14px', background: 'var(--accent-fill)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' };
const GHOST: CSSProperties = { padding: '7px 14px', background: 'none', border: '1px solid var(--line-strong)', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, color: 'var(--fg-3)', fontFamily: 'inherit' };
const LINK_BTN: CSSProperties = { fontSize: 11, background: 'none', border: 'none', color: 'var(--title)', cursor: 'pointer', fontFamily: 'inherit', padding: 0, textDecoration: 'underline' };
