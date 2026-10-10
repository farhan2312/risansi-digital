'use client';

import { useState, type CSSProperties } from 'react';
import { ChartPanel, NoData } from '@/components/risansi/StageCharts';

// Where the complaints are, at two zoom levels.
//
// Summary is the five headline names the business uses — Open, Action Taken,
// Resolved, Feedback, Closed — and answers the question most people open the
// page with. Every stage answers the follow-up, in the eight sub-stages the
// Complaint Team actually works with. They are the same two questions the
// filter above the list asks, so a bar in either view sets the matching
// filter: a summary bar sets the headline, a stage bar sets the sub-stage.
//
// Hrefs are built on the server and passed in, because the page owns the URL
// and this component only owns which set of bars is on screen.

export interface StatusBar {
  key: string;
  label: string;
  count: number;
  /** Part of `count` that is overdue: older than its severity's threshold. Drawn in red. */
  overdue?: number;
  /** Closed work is drawn green rather than blue. */
  done?: boolean;
  href: string;
  /** Right-hand column: average time spent here, or the make-up of a summary bar. */
  note?: string;
  /** True when this bar is the filter currently applied. */
  on?: boolean;
}

export function StatusChart({ summary, stages, anySelected, noteSummary, noteStages }: {
  summary: StatusBar[];
  stages: StatusBar[];
  /** Something in the status filters is set, so unchosen bars step back. */
  anySelected: boolean;
  noteSummary: string;
  noteStages: string;
}) {
  const [full, setFull] = useState(false);
  const rows = full ? stages : summary;
  const total = rows.reduce((n, r) => n + r.count, 0);

  return (
    <ChartPanel
      title="Where they are"
      sub={`${total} complaint${total === 1 ? '' : 's'}`}
      note={full ? noteStages : noteSummary}
      action={
        <div role="group" aria-label="Level of detail" style={SWITCH}>
          {([[false, 'Summary'], [true, 'Every stage']] as const).map(([v, l]) => (
            <button key={l} type="button" onClick={() => setFull(v)} aria-pressed={full === v}
              style={{ ...SWITCH_BTN, background: full === v ? 'var(--accent)' : 'transparent', color: full === v ? '#fff' : 'var(--fg-3)', fontWeight: full === v ? 700 : 500 }}>
              {l}
            </button>
          ))}
        </div>
      }
    >
      <Bars rows={rows} anySelected={anySelected} wide={full} />
    </ChartPanel>
  );
}

function Bars({ rows, anySelected, wide }: { rows: StatusBar[]; anySelected: boolean; wide: boolean }) {
  if (!rows.length) return <NoData msg="No complaints in view." />;
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: wide ? 5 : 9 }}>
      {rows.map(r => {
        const overdue = r.overdue ?? 0;
        const hue = r.done ? 'var(--pos)' : 'var(--accent)';
        return (
          <a key={r.key} href={r.href} className="sc-row"
            title={`${r.label}: ${r.count}${overdue ? ` · ${overdue} overdue` : ''}${r.note ? ` · ${r.note}` : ''}`}
            style={{ ...ROW, opacity: anySelected && !r.on ? 0.4 : 1, outline: r.on ? '2px solid var(--accent)' : 'none' }}>
            <span className="sc-label" style={{ ...LBL, flex: wide ? '0 1 150px' : '0 1 110px', fontWeight: wide ? 400 : 600, color: wide ? 'var(--fg-2)' : 'var(--fg)' }}>{r.label}</span>
            <div style={{ flex: 1, minWidth: 40, height: wide ? 14 : 20, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
              {overdue > 0 && <div style={{ width: `${(overdue / max) * 100}%`, background: 'var(--neg)' }} />}
              <div style={{ width: `${((r.count - overdue) / max) * 100}%`, background: `color-mix(in oklab, ${hue} ${r.done ? 40 : 60}%, transparent)` }} />
            </div>
            <span style={{ ...NUM, fontSize: wide ? 11 : 13 }}>{r.count}</span>
            {/* The empty note keeps the columns lined up on a desktop. On a
                phone it drops to its own line, where a lone "·" is just a
                stray mark, so it is hidden there instead. */}
            <span className={r.note ? 'sc-note' : 'sc-note sc-note--empty'}
              style={{ ...NUM, width: wide ? 46 : 96, color: 'var(--fg-3)', fontWeight: 400, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note ?? '·'}</span>
          </a>
        );
      })}
    </div>
  );
}

const SWITCH: CSSProperties = {
  display: 'inline-flex', height: 22, overflow: 'hidden',
  border: '1px solid var(--line-strong)', borderRadius: 5, background: 'var(--bg-paper)',
};
const SWITCH_BTN: CSSProperties = {
  padding: '0 8px', fontSize: 10, fontFamily: 'inherit', border: 'none', cursor: 'pointer', lineHeight: '20px',
};
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'inherit', outlineOffset: 2, borderRadius: 4 };
const LBL: CSSProperties = { minWidth: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const NUM: CSSProperties = { width: 34, flexShrink: 0, textAlign: 'right', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' };
