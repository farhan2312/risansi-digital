'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEPARTMENTS_LIST, SEVERITY_LABEL, SEVERITIES, HEADLINE_STATUSES, statusesFor, statusesUnderHeadline,
  STATE_LABEL, type HeadlineStatus,
} from '@/lib/risansi-complaint-flow';

// The filters over the complaints list. Every control writes the URL, so the
// analytics, the table and the export all read the same state, and a clicked
// bar (which is also just a URL) shows up here as a chosen value.
//
// Status is asked in two steps, matching decision 1: the segmented control
// picks one of the five headline names the business uses, and the dropdown
// beside it narrows to a sub-stage underneath it. The sub-stage is still what
// the Complaint Team works with — "Replacement Pending" says who to chase and
// "Action Taken" does not — so it stays on the row and in this dropdown.
//
// Requirement (A), pumps of H100 and above, is not here. Model Series is free
// text by decision 12 and holds nothing on any complaint on file, so there is
// no ordering to compare a size against; the note above the filter keys in
// lib/risansi-complaint-rows.ts spells out why.

export interface FilterOptions {
  categories: string[]; subcategories: string[];
  /** Old `defect_category` answers on rows the 2 Oct mapping left without a new category. */
  legacyCategories: string[];
  responsibles: string[];
  rootCauses: string[]; rootCauseSubs: string[];
  partTypes: string[]; partNames: string[]; mocs: string[];
  industries: string[]; clientTypes: string[]; actions: string[];
  modelVersions: string[]; modelSeries: string[];
  reps: { id: number; name: string }[]; holders: { id: number; name: string }[];
  /** Only the clients that actually have a complaint, most first. */
  clients: { id: string; name: string }[];
}

export function ComplaintFilterBar({ value, options, basePath }: {
  value: Record<string, string | undefined>;
  options: FilterOptions;
  basePath: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(value.q ?? '');
  useEffect(() => { setQ(value.q ?? ''); }, [value.q]);

  const set = (patch: Record<string, string | undefined>) => {
    const next = { ...value, ...patch };
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) usp.set(k, v);
    const s = usp.toString();
    router.push(s ? `${basePath}?${s}` : basePath);
  };
  // `sort` rides along in value so a filter change keeps the column order, but it is not a filter.
  const active = Object.entries(value).filter(([k, v]) => v && k !== 'sort').length;

  // Narrowing the headline drops a sub-stage that no longer belongs to it,
  // rather than leaving a pair that can never match and an empty table with no
  // reason given.
  const stagesUnder = (h: string | undefined) =>
    h ? statusesUnderHeadline(h as HeadlineStatus) : statusesFor(value.state);
  const fits = (status: string | undefined, headline: string | undefined) =>
    !status || stagesUnder(headline).includes(status);

  // The second row: everything that is not the question people open the page
  // with. Opened automatically when one of its filters is already in force, so
  // a shared link never hides the filter that is shaping the table.
  const MORE = ['dept', 'holder', 'dcat', 'resp', 'rcc', 'rcs', 'ptype', 'pname', 'moc', 'ctype', 'action', 'capa', 'pa', 'visit', 'mver', 'mseries', 'era', 'client', 'rep', 'linked'];
  const moreOn = MORE.filter(k => value[k]).length;
  const [more, setMore] = useState(false);
  useEffect(() => { if (moreOn) setMore(true); }, [moreOn]);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <form onSubmit={e => { e.preventDefault(); set({ q: q.trim() || undefined }); }} style={{ display: 'flex' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search no., client, serial, EC, text…"
            style={{ ...INPUT, width: 240 }} />
        </form>
        {/* Two questions, one control. The segmented part asks which of the five
            headline names; the dropdown beside it asks which sub-stage under
            it. Picking a headline also narrows the stages on offer, so a pair
            that can never match cannot be built. */}
        <div className="cmp-statusfilter" style={{ display: 'flex', alignItems: 'center' }}>
          <Toggle
            value={value.headline}
            onChange={v => set({ headline: v, status: fits(value.status, v) ? value.status : undefined, state: undefined })}
            opts={[
              [undefined, 'All'],
              ...HEADLINE_STATUSES.map(h => [h, h] as [string, string]),
              // Not a choice — what an old ?state= / ?status=open link meant.
              // Shown only while one is in force, so the filter in play is
              // never invisible.
              ...(value.state ? [[value.state, STATE_LABEL[value.state as keyof typeof STATE_LABEL] ?? value.state] as [string, string]] : []),
            ]}
            legacy={value.state}
          />
          <Sel label="Sub-stage" v={value.status} onChange={v => set({ status: v })}
            opts={stagesUnder(value.headline).map(s => [s, s] as [string, string])}
            joined />
        </div>
        <Sel label="Severity" v={value.sev} onChange={v => set({ sev: v })}
          opts={[...SEVERITIES.map(s => [s, SEVERITY_LABEL[s]] as [string, string]), ['none', 'Not yet rated']]} />
        <Sel label="Category" v={value.cat} onChange={v => set({ cat: v, subcat: undefined })} opts={options.categories.map(t => [t, t])} />
        <Sel label="Sub-category" v={value.subcat} onChange={v => set({ subcat: v })} opts={options.subcategories.map(t => [t, t])} />
        <Sel label="Industry" v={value.ind} onChange={v => set({ ind: v })} opts={options.industries.map(t => [t, t])} />
        {/* Overdue is three answers, not a checkbox: late with nothing done and
            late with something done are chased by different people. */}
        <Sel label="Overdue" v={value.overdue} onChange={v => set({ overdue: v })}
          opts={[['1', 'Overdue — any'], ['no-action', 'Overdue · no action taken'], ['acted', 'Overdue · action taken']]} />
        <label style={CHK} title="Safety, shutdown, penalty or repeat answered Yes on page 3">
          <input type="checkbox" checked={value.severe === '1'} onChange={e => set({ severe: e.target.checked ? '1' : undefined })} /> Severe only
        </label>
        <div className="cmp-daterange" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Named, because a bare pair of date boxes on a phone says nothing
              about what date it is asking for, and a title attribute is not a
              thing a thumb can hover over. */}
          <span style={{ fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>Raised</span>
          <input type="date" value={value.from ?? ''} onChange={e => set({ from: e.target.value || undefined })} style={{ ...INPUT, width: 130 }} title="Raised from" />
          <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>to</span>
          <input type="date" value={value.to ?? ''} onChange={e => set({ to: e.target.value || undefined })} style={{ ...INPUT, width: 130 }} title="Raised to" />
        </div>
        <button type="button" onClick={() => setMore(o => !o)} style={{ ...CLEAR, color: 'var(--fg-2)' }} aria-expanded={more}>
          {more ? '− ' : '+ '}More filters{moreOn ? ` (${moreOn} on)` : ''}
        </button>
        {active > 0 && (
          <button type="button" onClick={() => router.push(value.sort ? `${basePath}?sort=${value.sort}` : basePath)} style={CLEAR}>Clear {active} filter{active === 1 ? '' : 's'}</button>
        )}
      </div>

      {more && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
          <Sel label="Sitting with" v={value.dept} onChange={v => set({ dept: v })} opts={DEPARTMENTS_LIST.map(d => [d, d])} />
          {options.holders.length > 0 && (
            <Sel label="Holder" v={value.holder} onChange={v => set({ holder: v })} opts={options.holders.map(h => [String(h.id), h.name])} />
          )}
          <Sel label="Action taken" v={value.action} onChange={v => set({ action: v })} opts={options.actions.map(t => [t, t])} />
          <Sel label="CAPA" v={value.capa} onChange={v => set({ capa: v })}
            opts={[['raised', 'CAPA raised'], ['pending', 'CAPA pending — nothing back'], ['review', 'CAPA under review'], ['closed', 'CAPA closed'], ['none', 'No CAPA asked for']]} />
          <Sel label="Preventive action" v={value.pa} onChange={v => set({ pa: v })} opts={[['pending', 'Preventive action pending']]} title="Owed — a root cause, a corrective action or a CAPA — and not yet written" />
          <Sel label="Visit" v={value.visit} onChange={v => set({ visit: v })} opts={[['pending', 'Visit pending'], ['planned', 'Visit planned — any']]} />
          <Sel label="Responsible" v={value.resp} onChange={v => set({ resp: v })} opts={options.responsibles.map(t => [t, t])} />
          <Sel label="Root cause" v={value.rcc} onChange={v => set({ rcc: v, rcs: undefined })} opts={options.rootCauses.map(t => [t, t])} />
          {options.rootCauseSubs.length > 0 && (
            <Sel label="Root cause sub" v={value.rcs} onChange={v => set({ rcs: v })} opts={options.rootCauseSubs.map(t => [t, t])} />
          )}
          <Sel label="Part type" v={value.ptype} onChange={v => set({ ptype: v })} opts={options.partTypes.map(t => [t, t])} />
          <Sel label="Part name" v={value.pname} onChange={v => set({ pname: v })} opts={options.partNames.map(t => [t, t])} />
          {options.mocs.length > 0 && (
            <Sel label="MOC" v={value.moc} onChange={v => set({ moc: v })} opts={options.mocs.map(t => [t, t])} />
          )}
          {options.clientTypes.length > 0 && (
            <Sel label="Direct / OEM" v={value.ctype} onChange={v => set({ ctype: v })} opts={options.clientTypes.map(t => [t, t])} />
          )}
          {/* Version code — requirement (B). Offered only where a complaint
              carries one, because the column is free text and mostly blank. */}
          {options.modelVersions.length > 0 && (
            <Sel label="Version" v={value.mver} onChange={v => set({ mver: v })} opts={options.modelVersions.map(t => [t, t])} />
          )}
          {options.modelSeries.length > 0 && (
            <Sel label="Model series" v={value.mseries} onChange={v => set({ mseries: v })} opts={options.modelSeries.map(t => [t, t])} />
          )}
          {/* The old Defect Category wording, for the historical complaints the
              mapping could not read onto a new category without guessing. */}
          {options.legacyCategories.length > 0 && (
            <Sel label="Old defect category" v={value.dcat} onChange={v => set({ dcat: v })} opts={options.legacyCategories.map(t => [t, t])} />
          )}
          {options.clients.length > 1 && (
            <Sel label="Client" v={value.client} onChange={v => set({ client: v })} opts={options.clients.map(c => [c.id, c.name])} />
          )}
          {options.reps.length > 1 && (
            <Sel label="Rep" v={value.rep} onChange={v => set({ rep: v })} opts={options.reps.map(r => [String(r.id), r.name])} />
          )}
          <Sel label="Records" v={value.era} onChange={v => set({ era: v })} opts={[['workflow', 'Workflow only'], ['legacy', 'Legacy only']]} />
          <label style={CHK} title="Flagged a repeat at closure, or pointing at the original complaint">
            <input type="checkbox" checked={value.linked === '1'} onChange={e => set({ linked: e.target.checked ? '1' : undefined })} /> Repeat or linked
          </label>
        </div>
      )}
    </div>
  );
}

/** The five headline names, as one segmented control fused to the sub-stage dropdown. */
function Toggle({ value, onChange, opts, legacy }: {
  value?: string; onChange: (v: string | undefined) => void; opts: [string | undefined, string][]; legacy?: string;
}) {
  return (
    <div role="group" aria-label="Status" style={{
      display: 'inline-flex', height: 32, boxSizing: 'border-box', overflow: 'hidden',
      border: '1px solid var(--line-strong)', borderRight: 'none',
      borderRadius: '6px 0 0 6px', background: 'var(--bg-paper)',
    }}>
      {opts.map(([k, l]) => {
        const isLegacy = k != null && k === legacy;
        const on = isLegacy || (value ?? undefined) === k;
        return (
          <button key={l} type="button" onClick={() => onChange(isLegacy ? undefined : k)} aria-pressed={on}
            title={isLegacy ? 'From an older link — click to clear' : undefined}
            style={{
              padding: '0 10px', fontSize: 11.5, fontWeight: on ? 700 : 500, fontFamily: 'inherit',
              border: 'none', cursor: 'pointer',
              background: on ? 'var(--accent)' : 'transparent',
              color: on ? '#fff' : 'var(--fg-3)',
            }}>{l}</button>
        );
      })}
    </div>
  );
}

function Sel({ label, v, onChange, opts, joined, title }: { label: string; v?: string; onChange: (v: string | undefined) => void; opts: [string, string][]; joined?: boolean; title?: string }) {
  const known = !v || opts.some(([k]) => k === v);
  return (
    <select value={v ?? ''} onChange={e => onChange(e.target.value || undefined)} aria-label={label} title={title}
      style={{ ...INPUT, width: 'auto', minWidth: 120, color: v ? 'var(--fg)' : 'var(--fg-3)', borderColor: v ? 'var(--accent)' : 'var(--line-strong)',
               ...(joined ? { borderRadius: '0 6px 6px 0' } : null) }}>
      <option value="">{label}</option>
      {!known && <option value={v}>{v}</option>}
      {opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

const INPUT: CSSProperties = {
  height: 32, padding: '0 10px', fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box',
  background: 'var(--bg-paper)', border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none',
};
const CHK: CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--fg-2)', cursor: 'pointer', whiteSpace: 'nowrap' };
const CLEAR: CSSProperties = { height: 32, padding: '0 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', border: '1px solid var(--line-strong)', borderRadius: 6, background: 'var(--bg-paper)', color: 'var(--accent)', cursor: 'pointer' };
