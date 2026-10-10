'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  updateAction, updateTaskStatus, listActionHistory,
  type ActionHistory, type ActionHistoryItem,
} from '@/app/actions/risansi-tasks';

// One dialog for everything that happens to an action after it is raised.
//
// It used to ask a single question — "what was done?" — at the moment of
// closing. Now it is where an action is worked: leave a comment, move the due
// date, or mark it done, with the whole history above the box so the person
// typing can see how it got here. The words are required exactly when they
// carry meaning: a comment alone is optional (it IS the update), moving the date
// needs a reason, closing needs to say what was done.
//
// Shared by every surface that touches an action — the registry, the dashboard
// queue, Field → Activities, the Client 360 register and the visit report — so
// none of the rules can be sidestepped by doing it somewhere else. Callers that
// only ever closed an action pass nothing extra and get the box with "Mark as
// done" already ticked; the registry opens it neutral.

export interface ResolvingAction {
  id: number;
  title: string;
  /** Non-null when the action already carries a note from an earlier closure. */
  existingNote?: string | null;
}

// Plain YYYY-MM-DD → "12 Sep 2026", built from the parts so it is never shifted
// a day west by being parsed as UTC midnight.
function day(iso: string | null | undefined): string {
  if (!iso) return 'no date';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function when(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const todayStr = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

export function ResolveActionDialog({ action, onCancel, onDone, intent = 'done' }: {
  action: ResolvingAction;
  onCancel: () => void;
  onDone: () => void;
  /** 'done' pre-ticks Mark as done (the old behaviour for callers that only close); 'update' opens it neutral. */
  intent?: 'done' | 'update';
}) {
  const [hist, setHist]   = useState<ActionHistory | null>(null);
  const [histErr, setHistErr] = useState('');
  const [note, setNote]   = useState('');
  const [due, setDue]     = useState<string>('');
  const [done, setDone]   = useState(intent === 'done');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    // The catch matters: a refusal comes back as a value, but a dead session or
    // a failed query still rejects, and without this the dialog sat empty with
    // nothing said.
    listActionHistory(action.id).then(r => {
      if (!alive) return;
      if (!r.ok) { setHistErr(r.error); return; }
      setHist(r.data);
      setDue(r.data.dueDate ?? '');
    }).catch(() => {
      if (alive) setHistErr('Could not load this action’s history. Reload the page to try again.');
    });
    return () => { alive = false; };
  }, [action.id]);

  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const closed      = hist?.status === 'completed';
  const dateChanged = hist != null && (due || null) !== (hist.dueDate ?? null);
  const needsNote   = done || dateChanged;
  // What the primary button will do, in words.
  const verb = closed ? 'Reopen'
    : done && dateChanged ? 'Move date & mark done'
    : done ? 'Mark as done'
    : dateChanged ? (due ? 'Move date' : 'Clear date')
    : 'Add comment';

  const submit = async () => {
    if (busy || !hist) return;
    setErr('');
    if (closed) {
      setBusy(true);
      try {
        const res = await updateTaskStatus(action.id, 'open', note.trim() || undefined);
        // The refusal says what to do about it; the generic line below is only
        // for a request that never arrived.
        if (!res.ok) { setErr(res.error); setBusy(false); return; }
        onDone();
      } catch { setErr('Could not reopen this action.'); setBusy(false); }
      return;
    }
    if (needsNote && !note.trim()) {
      setErr(done ? 'Say what was done before closing this.' : 'Say why the date is moving.');
      ref.current?.focus();
      return;
    }
    if (!note.trim() && !dateChanged && !done) {
      setErr('Nothing to save yet — add a comment, move the date, or mark it done.');
      return;
    }
    setBusy(true);
    const res = await updateAction(action.id, {
      comment: note.trim(),
      ...(dateChanged ? { dueDate: due || null } : {}),
      markDone: done,
    });
    if (!res.ok) { setErr(res.error); setBusy(false); return; }
    onDone();
  };

  const overdue = !!hist?.dueDate && !closed && hist.dueDate < todayStr();

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(10,22,40,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div className="risansi-modal" role="dialog" aria-modal="true" aria-label="Update action"
        style={{
          width: 560, maxWidth: '100%', maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column',
          background: 'var(--bg-paper)', color: 'var(--fg)',
          borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.35)', overflow: 'hidden',
        }}>

        {/* Header: what this action is, where it stands */}
        <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{action.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {hist?.clientName && <span>{hist.clientName}</span>}
                {hist && <span>→ {hist.assignee}</span>}
                {hist && (
                  <span style={{ fontFamily: 'var(--font-mono)', color: overdue ? 'var(--neg)' : 'var(--fg-3)', fontWeight: overdue ? 600 : 400 }}>
                    due {day(hist.dueDate)}{overdue ? ' · overdue' : ''}
                  </span>
                )}
              </div>
            </div>
            {hist && (
              <span style={{
                flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                padding: '3px 8px', borderRadius: 999,
                background: closed ? 'var(--pos-soft)' : 'var(--bg-elev)',
                color: closed ? 'var(--pos)' : 'var(--fg-2)',
                border: `1px solid ${closed ? 'var(--pos)' : 'var(--line-strong)'}`,
              }}>{closed ? 'Done' : 'Open'}</span>
            )}
          </div>
        </div>

        {/* History: newest first, down to the day it was raised */}
        <div style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0, background: 'var(--bg-sunk)' }}>
          <div style={{ padding: '10px 18px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>
            History
          </div>
          {histErr && <div style={{ padding: '4px 18px 12px', fontSize: 12, color: 'var(--neg)' }}>{histErr}</div>}
          {!hist && !histErr && <div style={{ padding: '4px 18px 12px', fontSize: 12, color: 'var(--fg-3)' }}>Loading…</div>}
          {hist && (
            <ol style={{ listStyle: 'none', margin: 0, padding: '2px 18px 12px' }}>
              {hist.items.map((it, i) => <HistoryRow key={`${it.kind}-${it.id}-${i}`} it={it} last={i === hist.items.length - 1} />)}
            </ol>
          )}
        </div>

        {/* Composer */}
        <div style={{ padding: '14px 18px 16px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <textarea
            ref={ref} value={note} rows={3}
            onChange={e => { setNote(e.target.value); if (err) setErr(''); }}
            placeholder={
              closed ? 'Why is this being reopened? (optional)'
              : done ? 'What was done? e.g. Sent the revised offer on 18 Aug; client confirmed receipt.'
              : dateChanged ? 'Why is the date moving? e.g. Client asked to hold until their board meets on the 25th.'
              : 'Add an update — a call made, a reply awaited, a reason it is waiting. (optional)'
            }
            style={{
              width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13,
              fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical',
              background: 'var(--bg-paper)', border: `1px solid ${err ? 'var(--neg)' : 'var(--line-strong)'}`,
              borderRadius: 6, color: 'var(--fg)', outline: 'none',
            }}
          />

          {!closed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-2)' }}>
                <span style={{ fontWeight: 600 }}>Due date</span>
                <input
                  type="date" value={due} disabled={!hist}
                  onChange={e => { setDue(e.target.value); if (err) setErr(''); }}
                  style={{
                    padding: '5px 8px', fontSize: 12, fontFamily: 'inherit', borderRadius: 6,
                    border: `1px solid ${dateChanged ? 'var(--accent)' : 'var(--line-strong)'}`,
                    background: 'var(--bg-paper)', color: 'var(--fg)',
                  }}
                />
                {dateChanged && hist && (
                  <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    was {day(hist.dueDate)}
                  </span>
                )}
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--fg-2)', marginLeft: 'auto', cursor: 'pointer' }}>
                <input type="checkbox" checked={done} onChange={e => { setDone(e.target.checked); if (err) setErr(''); }}
                  style={{ width: 15, height: 15, accentColor: 'var(--pos)' }} />
                <span style={{ fontWeight: 600, color: done ? 'var(--pos)' : 'var(--fg-2)' }}>Mark as done</span>
              </label>
            </div>
          )}

          <div style={{ fontSize: 10.5, color: needsNote ? 'var(--fg-2)' : 'var(--fg-3)' }}>
            {closed ? 'Reopening puts it back on the open list; the history stays.'
              : needsNote ? `A comment is required — ${done && dateChanged ? 'you are moving the date and closing this' : done ? 'you are closing this' : 'you are moving the date'}.`
              : 'A comment on its own is optional. Moving the date or marking done asks for one.'}
            {' '}Everything here is kept and shown wherever the action appears.
          </div>

          {err && (
            <div style={{
              fontSize: 11.5, color: 'var(--neg-strong, var(--neg))', background: 'var(--neg-soft)',
              border: '1px solid var(--neg)', borderRadius: 6, padding: '7px 10px',
            }}>{err}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} disabled={busy} style={GHOST}>Cancel</button>
            <button type="button" onClick={submit}
              disabled={busy || !hist || (!closed && !note.trim() && !dateChanged && !done)}
              style={{
                ...PRIMARY,
                background: closed ? 'var(--fg-2)' : done ? 'var(--pos)' : 'var(--accent-fill)',
                opacity: busy || !hist || (!closed && !note.trim() && !dateChanged && !done) ? 0.5 : 1,
              }}>
              {busy ? 'Saving…' : verb}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ it, last }: { it: ActionHistoryItem; last: boolean }) {
  const tone =
    it.kind === 'completed' ? 'var(--pos)'
    : it.kind === 'reopened' ? 'var(--warn)'
    : it.kind === 'due_date' ? 'var(--accent)'
    : it.kind === 'raised' ? 'var(--fg-4)'
    : 'var(--fg-3)';
  const label =
    it.kind === 'completed' ? 'Marked done'
    : it.kind === 'reopened' ? 'Reopened'
    : it.kind === 'due_date' ? (it.newDue ? `Due date moved · ${day(it.oldDue)} → ${day(it.newDue)}` : `Due date cleared · was ${day(it.oldDue)}`)
    : it.kind === 'raised' ? (it.newDue ? `Raised · due ${day(it.newDue)}` : 'Raised · no due date')
    : 'Comment';
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 10, position: 'relative' }}>
      <div style={{ position: 'relative', paddingTop: 6 }}>
        <span style={{ display: 'block', width: 8, height: 8, borderRadius: '50%', background: tone, marginLeft: 3 }} />
        {!last && <span style={{ position: 'absolute', left: 6, top: 16, bottom: -6, width: 2, background: 'var(--line)' }} />}
      </div>
      <div style={{ paddingBottom: last ? 4 : 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: it.kind === 'raised' ? 'var(--fg-3)' : 'var(--fg)' }}>{label}</span>
          <span style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{when(it.at)} · {it.actor}</span>
        </div>
        {it.comment && (
          <div style={{
            marginTop: 4, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--fg-2)',
            background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 9px',
          }}>{it.comment}</div>
        )}
      </div>
    </li>
  );
}

/** The note on an action that is already closed. Older actions have none. */
export function ResolutionNote({ note, compact }: { note?: string | null; compact?: boolean }) {
  if (!note) return null;
  return (
    <div style={{
      marginTop: 5, fontSize: compact ? 11 : 11.5, lineHeight: 1.5, whiteSpace: 'pre-wrap',
      color: 'var(--fg-2)', background: 'var(--pos-soft)',
      border: '1px solid var(--pos)', borderLeft: '3px solid var(--pos)',
      borderRadius: 5, padding: '6px 9px',
    }}>
      <span style={{ fontWeight: 700, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)' }}>
        Resolution
      </span>
      <div style={{ marginTop: 2 }}>{note}</div>
    </div>
  );
}

const GHOST: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 12.5, fontWeight: 600, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit',
};
const PRIMARY: CSSProperties = {
  border: 'none', background: 'var(--accent-fill)', color: 'var(--on-accent)',
  borderRadius: 6, fontSize: 12.5, fontWeight: 600, padding: '8px 16px', cursor: 'pointer', fontFamily: 'inherit',
};
