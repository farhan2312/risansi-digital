'use client';

import { MultiSelectFilter } from './MultiSelectFilter';
import { ActiveFilterBar } from './ActiveFilterBar';

// Zone / Tour / Rep multi-select filters shared across the visit pages.
// Deselectable (checkbox dropdowns) + removable pills; writes comma-separated
// ?zone=&tour=&rep= URL params, preserving other params (tab, feed, week…).
export function VisitFilterControls({ opts, sel }: {
  opts: { zones: string[]; tours: string[]; reps: string[] };
  sel:  { zones: string[]; tours: string[]; reps: string[] };
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2 }}>
          Filter
        </span>
        <MultiSelectFilter param="zone" label="Zone" options={opts.zones} selected={sel.zones} />
        <MultiSelectFilter param="tour" label="Tour" options={opts.tours} selected={sel.tours} />
        <MultiSelectFilter param="rep"  label="Rep"  options={opts.reps}  selected={sel.reps} />
      </div>
      <ActiveFilterBar filters={[
        { param: 'zone', label: 'Zone', values: sel.zones },
        { param: 'tour', label: 'Tour', values: sel.tours },
        { param: 'rep',  label: 'Rep',  values: sel.reps },
      ]} />
    </div>
  );
}
