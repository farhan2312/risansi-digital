'use client';

import { useState, type CSSProperties } from 'react';
import { isPastDue } from '@/lib/risansi-utils';
import { useRouter } from 'next/navigation';
import { updateTaskStatus } from '@/app/actions/risansi-tasks';
import { ResolveActionDialog, ResolutionNote } from './ResolveActionDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { useTableSort, SortTH } from './SortTH';
import { MobileSort } from './MobileSort';
import type { SortableColumn } from '@/lib/risansi-table-sort';

export interface ActivityTask {
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string | null;
  status: string;
  assigned_to_external: string | null;
  /** What was done to close it. NULL on actions closed before this was recorded. */
  resolution_note?: string | null;
  assigned_rep_name: string | null;
  client_id: number | null;
  client_code: string | null;
  client_name: string | null;
  visit_id: number | null;
  visit_date: string | null;
}

// Priority is a ladder, not three words: High first is the only order anybody
// opens that column to see.
const PRIORITY_ORDER = ['High', 'Medium', 'Low'] as const;
// Open before completed, for the same reason.
const TASK_STATUS_ORDER = ['open', 'completed'] as const;

// `label` is what the phone sort menu shows — this table is cards there and has
// no header row to tap.
const TASK_COLS: SortableColumn<ActivityTask>[] = [
  { key: 'status',   kind: 'status', label: 'Status',      order: TASK_STATUS_ORDER },
  { key: 'title',    kind: 'text',   label: 'Task',        value: t => t.title },
  { key: 'client',   kind: 'text',   label: 'Client',      value: t => t.client_name },
  { key: 'priority', kind: 'status', label: 'Priority',    order: PRIORITY_ORDER, value: t => t.priority ?? 'Medium' },
  { key: 'due',      kind: 'date',   label: 'Due date',    value: t => t.due_date },
  { key: 'owner',    kind: 'text',   label: 'Assigned to',
    value: t => (t.assigned_rep_name && t.assigned_rep_name !== '—' ? t.assigned_rep_name : t.assigned_to_external) },
  { key: 'visit',    kind: 'date',   label: 'Visit',       value: t => t.visit_date },
];

// The classes TableHead applies, so a sortable header sits level with a plain one.
const HEAD_CLS = 'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground';

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  High:   { bg: 'var(--neg-soft)',  text: 'var(--neg)'  },
  Medium: { bg: 'var(--warn-soft)', text: 'var(--warn)' },
  Low:    { bg: 'var(--pos-soft)',  text: 'var(--pos)'  },
};

const SELECT_STYLE: CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--line-strong)', borderRadius: 6,
  fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)', color: 'var(--fg)',
};

function ActionStatusToggle({ task, compact, onToggle }: {
  task: ActivityTask; compact?: boolean; onToggle: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  // Reopening can be refused — the action may have been deleted under you.
  const [err, setErr] = useState('');
  const handleToggle = async () => {
    if (task.status === 'open') { setResolving(true); return; }
    setLoading(true);
    setErr('');
    const res = await updateTaskStatus(task.id, 'open');
    if (!res.ok) { setErr(res.error); setLoading(false); return; }
    onToggle();
    setLoading(false);
  };

  const problem = err
    ? <div style={{ fontSize: 10.5, color: 'var(--neg)', marginTop: 4, lineHeight: 1.4 }}>{err}</div>
    : null;

  if (compact) {
    return (
      <>
        <Button variant="ghost" size="sm" onClick={handleToggle} disabled={loading} style={{ fontSize: 10 }}>
          {loading ? '…' : task.status === 'completed' ? '↩' : '✓'}
        </Button>
        {problem}
      {resolving && (
        <ResolveActionDialog
          action={{ id: task.id, title: task.title, existingNote: task.resolution_note }}
          onCancel={() => setResolving(false)}
          onDone={() => { setResolving(false); onToggle(); }}
        />
      )}
      </>
    );
  }

  return (
    <>
    <Badge
      onClick={handleToggle}
      className="r-tap"
      style={{
        background: task.status === 'completed' ? 'var(--pos-soft)' : 'var(--bg-elev)',
        color: task.status === 'completed' ? 'var(--pos)' : 'var(--fg-3)',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {loading ? '…' : task.status === 'completed' ? '✓ Done' : 'Open'}
    </Badge>
    {problem}
      {resolving && (
        <ResolveActionDialog
          action={{ id: task.id, title: task.title, existingNote: task.resolution_note }}
          onCancel={() => setResolving(false)}
          onDone={() => { setResolving(false); onToggle(); }}
        />
      )}
    </>
  );
}

export function ActivitiesTab({ tasks }: { tasks: ActivityTask[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const refresh = () => router.refresh();

  const openCount      = tasks.filter(t => t.status !== 'completed').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const overdueCount   = tasks.filter(t => t.status === 'open' && isPastDue(t.due_date)).length;

  const q = search.trim().toLowerCase();
  const filtered = tasks.filter(t => {
    if (q && !`${t.title} ${t.description ?? ''} ${t.client_name ?? ''}`.toLowerCase().includes(q)) return false;
    if (priorityFilter && (t.priority ?? 'Medium') !== priorityFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    return true;
  });
  // Sorting sits on top of the filters, so it orders what is on screen.
  const { rows: shown, sortBy, mobile } = useTableSort(filtered, TASK_COLS);

  return (
    <div>
      {/* Stats strip */}
      <div style={{ display: 'flex', gap: 16, padding: '12px 0 16px', fontSize: 12, color: 'var(--fg-3)' }}>
        <span><strong style={{ color: 'var(--fg)' }}>{openCount}</strong> open</span>
        <span>·</span>
        <span style={{ color: 'var(--neg)' }}><strong>{overdueCount}</strong> overdue</span>
        <span>·</span>
        <span><strong style={{ color: 'var(--pos)' }}>{completedCount}</strong> completed</span>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input placeholder="Search tasks…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 240 }} />
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={SELECT_STYLE}>
          <option value="">All Priorities</option>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={SELECT_STYLE}>
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
          No tasks match the current filters.
        </div>
      ) : (
        <>
        {/* Only on a phone, where the header row below becomes invisible. */}
        <div className="r-mobile-only" style={{ margin: '0 0 8px' }}>
          <MobileSort {...mobile} />
        </div>
        <Table className="r-cards">
          <TableHeader>
            <TableRow>
              <SortTH {...sortBy('status')}   className={HEAD_CLS}>Status</SortTH>
              <SortTH {...sortBy('title')}    className={HEAD_CLS}>Task</SortTH>
              <SortTH {...sortBy('client')}   className={HEAD_CLS}>Client</SortTH>
              <SortTH {...sortBy('priority')} className={HEAD_CLS}>Priority</SortTH>
              <SortTH {...sortBy('due')}      className={HEAD_CLS}>Due Date</SortTH>
              <SortTH {...sortBy('owner')}    className={HEAD_CLS}>Assigned To</SortTH>
              <SortTH {...sortBy('visit')}    className={HEAD_CLS}>Visit</SortTH>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(task => {
              const isOverdue = task.status === 'open' && isPastDue(task.due_date);
              const pc = PRIORITY_COLORS[task.priority ?? 'Medium'] ?? PRIORITY_COLORS.Medium;
              return (
                <TableRow key={task.id} style={{ opacity: task.status === 'completed' ? 0.6 : 1, background: isOverdue ? 'rgba(220,38,38,0.03)' : undefined }}>
                  <TableCell data-label="Done"><ActionStatusToggle task={task} onToggle={refresh} /></TableCell>
                  <TableCell data-label="">
                    <div style={{ fontWeight: 500, fontSize: 12, textDecoration: task.status === 'completed' ? 'line-through' : 'none' }}>
                      {task.title}
                    </div>
                    {task.description && (
                      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                        {task.description.slice(0, 60)}{task.description.length > 60 ? '…' : ''}
                      </div>
                    )}
                    {task.status === 'completed' && <ResolutionNote note={task.resolution_note} compact />}
                  </TableCell>
                  <TableCell data-label="Client">
                    {task.client_code && task.client_name ? (
                      <a href={`/risansi/clients/${task.client_code}`} style={{ fontSize: 12, color: 'var(--brand-blue)', textDecoration: 'none' }}>
                        {task.client_name}
                      </a>
                    ) : '—'}
                  </TableCell>
                  <TableCell data-label="Priority">
                    <Badge style={{ background: pc.bg, color: pc.text, fontSize: 10 }}>
                      {task.priority ?? 'Medium'}
                    </Badge>
                  </TableCell>
                  <TableCell data-label="Due" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: isOverdue ? 'var(--neg)' : 'var(--fg-3)', fontWeight: isOverdue ? 600 : 400 }}>
                    {task.due_date ? new Date(task.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    {isOverdue && ' ⚠'}
                  </TableCell>
                  <TableCell data-label="Owner" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                    {task.assigned_rep_name && task.assigned_rep_name !== '—' ? task.assigned_rep_name : (task.assigned_to_external ?? '—')}
                  </TableCell>
                  <TableCell data-label="Visit">
                    {task.visit_id ? (
                      <a href={`/risansi/visits/${task.visit_id}`} style={{ fontSize: 11, color: 'var(--brand-blue)', textDecoration: 'none' }}>
                        {task.visit_date ? new Date(task.visit_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Visit →'}
                      </a>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="r-hide">
                    <ActionStatusToggle task={task} compact onToggle={refresh} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </>
      )}
    </div>
  );
}
