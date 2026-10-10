'use client';

import type { CSSProperties } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useSearchBox } from '@/lib/risansi-search-box';
import { MultiSelectFilter } from './MultiSelectFilter';
import { ActiveFilterBar } from './ActiveFilterBar';
import { DateRangeFilter } from './DateRangeFilter';

// One filter row shared across the Field Activity tabs. All are URL params
// (server-side), so they work from this single row above the tabs, and
// Search/Purpose scope the whole reports query rather than just the loaded page.
// Reports use rsearch/rpurpose/rfrom/rto; the feed uses ffrom/fto.
//
// The filters divide into two questions people actually ask here. WHO: rep, and
// manager for everyone a manager speaks for. WHERE AND WHAT: zone, route, client
// status, industry, and — on the visit side only — whether a visit is planned or
// done. Client tier is deliberately absent: 2,753 of 2,754 clients are Standard,
// so it would be a control that never changes anything.

const CTRL: CSSProperties = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line-strong)',
  fontSize: 12, fontFamily: 'inherit', background: 'var(--bg-paper)', color: 'var(--fg)',
  outline: 'none', boxSizing: 'border-box',
};

export interface FieldFilterSets {
  zones: string[]; tours: string[]; reps: string[];
  managers: string[]; statuses: string[]; industries: string[];
}

// Client status is stored as a code. Show the words.
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active', PROSPECTIVE_CLIENT: 'Prospective client',
  PROSPECTIVE_LEAD: 'Lead', CLOSED: 'Closed', INACTIVE: 'Inactive', DUPLICATE: 'Duplicate',
};

// Visit status is not offered from the data: 'Planned' and 'planned' both exist
// in the table, and a list built from DISTINCT would show the same option twice.
// The predicate lower()s both sides, so one entry covers both spellings.
const VISIT_STATUS = ['planned', 'checked-in', 'completed'];
const VISIT_STATUS_LABEL: Record<string, string> = {
  planned: 'Planned', 'checked-in': 'Checked in', completed: 'Completed',
};

export function FieldFilterBar({ tab, opts, sel, purposes, search, purpose }: {
  tab: string;
  opts: FieldFilterSets;
  sel:  FieldFilterSets & { vstatus: string[] };
  purposes: string[];
  search: string;
  purpose: string;
}) {
  const showReports = tab === 'reports';
  const showDate    = tab === 'reports' || tab === 'feed';
  const fromParam   = tab === 'feed' ? 'ffrom' : 'rfrom';
  const toParam     = tab === 'feed' ? 'fto'   : 'rto';

  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const setParam = (key: string, val: string, replace = false) => {
    const p = new URLSearchParams(searchParams.toString());
    if (val) p.set(key, val); else p.delete(key);
    (replace ? router.replace : router.push)(`${pathname}?${p.toString()}`);
  };

  // Debounced search → rsearch (replace, so typing doesn't spam history).
  // The plain sync this used to do overwrote the box with whatever the server
  // last answered, so characters disappeared mid-word.
  const { value: q, onChange: setQ } = useSearchBox(search, v => setParam('rsearch', v, true), 350);

  const dateFrom = searchParams.get(fromParam) ?? '';
  const dateTo   = searchParams.get(toParam) ?? '';

  // Every filter is offered to every role now. It used to hide six of them from
  // reps on the reasoning that a rep has nobody to filter by — which stopped
  // being true when covering reps arrived: a secondary rep sees the primary's
  // visits on the accounts they cover, and had no way to pick them out.
  //
  // Nothing widens. getVisitFilterOptions builds each list from what this person
  // can already see, so a dropdown with one name in it is a rep who genuinely
  // only has their own work, and an empty list hides its own control below.

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2 }}>
          Filter
        </span>
        {opts.reps.length > 1 && (
          <MultiSelectFilter param="rep" label="Rep" options={opts.reps} selected={sel.reps} />
        )}
        {opts.managers.length > 0 && (
          <MultiSelectFilter param="manager" label="Manager" options={opts.managers} selected={sel.managers} />
        )}
        {opts.zones.length > 1 && (
          <MultiSelectFilter param="zone" label="Zone" options={opts.zones} selected={sel.zones} />
        )}
        {opts.tours.length > 1 && (
          <MultiSelectFilter param="tour" label="Route" options={opts.tours} selected={sel.tours} />
        )}
        {opts.statuses.length > 1 && (
          <MultiSelectFilter
            param="cstatus" label="Client status"
            options={opts.statuses.map(s => ({ value: s, label: STATUS_LABEL[s] ?? s }))}
            selected={sel.statuses}
          />
        )}
        {opts.industries.length > 1 && (
          <MultiSelectFilter param="industry" label="Industry" options={opts.industries} selected={sel.industries} />
        )}
        <MultiSelectFilter
          param="vstatus" label="Visit status"
          options={VISIT_STATUS.map(v => ({ value: v, label: VISIT_STATUS_LABEL[v] }))}
          selected={sel.vstatus}
        />
        {showReports && (
          <>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client or code…" style={{ ...CTRL, minWidth: 190 }} />
            <select value={purpose} onChange={e => setParam('rpurpose', e.target.value)} style={CTRL} aria-label="Purpose">
              <option value="">All Purposes</option>
              {purposes.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </>
        )}
        {showDate && (
          <div style={{ marginLeft: 'auto' }}>
            <DateRangeFilter fromParam={fromParam} toParam={toParam} from={dateFrom} to={dateTo} />
          </div>
        )}
      </div>
      {(sel.zones.length + sel.tours.length + sel.reps.length + sel.managers.length
        + sel.statuses.length + sel.industries.length + sel.vstatus.length > 0) && (
        <ActiveFilterBar filters={[
          { param: 'rep',      label: 'Rep',           values: sel.reps },
          { param: 'manager',  label: 'Manager',       values: sel.managers },
          { param: 'zone',     label: 'Zone',          values: sel.zones },
          { param: 'tour',     label: 'Route',         values: sel.tours },
          { param: 'cstatus',  label: 'Client status', values: sel.statuses.map(s => STATUS_LABEL[s] ?? s) },
          { param: 'industry', label: 'Industry',      values: sel.industries },
          { param: 'vstatus',  label: 'Visit status',  values: sel.vstatus.map(v => VISIT_STATUS_LABEL[v] ?? v) },
        ].filter(f => f.values.length > 0)} />
      )}
    </div>
  );
}
