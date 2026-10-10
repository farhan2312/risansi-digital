import type { CSSProperties } from 'react';
import { STATUSES, statusStep, isOpenStatus, type Dwell } from '@/lib/risansi-complaint-flow';

// Where a complaint is, and where it has been.
//
// The timeline is the seven statuses as a strip, the current one lit, the
// ones passed filled, each with the days it held the complaint underneath —
// so "it has been sitting in Action Pending for 19 days" is the first thing
// read, not something worked out from a log. The lifecycle below it is the
// same history as a table: every stretch, who held it, for how long, with the
// longest holder named. Server-rendered; no state.

const fmtDays = (d: number) => (d < 1 ? '<1d' : `${Math.round(d)}d`);
const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

export function ComplaintTimeline({ status, dwells, legacy }: { status: string; dwells: Dwell[]; legacy: boolean }) {
  const cur = statusStep(status);
  const closed = !isOpenStatus(status);
  // Days per status, summed (a reopened complaint visits a status twice).
  const daysIn = new Map<string, number>();
  for (const d of dwells) daysIn.set(d.status, (daysIn.get(d.status) ?? 0) + d.days);
  const steps = legacy ? ['Open', 'Resolved', 'Closed'] : [...STATUSES];

  return (
    <div className="cmp-timeline" style={{ display: 'grid', gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, gap: 4 }}>
      {steps.map((s, i) => {
        const idx = legacy ? (s === 'Open' ? 0 : s === 'Resolved' ? 5 : 6) : i;
        const done = idx < cur || (closed && idx <= cur);
        const now = idx === cur && !closed;
        const days = daysIn.get(s) ?? (legacy && s === 'Open' ? daysIn.get('In Progress') : 0) ?? 0;
        const hue = now ? 'var(--accent)' : done ? 'var(--pos)' : 'var(--line-strong)';
        return (
          <div key={s} style={{ minWidth: 0 }} title={`${s}${days ? ` · ${fmtDays(days)} in this status` : ''}`}>
            <div style={{ height: 6, borderRadius: 3, background: hue, opacity: done || now ? 1 : 0.5 }} />
            <div data-label style={{ marginTop: 6, fontSize: 10.5, fontWeight: now ? 700 : 500, color: now ? 'var(--accent)' : done ? 'var(--fg-2)' : 'var(--fg-3)', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {now && <span aria-hidden>● </span>}{s}
            </div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: now ? 'var(--accent)' : 'var(--fg-3)' }}>
              {days ? fmtDays(days) : (done || now ? '—' : '')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ComplaintLifecycle({ dwells, byHolder }: {
  dwells: Dwell[];
  byHolder: { key: string; label: string; days: number; stretches: number }[];
}) {
  const current = dwells.find(d => d.current);
  const longest = byHolder[0];
  const total = dwells.filter(d => isOpenStatus(d.status)).reduce((s, d) => s + d.days, 0);
  return (
    <div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
        {current && (
          <span>Sitting with <b>{current.holderName ? `${current.holderName} (${current.department})` : current.department}</b> for <b style={{ color: current.days > 7 ? 'var(--neg)' : 'var(--fg)' }}>{fmtDays(current.days)}</b> in {current.status}.</span>
        )}
        {longest && total > 0 && (
          <span style={{ color: 'var(--fg-2)' }}>Held longest by <b>{longest.label}</b> — {fmtDays(longest.days)} of {fmtDays(total)} open time ({Math.round((longest.days / total) * 100)}%).</span>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>{['Status', 'Held by', 'From', 'To', 'Days'].map(h => <th key={h} style={{ ...TH, textAlign: h === 'Days' ? 'right' : 'left' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {dwells.map((d, i) => (
              <tr key={i} style={{ background: d.current ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : undefined }}>
                <td style={TD}><b style={{ fontWeight: d.current ? 700 : 500 }}>{d.status}</b>{d.current && <span style={{ marginLeft: 6, fontSize: 9.5, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase' }}>now</span>}</td>
                <td style={TD}>{d.holderName ? `${d.holderName} · ${d.department}` : d.department}</td>
                <td style={{ ...TD, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{fmtWhen(d.from)}</td>
                <td style={{ ...TD, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{d.to ? fmtWhen(d.to) : '—'}</td>
                <td style={{ ...TD, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: isOpenStatus(d.status) && d.days > 7 ? 'var(--neg)' : 'var(--fg)' }}>{fmtDays(d.days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {byHolder.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 12 }}>
          {byHolder.map(h => (
            <div key={h.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <span style={{ width: 170, flexShrink: 0, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.label}</span>
              <div style={{ flex: 1, height: 10, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${total ? (h.days / total) * 100 : 0}%`, height: '100%', background: h === longest ? 'var(--neg)' : 'color-mix(in oklab, var(--accent) 55%, transparent)' }} />
              </div>
              <span style={{ width: 40, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtDays(h.days)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TH: CSSProperties = { padding: '7px 10px', fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--line)', background: 'var(--bg-sunk)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '7px 10px', borderBottom: '1px solid var(--line-2)', verticalAlign: 'top' };
