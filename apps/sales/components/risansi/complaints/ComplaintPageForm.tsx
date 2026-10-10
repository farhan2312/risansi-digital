'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { saveComplaintPage, lookupPump, listClientPumps, addLookupFromForm, type ClientPumpOption } from '@/app/actions/risansi-complaints-v2';
import {
  isFieldShown, missingOnPage, severityOf, optionsFor, cascadeParent, costImpactForced, costImpactReason,
  responsibleDepartmentFor, PAGES, ADD_ON_LOOKUP_KINDS,
  SEVERITY_LABEL, SEVERITY_REQUIRES, SEVERITY_TONE, RISK_FIELDS,
  type ComplaintPage, type ComplaintField, type ComplaintValues, type CascadingLookups, type Severity,
} from '@/lib/risansi-complaint-flow';
import { ComplaintLinkPicker } from './ComplaintLinkPicker';
import { ComplaintPartsEditor, type ComplaintPartRow } from './ComplaintPartsEditor';

// One page of a complaint, drawn from the catalogue in lib/risansi-complaint-flow.
//
// Every page uses this: the fields come from PAGES, the dropdowns from the
// lookups table, the people from the users list. It is controlled, saves the
// whole page in one action, and hides a conditional field the moment its
// condition stops holding. Page 3 computes the severity live from the same
// severityOf the server uses, so what the form shows is what will be stored.
//
// Three answers are not typed at all. A cascading select offers only the slice
// of its list that hangs under the parent's answer, and loses its own answer
// when that parent changes. Cost Impact answers itself for a replacement and is
// shown locked with the reason. Responsible Department is filled from the root
// cause and left editable, because the person who did the investigating may know
// better than the mapping.

/** The label of every field, so a cascading control can name the parent it waits on. */
const FIELD_LABEL = new Map(PAGES.flatMap(p => p.fields).map(f => [f.name, f.label] as const));

export interface UserOpt { id: number; name: string; role?: string | null; departments?: string[] }
/** A client with client_type = 'OEM', for the "supply through an OEM" picker. */
export interface OemOpt { id: number; name: string; code: string | null }

export function ComplaintPageForm({ complaintId, clientId, page, initial, lookups, cascades, users, oems = [], parts, canEdit, whyNot }: {
  complaintId: number;
  clientId: number | null;
  page: ComplaintPage;
  initial: ComplaintValues;
  lookups: Record<string, string[]>;
  /** The cascading half of complaint_lookups: `{ kind: { parent: [values] } }`. */
  cascades?: CascadingLookups;
  users: UserOpt[];
  oems?: OemOpt[];
  /** The complaint's `complaint_parts` rows, for page 2's parts editor. */
  parts?: ComplaintPartRow[];
  canEdit: boolean;
  /** One sentence on why the page is read-only, when it is. */
  whyNot?: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ComplaintValues>(() => {
    const v: ComplaintValues = {};
    for (const f of page.fields) v[f.name] = initial[f.name] ?? (f.type === 'bool' ? null : f.type === 'multi' ? [] : '');
    return v;
  });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [looking, setLooking] = useState(false);
  const [pumps, setPumps] = useState<ClientPumpOption[]>([]);

  // Whether Responsible Department is still holding what the mapping gave it.
  // A value the investigator typed over the top is theirs and is not replaced
  // when the root cause changes again.
  const autoDept = useRef<string | null>(
    page.id === 4 && initial.responsible_department
      && responsibleDepartmentFor(initial.root_cause_category as string | null, initial.root_cause_sub as string | null) === initial.responsible_department
      ? String(initial.responsible_department) : null);

  // Page 2: every pump this client has had from us, so SO, EC and serial are
  // picked off a list rather than typed blind, and an SO can bring its EC with it.
  useEffect(() => {
    if (page.id !== 2 || !clientId) return;
    let live = true;
    listClientPumps(clientId).then(res => {
      if (!live) return;
      if (res.ok) setPumps(res.data);
    }).catch(() => {
      // These only feed autocomplete on the serial / model fields, which stay
      // typeable without them. Swallowed on purpose, rather than left as an
      // unhandled rejection, because there is nothing here to tell anybody.
    });
    return () => { live = false; };
  }, [page.id, clientId]);

  const suggestions = useMemo(() => {
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x && x.trim() !== '').map(x => x.trim()))].slice(0, 300);
    return {
      so_no: uniq(pumps.map(p => p.so_number)),
      ec_no: uniq(pumps.map(p => p.ec_number)),
      pump_serial_no: uniq(pumps.map(p => p.pump_sl_no)),
      pump_model: uniq(pumps.map(p => p.pump_model_plate)),
    } as Record<string, string[]>;
  }, [pumps]);

  // Cost Impact decides itself for a replacement or an FR challan. The field is
  // shown locked with the reason; the save action applies the same rule, so a
  // post that goes round the UI cannot file a free replacement as costing nothing.
  const forcedCost = page.id === 5 && costImpactForced(values);
  const costReason = forcedCost ? costImpactReason(values) : null;
  useEffect(() => {
    if (forcedCost && values.cost_impact !== true) setValues(cur => ({ ...cur, cost_impact: true }));
  }, [forcedCost, values.cost_impact]);

  const set = (name: string, v: unknown) => {
    const next: ComplaintValues = { ...values, [name]: v };
    let note: string | null = null;

    // A cascade's parent moved, so the child it was holding is orphaned —
    // nothing may sit holding Vibration under Supply Related.
    for (const f of page.fields) if (f.parentField === name && next[f.name]) next[f.name] = '';

    // The document asks that entering an SO recommend the EC against it. The
    // installed base knows the pairing; blanks are filled and an answer already
    // typed is left alone and pointed out instead.
    if (page.id === 2 && name === 'so_no' && v) {
      const hit = pumps.find(p => (p.so_number ?? '').trim().toUpperCase() === String(v).trim().toUpperCase());
      if (hit) {
        const filled: string[] = [], differs: string[] = [];
        if (hit.ec_number) { if (!next.ec_no) { next.ec_no = hit.ec_number; filled.push(`EC ${hit.ec_number}`); } else if (next.ec_no !== hit.ec_number) differs.push(`EC on this SO is ${hit.ec_number}`); }
        if (hit.ec_date) { if (!next.ec_date) { next.ec_date = hit.ec_date; filled.push(`EC date ${hit.ec_date}`); } else if (next.ec_date !== hit.ec_date) differs.push(`EC date on this SO is ${hit.ec_date}`); }
        note = [filled.length ? `Filled from the installed base: ${filled.join(', ')}.` : '', differs.length ? `Already filled differently — ${differs.join('; ')}.` : ''].filter(Boolean).join(' ') || null;
      }
    }

    // Responsible Department follows the root cause (decision 8) and stays
    // editable. A null from the mapping means the pairing has no owner yet:
    // leave it for a human rather than writing a default nobody chose.
    if (page.id === 4 && (name === 'root_cause_category' || name === 'root_cause_sub')) {
      const dept = responsibleDepartmentFor(
        String(next.root_cause_category ?? '') || null,
        String(next.root_cause_sub ?? '') || null);
      const held = next.responsible_department;
      if (dept && (held == null || held === '' || held === autoDept.current)) {
        next.responsible_department = dept;
        autoDept.current = dept;
      }
    }

    setValues(next);
    setMsg(note ? { ok: true, text: note } : null);
  };

  // Page 3 only: what the answers so far make the severity.
  const liveSeverity: Severity | null = useMemo(
    () => (page.id === 3 ? severityOf(values as Parameters<typeof severityOf>[0]) : null), [page.id, values]);

  const missing = missingOnPage(page, values);

  const save = () => {
    setMsg(null);
    start(async () => {
      const out: Record<string, unknown> = {};
      for (const f of page.fields) out[f.name] = isFieldShown(f, values) ? values[f.name] : null;
      const res = await saveComplaintPage(complaintId, page.id, out);
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      setMsg({ ok: true, text: `${page.title} saved.` });
      router.refresh();
    });
  };

  // Page 2: the installed base, by SO number, EC number or serial. Fills blanks only.
  const lookup = async (q: string) => {
    if (!q || q.trim().length < 3) return;
    setLooking(true);
    const res = await lookupPump(q, clientId);
    setLooking(false);
    if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
    if (!res.data) { setMsg({ ok: false, text: `Nothing in the installed base matches "${q}". Type the details in; they are saved as typed.` }); return; }
    const d = res.data;
    const fill: Record<string, unknown> = { so_no: d.so_no, ec_no: d.ec_no, ec_date: d.ec_date, pump_serial_no: d.pump_serial_no, pump_model: d.pump_model };
    let n = 0;
    setValues(cur => {
      const next = { ...cur };
      for (const [k, v] of Object.entries(fill)) if (v != null && v !== '' && (next[k] == null || next[k] === '')) { next[k] = v; n++; }
      return next;
    });
    setMsg({ ok: true, text: `Found ${d.client_name ? `on ${d.client_name}` : 'it'}${d.matches > 1 ? ` (${d.matches} rows, first used)` : ''}. Filled ${n} blank field${n === 1 ? '' : 's'} — check them.` });
  };

  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '12px 16px' };

  return (
    <div>
      {!canEdit && (
        <div style={{ ...NOTE, background: 'var(--bg-elev)', border: '1px solid var(--line)', color: 'var(--fg-2)' }}>
          <span aria-hidden>👁</span> Read only. {whyNot ?? `${page.title} is edited by ${page.owner}.`}
        </div>
      )}

      {page.id === 3 && (
        <div style={{ ...NOTE, background: liveSeverity ? `color-mix(in oklab, ${SEVERITY_TONE[liveSeverity]} 10%, transparent)` : 'var(--bg-elev)',
                      border: `1px solid ${liveSeverity ? SEVERITY_TONE[liveSeverity] : 'var(--line)'}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: liveSeverity ? SEVERITY_TONE[liveSeverity] : 'var(--fg-2)' }}>
            {liveSeverity ? SEVERITY_LABEL[liveSeverity] : 'Severity — answer the questions below'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-2)', marginTop: 2 }}>
            {liveSeverity ? SEVERITY_REQUIRES[liveSeverity] : 'Computed from the answers, never typed. The highest level with any Yes wins.'}
          </div>
        </div>
      )}

      <div style={grid}>
        {page.fields.map(f => {
          if (!isFieldShown(f, values)) return null;
          const wide = f.type === 'long' || f.type === 'multi';
          const locked = forcedCost && f.name === 'cost_impact';
          return (
            <div key={f.name} style={wide ? { gridColumn: '1 / -1' } : undefined}>
              <label style={LBL}>
                {f.label}{f.required && <span style={{ color: 'var(--neg)', marginLeft: 3 }}>*</span>}
                {locked && <span style={{ ...SEV, color: 'var(--fg-3)' }} aria-label="set automatically">🔒</span>}
                {/* Each of the four forces High on its own now, so the old
                    per-question S-level badge has nothing left to say. */}
              </label>
              {locked ? (
                <div style={{ ...INPUT, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-elev)', color: 'var(--fg-2)' }}>
                  <span style={{ fontWeight: 700, fontSize: 12.5 }}>Yes</span>
                  <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>set automatically</span>
                </div>
              ) : (
                <Field f={f} value={values[f.name]} onChange={v => set(f.name, v)} disabled={!canEdit || pending}
                  lookups={lookups} cascades={cascades} values={values} users={users} oems={oems}
                  suggestions={page.id === 2 ? suggestions[f.name] : undefined}
                  complaintId={complaintId} pageId={page.id}
                  onLookup={page.id === 2 && f.fromPump && (f.name === 'ec_no' || f.name === 'pump_serial_no' || f.name === 'so_no') ? () => lookup(String(values[f.name] ?? '')) : undefined}
                  looking={looking} />
              )}
              {(locked ? costReason : f.hint) && <div style={HINT}>{locked ? costReason : f.hint}</div>}
            </div>
          );
        })}
      </div>

      {msg && (
        <div style={{ ...NOTE, marginTop: 14, background: msg.ok ? 'var(--pos-soft)' : 'var(--neg-soft)', border: `1px solid ${msg.ok ? 'var(--pos)' : 'var(--neg)'}`, color: msg.ok ? 'var(--pos)' : 'var(--neg-strong, var(--neg))' }}>
          {msg.text}
        </div>
      )}

      {canEdit && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <button type="button" onClick={save} disabled={pending} style={{ ...PRIMARY, opacity: pending ? 0.6 : 1 }}>
            {pending ? 'Saving…' : `Save ${page.title}`}
          </button>
          <span style={{ fontSize: 11, color: missing.length ? 'var(--warn)' : 'var(--fg-3)' }}>
            {missing.length ? `Still needed before this page counts as complete: ${missing.join(', ')}` : 'Every required field on this page is filled.'}
          </span>
        </div>
      )}

      {page.id === 2 && (
        <ComplaintPartsEditor complaintId={complaintId} category={(initial.complaint_category as string | null) ?? null}
          initial={parts ?? []} lookups={lookups} cascades={cascades} canEdit={canEdit}
          suggestions={{ ec_no: suggestions.ec_no ?? [] }} />
      )}
    </div>
  );
}

/**
 * A dropdown you can add to without leaving the complaint.
 *
 * The value is saved to the list straight away rather than held until the page
 * is saved: a sub-category typed here and then abandoned would otherwise be
 * lost, and the next person would type it slightly differently. It is marked
 * as added by the team, so a re-seed of the standard lists never overwrites it.
 */
function AddableSelect({ value, opts, onChange, complaintId, pageId, kind, parentValue }: {
  value: string;
  opts: string[];
  onChange: (v: unknown) => void;
  complaintId: number;
  pageId: number;
  kind: string;
  parentValue: string | null;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  // Values added in this sitting, so the new one is selectable before the
  // server's list has been fetched again.
  const [extra, setExtra] = useState<string[]>([]);

  const all = [...opts, ...extra.filter(e => !opts.includes(e))];
  const has = !value || all.includes(value);

  const save = () => {
    const v = draft.trim();
    if (!v) { setErr('Type the value first.'); return; }
    setErr(null);
    start(async () => {
      const res = await addLookupFromForm({ complaintId, pageId, kind, value: v, parentValue });
      if (!res.ok) { setErr(res.error); return; }
      setExtra(cur => [...cur, res.data.value]);
      onChange(res.data.value);
      setAdding(false);
      setDraft('');
      router.refresh();
    });
  };

  if (adding) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); }
                              if (e.key === 'Escape') { setAdding(false); setErr(null); } }}
            placeholder="New value" disabled={busy} style={{ ...INPUT, flex: 1 }}
          />
          <button type="button" onClick={save} disabled={busy} style={ADD_OK}>{busy ? '…' : 'Add'}</button>
          <button type="button" onClick={() => { setAdding(false); setErr(null); }} disabled={busy} style={ADD_X}>Cancel</button>
        </div>
        {err && <span style={{ fontSize: 10.5, color: 'var(--neg)' }}>{err}</span>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...INPUT, flex: 1 }}>
        <option value="">—</option>
        {!has && <option value={value}>{value} (not on the list)</option>}
        {all.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <button type="button" onClick={() => setAdding(true)} title="Add a value to this list" style={ADD_BTN}>+ Add</button>
    </div>
  );
}

const ADD_BTN: CSSProperties = {
  padding: '0 9px', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
  whiteSpace: 'nowrap', border: '1px solid var(--line-strong)', borderRadius: 6,
  background: 'var(--bg-paper)', color: 'var(--fg-2)',
};
const ADD_OK: CSSProperties = { ...ADD_BTN, borderColor: 'var(--accent)', color: 'var(--accent)' };
const ADD_X: CSSProperties = { ...ADD_BTN, color: 'var(--fg-3)' };

export function Field({ f, value, onChange, disabled, lookups, cascades, values, users, oems = [], onLookup, looking, suggestions, complaintId, pageId }: {
  f: ComplaintField; value: unknown; onChange: (v: unknown) => void; disabled: boolean;
  lookups: Record<string, string[]>; cascades?: CascadingLookups;
  /** The page's answers so far — what a cascading select reads its parent from. */
  values?: ComplaintValues;
  users: UserOpt[]; oems?: OemOpt[]; onLookup?: () => void; looking?: boolean;
  /** Offered values for a text field, off the client's installed base. */
  suggestions?: string[];
  /** The complaint being edited, so a 'complaint' picker never offers it to itself. */
  complaintId?: number | null;
  /** Which page, so adding to a list can be checked against who may edit it. */
  pageId?: number;
}) {
  const s = value == null ? '' : String(value);
  const answers = values ?? {};
  switch (f.type) {
    case 'long':
      return <textarea value={s} onChange={e => onChange(e.target.value)} disabled={disabled} rows={3} style={{ ...INPUT, height: 'auto', resize: 'vertical', lineHeight: 1.5 }} />;
    case 'date':
      return <input type="date" value={s.slice(0, 10)} onChange={e => onChange(e.target.value)} disabled={disabled} style={INPUT} />;
    case 'number':
      return <input type="number" value={s} onChange={e => onChange(e.target.value)} disabled={disabled} style={INPUT} />;
    case 'money':
      return <input inputMode="decimal" value={s} onChange={e => onChange(e.target.value)} disabled={disabled} placeholder="₹" style={INPUT} />;
    case 'bool':
      return (
        <div style={{ display: 'flex', gap: 6 }}>
          {[['Yes', true], ['No', false]].map(([lbl, v]) => (
            <button key={String(lbl)} type="button" disabled={disabled} onClick={() => onChange(value === v ? null : v)}
              style={{ ...CHOICE, ...(value === v ? (v ? CHOICE_YES : CHOICE_NO) : {}) }}>{lbl as string}</button>
          ))}
        </div>
      );
    case 'yesno4':
      return <Choices value={s} onChange={onChange} disabled={disabled} options={['Yes', 'No', 'Issued', 'NA']} />;
    case 'paid':
      return <Choices value={s} onChange={onChange} disabled={disabled} options={['Paid', 'To Pay']} />;
    // Several answers from one list, and no single owner. A BOI failure is QC's
    // to investigate and Purchase's to take up with the vendor; making one of
    // them the owner is how the other one stops reading it.
    case 'multi': {
      const opts = optionsFor(f, answers, lookups, cascades);
      const picked = Array.isArray(value) ? (value as unknown[]).map(String)
        : s ? s.replace(/^\{|\}$/g, '').split(',').map(x => x.trim().replace(/^"|"$/g, '')).filter(Boolean) : [];
      const toggle = (o: string) => onChange(picked.includes(o) ? picked.filter(x => x !== o) : [...picked, o]);
      return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {opts.map(o => (
            <button key={o} type="button" disabled={disabled} onClick={() => toggle(o)}
              style={{ ...CHOICE, ...(picked.includes(o) ? CHOICE_ON : {}) }}>{o}</button>
          ))}
          {picked.filter(p => !opts.includes(p)).map(o => (
            <button key={o} type="button" disabled={disabled} onClick={() => toggle(o)}
              style={{ ...CHOICE, ...CHOICE_ON, opacity: 0.7 }} title="No longer on the list">{o}</button>
          ))}
          {!opts.length && !picked.length && <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>Nothing on the list yet.</span>}
        </div>
      );
    }
    // Another complaint, by number or by client. A searching picker rather than
    // a dropdown: the list it would have to hold is every complaint ever filed.
    case 'complaint':
      return <ComplaintLinkPicker value={value} onChange={onChange} disabled={disabled} excludeId={complaintId ?? null} inputStyle={INPUT} />;
    // Suggest, do not confine. A native combobox: pick from the list, or type
    // something it does not have. What is typed is stored as typed and does not
    // join the master list, so the list stays a list rather than a pile of
    // near-identical spellings.
    case 'select_free': {
      const opts = optionsFor(f, answers, lookups, cascades);
      const listId = `dl-${f.name}`;
      return (
        <>
          <input value={s} list={listId} onChange={e => onChange(e.target.value)} disabled={disabled}
            placeholder="Pick one, or type your own" style={INPUT} />
          <datalist id={listId}>{opts.map(o => <option key={o} value={o} />)}</datalist>
        </>
      );
    }
    case 'oem': {
      const id = value == null || value === '' ? '' : String(value);
      const known = !id || oems.some(o => String(o.id) === id);
      return (
        <select value={id} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} disabled={disabled} style={INPUT}>
          <option value="">—</option>
          {!known && <option value={id}>OEM #{id} (no longer on the list)</option>}
          {oems.map(o => <option key={o.id} value={o.id}>{o.name}{o.code ? ` · ${o.code}` : ''}</option>)}
        </select>
      );
    }
    case 'select': {
      const opts = optionsFor(f, answers, lookups, cascades);
      // The two empty cases have to look different. Nothing chosen upstream:
      // there is no list, so the control says which answer it is waiting on and
      // stays shut. Chosen, with nothing seeded under it: the list is still
      // coming from the Complaint team — Client Related has no sub-categories
      // yet — so the field opens for typing instead of pretending to be a
      // dropdown with nothing in it.
      if (f.parentField && cascadeParent(f, answers) == null) {
        return (
          <select value="" disabled style={{ ...INPUT, opacity: 0.6 }}>
            <option value="">Choose {FIELD_LABEL.get(f.parentField) ?? f.parentField} first</option>
          </select>
        );
      }
      if (f.parentField && !opts.length) {
        return (
          <input value={s} onChange={e => onChange(e.target.value)} disabled={disabled} style={INPUT}
            placeholder="Nothing on the list yet — type it in" />
        );
      }
      // A list the form may extend gets the "+ Add On" the requirement asks for,
      // so somebody with the complaint in front of them is not stopped by a
      // dropdown that is missing the one word they need.
      if (!disabled && complaintId && pageId && ADD_ON_LOOKUP_KINDS.includes(f.lookup ?? '')) {
        return (
          <AddableSelect
            value={s} opts={opts} onChange={onChange}
            complaintId={complaintId} pageId={pageId}
            kind={f.lookup as string} parentValue={f.parentField ? cascadeParent(f, answers) : null}
          />
        );
      }
      const has = !s || opts.includes(s);
      return (
        <select value={s} onChange={e => onChange(e.target.value)} disabled={disabled} style={INPUT}>
          <option value="">—</option>
          {!has && <option value={s}>{s} (not on the list)</option>}
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    case 'user': {
      const id = value == null || value === '' ? '' : String(value);
      return (
        <select value={id} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} disabled={disabled} style={INPUT}>
          <option value="">—</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}{u.departments?.length ? ` · ${u.departments.join(', ')}` : u.role ? ` · ${u.role}` : ''}</option>)}
        </select>
      );
    }
    default: {
      const listId = suggestions?.length ? `dl-sugg-${f.name}` : undefined;
      return (
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={s} list={listId} onChange={e => onChange(e.target.value)} disabled={disabled} style={INPUT}
            onKeyDown={e => { if (e.key === 'Enter' && onLookup) { e.preventDefault(); onLookup(); } }} />
          {listId && <datalist id={listId}>{suggestions!.map(o => <option key={o} value={o} />)}</datalist>}
          {onLookup && (
            <button type="button" onClick={onLookup} disabled={disabled || looking || s.trim().length < 3} title="Look this up in the installed base and fill what it knows"
              style={{ ...GHOST, whiteSpace: 'nowrap', opacity: s.trim().length < 3 ? 0.5 : 1 }}>{looking ? '…' : 'Look up'}</button>
          )}
        </div>
      );
    }
  }
}

function Choices({ value, onChange, disabled, options }: { value: string; onChange: (v: unknown) => void; disabled: boolean; options: string[] }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o} type="button" disabled={disabled} onClick={() => onChange(value === o ? '' : o)}
          style={{ ...CHOICE, ...(value === o ? CHOICE_ON : {}) }}>{o}</button>
      ))}
    </div>
  );
}

export const LBL: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-3)', marginBottom: 4 };
export const SEV: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, textTransform: 'none', letterSpacing: 0 };
export const HINT: CSSProperties = { fontSize: 10.5, color: 'var(--fg-3)', marginTop: 3, lineHeight: 1.4 };
export const INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
  background: 'var(--bg-sunk)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none', height: 36,
};
export const NOTE: CSSProperties = { padding: '9px 12px', borderRadius: 6, fontSize: 12, marginBottom: 14, lineHeight: 1.5 };
const CHOICE: CSSProperties = {
  padding: '7px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer',
  background: 'var(--bg-paper)', color: 'var(--fg-2)', border: '1px solid var(--line-strong)',
};
const CHOICE_ON: CSSProperties = { background: 'var(--accent-fill)', color: 'var(--on-accent)', borderColor: 'var(--accent-fill)' };
// A chosen Yes is navy like any other choice; a chosen No is grey. Yes is not
// "bad" everywhere — "customer confirmed the fix" is a good Yes.
const CHOICE_YES: CSSProperties = CHOICE_ON;
const CHOICE_NO: CSSProperties = { background: 'var(--fg-3)', color: '#fff', borderColor: 'var(--fg-3)' };
export const PRIMARY: CSSProperties = { border: 'none', background: 'var(--accent-fill)', color: 'var(--on-accent)', borderRadius: 6, fontSize: 13, fontWeight: 600, padding: '9px 18px', cursor: 'pointer', fontFamily: 'inherit' };
export const GHOST: CSSProperties = { border: '1px solid var(--line-strong)', background: 'var(--bg-paper)', color: 'var(--fg)', borderRadius: 6, fontSize: 12, fontWeight: 600, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit' };
