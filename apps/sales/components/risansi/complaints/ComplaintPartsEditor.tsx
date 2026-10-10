'use client';

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { saveComplaintParts } from '@/app/actions/risansi-complaints-v2';
import type { CascadingLookups } from '@/lib/risansi-complaint-flow';

// The parts one complaint is about — as many as it is actually about.
//
// Page 2 used to hold one part: one type, one name, one quantity, one MOC. A
// damaged joint arrives with the bush, the pin, the protector and the shaft
// head, each wanting its own material of construction, and a wrong supply spans
// several ECs. With one slot the rest went into the remarks box, where no
// dashboard can answer "which part fails most" — which is the reason the
// question is asked at all.
//
// So: a repeating row editor over `complaint_parts`, saved as a whole list
// through saveComplaintParts. Which columns it asks for follows the complaint's
// category. For Performance the question is not about a part but about duty, so
// the row becomes Liquid / Head / Capacity / MOC / Quantity; for everything else
// it is Part Type / Part Name / Quantity / MOC, with Vendor added for a BOI part
// and MFG Date and Part Code for a rubber one. EC number and date sit on every
// row, because one complaint can span several ECs.

export interface ComplaintPartRow {
  id?: number;
  part_type: string | null; part_name: string | null; quantity: string | null; moc: string | null;
  vendor_name: string | null; mfg_date: string | null; part_code: string | null;
  ec_no: string | null; ec_date: string | null;
  liquid: string | null; head: string | null; capacity: string | null;
}

/** The lookup parent whose children are a joint's parts. */
const JOINT = 'Joint';

/**
 * What a joint is made of, for the "+ child parts" button.
 *
 * A constant rather than a lookup list. These were a part type of their own
 * until the Complaint Team pointed out that a Bush is not a different kind of
 * part from a joint, it is a part of one; they are part NAMES under Joint now.
 * The button needs to know which of Joint's names are the children rather than
 * the four assemblies, and that is a fact about how a joint is built, not a
 * list anybody revises. A twelfth is added through Add On under Joint and
 * picked from the dropdown like any other name.
 */
const JOINT_CHILDREN = [
  'Bush', 'Protector', 'Shaft', 'Shaft Head', 'Rotor Head', 'Connecting Rod',
  'Sleeve', 'Pin', 'Dowel Pin', 'Threaded Pin', 'Head Pin',
] as const;

type ColKind = 'text' | 'select' | 'qty' | 'date';
interface Col {
  key: keyof ComplaintPartRow;
  label: string;
  kind: ColKind;
  width: number;
  /** For `select`: the lookup kind, flat unless `parent` names the column it follows. */
  lookup?: string;
  parent?: keyof ComplaintPartRow;
  /** A column only some rows ask for. Shown when any row asks; dashed on the rest. */
  only?: (r: ComplaintPartRow) => boolean;
  hint?: string;
}

const PART_COLS: Col[] = [
  { key: 'part_type', label: 'Part type', kind: 'select', lookup: 'part_type', width: 150 },
  { key: 'part_name', label: 'Part name', kind: 'select', lookup: 'part_name', parent: 'part_type', width: 165 },
  { key: 'quantity', label: 'Qty', kind: 'qty', width: 68 },
  { key: 'moc', label: 'MOC', kind: 'text', width: 120, hint: 'Material of construction' },
  { key: 'vendor_name', label: 'Vendor', kind: 'text', width: 140, only: r => r.part_type === 'BOI' },
  { key: 'mfg_date', label: 'MFG date', kind: 'date', width: 140, only: r => r.part_type === 'Rubber Part' },
  { key: 'part_code', label: 'Part code', kind: 'text', width: 120, only: r => r.part_type === 'Rubber Part' },
  { key: 'ec_no', label: 'EC no.', kind: 'text', width: 120 },
  { key: 'ec_date', label: 'EC date', kind: 'date', width: 140 },
];

const PERF_COLS: Col[] = [
  { key: 'liquid', label: 'Liquid', kind: 'text', width: 150 },
  { key: 'head', label: 'Head', kind: 'text', width: 100 },
  { key: 'capacity', label: 'Capacity', kind: 'text', width: 100 },
  { key: 'moc', label: 'MOC', kind: 'text', width: 120 },
  { key: 'quantity', label: 'Qty', kind: 'qty', width: 68 },
  { key: 'ec_no', label: 'EC no.', kind: 'text', width: 120 },
  { key: 'ec_date', label: 'EC date', kind: 'date', width: 140 },
];

const BLANK: ComplaintPartRow = {
  part_type: null, part_name: null, quantity: null, moc: null, vendor_name: null,
  mfg_date: null, part_code: null, ec_no: null, ec_date: null, liquid: null, head: null, capacity: null,
};

const isEmptyRow = (r: ComplaintPartRow) =>
  (Object.keys(BLANK) as (keyof ComplaintPartRow)[]).every(k => r[k] == null || r[k] === '');

export function ComplaintPartsEditor({ complaintId, category, initial, lookups, cascades, canEdit, suggestions = {} }: {
  complaintId: number;
  /** The complaint category. Performance asks about duty, not about a part. */
  category: string | null;
  initial: ComplaintPartRow[];
  lookups: Record<string, string[]>;
  cascades?: CascadingLookups;
  canEdit: boolean;
  /** EC numbers off the client's installed base, offered rather than typed blind. */
  suggestions?: Record<string, string[]>;
}) {
  const router = useRouter();
  const performance = category === 'Performance';
  const cols = performance ? PERF_COLS : PART_COLS;

  const [rows, setRows] = useState<ComplaintPartRow[]>(() => (initial.length ? initial.map(r => ({ ...BLANK, ...r })) : [{ ...BLANK }]));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const shown = useMemo(() => cols.filter(c => !c.only || rows.some(c.only)), [cols, rows]);

  const edit = (i: number, key: keyof ComplaintPartRow, v: string) => {
    setRows(cur => cur.map((r, n) => {
      if (n !== i) return r;
      const next: ComplaintPartRow = { ...r, [key]: v === '' ? null : v };
      // Part Name follows Part Type. Change the type and the name it was
      // holding is a part of something else — Shaft under External is not the
      // Shaft under a joint — so it is cleared rather than left to mislead.
      if (key === 'part_type') next.part_name = null;
      if (key === 'part_type' && v !== 'BOI') next.vendor_name = null;
      if (key === 'part_type' && v !== 'Rubber Part') { next.mfg_date = null; next.part_code = null; }
      return next;
    }));
    setDirty(true); setMsg(null);
  };

  const addRow = () => { setRows(cur => [...cur, { ...BLANK }]); setDirty(true); setMsg(null); };
  const removeRow = (i: number) => {
    setRows(cur => { const next = cur.filter((_, n) => n !== i); return next.length ? next : [{ ...BLANK }]; });
    setDirty(true); setMsg(null);
  };

  /**
   * The joint rule from the requirement: pick a joint and the MOC is wanted for
   * every part inside it. Eleven rows typed by hand is how that ends up not
   * being recorded, so one click lays the whole child set out, carrying the
   * joint's EC down with it — the children came out on the same EC.
   */
  const children = JOINT_CHILDREN as readonly string[];
  const addJointChildren = (i: number) => {
    const from = rows[i];
    // Rows are typed Joint, like the assembly they came from. Older rows may
    // still carry the retired type, so both count as "already there" and the
    // button does not add an eleventh Bush beside the one that exists.
    const already = new Set(rows
      .filter(r => (r.part_type === JOINT || r.part_type === 'Child Parts of Joints') && (r.ec_no ?? '') === (from.ec_no ?? ''))
      .map(r => r.part_name));
    const fresh = children.filter(c => !already.has(c)).map(c => ({
      ...BLANK, part_type: JOINT, part_name: c, ec_no: from.ec_no, ec_date: from.ec_date,
    }));
    if (!fresh.length) { setMsg({ ok: true, text: 'Every child part of this joint is already on the list.' }); return; }
    setRows(cur => [...cur.slice(0, i + 1), ...fresh, ...cur.slice(i + 1)]);
    setDirty(true);
    setMsg({ ok: true, text: `${fresh.length} child part${fresh.length === 1 ? '' : 's'} added — enter the MOC against each, and delete the ones this complaint is not about.` });
  };

  const save = () => {
    setMsg(null);
    start(async () => {
      const res = await saveComplaintParts(complaintId, rows.filter(r => !isEmptyRow(r)));
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      const n = rows.filter(r => !isEmptyRow(r)).length;
      setDirty(false);
      setMsg({ ok: true, text: n ? `${n} part${n === 1 ? '' : 's'} saved.` : 'Part details cleared.' });
      router.refresh();
    });
  };

  const filled = rows.filter(r => !isEmptyRow(r)).length;

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Part details</span>
        <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
          {performance
            ? 'A Performance complaint is about duty, not a part: liquid, head and capacity as reported.'
            : 'One row per part. Add as many as the complaint is about, each with its own MOC and EC.'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{filled || '—'}</span>
      </div>
      {!category && (
        <div style={{ ...NOTE, background: 'var(--bg-elev)', border: '1px solid var(--line)', color: 'var(--fg-2)', marginTop: 8 }}>
          No complaint category is set on page 1 yet, so these are the part fields rather than the Performance ones. Set the category first if this is a Performance complaint.
        </div>
      )}

      {Object.entries(suggestions).filter(([, v]) => v.length).map(([k, v]) => (
        <datalist key={k} id={`dl-part-${k}`}>{v.map(o => <option key={o} value={o} />)}</datalist>
      ))}

      <div style={{ overflowX: 'auto', marginTop: 10 }}>
        <div style={{ minWidth: shown.reduce((n, c) => n + c.width + 8, 90) }}>
          <div style={{ display: 'grid', gridTemplateColumns: `28px ${shown.map(c => `${c.width}px`).join(' ')} 1fr`, gap: 6, alignItems: 'center' }}>
            <span />
            {shown.map(c => <span key={String(c.key)} style={TH} title={c.hint}>{c.label}</span>)}
            <span />
            {rows.map((r, i) => (
              <Row key={i} index={i} row={r} cols={shown} lookups={lookups} cascades={cascades} suggestions={suggestions}
                disabled={!canEdit || pending} onEdit={edit} onRemove={removeRow}
                onJoint={!performance && r.part_type === JOINT && !!r.part_name && children.length > 0 ? () => addJointChildren(i) : undefined} />
            ))}
          </div>
        </div>
      </div>

      {msg && (
        <div style={{ ...NOTE, marginTop: 12, background: msg.ok ? 'var(--pos-soft)' : 'var(--neg-soft)', border: `1px solid ${msg.ok ? 'var(--pos)' : 'var(--neg)'}`, color: msg.ok ? 'var(--pos-strong, var(--pos))' : 'var(--neg-strong, var(--neg))' }}>
          {msg.text}
        </div>
      )}

      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={addRow} disabled={pending} style={GHOST}>+ Add {performance ? 'a duty row' : 'a part'}</button>
          <button type="button" onClick={save} disabled={pending || !dirty} style={{ ...GHOST, fontWeight: 700, opacity: pending || !dirty ? 0.55 : 1 }}>
            {pending ? 'Saving…' : 'Save part details'}
          </button>
          <span style={{ fontSize: 11, color: dirty ? 'var(--warn-strong, var(--warn))' : 'var(--fg-3)' }}>
            {dirty ? 'Not saved yet — the part rows save on their own button.' : 'Saved separately from the fields above.'}
          </span>
        </div>
      )}
    </div>
  );
}

function Row({ index, row, cols, lookups, cascades, suggestions, disabled, onEdit, onRemove, onJoint }: {
  index: number; row: ComplaintPartRow; cols: Col[];
  lookups: Record<string, string[]>; cascades?: CascadingLookups; suggestions: Record<string, string[]>;
  disabled: boolean;
  onEdit: (i: number, key: keyof ComplaintPartRow, v: string) => void;
  onRemove: (i: number) => void;
  onJoint?: () => void;
}) {
  return (
    <>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-3)', textAlign: 'right' }}>{index + 1}</span>
      {cols.map(c => {
        if (c.only && !c.only(row)) {
          return <span key={String(c.key)} style={{ fontSize: 11, color: 'var(--fg-4, var(--fg-3))', textAlign: 'center', opacity: 0.5 }} title={`${c.label} is only asked for ${c.key === 'vendor_name' ? 'a BOI part' : 'a rubber part'}`}>—</span>;
        }
        return <Cell key={String(c.key)} col={c} row={row} lookups={lookups} cascades={cascades}
          suggestions={suggestions} disabled={disabled} onChange={v => onEdit(index, c.key, v)} />;
      })}
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {onJoint && (
          <button type="button" onClick={onJoint} disabled={disabled} style={{ ...MINI, color: 'var(--accent)', borderColor: 'var(--accent-line, var(--line-strong))' }}
            title="Lay out every child part of this joint as its own row, so an MOC can be entered for each">
            + child parts
          </button>
        )}
        {!disabled && <button type="button" onClick={() => onRemove(index)} title="Remove this row" style={X}>×</button>}
      </span>
    </>
  );
}

function Cell({ col, row, lookups, cascades, suggestions, disabled, onChange }: {
  col: Col; row: ComplaintPartRow; lookups: Record<string, string[]>; cascades?: CascadingLookups;
  suggestions: Record<string, string[]>; disabled: boolean; onChange: (v: string) => void;
}) {
  const v = row[col.key] == null ? '' : String(row[col.key]);

  if (col.kind === 'select') {
    const parentValue = col.parent ? (row[col.parent] == null ? '' : String(row[col.parent])) : null;
    const opts = col.parent
      ? (parentValue ? cascades?.[col.lookup ?? '']?.[parentValue] ?? [] : [])
      : lookups[col.lookup ?? ''] ?? [];
    // Parent unanswered: there is no list to show, so the control says so and
    // stays shut. Parent answered with nothing under it: the list is pending
    // from the Complaint team, so what is typed is kept.
    if (col.parent && !parentValue) {
      return <select value="" disabled style={{ ...CELL, opacity: 0.6 }}><option value="">Part type first</option></select>;
    }
    if (col.parent && !opts.length) {
      return <input value={v} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder="Nothing listed — type it" style={CELL} />;
    }
    const known = !v || opts.includes(v);
    return (
      <select value={v} disabled={disabled} onChange={e => onChange(e.target.value)} style={CELL}>
        <option value="">—</option>
        {!known && <option value={v}>{v} (not on the list)</option>}
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (col.kind === 'date') {
    return <input type="date" value={v.slice(0, 10)} disabled={disabled} onChange={e => onChange(e.target.value)} style={CELL} />;
  }
  if (col.kind === 'qty') {
    return <input inputMode="decimal" value={v} disabled={disabled} onChange={e => onChange(e.target.value)} style={{ ...CELL, textAlign: 'right' }} />;
  }
  // The datalists themselves are rendered once for the whole table, not once
  // per row: a dozen rows each emitting `id="dl-part-ec_no"` is a dozen elements
  // fighting over one id, and the browser resolves `list=` to whichever it saw
  // first anyway.
  const hasList = (suggestions[String(col.key)] ?? []).length > 0;
  return <input value={v} list={hasList ? `dl-part-${String(col.key)}` : undefined} disabled={disabled}
    onChange={e => onChange(e.target.value)} style={CELL} />;
}

const TH: CSSProperties = { fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)' };
const CELL: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '5px 7px', fontSize: 12, fontFamily: 'inherit',
  background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)', borderRadius: 5, color: 'var(--fg)', outline: 'none', height: 30,
};
const NOTE: CSSProperties = { padding: '9px 12px', borderRadius: 6, fontSize: 12, lineHeight: 1.5 };
const GHOST: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)',
  borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit',
};
const MINI: CSSProperties = {
  border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg-2)',
  borderRadius: 5, fontSize: 10.5, fontWeight: 600, padding: '3px 7px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};
const X: CSSProperties = { border: 'none', background: 'transparent', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 3px' };
