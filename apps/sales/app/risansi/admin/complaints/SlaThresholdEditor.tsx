'use client';

// How many days a complaint gets before it is late, by how severe it is.
//
// These four numbers are the whole of the overdue calculation now. The old rule
// asked whether a target completion date had passed, and that date is only typed
// on page 5 — so a complaint nobody had touched could sit open for a hundred
// days and never be late. That is the 34-open-but-1-overdue figure the review
// queried. Overdue is the complaint's age against the days its severity allows.
//
// Which means changing a number here changes what the dashboard calls overdue,
// so the screen shows the consequence of the figure being typed before it is
// saved: how many open complaints each threshold would catch, split the way the
// dashboard splits them. Typing 3 into S1 and seeing the count move is the
// point; discovering it on the dashboard tomorrow is not.

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useTableSort, SortTH } from '@/components/risansi/SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';
import { setComplaintSlaThresholds } from '@/app/actions/risansi-complaint-admin';

export interface SlaRow {
  severity: string;
  days: number;
  label: string;
  open: { age: number; noAction: boolean }[];
}

const SEVERITY_ORDER = ['S1', 'S2', 'S3', 'S4'];

/** Late, and whether anything has been done about it. Mirrors overdueFor. */
function countOverdue(open: { age: number; noAction: boolean }[], days: number) {
  let noAction = 0, acted = 0;
  for (const c of open) {
    if (c.age <= days) continue;
    if (c.noAction) noAction++; else acted++;
  }
  return { noAction, acted, total: noAction + acted };
}

export function SlaThresholdEditor({ rows }: { rows: SlaRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map(r => [r.severity, String(r.days)])));

  const typed = (r: SlaRow) => {
    const n = Number(draft[r.severity]);
    return Number.isInteger(n) && n >= 1 ? n : null;
  };

  const dirty = rows.some(r => String(draft[r.severity] ?? '') !== String(r.days));

  const COLS: SortableColumn<SlaRow>[] = [
    { key: 'severity', kind: 'status', order: SEVERITY_ORDER },
    { key: 'label', kind: 'text' },
    { key: 'days', kind: 'number' },
    { key: 'openCount', kind: 'number', value: r => r.open.length },
    { key: 'overdueNow', kind: 'number', value: r => countOverdue(r.open, r.days).total },
    { key: 'overdueThen', kind: 'number', value: r => countOverdue(r.open, typed(r) ?? r.days).total },
  ];

  const { rows: ordered, sortBy } = useTableSort(rows, COLS);

  const totals = useMemo(() => {
    let now = { noAction: 0, acted: 0, total: 0 }, then = { noAction: 0, acted: 0, total: 0 };
    for (const r of rows) {
      const a = countOverdue(r.open, r.days);
      const b = countOverdue(r.open, typed(r) ?? r.days);
      now = { noAction: now.noAction + a.noAction, acted: now.acted + a.acted, total: now.total + a.total };
      then = { noAction: then.noAction + b.noAction, acted: then.acted + b.acted, total: then.total + b.total };
    }
    return { now, then, open: rows.reduce((n, r) => n + r.open.length, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, draft]);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await setComplaintSlaThresholds(rows.map(r => ({ severity: r.severity, days: draft[r.severity] ?? '' })));
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
      setMsg({ ok: true, text: `Saved. ${totals.then.total} of ${totals.open} open complaints are overdue on the new thresholds.` });
      router.refresh();
    });
  }

  return (
    <div style={PANEL}>
      <div style={PANEL_H}>
        <div style={PANEL_TITLE}>Overdue thresholds</div>
        <div style={SUB}>
          Days from the day a complaint was raised. Past that, an open complaint is overdue — on the
          Complaints list, on the two overdue dashboard tiles, in the client&rsquo;s own complaints panel and
          in the export. A complaint with page 3 unanswered has no severity and is held to S4, the most
          forgiving one, so a blank risk page cannot take a complaint out of the reckoning.
        </div>
        <div style={{ ...SUB, marginTop: 6 }}>
          The more severe level has to be the tighter one: S1 cannot be given longer than S2.
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={TABLE}>
          <thead>
            <tr>
              <SortTH {...sortBy('severity')} style={TH}>Severity</SortTH>
              <SortTH {...sortBy('label')} style={TH}>What it means</SortTH>
              <SortTH {...sortBy('days')} style={TH}>Days allowed</SortTH>
              <SortTH {...sortBy('openCount')} style={TH_R} align="right">Open now</SortTH>
              <SortTH {...sortBy('overdueNow')} style={TH_R} align="right" title="Overdue on the threshold as saved">Overdue, saved</SortTH>
              <SortTH {...sortBy('overdueThen')} style={TH_R} align="right" title="Overdue on the number currently typed">Overdue, typed</SortTH>
              <SortTH sortable={false} style={TH}>No action / acted</SortTH>
            </tr>
          </thead>
          <tbody>
            {ordered.map(r => {
              const t = typed(r);
              const now = countOverdue(r.open, r.days);
              const then = countOverdue(r.open, t ?? r.days);
              const moved = t != null && t !== r.days;
              const oldest = r.open.length ? r.open[0].age : null;
              return (
                <tr key={r.severity} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ ...TD, fontWeight: 700, color: 'var(--fg)' }}>{r.severity}</td>
                  <td style={{ ...TD, color: 'var(--fg-3)' }}>
                    {r.label}
                    {oldest != null && (
                      <span style={{ display: 'block', fontSize: 10.5, color: 'var(--fg-4)', marginTop: 2 }}>
                        oldest open: {oldest} day{oldest === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                  <td style={TD}>
                    <input type="number" min={1} max={365} step={1}
                      value={draft[r.severity] ?? ''}
                      onChange={e => setDraft(d => ({ ...d, [r.severity]: e.target.value }))}
                      style={{ ...INP, width: 78, borderColor: moved ? 'var(--accent)' : 'var(--line-strong)' }} />
                    <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 6 }}>days</span>
                    {moved && (
                      <span style={{ fontSize: 10.5, color: 'var(--accent)', marginLeft: 6, fontFamily: 'var(--font-mono)' }}>
                        was {r.days}
                      </span>
                    )}
                  </td>
                  <td style={{ ...TD, ...MONO, textAlign: 'right', color: 'var(--fg-2)' }}>{r.open.length || '—'}</td>
                  <td style={{ ...TD, ...MONO, textAlign: 'right', color: now.total ? 'var(--neg)' : 'var(--fg-4)' }}>{now.total || '—'}</td>
                  <td style={{
                    ...TD, ...MONO, textAlign: 'right', fontWeight: moved ? 700 : 400,
                    color: !moved ? 'var(--fg-4)' : then.total > now.total ? 'var(--neg)' : then.total < now.total ? 'var(--pos)' : 'var(--fg-3)',
                  }}>
                    {moved ? `${then.total}${then.total === now.total ? '' : then.total > now.total ? ` (+${then.total - now.total})` : ` (−${now.total - then.total})`}` : '—'}
                  </td>
                  <td style={{ ...TD, fontSize: 11, color: 'var(--fg-3)' }}>
                    {then.total === 0 ? 'none' : `${then.noAction} with no action · ${then.acted} acted on`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid var(--line-strong)', background: 'var(--bg-elev)' }}>
              <td style={{ ...TD, fontWeight: 600, color: 'var(--fg-2)' }} colSpan={3}>
                Every open complaint
              </td>
              <td style={{ ...TD, ...MONO, textAlign: 'right', fontWeight: 600, color: 'var(--fg)' }}>{totals.open}</td>
              <td style={{ ...TD, ...MONO, textAlign: 'right', fontWeight: 600, color: 'var(--neg)' }}>{totals.now.total}</td>
              <td style={{ ...TD, ...MONO, textAlign: 'right', fontWeight: 700, color: dirty ? (totals.then.total > totals.now.total ? 'var(--neg)' : 'var(--pos)') : 'var(--fg-4)' }}>
                {dirty ? totals.then.total : '—'}
              </td>
              <td style={{ ...TD, fontSize: 11, color: 'var(--fg-3)' }}>
                {totals.then.noAction} with no action · {totals.then.acted} acted on
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--line)' }}>
        <button type="button" onClick={save} disabled={!dirty || pending}
          style={{ ...BTN, opacity: !dirty || pending ? 0.5 : 1 }}>
          {pending ? 'Saving…' : 'Save thresholds'}
        </button>
        {dirty && (
          <button type="button" disabled={pending}
            onClick={() => { setDraft(Object.fromEntries(rows.map(r => [r.severity, String(r.days)]))); setMsg(null); }}
            style={{ ...LINK_BTN, color: 'var(--fg-3)' }}>
            Put them back
          </button>
        )}
        <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
          {dirty
            ? `Overdue would go from ${totals.now.total} to ${totals.then.total} of ${totals.open} open complaints.`
            : `${totals.now.total} of ${totals.open} open complaints are overdue on these figures.`}
        </span>
      </div>

      {msg && (
        <div style={{
          padding: '9px 16px', fontSize: 12, borderTop: '1px solid var(--line)',
          background: msg.ok ? 'var(--pos-soft)' : 'var(--neg-soft)',
          color: msg.ok ? 'var(--pos-strong)' : 'var(--neg-strong)',
        }}>
          {msg.ok ? '✓ ' : '⚠ '}{msg.text}
        </div>
      )}
    </div>
  );
}

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '14px 16px', borderBottom: '1px solid var(--line)' };
const PANEL_TITLE: CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--fg)' };
const SUB: CSSProperties = { fontSize: 12, color: 'var(--fg-3)', marginTop: 4, lineHeight: 1.5, maxWidth: 760 };
const INP: CSSProperties = {
  padding: '6px 8px', fontSize: 13, fontFamily: 'inherit', background: 'var(--bg-elev)',
  border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', outline: 'none',
};
const BTN: CSSProperties = {
  padding: '8px 16px', fontSize: 12.5, fontWeight: 600, background: 'var(--brand-blue)',
  color: 'var(--toggle-sel-fg)', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
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
