'use client';

// Every dropdown the complaint form offers, and the + Add On control the
// requirement asks for in six different places.
//
// One screen for all sixteen lists rather than six controls scattered across
// the form, because they behave identically and the rules that matter are the
// same everywhere: nothing is ever deleted, a value the team adds is marked as
// theirs so a later seed cannot reword it, and a cascading list is edited under
// the parent it hangs beneath.
//
// Sorting and reordering are two different things and the table says which is
// which. The column headers sort what you are looking at; the ▲▼ buttons change
// the order the form will show the list in, which is only meaningful while the
// table is in that order — so a sort disables them rather than letting a click
// move a row somewhere the screen cannot show.

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useTableSort, SortTH } from '@/components/risansi/SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';
import {
  addComplaintLookup, setComplaintLookupActive, moveComplaintLookup,
} from '@/app/actions/risansi-complaint-admin';

export interface LookupKindOption {
  kind: string;
  label: string;
  note: string;
  retired: boolean;
  /** The kind this list hangs under, for a cascading list. */
  parentKind: string | null;
  parentLabel: string | null;
  /** Parent values this list may hang under — every value of the parent kind. */
  parents: string[];
  active: number;
  total: number;
}

export interface LookupEditorRow {
  kind: string;
  value: string;
  parent_value: string | null;
  sort_order: number;
  is_active: boolean;
  is_user_added: boolean;
  in_use: number;
}

const SOURCE_ORDER = ['Complaint Team', 'Seeded'];
const STATE_ORDER = ['Active', 'Retired'];

const COLS: SortableColumn<LookupEditorRow>[] = [
  { key: 'value',       kind: 'text' },
  { key: 'parent_value', kind: 'text' },
  { key: 'sort_order',  kind: 'number' },
  { key: 'in_use',      kind: 'number' },
  { key: 'source',      kind: 'status', order: SOURCE_ORDER, value: r => (r.is_user_added ? 'Complaint Team' : 'Seeded') },
  { key: 'state',       kind: 'status', order: STATE_ORDER,  value: r => (r.is_active ? 'Active' : 'Retired') },
];

export function LookupEditor({ kinds, rows }: { kinds: LookupKindOption[]; rows: LookupEditorRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [kind, setKind] = useState(kinds[0]?.kind ?? 'source');
  const [parentFilter, setParentFilter] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newParent, setNewParent] = useState('');
  const [showRetired, setShowRetired] = useState(false);

  const meta = kinds.find(k => k.kind === kind) ?? kinds[0];

  const shown = useMemo(() => rows.filter(r =>
    r.kind === kind
    && (parentFilter === '' || (r.parent_value ?? '') === parentFilter)
    && (showRetired || r.is_active)), [rows, kind, parentFilter, showRetired]);

  const { rows: ordered, sort, sortBy } = useTableSort(shown, COLS);
  const reorderable = sort.key === null;

  // Up and down are offered against the list as the form will read it — every
  // row of that (kind, parent), retired ones included, because the retired ones
  // still occupy a position and skipping them would make the arrows lie about
  // which row moves.
  const groupOf = (r: LookupEditorRow) =>
    rows.filter(x => x.kind === r.kind && (x.parent_value ?? '') === (r.parent_value ?? ''))
      .sort((a, b) => a.sort_order - b.sort_order || a.value.localeCompare(b.value));

  // Each call site reads its own `.ok` rather than handing the promise to a
  // runner. A refusal from any of these three is nearly always something the
  // person typing can fix — a duplicate value, the last value on a list — and a
  // wrapper that swallowed the result would turn that into a silent no-op.
  const refused = (error: string) => setMsg({ ok: false, text: error });
  const saved = (note?: string) => { setMsg({ ok: true, text: note ?? 'Saved.' }); router.refresh(); };

  function add() {
    setMsg(null);
    start(async () => {
      const res = await addComplaintLookup({ kind, value: newValue, parentValue: meta?.parentKind ? newParent : null });
      if (!res.ok) { refused(res.error); return; }
      setNewValue('');
      saved(res.note);
    });
  }

  function toggle(r: LookupEditorRow) {
    setMsg(null);
    start(async () => {
      const res = await setComplaintLookupActive(r.kind, r.value, r.parent_value, !r.is_active);
      if (!res.ok) { refused(res.error); return; }
      saved(r.is_active ? `"${r.value}" retired.` : `"${r.value}" is back on the list.`);
    });
  }

  function move(r: LookupEditorRow, direction: 'up' | 'down') {
    setMsg(null);
    start(async () => {
      const res = await moveComplaintLookup(r.kind, r.value, r.parent_value, direction);
      if (!res.ok) { refused(res.error); return; }
      saved(`"${r.value}" moved ${direction}.`);
    });
  }

  const canAdd = newValue.trim() !== '' && !meta?.retired && (!meta?.parentKind || newParent !== '');

  return (
    <div style={PANEL}>
      <div style={PANEL_H}>
        <div>
          <div style={PANEL_TITLE}>Lists &amp; Add On</div>
          <div style={SUB}>
            Every dropdown the complaint form offers. Add a value and it appears on the form at once —
            no release. Nothing is deleted: a value you retire leaves the dropdown and keeps reading on
            the complaints already filed under it.
          </div>
        </div>
      </div>

      {/* Which list */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {kinds.map(k => {
          const on = k.kind === kind;
          return (
            <button key={k.kind} type="button"
              onClick={() => { setKind(k.kind); setParentFilter(''); setNewParent(''); setMsg(null); }}
              style={{
                ...CHIP,
                background: on ? 'var(--accent-soft)' : 'var(--bg-elev)',
                borderColor: on ? 'var(--accent-line)' : 'var(--line)',
                color: on ? 'var(--accent)' : k.retired ? 'var(--fg-4)' : 'var(--fg-2)',
                fontWeight: on ? 600 : 500,
              }}>
              {k.label}
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, opacity: 0.75, marginLeft: 5 }}>
                {k.active}{k.total > k.active ? `/${k.total}` : ''}
              </span>
              {k.retired && <span style={{ fontSize: 9, marginLeft: 5, color: 'var(--fg-4)' }}>retired</span>}
            </button>
          );
        })}
      </div>

      {meta && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>{meta.note}</div>

          {meta.parentKind && (
            <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 6 }}>
              This list cascades: each value belongs to one {meta.parentLabel}. A {meta.parentLabel} with
              nothing under it is allowed — the form lets the value be typed in instead.
            </div>
          )}
          {meta.retired && (
            <div style={{ ...BANNER, background: 'var(--bg-sunk)', borderColor: 'var(--line-strong)', color: 'var(--fg-3)' }}>
              The form no longer asks for this. The list is here so the complaints that answered it still
              show their answer; new values cannot be added.
            </div>
          )}

          {/* + Add On */}
          {!meta.retired && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12 }}>
              {meta.parentKind && (
                <select value={newParent} onChange={e => setNewParent(e.target.value)} style={{ ...INP, width: 200 }}>
                  <option value="">{meta.parentLabel}…</option>
                  {meta.parents.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
              <input
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && canAdd && !pending) add(); }}
                placeholder={`New ${meta.label.toLowerCase()}`}
                style={{ ...INP, width: 260 }} />
              <button type="button" onClick={add} disabled={!canAdd || pending}
                style={{ ...BTN, opacity: !canAdd || pending ? 0.5 : 1 }}>
                {pending ? 'Adding…' : '+ Add On'}
              </button>
            </div>
          )}

          {/* Outside the Add On block on purpose: a retired list has no Add On
              control and still has retired values somebody may want back. */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-3)', marginTop: 10 }}>
            <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} />
            Show retired values{meta ? ` (${rows.filter(r => r.kind === kind && !r.is_active).length})` : ''}
          </label>

          {meta.parentKind && meta.parents.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-4)' }}>
                Under
              </span>
              <button type="button" onClick={() => setParentFilter('')}
                style={{ ...MINI, background: parentFilter === '' ? 'var(--accent-soft)' : 'var(--bg-elev)', color: parentFilter === '' ? 'var(--accent)' : 'var(--fg-3)' }}>
                All
              </button>
              {meta.parents.map(p => {
                const n = rows.filter(r => r.kind === kind && r.parent_value === p && r.is_active).length;
                const on = parentFilter === p;
                return (
                  <button key={p} type="button" onClick={() => { setParentFilter(p); setNewParent(p); }}
                    style={{ ...MINI, background: on ? 'var(--accent-soft)' : 'var(--bg-elev)', color: on ? 'var(--accent)' : n === 0 ? 'var(--warn-strong)' : 'var(--fg-3)' }}>
                    {p} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5 }}>{n}</span>
                    {n === 0 && <span title="Nothing under this one yet" style={{ marginLeft: 3 }}>⚠</span>}
                  </button>
                );
              })}
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
              <SortTH {...sortBy('value')} style={TH}>Value</SortTH>
              {meta?.parentKind && <SortTH {...sortBy('parent_value')} style={TH}>{meta.parentLabel}</SortTH>}
              <SortTH {...sortBy('sort_order')} style={TH_R} align="right">Order</SortTH>
              <SortTH {...sortBy('in_use')} style={TH_R} align="right" title="Complaints answering with this value">On</SortTH>
              <SortTH {...sortBy('source')} style={TH}>Added by</SortTH>
              <SortTH {...sortBy('state')} style={TH}>State</SortTH>
              <SortTH sortable={false} style={TH_R} align="right">
                {reorderable ? 'Move' : <span title="Clear the sort to reorder" style={{ color: 'var(--fg-4)' }}>Move</span>}
              </SortTH>
              <SortTH sortable={false} style={TH_R} align="right">&nbsp;</SortTH>
            </tr>
          </thead>
          <tbody>
            {ordered.length === 0 && (
              <tr><td colSpan={8} style={{ ...TD, textAlign: 'center', color: 'var(--fg-3)', padding: '22px 12px' }}>
                {showRetired ? 'Nothing on this list yet. Add the first value above.'
                  : 'Nothing active on this list. Tick “Show retired”, or add a value above.'}
              </td></tr>
            )}
            {ordered.map(r => {
              const group = groupOf(r);
              const at = group.findIndex(x => x.value === r.value);
              const first = at <= 0, last = at === group.length - 1;
              return (
                <tr key={`${r.kind}|${r.parent_value ?? ''}|${r.value}`}
                  style={{ borderTop: '1px solid var(--line)', opacity: r.is_active ? 1 : 0.6 }}>
                  <td style={{ ...TD, fontWeight: 500, color: 'var(--fg)' }}>{r.value}</td>
                  {meta?.parentKind && <td style={{ ...TD, color: 'var(--fg-3)' }}>{r.parent_value ?? '—'}</td>}
                  <td style={{ ...TD, ...MONO, textAlign: 'right', color: 'var(--fg-3)' }}>{r.sort_order}</td>
                  <td style={{ ...TD, ...MONO, textAlign: 'right', color: r.in_use > 0 ? 'var(--fg-2)' : 'var(--fg-4)' }}>
                    {r.in_use || '—'}
                  </td>
                  <td style={TD}>
                    <span style={{ ...PILL, background: r.is_user_added ? 'var(--accent-soft)' : 'var(--bg-elev)', color: r.is_user_added ? 'var(--accent)' : 'var(--fg-3)' }}>
                      {r.is_user_added ? 'Complaint Team' : 'Seeded'}
                    </span>
                  </td>
                  <td style={TD}>
                    <span style={{ ...PILL, background: r.is_active ? 'var(--pos-soft)' : 'var(--bg-elev)', color: r.is_active ? 'var(--pos-strong)' : 'var(--fg-4)' }}>
                      {r.is_active ? 'Active' : 'Retired'}
                    </span>
                  </td>
                  <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" title={reorderable ? 'Move up' : 'Clear the sort to reorder'}
                      disabled={!reorderable || first || pending}
                      onClick={() => move(r, 'up')}
                      style={{ ...ICON, opacity: !reorderable || first || pending ? 0.25 : 1 }}>▲</button>
                    <button type="button" title={reorderable ? 'Move down' : 'Clear the sort to reorder'}
                      disabled={!reorderable || last || pending}
                      onClick={() => move(r, 'down')}
                      style={{ ...ICON, opacity: !reorderable || last || pending ? 0.25 : 1 }}>▼</button>
                  </td>
                  <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" disabled={pending}
                      title={r.is_active
                        ? `Take "${r.value}" out of the dropdown. The ${r.in_use} complaint${r.in_use === 1 ? '' : 's'} on it keep reading it.`
                        : `Put "${r.value}" back on the dropdown.`}
                      onClick={() => toggle(r)}
                      style={{ ...LINK_BTN, color: r.is_active ? 'var(--neg)' : 'var(--accent)' }}>
                      {r.is_active ? 'Retire' : 'Restore'}
                    </button>
                  </td>
                </tr>
              );
            })}
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
const BANNER: CSSProperties = { marginTop: 10, padding: '8px 10px', border: '1px solid', borderRadius: 6, fontSize: 11.5, lineHeight: 1.5 };
const CHIP: CSSProperties = { padding: '5px 10px', fontSize: 11.5, border: '1px solid', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' };
const MINI: CSSProperties = { padding: '3px 8px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' };
const INP: CSSProperties = {
  padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-elev)',
  border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none',
};
const BTN: CSSProperties = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 600, background: 'var(--brand-blue)',
  color: 'var(--toggle-sel-fg)', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
};
const ICON: CSSProperties = {
  padding: '2px 5px', fontSize: 9, background: 'var(--bg-elev)', color: 'var(--fg-2)',
  border: '1px solid var(--line)', borderRadius: 4, cursor: 'pointer', marginLeft: 3, fontFamily: 'inherit',
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
