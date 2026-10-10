'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { getOpportunityRemarks, type OppRemark } from '@/app/actions/risansi-opportunity-remarks';
import { STAGE_TONE } from '@/lib/risansi-stage-tone';

// The remarks left each time this opportunity changed stage.
//
// Read-only here on purpose. A remark belongs to the moment a stage was entered,
// so it is written by the move form and never edited afterwards — the value of
// the log is that it says what someone actually thought at the time, not what
// they would prefer to have thought.

export function OppRemarksLog({ oppId }: { oppId: number }) {
  const [rows, setRows] = useState<OppRemark[] | null>(null);

  useEffect(() => {
    let alive = true;
    getOpportunityRemarks(oppId)
      .then(r => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [oppId]);

  // Nothing at all while loading, and nothing when empty: an empty panel headed
  // "Remarks" on the 1,800 opportunities that predate the log would be a box
  // saying nothing, on every card.
  if (!rows || rows.length === 0) return null;

  return (
    <div style={PANEL}>
      <div style={HEAD}>Remarks · {rows.length}</div>
      <ol style={{ listStyle: 'none', margin: 0, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(r => {
          const tone = STAGE_TONE[r.stage] ?? 'var(--fg-3)';
          return (
            <li key={r.id} style={{ display: 'flex', gap: 10 }}>
              <div style={{ ...DOT, background: tone }} aria-hidden />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: tone }}>{r.stage}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>
                    {r.created_at.slice(0, 10)}
                    {r.created_by_name ? ` · ${r.created_by_name}` : ''}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--fg-2)', marginTop: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {r.remark}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const PANEL: CSSProperties = {
  border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden',
  background: 'var(--bg-paper)',
};
const HEAD: CSSProperties = {
  padding: '9px 14px', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)',
  fontSize: 12, fontWeight: 700, color: 'var(--fg-2)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const DOT: CSSProperties = {
  width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0,
};
