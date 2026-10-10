'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ResolveActionDialog, ResolutionNote } from './ResolveActionDialog';

export interface QueueTask {
  id: number;
  title: string;
  due_date: string | null;
  /** The day it was raised. */
  created_on?: string | null;
  priority: string | null;
  status: string;
  assigned_to_external: string | null;
  /** What was done to close it. NULL on actions closed before this was recorded. */
  resolution_note?: string | null;
  assigned_rep_name: string | null;
  client_id: number | null;
  client_code: string | null;
  client_name: string | null;
}

// Both dates are plain YYYY-MM-DD, so build the Date from the parts rather than
// letting the string be parsed as UTC midnight and shifted a day west.
function day(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const PRIORITY_DOT: Record<string, string> = {
  High:   'var(--neg)',
  Medium: 'var(--warn)',
  Low:    'var(--pos)',
};

export function ActionQueueRow({ task }: { task: QueueTask }) {
  const router = useRouter();

  // due_date is a plain YYYY-MM-DD string. Compare against *today's* local date
  // (date-only) so something due today reads as "Due today", not overdue — the
  // same rule the header count and the Overdue filter bucket use.
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isOverdue = !!task.due_date && task.status !== 'completed' && task.due_date < todayStr;

  // Everything after an action is raised happens in one dialog: comment, move
  // the date, mark it done, reopen — with the history above the box.
  const [resolving, setResolving] = useState(false);

  const assignee = task.assigned_rep_name && task.assigned_rep_name !== '—'
    ? task.assigned_rep_name
    : task.assigned_to_external ?? 'Unassigned';

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 16px',
      borderBottom: '1px solid var(--line-2)',
      opacity: task.status === 'completed' ? 0.5 : 1,
      background: isOverdue ? 'rgba(220,38,38,0.03)' : 'transparent',
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: PRIORITY_DOT[task.priority ?? 'Medium'] ?? PRIORITY_DOT.Medium,
        flexShrink: 0, marginTop: 5,
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 500, color: 'var(--fg)',
          textDecoration: task.status === 'completed' ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {task.title}
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--fg-3)', marginTop: 2, flexWrap: 'wrap' }}>
          {task.client_code && task.client_name && (
            <a href={`/risansi/clients/${task.client_code}`} style={{ color: 'var(--brand-blue)', textDecoration: 'none' }}>
              {task.client_name}
            </a>
          )}
          {task.created_on && (
            <span style={{ fontFamily: 'var(--font-mono)' }} title="When this action was raised">
              raised {day(task.created_on)}
            </span>
          )}
          {task.due_date && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              color: isOverdue ? 'var(--neg)' : 'var(--fg-3)', fontWeight: isOverdue ? 600 : 400,
            }} title="When this action is due">
              {isOverdue ? '⚠ ' : ''}due {day(task.due_date)}
            </span>
          )}
          <span>→ {assignee}</span>
        </div>
        {task.status === 'completed' && <ResolutionNote note={task.resolution_note} compact />}
      </div>

      {/* A button that reads as a button. The green "✓ Done" pill it replaces
          looked like a status, and people read it as "this is done" rather than
          "press to finish". */}
      <button
        type="button"
        onClick={() => setResolving(true)}
        title={task.status === 'completed' ? 'See the history, or reopen' : 'Add an update, move the date, or mark it done'}
        style={{
          flexShrink: 0, padding: '5px 10px', borderRadius: 6, fontFamily: 'inherit',
          border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
          fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
      >
        {task.status === 'completed' ? 'History · Reopen' : 'Update / Mark as done'}
        <span aria-hidden style={{ color: 'var(--fg-3)', fontSize: 10 }}>›</span>
      </button>

      {resolving && (
        <ResolveActionDialog
          action={{ id: task.id, title: task.title, existingNote: task.resolution_note }}
          intent="update"
          onCancel={() => setResolving(false)}
          onDone={() => { setResolving(false); router.refresh(); }}
        />
      )}
    </div>
  );
}
