'use client';

import { useState, type CSSProperties } from 'react';
import { RepRow, type RepData, ZONE_BG, ZONE_COLOR } from './RepRow';
import { useTableSort, SortTH } from './SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';

const ZONES = ['North', 'Central', 'West', 'South', 'Export'];

// client_count and visits_last_30d arrive as strings from pg's ::count casts,
// which is why they are numbers here rather than text: "9" must not sort above
// "10", and the comparator reads through the string for us.
const REP_COLS: SortableColumn<RepData>[] = [
  { key: 'name',            kind: 'text' },
  // Zone is a region, not a stage: the five of them have no lifecycle, so A-Z
  // is the honest order and matches the pill row above.
  { key: 'zone',            kind: 'text' },
  { key: 'route',           kind: 'text' },
  { key: 'client_count',    kind: 'number' },
  { key: 'visits_last_30d', kind: 'number' },
  // Active before inactive on the first click; a yes/no flag has no lifecycle
  // list to follow, and as text it would open on "Inactive".
  { key: 'is_active',       kind: 'number', value: r => (r.is_active ? 1 : 0) },
];

const ZONE_LABELS: Record<string, string> = {
  North: 'N', Central: 'C', West: 'W', South: 'S', Export: 'E',
};

export function RepsZoneFilter({ reps }: { reps: RepData[] }) {
  const [activeZone, setActiveZone] = useState<string | null>(null);

  const zoned = activeZone ? reps.filter(r => r.zone === activeZone) : reps;
  const { rows: filtered, sortBy } = useTableSort(zoned, REP_COLS);

  return (
    <>
      {/* Zone filter pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}>
        <button
          onClick={() => setActiveZone(null)}
          style={{
            fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            background: !activeZone ? 'var(--title)' : 'var(--bg-elev)',
            color: !activeZone ? 'white' : 'var(--fg-3)',
          }}
        >
          All ({reps.length})
        </button>
        {ZONES.map(zone => {
          const count = reps.filter(r => r.zone === zone).length;
          const isActive = activeZone === zone;
          const bg = ZONE_BG[zone] ?? 'var(--bg-sunk)';
          const color = ZONE_COLOR[zone] ?? 'var(--fg-3)';
          return (
            <button
              key={zone}
              onClick={() => setActiveZone(isActive ? null : zone)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: isActive ? color : bg,
                color: isActive ? 'white' : color,
              }}
            >
              {ZONE_LABELS[zone]}: {count}
            </button>
          );
        })}
      </div>

      {/* Reps table */}
      <div style={PANEL}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg-elev)' }}>
                <SortTH {...sortBy('name')}             style={TH}>Name</SortTH>
                <SortTH {...sortBy('zone')}             style={TH}>Zone</SortTH>
                <SortTH {...sortBy('route')}            style={TH}>Tour</SortTH>
                <SortTH {...sortBy('client_count')}     style={{ ...TH, textAlign: 'center' }}>Clients</SortTH>
                <SortTH {...sortBy('visits_last_30d')}  style={{ ...TH, textAlign: 'center' }}>Visits (30d)</SortTH>
                <SortTH {...sortBy('is_active')}        style={{ ...TH, textAlign: 'center' }}>Status</SortTH>
                {/* The Edit button's column. */}
                <th style={TH} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
                    {activeZone ? `No reps in ${activeZone} zone` : 'No reps yet'}
                  </td>
                </tr>
              ) : filtered.map(rep => <RepRow key={rep.id} rep={rep} />)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden',
};
const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--fg-3)',
  textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '2px solid var(--line)',
  background: 'var(--bg-elev)', whiteSpace: 'nowrap',
};
