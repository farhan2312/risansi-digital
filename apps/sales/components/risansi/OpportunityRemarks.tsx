'use client';

import { useEffect, useState, useTransition, type CSSProperties } from 'react';
import {
  listOpportunityComments, addOpportunityComment,
  updateOpportunityComment, deleteOpportunityComment,
} from '@/app/actions/risansi-opportunity-comments';
import type { OppCommentRow } from '@/lib/risansi-opportunity-comment-types';

/**
 * Remarks on an opportunity — a running thread, oldest first.
 *
 * WHY A THREAD AND NOT A BOX
 *
 * The opportunity already has two places to type: Lead / Discussion, which is
 * the story of the deal and is carried through every stage, and Notes. Both
 * are single values somebody types over. The question people actually ask —
 * "what did we agree on the 14th, and who said so" — cannot be answered by
 * either, because the answer was overwritten by whoever saved last.
 *
 * So: anybody who can see the opportunity may add one, each keeps its author
 * and its time, and only the author may change or remove theirs. The same
 * rules as the comments on a client, on purpose.
 *
 * It loads when it is opened, not with the drawer: most people opening an
 * opportunity are editing a field, not reading the history, and the drawer
 * should not wait on a query nobody asked for.
 */
export function OpportunityRemarks({ oppId }: { oppId: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<OppCommentRow[] | null>(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();

  useEffect(() => {
    if (!open || rows !== null) return;
    let live = true;
    listOpportunityComments(oppId)
      .then(r => { if (live) setRows(r); })
      // The table may not exist yet on an environment where migration 0133 has
      // not run. An empty thread is the right thing to show either way; the
      // add below will say what went wrong if somebody tries to write.
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [open, oppId, rows]);

  const reload = async () => setRows(await listOpportunityComments(oppId).catch(() => []));

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setErr('');
    start(async () => {
      const r = await addOpportunityComment(oppId, text).catch(() => ({ ok: false as const, error: 'Could not save that remark.' }));
      if (!r.ok) { setErr(r.error); return; }
      setDraft('');
      await reload();
    });
  };

  const saveEdit = (id: number) => {
    const text = editDraft.trim();
    if (!text) return;
    setErr('');
    start(async () => {
      const r = await updateOpportunityComment(id, text).catch(() => ({ ok: false as const, error: 'Could not save that change.' }));
      if (!r.ok) { setErr(r.error); return; }
      setEditingId(null);
      await reload();
    });
  };

  const remove = (id: number) => {
    if (!window.confirm('Remove this remark?')) return;
    setErr('');
    start(async () => {
      const r = await deleteOpportunityComment(id).catch(() => ({ ok: false as const, error: 'Could not remove that remark.' }));
      if (!r.ok) { setErr(r.error); return; }
      await reload();
    });
  };

  const count = rows?.length ?? 0;

  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 10 }}>
      <button type="button" onClick={() => setOpen(o => !o)} style={TOGGLE} aria-expanded={open}>
        <span style={{ color: 'var(--fg-4)', marginRight: 5 }}>{open ? '▾' : '▸'}</span>
        Remarks{rows ? ` · ${count}` : ''}
        <span style={{ color: 'var(--fg-4)', fontWeight: 400, marginLeft: 6 }}>
          anything worth keeping, kept with who said it
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows === null ? (
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>No remarks yet.</div>
          ) : (
            rows.map(c => (
              <div key={c.id} style={ROW}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 12 }}>{c.author_name || c.author_email}</strong>
                  <span style={{ fontSize: 10.5, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
                    {fmt(c.created_at)}
                    {c.updated_at !== c.created_at && ' · edited'}
                  </span>
                  {c.mine && editingId !== c.id && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      <button type="button" style={LINK}
                        onClick={() => { setEditingId(c.id); setEditDraft(c.body); }}>Edit</button>
                      <button type="button" style={{ ...LINK, color: 'var(--neg)' }}
                        onClick={() => remove(c.id)} disabled={busy}>Remove</button>
                    </span>
                  )}
                </div>
                {editingId === c.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                    <textarea value={editDraft} onChange={e => setEditDraft(e.target.value)}
                      rows={3} style={INPUT} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" onClick={() => saveEdit(c.id)} disabled={busy} style={BTN}>Save</button>
                      <button type="button" onClick={() => setEditingId(null)} style={GHOST}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {c.body}
                  </p>
                )}
              </div>
            ))
          )}

          {err && <div style={{ fontSize: 12, color: 'var(--neg)' }}>{err}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
              placeholder="Add a remark — what was agreed, who said it, what happens next"
              style={INPUT} />
            <div>
              <button type="button" onClick={add} disabled={busy || !draft.trim()} style={BTN}>
                {busy ? 'Saving…' : 'Add remark'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Guarded, so a value that will not parse degrades to itself. */
function fmt(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}, `
    + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

const TOGGLE: CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', textAlign: 'left',
};
const ROW: CSSProperties = {
  background: 'var(--bg-sunk)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px',
};
const INPUT: CSSProperties = {
  width: '100%', background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 5,
  padding: '7px 9px', fontSize: 12.5, color: 'var(--fg)', fontFamily: 'inherit', resize: 'vertical',
};
const BTN: CSSProperties = {
  background: 'var(--accent-fill)', color: '#fff', border: 'none', borderRadius: 5,
  padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
};
const GHOST: CSSProperties = {
  background: 'var(--bg-paper)', color: 'var(--fg-2)', border: '1px solid var(--line)',
  borderRadius: 5, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
};
const LINK: CSSProperties = {
  background: 'none', border: 'none', padding: 0, fontSize: 11, color: 'var(--accent)',
  cursor: 'pointer', fontFamily: 'inherit',
};
