'use client';

// Who picks up a complaint once somebody says what was done about it.
//
// Page 5 used to ask for an assignee by hand, from a list of every user. The
// answer is the same every time for a given action and it was still answered
// wrong, so the action decides and this table is the decision. Three ways to
// name an assignee: a person, a department, or "the client's own rep", which is
// a different person on every complaint and so cannot be stored as an id.
//
// Two rows are placeholders rather than decisions, and the screen says so twice
// — once at the top of the panel and once on the row — because the one thing
// that must not happen is somebody reading "Complaint Team" as the answer. See
// PROVISIONAL_ASSIGNMENTS in lib/risansi-complaint-admin.ts.

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useTableSort, SortTH } from '@/components/risansi/SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';
import { setComplaintActionAssignment } from '@/app/actions/risansi-complaint-admin';

export type AssigneeKind = 'user' | 'department' | 'client_rep';

export interface AssignmentRow {
  action: string;
  mapped: boolean;
  assignee_kind: AssigneeKind | null;
  user_id: number | null;
  user_name: string | null;
  department: string | null;
  active: boolean;
  in_use: number;
}

export interface AssignmentUser { id: number; name: string; role: string }

export interface ProvisionalNote { person: string; why: string }

const KIND_LABEL: Record<AssigneeKind, string> = {
  user: 'A person',
  department: 'A department',
  client_rep: 'The client’s own rep',
};

// Needs attention first, settled next, retired last — which is what anybody
// opens this table to find. Alphabetical would bury the unmapped row in the
// middle. 'Retired' is its own state and not 'Not assigned': a value that left
// the Action taken list cannot be chosen, so nothing is missing from it, and
// colouring those five rows red would make the screen cry wolf.
const SETTLED_ORDER = ['Not assigned', 'Provisional', 'Set', 'Retired'];

export function ActionAssignmentEditor({
  rows, users, departments, provisional, krishnaCandidates,
}: {
  rows: AssignmentRow[];
  users: AssignmentUser[];
  departments: string[];
  provisional: Record<string, ProvisionalNote>;
  krishnaCandidates: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [kind, setKind] = useState<AssigneeKind>('user');
  const [userId, setUserId] = useState('');
  const [department, setDepartment] = useState('');

  const isProvisional = (r: AssignmentRow) => r.action in provisional && r.assignee_kind !== 'user';
  const settled = (r: AssignmentRow) =>
    !r.mapped ? (r.active ? 'Not assigned' : 'Retired') : isProvisional(r) ? 'Provisional' : 'Set';
  const assignee = (r: AssignmentRow) =>
    !r.mapped ? (r.active ? 'Nobody' : '—') : r.assignee_kind === 'user' ? (r.user_name ?? `User #${r.user_id}`)
      : r.assignee_kind === 'department' ? (r.department ?? '—')
        : 'The client’s own rep';
  /** Red is for an action somebody can choose today that lands on nobody. */
  const needsOwner = (r: AssignmentRow) => r.active && !r.mapped;

  const COLS: SortableColumn<AssignmentRow>[] = [
    { key: 'action', kind: 'text' },
    { key: 'assignee', kind: 'text', value: assignee },
    { key: 'assignee_kind', kind: 'text', value: r => (r.assignee_kind ? KIND_LABEL[r.assignee_kind] : '') },
    { key: 'settled', kind: 'status', order: SETTLED_ORDER, value: settled },
    { key: 'in_use', kind: 'number' },
    { key: 'active', kind: 'status', order: ['Offered', 'Retired'], value: r => (r.active ? 'Offered' : 'Retired') },
  ];

  const { rows: ordered, sortBy } = useTableSort(rows, COLS);
  const provisionalRows = rows.filter(isProvisional);

  function open(r: AssignmentRow) {
    setMsg(null);
    setEditing(r.action);
    setKind(r.assignee_kind ?? 'user');
    setUserId(r.user_id ? String(r.user_id) : '');
    setDepartment(r.department ?? '');
  }

  function save(action: string, next?: { kind: AssigneeKind; userId?: string; department?: string }) {
    const k = next?.kind ?? kind;
    const u = next?.userId ?? userId;
    const d = next?.department ?? department;
    setMsg(null);
    start(async () => {
      const res = await setComplaintActionAssignment({
        action, assigneeKind: k,
        userId: k === 'user' ? Number(u) : null,
        department: k === 'department' ? d : null,
      });
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      setEditing(null);
      setMsg({ ok: true, text: `${action} now goes to ${k === 'user' ? (users.find(x => String(x.id) === String(u))?.name ?? 'that person') : k === 'department' ? d : 'the client’s own rep'}.` });
      router.refresh();
    });
  }

  const canSave = kind === 'client_rep' || (kind === 'user' && userId !== '') || (kind === 'department' && department !== '');

  return (
    <div style={PANEL}>
      <div style={PANEL_H}>
        <div style={PANEL_TITLE}>Action assignment</div>
        <div style={SUB}>
          Page 5 asks what was done. This table decides who it lands on, so nobody picks an assignee by
          hand. Add an Action taken to the list above and it appears here, assigned to nobody, until you
          say who.
        </div>
      </div>

      {provisionalRows.length > 0 && (
        <div style={{ ...BANNER, background: 'var(--warn-soft)', borderColor: 'var(--warn)', color: 'var(--warn-strong)' }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
            {provisionalRows.length} row{provisionalRows.length === 1 ? ' is a placeholder' : 's are placeholders'}, not a decision
          </div>
          <div style={{ fontSize: 11.5, lineHeight: 1.55 }}>
            {provisionalRows.map(r => `${r.action} → ${provisional[r.action].person}`).join(' · ')}
            {' — '}
            the requirement of 2 Oct names {provisionalRows.map(r => provisional[r.action].person)[0]} for{' '}
            {provisionalRows.length === 1 ? 'it' : 'both'}, and there is no such account in the portal, so
            there was no id to point {provisionalRows.length === 1 ? 'it' : 'them'} at. The Complaint Team
            holds the work meanwhile. Repoint {provisionalRows.length === 1 ? 'the row' : 'these rows'} the
            day the login exists — until then the work reaches the right desk but not the right person.
          </div>
          {krishnaCandidates.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>
                An account that could be them now exists:
              </span>
              {krishnaCandidates.flatMap(k => provisionalRows.map(r => (
                <button key={`${k.id}-${r.action}`} type="button" disabled={pending}
                  onClick={() => save(r.action, { kind: 'user', userId: String(k.id) })}
                  style={BTN}>
                  {r.action} → {k.name}
                </button>
              )))}
            </div>
          )}
        </div>
      )}

      {msg && (
        <div style={{
          padding: '9px 16px', fontSize: 12, borderBottom: '1px solid var(--line)',
          background: msg.ok ? 'var(--pos-soft)' : 'var(--neg-soft)',
          color: msg.ok ? 'var(--pos-strong)' : 'var(--neg-strong)',
        }}>
          {msg.ok ? '✓ ' : '⚠ '}{msg.text}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={TABLE}>
          <thead>
            <tr>
              <SortTH {...sortBy('action')} style={TH}>Action taken</SortTH>
              <SortTH {...sortBy('assignee')} style={TH}>Goes to</SortTH>
              <SortTH {...sortBy('assignee_kind')} style={TH}>As</SortTH>
              <SortTH {...sortBy('settled')} style={TH}>State</SortTH>
              <SortTH {...sortBy('in_use')} style={TH_R} align="right" title="Complaints currently on this action">On</SortTH>
              <SortTH {...sortBy('active')} style={TH}>Offered</SortTH>
              <SortTH sortable={false} style={TH_R} align="right">&nbsp;</SortTH>
            </tr>
          </thead>
          <tbody>
            {ordered.map(r => {
              const prov = isProvisional(r);
              const state = settled(r);
              return (
                <tr key={r.action} style={{
                  borderTop: '1px solid var(--line)',
                  background: prov ? 'var(--warn-soft)' : needsOwner(r) ? 'var(--neg-soft)' : undefined,
                  opacity: r.active ? 1 : 0.6,
                }}>
                  <td style={{ ...TD, fontWeight: 500, color: 'var(--fg)' }}>
                    {r.action}
                    {prov && (
                      <span title={provisional[r.action].why} style={{ ...PILL, background: 'var(--warn)', color: 'var(--bg-sunk)', marginLeft: 7 }}>
                        provisional · {provisional[r.action].person}
                      </span>
                    )}
                  </td>
                  <td style={{ ...TD, color: needsOwner(r) ? 'var(--neg-strong)' : r.mapped ? 'var(--fg-2)' : 'var(--fg-4)', fontWeight: needsOwner(r) ? 600 : 400 }}>
                    {assignee(r)}
                  </td>
                  <td style={{ ...TD, color: 'var(--fg-3)' }}>{r.assignee_kind ? KIND_LABEL[r.assignee_kind] : '—'}</td>
                  <td style={TD}>
                    <span style={{
                      ...PILL,
                      background: state === 'Set' ? 'var(--pos-soft)' : state === 'Provisional' ? 'var(--warn-soft)' : state === 'Retired' ? 'var(--bg-elev)' : 'var(--neg-soft)',
                      color: state === 'Set' ? 'var(--pos-strong)' : state === 'Provisional' ? 'var(--warn-strong)' : state === 'Retired' ? 'var(--fg-4)' : 'var(--neg-strong)',
                    }}>{state}</span>
                  </td>
                  <td style={{ ...TD, ...MONO, textAlign: 'right', color: r.in_use ? 'var(--fg-2)' : 'var(--fg-4)' }}>{r.in_use || '—'}</td>
                  <td style={{ ...TD, color: 'var(--fg-3)' }}>{r.active ? 'Yes' : 'No'}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    {/* A retired action is not offered on page 5, so there is
                        nothing to assign. Restore it on the list above first. */}
                    {r.active ? (
                      <button type="button" onClick={() => (editing === r.action ? setEditing(null) : open(r))}
                        disabled={pending} style={{ ...LINK_BTN, color: 'var(--accent)' }}>
                        {editing === r.action ? 'Cancel' : prov || !r.mapped ? 'Set owner' : 'Change'}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>not offered</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {ordered.map(r => editing !== r.action ? null : (
              <tr key={`${r.action}-edit`} style={{ borderTop: '1px solid var(--accent-line)', background: 'var(--bg-elev)' }}>
                <td colSpan={7} style={{ padding: '12px 14px' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginBottom: 8 }}>
                    Who picks up a complaint once <b style={{ color: 'var(--fg-2)' }}>{r.action}</b> is chosen on page 5?
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <select value={kind} onChange={e => setKind(e.target.value as AssigneeKind)} style={{ ...INP, width: 190 }}>
                      <option value="user">A person</option>
                      <option value="department">A department</option>
                      <option value="client_rep">The client&rsquo;s own rep</option>
                    </select>
                    {kind === 'user' && (
                      <select value={userId} onChange={e => setUserId(e.target.value)} style={{ ...INP, width: 240 }}>
                        <option value="">Choose a person…</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
                      </select>
                    )}
                    {kind === 'department' && (
                      <select value={department} onChange={e => setDepartment(e.target.value)} style={{ ...INP, width: 240 }}>
                        <option value="">Choose a department…</option>
                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    )}
                    {kind === 'client_rep' && (
                      <span style={{ fontSize: 11.5, color: 'var(--fg-3)', maxWidth: 420, lineHeight: 1.5 }}>
                        Resolved per complaint: whoever owns that client. Nothing to choose.
                      </span>
                    )}
                    <button type="button" onClick={() => save(r.action)} disabled={!canSave || pending}
                      style={{ ...BTN, opacity: !canSave || pending ? 0.5 : 1 }}>
                      {pending ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {r.action in provisional && (
                    <div style={{ fontSize: 11, color: 'var(--warn-strong)', marginTop: 8, lineHeight: 1.5 }}>
                      {provisional[r.action].why}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '14px 16px', borderBottom: '1px solid var(--line)' };
const PANEL_TITLE: CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--fg)' };
const SUB: CSSProperties = { fontSize: 12, color: 'var(--fg-3)', marginTop: 4, lineHeight: 1.5, maxWidth: 720 };
const BANNER: CSSProperties = { padding: '12px 16px', borderBottomWidth: 1, borderBottomStyle: 'solid' };
const INP: CSSProperties = {
  padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-paper)',
  border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none',
};
const BTN: CSSProperties = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 600, background: 'var(--brand-blue)',
  color: 'var(--toggle-sel-fg)', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
};
const LINK_BTN: CSSProperties = {
  padding: 0, fontSize: 11.5, fontWeight: 600, background: 'none', border: 'none',
  cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2,
};
const TABLE: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase',
  letterSpacing: '0.08em', fontWeight: 500, color: 'var(--fg-3)',
  borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', background: 'var(--bg-elev)',
};
const TH_R: CSSProperties = { ...TH, textAlign: 'right' };
const TD: CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11 };
const PILL: CSSProperties = { padding: '2px 7px', borderRadius: 10, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' };
