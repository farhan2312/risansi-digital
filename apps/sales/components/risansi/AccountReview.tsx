'use client';

import type { CSSProperties, ReactNode } from 'react';
import { ALL_STAGES } from '@/lib/risansi-opportunity-fields';
import { useTableSort, SortTH } from './SortTH';
import type { SortableColumn } from '@/lib/risansi-table-sort';

// ────────────────────────────────────────────────────────────────
// Account Review — the group-of-mills and OEM executive formats.
// Everything here is rendered from live data; blocks with no source in the
// system (FR/red-money on complaints, a "budgetary" opportunity category, a
// named-projects register, per-FY pump counts) are deliberately omitted rather
// than shown as empty scaffolding.
//
// A client component, and only because the tables sort. Every table on this page
// holds its whole set of rows — a group has a dozen units, an OEM has five
// fiscal years — so sorting happens in the browser against rows that are all
// already there. None of this is one page of a longer query, so there is no
// larger set a browser sort could misrepresent, and no reason to make a reader
// wait for a round trip to reorder eleven lines.
//
// The totals and averages sit in <tfoot> rather than at the end of <tbody>, so
// they are outside the array that gets sorted and stay at the bottom whichever
// column is pointing which way.
// ────────────────────────────────────────────────────────────────

const inr = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-IN'));
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const cr = (n: number) => `₹ ${(n / 1e7).toFixed(2)} Cr`;
const lakh = (n: number) => `₹ ${(n / 1e5).toFixed(2)} L`;

export interface GroupUnit {
  code: string; name: string; tcd: number | null;
  rilPcp: number; rotoPcp: number; otherPcp: number; totalPcp: number;
  rilMmp: number; otherMmp: number; totalPumps: number;
  sparesPerPump: number | null;
  pumpByFy: (number | null)[];
  spareByFy: (number | null)[];
  actions: string[];
}
/**
 * This fiscal year's trading position, for the account being reviewed.
 *
 * The five-year tables answer "how has this account behaved"; this answers "where
 * does it stand right now", which is the question somebody opens an account
 * review to ask and the one the page could not previously answer.
 *
 * Order in hand is Won less what has already gone onto a sales order, so it is
 * work owed rather than work booked -- the same definition the TSM review and the
 * dashboard use, deliberately, so the two never disagree.
 */
export interface CurrentFyView {
  label: string;              // e.g. '26-27'
  pendingValue: number; pendingCount: number;
  wonValue: number;     wonCount: number;
  orderInHand: number;
  lostValue: number;    lostCount: number;
  revenue: number;
}

export interface GroupReviewData {
  group: string;
  fys: string[];
  units: GroupUnit[];
  footprint: { pcpRil: number; pcpRoto: number; pcpOther: number; pcpTotal: number; mmpRil: number; mmpOther: number; mmpTotal: number };
  sparesPerPumpAvg: number | null;
  attention: string[];
  complaints: { year: number; nature: string; count: number }[];
  currentFy: CurrentFyView;
}

export interface OemReviewData {
  code: string; name: string;
  fys: string[];
  revenueByFy: (number | null)[];
  totalRevenue: number; avgPerYear: number; totalPumps: number;
  stages: string[];
  oppFys: string[];
  oppMatrix: (number | null)[][];   // [stage][fy] → ₹
  currentFy: CurrentFyView;
}

// ── Sort column definitions ─────────────────────────────────────

// Unit Overview. The pump counts and the spares figure are quantities, so the
// first click gives the largest; Unit and Action Points are labels, so theirs
// gives A to Z. Action Points sorts on the joined text the cell actually shows,
// and a unit with no action points reads blank and sinks to the bottom rather
// than sorting as an empty string somewhere in the middle.
const UNIT_COLS: SortableColumn<GroupUnit>[] = [
  { key: 'name',          kind: 'text' },
  { key: 'tcd',           kind: 'number' },
  { key: 'rilPcp',        kind: 'number' },
  { key: 'rotoPcp',       kind: 'number' },
  { key: 'otherPcp',      kind: 'number' },
  { key: 'totalPcp',      kind: 'number' },
  { key: 'rilMmp',        kind: 'number' },
  { key: 'otherMmp',      kind: 'number' },
  { key: 'sparesPerPump', kind: 'number' },
  { key: 'actions',       kind: 'text', value: u => u.actions.join(' · ') || null },
];

type ComplaintRow = GroupReviewData['complaints'][number];
// The year is a number, not a date string, so it sorts as one — and like every
// other number column the first click gives the largest, which here is the most
// recent year.
const COMPLAINT_COLS: SortableColumn<ComplaintRow>[] = [
  { key: 'year',   kind: 'number' },
  { key: 'nature', kind: 'text' },
  { key: 'count',  kind: 'number' },
];

// ── Group (Mills) ───────────────────────────────────────────────
/**
 * Where this account stands this fiscal year.
 *
 * Pending is everything still live -- Prospect through Negotiating and On Hold.
 * It is deliberately not called "pipeline": that word is used on the opportunity
 * board for a different set, and two names for two things beats one name for
 * both.
 */
function CurrentFyStrip({ d }: { d: CurrentFyView }) {
  const decided = d.wonCount + d.lostCount;
  return (
    <Panel title={`This Year · FY ${d.label}`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Fig label="Pending" value={cr(d.pendingValue)}
             sub={`${d.pendingCount} open opportunit${d.pendingCount === 1 ? 'y' : 'ies'}`} />
        <Fig label="Order received" value={cr(d.wonValue)}
             sub={`${d.wonCount} won`} tone="var(--pos)" />
        <Fig label="Order in hand" value={cr(d.orderInHand)}
             sub="won · not yet in a sales order" tone="var(--accent)" />
        <Fig label="Lost" value={cr(d.lostValue)}
             sub={`${d.lostCount} lost`} tone="var(--neg)" />
        <Fig label="Revenue" value={cr(d.revenue)} sub="invoiced this FY" />
      </div>
      <p style={{ ...DIM, margin: '10px 0 0', fontSize: 10.5 }}>
        {decided > 0
          ? `Win rate this year: ${Math.round((d.wonCount / decided) * 100)}% of ${decided} decided.`
          : 'Nothing decided this year yet, so there is no win rate to quote.'}
      </p>
    </Panel>
  );
}

function Fig({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--fg-3)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 700, color: tone ?? 'var(--fg)', marginTop: 3 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 1 }}>{sub}</div>
    </div>
  );
}

export function GroupReview({ d }: { d: GroupReviewData }) {
  const f = d.footprint;
  const { rows: units, sortBy: unitSort } = useTableSort(d.units, UNIT_COLS);
  const { rows: complaints, sortBy: complaintSort } = useTableSort(d.complaints, COMPLAINT_COLS);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <CurrentFyStrip d={d.currentFy} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Kpi label="Units in group" value={String(d.units.length)} />
        <Kpi label="Total pumps" value={String(f.pcpTotal + f.mmpTotal)} sub={`${f.pcpTotal} PCP · ${f.mmpTotal} MMP`} />
        <Kpi label="RIL share · PCP" value={`${pct(f.pcpRil, f.pcpTotal)}%`} sub={`${f.pcpRil} of ${f.pcpTotal}`} accent />
        <Kpi label="Spares / pump · avg-yr" value={d.sparesPerPumpAvg == null ? '—' : `₹ ${inr(d.sparesPerPumpAvg)}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
        <Panel title="Pumps Footprint">
          <ul style={UL}>
            <li><b>PCP</b> — RIL {pct(f.pcpRil, f.pcpTotal)}% · Roto {pct(f.pcpRoto, f.pcpTotal)}% · Others {pct(f.pcpOther, f.pcpTotal)}% <span style={DIM}>({f.pcpTotal} pumps)</span></li>
            <li><b>MMP</b> — RIL {pct(f.mmpRil, f.mmpTotal)}% · Others {pct(f.mmpOther, f.mmpTotal)}% <span style={DIM}>({f.mmpTotal} pumps)</span></li>
            <li>Units with no footprint recorded: <b>{d.units.filter(u => u.totalPumps === 0).length}</b></li>
          </ul>
        </Panel>
        <Panel title="Spares Evolution">
          <ul style={UL}>
            <li>Group spares per pump (avg/yr): <b>{d.sparesPerPumpAvg == null ? '—' : `₹ ${inr(d.sparesPerPumpAvg)}`}</b></li>
            <li>Units needing attention: {d.attention.length ? <b>{d.attention.join(', ')}</b> : <span style={DIM}>none</span>}</li>
          </ul>
          <p style={{ ...DIM, margin: '8px 0 0', fontSize: 10.5 }}>
            Attention = spares/pump below the group average, or no spares recorded against an installed footprint.
          </p>
        </Panel>
      </div>

      <Panel title="Unit Overview">
        <Scroll>
          <table style={TBL}>
            <thead><tr>
              <SortTH {...unitSort('name')} style={TH} align="left">Unit</SortTH>
              <SortTH {...unitSort('tcd')} style={TH} align="right">Cap TCD</SortTH>
              <SortTH {...unitSort('rilPcp')} style={TH} align="right">RIL PCP</SortTH>
              <SortTH {...unitSort('rotoPcp')} style={TH} align="right">ROTO PCP</SortTH>
              <SortTH {...unitSort('otherPcp')} style={TH} align="right">OTHER PCP</SortTH>
              <SortTH {...unitSort('totalPcp')} style={TH} align="right">Total PCP</SortTH>
              <SortTH {...unitSort('rilMmp')} style={TH} align="right">RIL MMP</SortTH>
              <SortTH {...unitSort('otherMmp')} style={TH} align="right">OTHER MMP</SortTH>
              <SortTH {...unitSort('sparesPerPump')} style={TH} align="right">Spares / Pump</SortTH>
              <SortTH {...unitSort('actions')} style={TH} align="left">Action Points</SortTH>
            </tr></thead>
            <tbody>
              {units.map(u => (
                <tr key={u.code}>
                  <td style={{ ...TD, fontWeight: 500 }}>{u.name}</td>
                  <Num v={u.tcd} /><Num v={u.rilPcp} /><Num v={u.rotoPcp} /><Num v={u.otherPcp} />
                  <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontWeight: 700 }}>{u.totalPcp || '—'}</td>
                  <Num v={u.rilMmp} /><Num v={u.otherMmp} />
                  <td style={{ ...TD, textAlign: 'right', fontFamily: MONO }}>{u.sparesPerPump == null ? '—' : inr(u.sparesPerPump)}</td>
                  <td style={{ ...TD, fontSize: 11, color: u.actions.length ? 'var(--warn)' : 'var(--fg-3)' }}>{u.actions.join(' · ') || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: 'var(--bg-elev)' }}>
                <td style={{ ...TD, fontWeight: 700, borderTop: BT }}>Total</td>
                <td style={{ ...TD, borderTop: BT }} />
                {[f.pcpRil, f.pcpRoto, f.pcpOther, f.pcpTotal, f.mmpRil, f.mmpOther].map((v, i) =>
                  <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontWeight: 700, borderTop: BT }}>{v}</td>)}
                <td style={{ ...TD, borderTop: BT }} /><td style={{ ...TD, borderTop: BT }} />
              </tr>
            </tfoot>
          </table>
        </Scroll>
      </Panel>

      {([['Pump Revenue by Unit', 'pumpByFy'], ['Spares Revenue by Unit', 'spareByFy']] as const).map(([title, key]) => (
        <RevenueByUnit key={title} title={title} fys={d.fys} units={d.units} field={key} />
      ))}

      <Panel title="Complaints" note="by year">
        {d.complaints.length === 0 ? <Empty /> : (
          <Scroll>
            <table style={TBL}>
              <thead><tr>
                <SortTH {...complaintSort('year')} style={TH} align="left">Year</SortTH>
                <SortTH {...complaintSort('nature')} style={TH} align="left">Nature of complaint</SortTH>
                <SortTH {...complaintSort('count')} style={TH} align="right">No. of complaints</SortTH>
              </tr></thead>
              <tbody>
                {complaints.map((c, i) => (
                  <tr key={i}>
                    <td style={{ ...TD, fontFamily: MONO }}>{c.year}</td>
                    <td style={TD}>{c.nature}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: MONO }}>{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
        )}
      </Panel>
    </div>
  );
}

/**
 * Revenue per unit across the fiscal years, for pumps or for spares.
 *
 * Its own component rather than two blocks inside GroupReview's loop, because
 * each copy keeps its own sort and a hook cannot be called inside a map.
 */
function RevenueByUnit({ title, fys, units, field }: {
  title: string; fys: string[]; units: GroupUnit[]; field: 'pumpByFy' | 'spareByFy';
}) {
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
  // Divided by the number of years, not by the number of years that had revenue:
  // a unit that bought in one year of five averages a fifth, not the whole.
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter(x => x != null) as number[];
    return v.length ? sum(v) / fys.length : null;
  };

  const COLS: SortableColumn<GroupUnit>[] = [
    { key: 'name', kind: 'text' },
    { key: 'tcd',  kind: 'number' },
    ...fys.map((fy, i) => ({ key: `fy${i}`, kind: 'number' as const, value: (u: GroupUnit) => u[field][i] })),
    { key: 'avg',  kind: 'number', value: (u: GroupUnit) => avg(u[field]) },
  ];
  const { rows, sortBy } = useTableSort(units, COLS);

  return (
    <Panel title={title} note="₹ per financial year">
      <Scroll>
        <table style={TBL}>
          <thead><tr>
            <SortTH {...sortBy('name')} style={TH} align="left">Unit</SortTH>
            <SortTH {...sortBy('tcd')} style={TH} align="right">TCD</SortTH>
            {fys.map((fy, i) => (
              <SortTH key={fy} {...sortBy(`fy${i}`)} style={TH} align="right">{fy}</SortTH>
            ))}
            <SortTH {...sortBy('avg')} style={TH} align="right">Avg/Yr</SortTH>
          </tr></thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.code}>
                <td style={{ ...TD, fontWeight: 500 }}>{u.name}</td>
                <Num v={u.tcd} />
                {u[field].map((v, i) => <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: v ? 'var(--fg)' : 'var(--fg-3)' }}>{v ? inr(v) : '—'}</td>)}
                <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontWeight: 600 }}>{inr(avg(u[field]))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--bg-elev)' }}>
              <td style={{ ...TD, fontWeight: 700, borderTop: BT }}>Group Total</td>
              <td style={{ ...TD, borderTop: BT }} />
              {fys.map((_, i) => (
                <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontWeight: 700, borderTop: BT }}>
                  {inr(sum(units.map(u => u[field][i])))}
                </td>
              ))}
              <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontWeight: 700, borderTop: BT }}>
                {inr(sum(units.map(u => sum(u[field]))) / fys.length)}
              </td>
            </tr>
          </tfoot>
        </table>
      </Scroll>
    </Panel>
  );
}

// ── OEM ─────────────────────────────────────────────────────────

interface OemRevenueRow { fy: string; revenue: number | null }
interface OemStageRow { stage: string; vals: (number | null)[] }

export function OemReview({ d }: { d: OemReviewData }) {
  // The fiscal year and its figure as one row, so the table sorts on a pair
  // rather than on two arrays that have to be kept in step by index.
  const revenueRows: OemRevenueRow[] = d.fys.map((fy, i) => ({ fy, revenue: d.revenueByFy[i] ?? null }));
  // A fiscal-year label reads '24-25', so text order and chronological order are
  // the same thing and the numeric collator keeps them that way.
  const REV_COLS: SortableColumn<OemRevenueRow>[] = [
    { key: 'fy',      kind: 'text' },
    { key: 'revenue', kind: 'number' },
  ];
  const { rows: revenue, sortBy: revSort } = useTableSort(revenueRows, REV_COLS);

  const stageRows: OemStageRow[] = d.stages.map((s, si) => ({ stage: s, vals: d.oppMatrix[si] ?? [] }));
  // Stage is a lifecycle, not a word list: ALL_STAGES is the sequence an
  // opportunity actually moves through (Prospect, Suspect, Quoted, Negotiating,
  // On Hold, Won, Lost, Dropped), and sorting it alphabetically would put
  // Dropped first and Won next to Suspect. The rows arrive alphabetical from the
  // page, so the first click on this column is what puts them in pipeline order.
  const STAGE_COLS: SortableColumn<OemStageRow>[] = [
    { key: 'stage', kind: 'status', order: ALL_STAGES },
    ...d.oppFys.map((fy, i) => ({ key: `fy${i}`, kind: 'number' as const, value: (r: OemStageRow) => r.vals[i] })),
  ];
  const { rows: stages, sortBy: stageSort } = useTableSort(stageRows, STAGE_COLS);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <CurrentFyStrip d={d.currentFy} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Kpi label={`${d.fys.length}-yr total revenue`} value={cr(d.totalRevenue)} sub={`FY ${d.fys[0]} to ${d.fys[d.fys.length - 1]}`} accent />
        <Kpi label="Avg revenue / yr" value={lakh(d.avgPerYear)} sub="per year average" />
        <Kpi label="Total pumps" value={String(d.totalPumps)} sub="installed base on record" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
        <Panel title="Revenue by Financial Year">
          <Scroll>
            <table style={TBL}>
              <thead><tr>
                <SortTH {...revSort('fy')} style={TH} align="left">F.Y.</SortTH>
                <SortTH {...revSort('revenue')} style={TH} align="right">Revenue</SortTH>
              </tr></thead>
              <tbody>
                {revenue.map(r => (
                  <tr key={r.fy}>
                    <td style={{ ...TD, fontWeight: 500 }}>{r.fy}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: r.revenue ? 'var(--fg)' : 'var(--fg-3)' }}>
                      {r.revenue ? inr(r.revenue) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg-elev)' }}>
                  <td style={{ ...TD, fontWeight: 700, borderTop: BT }}>Avg/Yr</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontWeight: 700, borderTop: BT }}>{inr(d.avgPerYear)}</td>
                </tr>
              </tfoot>
            </table>
          </Scroll>
        </Panel>

        <Panel title="Opportunities Summary" note="₹ by stage">
          {d.stages.length === 0 ? <Empty /> : (
            <Scroll>
              <table style={TBL}>
                <thead><tr>
                  <SortTH {...stageSort('stage')} style={TH} align="left">Stage</SortTH>
                  {d.oppFys.map((fy, i) => (
                    <SortTH key={fy} {...stageSort(`fy${i}`)} style={TH} align="right">{fy}</SortTH>
                  ))}
                </tr></thead>
                <tbody>
                  {stages.map(r => (
                    <tr key={r.stage}>
                      <td style={{ ...TD, fontWeight: 500 }}>{r.stage}</td>
                      {r.vals.map((v, vi) => (
                        <td key={vi} style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: v ? 'var(--fg)' : 'var(--fg-3)' }}>{v ? inr(v) : '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--bg-elev)' }}>
                    <td style={{ ...TD, fontWeight: 700, borderTop: BT }}>Total</td>
                    {d.oppFys.map((_, fi) => (
                      <td key={fi} style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontWeight: 700, borderTop: BT }}>
                        {inr(d.oppMatrix.reduce((a, row) => a + (row[fi] ?? 0), 0))}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </Scroll>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── shared bits ─────────────────────────────────────────────────
function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ ...PANEL, padding: '13px 15px', ...(accent ? { borderLeft: '4px solid var(--title)' } : {}) }}>
      <div style={METRIC_LABEL}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--fg)', lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div style={PANEL}>
      <div style={PANEL_H}><span style={PANEL_TITLE}>{title}</span>{note && <span style={META}>{note}</span>}</div>
      <div style={{ padding: title === 'Pumps Footprint' || title === 'Spares Evolution' ? '10px 14px' : 0 }}>{children}</div>
    </div>
  );
}
const Scroll = ({ children }: { children: ReactNode }) => <div style={{ overflowX: 'auto' }}>{children}</div>;
const Num = ({ v }: { v: number | null }) => <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: v ? 'var(--fg)' : 'var(--fg-3)' }}>{v ? inr(v) : '—'}</td>;
const Empty = () => <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-3)' }}>No data</div>;

const MONO = 'var(--font-mono)';
const BT = '2px solid var(--line-strong)';
const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' };
const PANEL_H: CSSProperties = { padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 };
const PANEL_TITLE: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--title)' };
const META: CSSProperties = { fontSize: 11, color: 'var(--fg-3)', fontFamily: MONO, marginLeft: 'auto' };
const METRIC_LABEL: CSSProperties = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', fontWeight: 600 };
const TBL: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const TH: CSSProperties = { padding: '8px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, color: 'var(--fg-3)', background: 'var(--bg-elev)', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };
const TD: CSSProperties = { padding: '8px 12px', verticalAlign: 'middle', whiteSpace: 'nowrap', borderTop: '1px solid var(--line)' };
const UL: CSSProperties = { margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9, color: 'var(--fg)' };
const DIM: CSSProperties = { color: 'var(--fg-3)' };
