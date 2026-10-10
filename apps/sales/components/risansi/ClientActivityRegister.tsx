'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { AddActionForm, type ActionRep } from './AddActionForm';
import { updateTaskStatus, deleteTask } from '@/app/actions/risansi-tasks';
import { ResolveActionDialog, ResolutionNote, type ResolvingAction } from './ResolveActionDialog';

export interface ActionItem {
  id: number;
  title: string;
  description: string | null;
  assigned_rep_name: string | null;
  assigned_to_external: string | null;
  /** What was done to close it. NULL on actions closed before this was recorded. */
  resolution_note?: string | null;
  assigned_to_external_email: string | null;
  due_date: string | null;          // yyyy-mm-dd
  priority: string;
  status: string;                   // open | completed
  created_by: string | null;
  created_at: string | null;        // ISO
  from_visit: boolean;
}

const PRIORITY_COLOR: Record<string, string> = { High: 'var(--neg)', Medium: 'var(--warn-strong)', Low: '#64748B' };

// The Client 360 "Activity Register": every action item logged for this client
// (via a visit or added directly here), plus a New Activity button that opens
// the same action form used in the visit report.
export function ClientActivityRegister({ clientId, actions, reps, ownerRepId }: {
  clientId: number;
  actions: ActionItem[];
  reps: ActionRep[];
  /** The client's owner, preselected in the new-action form. */
  ownerRepId?: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr]   = useState('');

  const [resolving, setResolving] = useState<ResolvingAction | null>(null);
  const setDone = async (id: number, done: boolean, title = '', existingNote: string | null = null) => {
    if (done) { setResolving({ id, title, existingNote }); return; }
    setBusy(id); setErr('');
    try {
      const res = await updateTaskStatus(id, 'open');
      if (!res.ok) { setErr(res.error); setBusy(null); return; }
      router.refresh();
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not update the action.'); }
    finally { setBusy(null); }
  };
  const remove = async (id: number) => {
    if (!window.confirm('Delete this action? This cannot be undone.')) return;
    setBusy(id); setErr('');
    try {
      const res = await deleteTask(id);
      if (!res.ok) { setErr(res.error); return; }
      router.refresh();
    }
    catch { setErr('Could not reach the server. Check your connection and try again.'); }
    finally { setBusy(null); }
  };

  const openCount = actions.filter(a => a.status !== 'completed').length;

  return (
    <div data-tabgroup="activity" style={PANEL}>
      <div style={PANEL_H}>
        <span style={PANEL_TITLE}>Activity Register{actions.length > 0 ? ` · ${actions.length}` : ''}</span>
        {openCount > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
            {openCount} open
          </span>
        )}
      </div>

      <div style={{ padding: 14 }}>
        {actions.length === 0 ? (
          <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>
            No activities recorded yet
          </div>
        ) : (
          <div>
            {actions.map((a, i) => {
              const done = a.status === 'completed';
              const assignee = a.assigned_rep_name
                ? a.assigned_rep_name
                : a.assigned_to_external
                  ? `${a.assigned_to_external} (external)`
                  : 'Unassigned';
              return (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0',
                  borderBottom: i < actions.length - 1 ? '1px solid var(--line)' : 'none',
                  opacity: done ? 0.6 : 1,
                }}>
                  <button
                    type="button" onClick={() => setDone(a.id, !done, a.title, a.resolution_note ?? null)} disabled={busy === a.id}
                    aria-label={done ? 'Reopen' : 'Mark complete'} title={done ? 'Reopen' : 'Mark complete'}
                    style={{
                      flexShrink: 0, marginTop: 1, width: 16, height: 16, borderRadius: 4, cursor: 'pointer',
                      border: `1.5px solid ${done ? 'var(--pos)' : 'var(--line-strong)'}`,
                      background: done ? 'var(--pos)' : 'transparent', color: '#fff',
                      fontSize: 11, lineHeight: 1, padding: 0,
                    }}
                  >
                    {done ? '✓' : ''}
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', textDecoration: done ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
                      {a.title}
                    </div>
                    {a.description && (
                      <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 2, overflowWrap: 'anywhere' }}>{a.description}</div>
                    )}
                    {done && <ResolutionNote note={a.resolution_note} />}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, fontSize: 11, color: 'var(--fg-3)', minWidth: 0 }}>
                      <span style={{ overflowWrap: 'anywhere', maxWidth: '100%' }}>👤 {assignee}</span>
                      {a.due_date && <span>· 📅 {a.due_date}</span>}
                      <span style={{ color: PRIORITY_COLOR[a.priority] ?? 'var(--fg-3)' }}>· {a.priority}</span>
                      <span>· {a.from_visit ? 'from visit' : 'direct'}</span>
                    </div>
                  </div>

                  <button
                    type="button" onClick={() => remove(a.id)} disabled={busy === a.id}
                    aria-label="Delete action"
                    style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {err && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--neg)' }}>{err}</div>}

        <AddActionForm
          clientId={clientId}
          reps={reps}
          defaultRepId={ownerRepId ?? null}
          onAdded={() => router.refresh()}
          triggerLabel="+ New Activity"
        />
      </div>

      {resolving && (
        <ResolveActionDialog
          action={resolving}
          onCancel={() => setResolving(null)}
          onDone={() => { setResolving(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', marginBottom: 16,
};
const PANEL_H: CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--line)',
};
const PANEL_TITLE: CSSProperties = {
  fontSize: 13, fontWeight: 600, color: 'var(--fg)',
};
