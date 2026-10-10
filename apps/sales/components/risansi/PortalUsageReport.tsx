// The individual portal-usage report, as markup.
//
// Split from app/print/portal-usage/page.tsx so the layout can be rendered
// without a request, a session or a database — scripts/portal-usage-preview.mjs
// feeds it real rows and writes an HTML file, which is the only way to look at
// a print layout short of logging in and pressing Ctrl-P.
//
// None of the tables here sort, and that is not an oversight. This is a sheet
// of A4 somebody saves as a PDF and sends: there is no header to click once it
// has left the browser, and the preview script renders it with no React runtime
// at all. "Every metric" could not take a sort even on screen — its rows are
// grouped under section headings, and ordering the body would scatter the rows
// out from under the heading that names them.
import type { CSSProperties, ReactNode } from 'react';
import { C, TH, TD, DocHeader } from '@/components/risansi/print-shared';
import { AutoPrint } from '@/components/risansi/AutoPrint';
import type { PersonRow, MetricComparison } from '@/lib/risansi-person-metrics';

export const PORTAL_USAGE_CSS = `
  @page { size: A4; margin: 12mm 11mm; }
  @media print {
    .no-print { display: none !important; }
    .print-root { background: #fff !important; }
    .avoid-break { break-inside: avoid; page-break-inside: avoid; }
    .page-break { break-before: page; page-break-before: always; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
  }
  .print-root { color: #0F172A; }
`;

const ROOT: CSSProperties = {
  maxWidth: 780, margin: '0 auto', padding: '0 4px 30px',
  fontFamily: '"Helvetica Neue", Arial, system-ui, sans-serif',
  fontSize: 11.5, lineHeight: 1.45, color: C.ink,
};

const MODULE_LABEL: Record<string, string> = {
  pipeline: 'Opportunities', clients: 'Client 360', visits: 'Visit reports',
  field: 'Field Activity', admin: 'Admin', revenue: 'Revenue',
  complaints: 'Complaints', registry: 'Action Registry', compete: 'Competition',
  exhibitions: 'Exhibitions', mobile: 'Mobile', 'executive-review': 'Executive Review',
  dashboard: 'Dashboard',
};
export const moduleOf = (path: string | null): string => {
  if (!path) return 'dashboard';
  const seg = path.replace(/^\/risansi\/?/, '').replace(/^\//, '').split('/')[0];
  return seg && seg !== 'risansi' ? seg : 'dashboard';
};
const modLabel = (m: string) => MODULE_LABEL[m] ?? m.replace(/-/g, ' ');

const fmtDate = (v: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const nf = (v: number, dp = 0) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
// Averages and medians get a second decimal when one is not enough to be
// non-zero. "avg 0.0" printed beside "-100%" reads as a contradiction; it is
// really an average of 0.08.
const avgf = (v: number) => (v > 0 && v < 0.1 ? nf(v, 2) : nf(v, 1));

export interface PortalUsageReportProps {
  subject: PersonRow;
  cmp: MetricComparison[];
  cohortLabel: string;
  cohortSize: number;
  winLabel: string;
  modRows: { m: string; mine: number; avg: number }[];
  trend: { ym: string; hours: number; days: number; sessions: number }[];
  generated: string;
  generatedBy: string;
  /** Off in the offline preview, which has no browser print dialog to open. */
  autoPrint?: boolean;
}

export function PortalUsageReport({
  subject, cmp, cohortLabel, cohortSize, winLabel, modRows, trend, generated, generatedBy,
  autoPrint = true,
}: PortalUsageReportProps) {
  const by = (k: string) => cmp.find(m => m.key === k)!;
  const HEADLINE = ['hours', 'days_active', 'visits_owned', 'audited_actions'].map(by);
  const groups = [...new Set(cmp.map(m => m.group))];
  const first = subject.name.split(' ')[0];

  return (
    <div className="print-root" style={{ background: '#fff', minHeight: '100vh', padding: '16px 12px' }}>
      <style dangerouslySetInnerHTML={{ __html: PORTAL_USAGE_CSS }} />
      <div style={ROOT}>
        {autoPrint && <AutoPrint label="Save as PDF" />}

        <DocHeader
          kind="Portal Usage"
          title={subject.name}
          subtitle={<>
            {subject.role}{subject.zone ? ` · ${subject.zone}` : ''} · {subject.email}
          </>}
          meta={<>
            <div style={{ fontWeight: 700, color: C.ink }}>{winLabel}</div>
            <div style={{ marginTop: 2 }}>Compared with {cohortLabel}</div>
            <div style={{ marginTop: 6 }}>Generated {generated}</div>
            <div>by {generatedBy}</div>
          </>}
        />

        {/* ── the four numbers somebody actually reads ─────────────── */}
        <div className="avoid-break" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
          {HEADLINE.map(m => <Headline key={m.key} m={m} cohortSize={cohortSize} />)}
        </div>

        {/* ── how far from average, as a picture ───────────────────── */}
        <Panel title="Against the rest of the team" note={`bar is ${first} · line is the ${cohortLabel} average · end of the track is the best in the group`}>
          <div style={{ display: 'grid', gap: 7 }}>
            {['hours', 'days_active', 'visits_owned', 'reports_filed', 'opps_created', 'sales_orders', 'actions_done', 'audited_actions']
              .map(by)
              .filter(m => m.applicable)
              .map(m => <CompareBar key={m.key} m={m} />)}
          </div>
        </Panel>

        {/* ── every metric ─────────────────────────────────────────── */}
        <Panel title="Every metric" note="rank 1 is the highest in the group; ties share a rank">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...TH, width: '38%' }}>Metric</th>
                <th style={{ ...TH, textAlign: 'right' }}>{first}</th>
                <th style={{ ...TH, textAlign: 'right' }}>Average</th>
                <th style={{ ...TH, textAlign: 'right' }}>Median</th>
                <th style={{ ...TH, textAlign: 'right' }}>Best</th>
                <th style={{ ...TH, textAlign: 'right' }}>vs avg</th>
                <th style={{ ...TH, textAlign: 'right' }}>Rank</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <GroupRows key={g} group={g} rows={cmp.filter(m => m.group === g)} n={cohortSize} />
              ))}
            </tbody>
          </table>
        </Panel>

        <div className="page-break" />

        {/* ── where the time went ──────────────────────────────────── */}
        <Panel title="Where the time went" note={`their hours by module, against the ${cohortLabel} average`}>
          {modRows.length === 0
            ? <div style={{ color: C.fg3, padding: '10px 0' }}>No recorded time in this period.</div>
            : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...TH, width: '32%' }}>Module</th>
                  <th style={TH}></th>
                  <th style={{ ...TH, textAlign: 'right' }}>Hours</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Share</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Group avg</th>
                </tr></thead>
                <tbody>
                  {(() => {
                    const total = modRows.reduce((s, r) => s + r.mine, 0) || 1;
                    const max = Math.max(...modRows.map(r => Math.max(r.mine, r.avg)), 0.1);
                    return modRows.map(r => (
                      <tr key={r.m}>
                        <td style={{ ...TD, textTransform: 'capitalize' }}>{modLabel(r.m)}</td>
                        <td style={{ ...TD, width: 170 }}><Track value={r.mine} avg={r.avg} max={max} /></td>
                        <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{nf(r.mine, 1)}</td>
                        <td style={{ ...TD, textAlign: 'right', color: C.fg3, fontVariantNumeric: 'tabular-nums' }}>{Math.round((r.mine / total) * 100)}%</td>
                        <td style={{ ...TD, textAlign: 'right', color: C.fg3, fontVariantNumeric: 'tabular-nums' }}>{avgf(r.avg)}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>}
        </Panel>

        {/* ── month by month ───────────────────────────────────────── */}
        <Panel title="Month by month" note="hours in the app, days they were in, sessions">
          {trend.length === 0
            ? <div style={{ color: C.fg3, padding: '10px 0' }}>No recorded time in this period.</div>
            : <Trend rows={trend.map(t => ({ ym: t.ym, hours: Number(t.hours), days: Number(t.days), sessions: Number(t.sessions) }))} />}
        </Panel>

        {/* ── the facts that are not comparisons ───────────────────── */}
        <Panel title="Account">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '9px 18px' }}>
            <Fact label="First seen" value={fmtDate(subject.first_seen)} />
            <Fact label="Last sign-in" value={fmtDate(subject.last_login)} />
            <Fact label="Sign-ins" value={`${nf(subject.logins)}${subject.login_failed > 0 ? ` · ${subject.login_failed} failed` : ''}`} />
            <Fact label="Most-used screen" value={modLabel(moduleOf(subject.top_path))} />
            <Fact label="Clients owned" value={nf(subject.clients_owned)} />
            <Fact label="Clients covered" value={nf(subject.clients_covered)} />
          </div>
        </Panel>

        <div style={{ fontSize: 9.5, color: C.fg3, lineHeight: 1.6, marginTop: 10 }}>
          <strong style={{ color: C.fg2 }}>How to read this.</strong>{' '}
          Active hours are measured, not inferred: the portal records seconds a page was
          actually in focus, so an hour here is an hour of use rather than a tab left open.
          Comparisons are drawn against {cohortLabel} — the same role, so the numbers are
          about the work and not the job title. The average and the median are both shown
          because the two disagreeing means one person is carrying the group. Client counts
          are as they stand today rather than windowed; everything else covers {winLabel.toLowerCase()}.
          A dash in place of a rank means nobody in the group recorded any of that.
        </div>
      </div>
    </div>
  );
}

// ── pieces ────────────────────────────────────────────────────────

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="avoid-break" style={{ border: `1px solid ${C.line}`, borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{
        padding: '7px 11px', background: C.bgElev, borderBottom: `1px solid ${C.line}`,
        display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: C.fg2 }}>{title}</span>
        {note && <span style={{ fontSize: 9.5, color: C.fg3, marginLeft: 'auto' }}>{note}</span>}
      </div>
      <div style={{ padding: 11 }}>{children}</div>
    </div>
  );
}

function Headline({ m, cohortSize }: { m: MetricComparison; cohortSize: number }) {
  const up = m.vsAvg != null && m.vsAvg >= 0;
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '9px 11px' }}>
      <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: C.fg3 }}>{m.label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: C.ink, lineHeight: 1.2, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
        {nf(m.value, m.dp ?? 0)}
      </div>
      <div style={{ fontSize: 9.5, color: C.fg3, marginTop: 1 }}>
        avg {avgf(m.avg)}
        {m.vsAvg != null && (
          <span style={{ color: up ? C.pos : C.neg, fontWeight: 700 }}>
            {' '}· {up ? '+' : ''}{Math.round(m.vsAvg * 100)}%
          </span>
        )}
      </div>
      <div style={{ fontSize: 9.5, color: C.fg3 }}>
        {m.applicable ? `rank ${m.rank} of ${cohortSize}` : 'nobody recorded any'}
      </div>
    </div>
  );
}

/** Person as a filled bar, the group average as a line across it, best = full width. */
function CompareBar({ m }: { m: MetricComparison }) {
  const max = Math.max(m.best, m.value, m.avg, 0.001);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const up = m.vsAvg != null && m.vsAvg >= 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 132, flexShrink: 0, fontSize: 10 }}>{m.label}</span>
      <div style={{ flex: 1, position: 'relative', height: 15, background: C.bgSunk, borderRadius: 3, minWidth: 60 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(m.value),
          background: up ? C.accent : C.warn, borderRadius: 3,
        }} />
        <div style={{
          position: 'absolute', top: -2, bottom: -2, left: pct(m.avg),
          width: 2, background: C.ink,
        }} title="group average" />
      </div>
      <span style={{ width: 52, flexShrink: 0, textAlign: 'right', fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {nf(m.value, m.dp ?? 0)}
      </span>
      <span style={{ width: 44, flexShrink: 0, textAlign: 'right', fontSize: 9.5, color: C.fg3, fontVariantNumeric: 'tabular-nums' }}>
        {avgf(m.avg)}
      </span>
      <span style={{ width: 40, flexShrink: 0, textAlign: 'right', fontSize: 9.5, fontWeight: 700, color: up ? C.pos : C.neg }}>
        {m.vsAvg == null ? '—' : `${up ? '+' : ''}${Math.round(m.vsAvg * 100)}%`}
      </span>
    </div>
  );
}

/** The module table's inline bar: their hours filled, the group average marked. */
function Track({ value, avg, max }: { value: number; avg: number; max: number }) {
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div style={{ position: 'relative', height: 11, background: C.bgSunk, borderRadius: 3 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(value), background: C.accent, borderRadius: 3 }} />
      <div style={{ position: 'absolute', top: -1, bottom: -1, left: pct(avg), width: 2, background: C.ink }} />
    </div>
  );
}

function GroupRows({ group, rows, n }: { group: string; rows: MetricComparison[]; n: number }) {
  return (
    <>
      <tr>
        <td colSpan={7} style={{
          padding: '7px 8px 3px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.07em', color: C.accent, borderBottom: `1px solid ${C.line}`,
        }}>{group}</td>
      </tr>
      {rows.map(m => {
        const up = m.vsAvg != null && m.vsAvg >= 0;
        const num: CSSProperties = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
        return (
          <tr key={m.key}>
            <td style={TD}>
              {m.label}
              {m.hint && <div style={{ fontSize: 8.5, color: C.fg3, lineHeight: 1.3 }}>{m.hint}</div>}
              {m.unit && <span style={{ fontSize: 9, color: C.fg3 }}> ({m.unit})</span>}
            </td>
            <td style={{ ...num, fontWeight: 700 }}>{nf(m.value, m.dp ?? 0)}</td>
            <td style={{ ...num, color: C.fg2 }}>{avgf(m.avg)}</td>
            <td style={{ ...num, color: C.fg3 }}>{avgf(m.median)}</td>
            <td style={{ ...num, color: C.fg3 }}>{nf(m.best, m.dp ?? 0)}</td>
            <td style={{ ...num, fontWeight: 700, color: m.vsAvg == null ? C.fg3 : up ? C.pos : C.neg }}>
              {m.vsAvg == null ? '—' : `${up ? '+' : ''}${Math.round(m.vsAvg * 100)}%`}
            </td>
            <td style={{ ...num, color: C.fg3 }}>{m.applicable ? `${m.rank} / ${n}` : '—'}</td>
          </tr>
        );
      })}
    </>
  );
}

function Trend({ rows }: { rows: { ym: string; hours: number; days: number; sessions: number }[] }) {
  const max = Math.max(...rows.map(r => r.hours), 0.1);
  const month = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  };
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {rows.map(r => (
        <div key={r.ym} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 62, flexShrink: 0, fontSize: 10, color: C.fg2 }}>{month(r.ym)}</span>
          <div style={{ flex: 1, height: 13, background: C.bgSunk, borderRadius: 3, overflow: 'hidden', minWidth: 50 }}>
            <div style={{ height: '100%', width: `${Math.max((r.hours / max) * 100, 1)}%`, background: C.accent }} />
          </div>
          <span style={{ width: 48, flexShrink: 0, textAlign: 'right', fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {nf(r.hours, 1)}h
          </span>
          <span style={{ width: 110, flexShrink: 0, textAlign: 'right', fontSize: 9.5, color: C.fg3 }}>
            {r.days} day{r.days === 1 ? '' : 's'} · {r.sessions} session{r.sessions === 1 ? '' : 's'}
          </span>
        </div>
      ))}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 8.5, color: C.fg3, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 11.5, color: C.ink, marginTop: 1 }}>{value}</div>
    </div>
  );
}
