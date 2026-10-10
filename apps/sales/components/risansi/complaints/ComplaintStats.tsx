import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ChartPanel, StageKpi, NoData } from '@/components/risansi/StageCharts';
import { StatusChart } from './StatusChart';
import { SEVERITY_TONE, type Severity } from '@/lib/risansi-complaint-flow';
import type { ComplaintSummary, Bar, CategoryBar, DrillNode, HolderBar, ClientBar } from '@/lib/risansi-complaint-stats';

// The dashboard above the complaints list.
//
// Server-rendered from summariseComplaints. Every bar is a link into the
// list's own filters, so clicking "QC" under Who holds them narrows the table
// to what QC is sitting on, the way the stage dashboards work. The page owns
// the URL and passes hrefFor; a chosen bar stays lit and the rest step back.
//
// Every tile here says how it was worked out, because the review's finding was
// not that a number was missing but that two numbers could not both be true.
// "Overdue" in particular now explains its own rule in its subtitle: it is age
// since raised against the severity's threshold, and the old target-date rule
// that produced one overdue complaint out of thirty-four is gone.

const fmtDays = (d: number | null | undefined) => (d == null ? '—' : d < 1 ? '<1d' : `${d.toFixed(d >= 10 ? 0 : 1)}d`);
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function ComplaintStats({ s, href, sel }: {
  s: ComplaintSummary;
  /** Build the URL that toggles a filter key to a value. */
  href: (key: string, value: string) => string;
  /** The current value of each filter, to light the chosen bar. */
  sel: Record<string, string | undefined>;
}) {
  if (!s.total) return null;
  const net = s.raised30 - s.closed30;
  return (
    <div style={{ marginBottom: 14 }}>
      {/* r-grid-4: two tiles per row on a phone rather than eight in a column. */}
      <div className="r-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <Tile label="Open" value={String(s.open)}
          sub={`of ${s.total} · ${s.trulyClosed} closed · ${s.resolvedAwaitingClose} awaiting closure${s.awaitingFeedback ? ` · ${s.awaitingFeedback} out for feedback` : ''}`} />
        {/* Two tiles, not one, because they are chased by different people: the
            first is nobody's work yet, the second is late despite somebody's. */}
        <Tile label="Overdue · no action" value={String(s.overdueNoAction)}
          sub="still Open or Under Investigation, past its severity's days"
          href={href('overdue', 'no-action')} on={sel.overdue === 'no-action'}
          color={s.overdueNoAction ? 'var(--neg)' : undefined} alert={s.overdueNoAction > 0} />
        <Tile label="Overdue · acted" value={String(s.overdueActed)}
          sub="an action is recorded and it is late anyway"
          href={href('overdue', 'acted')} on={sel.overdue === 'acted'}
          color={s.overdueActed ? 'var(--warn)' : undefined} />
        <Tile label="Severe" value={String(s.severeOpen)}
          sub={`open · ${s.severe} ever · safety, shutdown, penalty or repeat`}
          href={href('severe', '1')} on={sel.severe === '1'}
          color={s.severeOpen ? 'var(--neg)' : undefined} alert={s.severeOpen > 0} />
        <Tile label="Avg age of open" value={fmtDays(s.avgOpenAge)} sub={s.oldestOpen != null ? `oldest ${s.oldestOpen}d · days since raised` : 'days since raised'}
          color={s.avgOpenAge != null && s.avgOpenAge > 30 ? 'var(--warn)' : undefined} />
        <Tile label="Avg time to close" value={fmtDays(s.avgTimeToClose)}
          sub={s.closedCount
            ? `median ${fmtDays(s.medianTimeToClose)} over ${s.closedCount} closed · ${fmtDays(s.avgTimeToResolve)} to resolve`
            : 'nothing closed yet'} />
        <Tile label="Last 30 days" value={`${s.raised30} / ${s.closed30}`}
          sub={`raised / closed · ${net > 0 ? `the backlog grew by ${net}` : net < 0 ? `the backlog shrank by ${-net}` : 'the backlog held'} · ${s.open} open in all`}
          color={net > 0 ? 'var(--warn)' : net < 0 ? 'var(--pos)' : undefined} />
        <Tile label="Repeat · linked" value={String(s.linkedCount)}
          sub={s.repeatRate == null ? 'flagged at closure, or linked to an original' : `${pct(s.repeatRate)} of rated · ${s.reopened} reopened`}
          href={href('linked', '1')} on={sel.linked === '1'}
          color={s.repeatRate != null && s.repeatRate >= 0.2 ? 'var(--neg)' : undefined} />
      </div>

      <div className="stage-grid-4">
        <StatusChart
          anySelected={!!sel.headline || !!sel.status || !!sel.state}
          noteSummary="The five names the business uses, over the eight sub-stages. Red part is overdue. Click to filter."
          noteStages="Count in each sub-stage now, and the average days a complaint spends there. Click a stage to filter."
          summary={s.byHeadline.map(h => ({
            key: h.key, label: h.label, count: h.count, overdue: h.overdue,
            done: h.key === 'Resolved' || h.key === 'Closed' || h.key === 'Feedback',
            href: href('headline', h.key), on: sel.headline === h.key,
            note: h.stages.length > 1 ? `${h.stages.length} stages` : (h.stages[0] ?? undefined),
          }))}
          stages={s.funnel.map(x => ({
            key: x.status, label: x.status, count: x.count,
            done: x.status === 'Resolved' || x.status === 'Closed' || x.status === 'Feedback',
            href: href('status', x.status), on: sel.status === x.status,
            note: x.stretches ? fmtDays(x.avgDays) : undefined,
          }))}
        />
        <ChartPanel title="Open by severity" sub="and the days each gets" note="The S-grade from the risk page, which is also what sets the overdue threshold. Red part is overdue. Click to filter.">
          <Bars rows={s.bySeverity.filter(b => b.count || b.key !== 'none')} href={v => href('sev', v)} selected={sel.sev}
            tone={b => (b.key === 'none' ? 'var(--fg-3)' : SEVERITY_TONE[b.key as Severity])} empty="No open complaints on the workflow." />
        </ChartPanel>
        <ChartPanel title="Who holds them now" sub="by department" note="Open complaints each department is sitting on, and the days they have held them in total. Click to filter.">
          <Holders rows={s.byHolderDept} href={v => href('dept', v)} selected={sel.dept} />
        </ChartPanel>
        <ChartPanel title="Who sits longest" sub="named holders" note="Days of open time each person has held, across every complaint. Longest first. Click to see theirs.">
          <Holders rows={s.byHolderPerson.slice(0, 8)} person href={v => href('holder', v)} selected={sel.holder} />
        </ChartPanel>
      </div>

      <div className="stage-grid-4">
        <div className="stage-span-2">
          <ChartPanel title="Complaint category" sub="open, and how long closing takes"
            note="Open count and average days from raised to closed, per category. A category marked old is one the 2 Oct mapping could not read onto a new name without guessing. Click to filter.">
            <Categories rows={s.byCategory} href={v => href('cat', v)} selected={sel.cat} />
          </ChartPanel>
        </div>
        <ChartPanel title="Sub-category" note="Under the category above. Click to filter.">
          <Bars rows={s.bySubcategory.slice(0, 10)} href={v => href('subcat', v)} selected={sel.subcat} empty="No sub-category recorded yet." />
        </ChartPanel>
        <ChartPanel title="Industry" note="The client's industry. Click to filter.">
          <Bars rows={s.byIndustry.slice(0, 10)} href={v => href('ind', v)} selected={sel.ind} empty="No industry on file." />
        </ChartPanel>
      </div>

      <div className="stage-grid-4">
        <ChartPanel title="Action taken" note="Page 5's Action Taken, which is also what decides who the task is assigned to. Click to filter.">
          <Bars rows={s.byAction} href={v => href('action', v)} selected={sel.action} empty="No action recorded yet." />
        </ChartPanel>
        <ChartPanel title="CAPA tracking" note="Raised, and where it has got to. Pending means asked for with nothing back. Click to filter.">
          <Capa s={s} href={href} sel={sel} />
        </ChartPanel>
        <ChartPanel title="Responsible department" sub="who caused it" note="Derived from the root cause at investigation. Click to filter.">
          <Bars rows={s.byResponsible} href={v => href('resp', v)} selected={sel.resp} empty="Not recorded yet." />
        </ChartPanel>
        <ChartPanel title="Raised vs closed" sub="last 12 months" note="Raised by complaint date, closed by the month it was resolved or closed.">
          <PairBars points={s.months} />
        </ChartPanel>
      </div>

      <div className="stage-grid-4">
        <div className="stage-span-2">
          <ChartPanel title="Drill down" sub="category → sub-category → part → MOC"
            note="The path the review asked for: Damage → Joint → Bush → the MOC on it. Every level is a filter; click along the branch.">
            <Drill nodes={s.drill} href={href} sel={sel} />
          </ChartPanel>
        </div>
        <ChartPanel title="Clients complaining most" sub={`${s.clientCount} client${s.clientCount === 1 ? '' : 's'}`}
          note="Every complaint in view, counted by account. Red is overdue. Click a client to see only theirs.">
          <Clients rows={s.byClient.slice(0, 8)} href={v => href('client', v)} selected={sel.client} />
        </ChartPanel>
        <ChartPanel title="How concentrated" note="A handful of accounts usually carry most of the complaints. This says how far that goes.">
          <Concentration rows={s.byClient} total={s.total} />
        </ChartPanel>
      </div>

      {s.longestSitting.length > 0 && (
        <div style={{ ...PANEL, padding: '10px 14px', display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 11.5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>Sitting longest right now</span>
          {s.longestSitting.map(r => (
            <Link key={r.id} href={`/risansi/complaints/${r.id}`} style={{ color: 'inherit', textDecoration: 'none' }}
              title={`${r.client_name ?? ''} · ${r.status} · with ${r.holder_name ?? r.holder_department ?? 'Complaint Team'}`}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }}>{r.complaint_no}</span>
              {r.severe && <span style={{ color: 'var(--neg)', fontWeight: 700 }} title="Severe / Immediate Response"> ⚑</span>}
              <span style={{ color: 'var(--fg-3)' }}> · {r.holder_name ?? r.holder_department}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: r.days_in_status > 7 ? 'var(--neg)' : 'var(--fg)', marginLeft: 4 }}>{fmtDays(r.days_in_status)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── A KPI tile that can also be a filter ───────────────────────

function Tile({ label, value, sub, color, alert, href, on }: {
  label: string; value: string; sub?: string; color?: string; alert?: boolean; href?: string; on?: boolean;
}) {
  const inner = <StageKpi label={label} value={value} sub={sub} color={color} alert={alert} />;
  if (!href) return inner;
  return (
    <a href={href} style={{ textDecoration: 'none', color: 'inherit', borderRadius: 'var(--radius)', outline: on ? '2px solid var(--accent)' : 'none', outlineOffset: 2, display: 'block' }}
      title={on ? 'Showing only these — click to clear' : 'Show only these'}>{inner}</a>
  );
}

// ── Plain count bars with an overdue part ──────────────────────

function Bars({ rows, href, selected, tone, empty, compact }: {
  rows: Bar[]; href?: (v: string) => string; selected?: string; tone?: (b: Bar) => string; empty: string; compact?: boolean;
}) {
  if (!rows.length) return empty ? <NoData msg={empty} /> : null;
  const max = Math.max(...rows.map(r => r.count), 1);
  const any = !!selected;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 4 : 6 }}>
      {rows.map(r => {
        const on = selected === r.key;
        const hue = tone ? tone(r) : 'var(--accent)';
        const inner = (
          <>
            <span style={{ ...LBL, flex: compact ? '0 1 110px' : '0 1 130px', fontSize: compact ? 10.5 : 11 }}>{r.label}</span>
            <div style={{ flex: 1, minWidth: 40, height: compact ? 10 : 14, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
              {(r.overdue ?? 0) > 0 && <div style={{ width: `${((r.overdue ?? 0) / max) * 100}%`, background: 'var(--neg)' }} />}
              <div style={{ width: `${((r.count - (r.overdue ?? 0)) / max) * 100}%`, background: `color-mix(in oklab, ${hue} 60%, transparent)` }} />
            </div>
            <span style={NUM}>{r.count}</span>
            {!compact && <span style={{ ...NUM, width: 30, color: r.overdue ? 'var(--neg)' : 'var(--fg-4)', fontSize: 10.5 }}>{r.overdue || '·'}</span>}
          </>
        );
        const style: CSSProperties = { ...ROW, opacity: any && !on ? 0.4 : 1, outline: on ? '2px solid var(--accent)' : 'none' };
        return href ? <a key={r.key} href={href(r.key)} style={style} title={`${r.label}: ${r.count}${r.overdue ? ` · ${r.overdue} overdue` : ''}`}>{inner}</a>
          : <div key={r.key} style={style}>{inner}</div>;
      })}
    </div>
  );
}

// ── Category: open count and average time to close, side by side ──

function Categories({ rows, href, selected }: { rows: CategoryBar[]; href: (v: string) => string; selected?: string }) {
  if (!rows.length) return <NoData msg="No category recorded on any complaint in view." />;
  const maxCount = Math.max(...rows.map(r => r.count), 1);
  const maxClose = Math.max(...rows.map(r => r.avgClose ?? 0), 1);
  const any = !!selected;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map(r => {
        const on = selected === r.key;
        return (
          <a key={r.key} href={href(r.key)} style={{ ...ROW, alignItems: 'flex-start', opacity: any && !on ? 0.4 : 1, outline: on ? '2px solid var(--accent)' : 'none' }}
            title={`${r.label}: ${r.open} of ${r.count} still open${r.overdue ? `, ${r.overdue} overdue` : ''}${r.avgClose != null ? ` · ${r.closed} closed in ${fmtDays(r.avgClose)} on average` : ' · none closed yet'}`}>
            <span style={{ ...LBL, flex: '0 1 150px' }}>
              {r.label}
              {r.legacy && <span style={{ fontSize: 9, color: 'var(--fg-4)', fontWeight: 700, marginLeft: 4 }} title="The old Defect Category wording — the mapping could not read it onto a new name without guessing">OLD</span>}
            </span>
            <div style={{ flex: 1, minWidth: 40, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ height: 10, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                {r.overdue > 0 && <div style={{ width: `${(r.overdue / maxCount) * 100}%`, background: 'var(--neg)' }} />}
                {r.open - r.overdue > 0 && <div style={{ width: `${((r.open - r.overdue) / maxCount) * 100}%`, background: 'color-mix(in oklab, var(--warn) 60%, transparent)' }} />}
                <div style={{ width: `${((r.count - r.open) / maxCount) * 100}%`, background: 'color-mix(in oklab, var(--pos) 40%, transparent)' }} />
              </div>
              <div style={{ height: 5, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${((r.avgClose ?? 0) / maxClose) * 100}%`, height: '100%', background: 'color-mix(in oklab, var(--accent) 50%, transparent)' }} />
              </div>
            </div>
            <span style={{ ...NUM, width: 26, color: r.open ? 'var(--warn)' : 'var(--fg-4)' }}>{r.open || '·'}</span>
            <span style={{ ...NUM, width: 40, color: 'var(--fg-2)', fontWeight: 400 }}>{fmtDays(r.avgClose)}</span>
          </a>
        );
      })}
      <div style={{ display: 'flex', gap: 10, fontSize: 9.5, color: 'var(--fg-3)', marginTop: 2, flexWrap: 'wrap' }}>
        <span><Swatch c="var(--neg)" /> overdue</span>
        <span><Swatch c="var(--warn)" /> open</span>
        <span><Swatch c="var(--pos)" /> closed</span>
        <span><Swatch c="var(--accent)" /> avg days to close</span>
        <span style={{ marginLeft: 'auto' }}>open · to close</span>
      </div>
    </div>
  );
}

// ── CAPA: raised, and where each one has got to ────────────────

function Capa({ s, href, sel }: { s: ComplaintSummary; href: (k: string, v: string) => string; sel: Record<string, string | undefined> }) {
  const lines: [string, string, number, string][] = [
    ['Raised', 'raised', s.capa.raised, 'A CAPA was asked for'],
    ['Open · pending', 'pending', s.capa.open, 'Asked for, nothing back yet'],
    ['Under review', 'review', s.capa.review, 'Came back, complaint still live'],
    ['Closed', 'closed', s.capa.closed, 'Came back, complaint finished'],
  ];
  const max = Math.max(s.capa.raised, 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {lines.map(([label, v, n, why]) => {
        const on = sel.capa === v;
        return (
          <a key={v} href={href('capa', v)} title={why}
            style={{ ...ROW, opacity: sel.capa && !on ? 0.4 : 1, outline: on ? '2px solid var(--accent)' : 'none' }}>
            <span style={{ ...LBL, flex: '0 1 120px' }}>{label}</span>
            <div style={{ flex: 1, minWidth: 40, height: 12, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: v === 'pending' ? 'var(--neg)' : 'color-mix(in oklab, var(--accent) 60%, transparent)' }} />
            </div>
            <span style={NUM}>{n}</span>
          </a>
        );
      })}
      <div style={{ borderTop: '1px solid var(--line-2)', marginTop: 4, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <a href={href('pa', 'pending')} title="Live complaints that owe a preventive action — a root cause recorded, a corrective action required, or a CAPA asked for — and have nothing written in either preventive-action field"
          style={{ ...ROW, opacity: sel.pa && sel.pa !== 'pending' ? 0.4 : 1, outline: sel.pa === 'pending' ? '2px solid var(--accent)' : 'none' }}>
          <span style={{ ...LBL, flex: 1 }}>Preventive action pending</span>
          <span style={{ ...NUM, color: s.preventivePending ? 'var(--warn)' : 'var(--fg-4)' }}>{s.preventivePending}</span>
        </a>
        <a href={href('visit', 'pending')} title="Action Taken is Visit Planned and the complaint has not closed out"
          style={{ ...ROW, opacity: sel.visit && sel.visit !== 'pending' ? 0.4 : 1, outline: sel.visit === 'pending' ? '2px solid var(--accent)' : 'none' }}>
          <span style={{ ...LBL, flex: 1 }}>Visit pending</span>
          <span style={{ ...NUM, color: s.visitPending ? 'var(--warn)' : 'var(--fg-4)' }}>{s.visitPending}</span>
        </a>
      </div>
    </div>
  );
}

// ── The drill-down, as an indented tree of links ───────────────

function Drill({ nodes, href, sel, depth = 0 }: {
  nodes: DrillNode[]; href: (k: string, v: string) => string; sel: Record<string, string | undefined>; depth?: number;
}) {
  if (!nodes.length) {
    return depth === 0
      ? <NoData msg="No category on any complaint in view. The part and MOC levels read complaint_parts, which page 2 fills in." />
      : null;
  }
  const max = Math.max(...nodes.map(n => n.count), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {nodes.map(n => {
        const on = sel[n.filter] === n.value;
        return (
          <div key={`${n.filter}:${n.value}`}>
            <a href={href(n.filter, n.value)}
              title={`${n.label}: ${n.count} complaint${n.count === 1 ? '' : 's'}${n.open ? `, ${n.open} open` : ''}`}
              style={{ ...ROW, paddingLeft: depth * 14, opacity: sel[n.filter] && !on ? 0.45 : 1, outline: on ? '2px solid var(--accent)' : 'none' }}>
              <span style={{ ...LBL, flex: '0 1 160px', fontWeight: depth === 0 ? 600 : 400, color: depth === 0 ? 'var(--fg)' : 'var(--fg-2)' }}>
                {depth > 0 && <span style={{ color: 'var(--fg-4)', marginRight: 4 }}>└</span>}{n.label}
              </span>
              <div style={{ flex: 1, minWidth: 30, height: depth === 0 ? 11 : 7, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(n.count / max) * 100}%`, height: '100%', background: `color-mix(in oklab, var(--accent) ${60 - depth * 12}%, transparent)` }} />
              </div>
              <span style={{ ...NUM, width: 28, fontSize: depth === 0 ? 11 : 10.5 }}>{n.count}</span>
              <span style={{ ...NUM, width: 26, fontSize: 10.5, color: n.open ? 'var(--warn)' : 'var(--fg-4)' }}>{n.open || '·'}</span>
            </a>
            {n.children.length > 0 && <Drill nodes={n.children} href={href} sel={sel} depth={depth + 1} />}
          </div>
        );
      })}
      {depth === 0 && (
        <div style={{ display: 'flex', fontSize: 9.5, color: 'var(--fg-3)', marginTop: 2 }}>
          <span style={{ marginLeft: 'auto' }}>total · open</span>
        </div>
      )}
    </div>
  );
}

// ── Clients: how many complaints each account has raised ───────

function Clients({ rows, href, selected }: { rows: ClientBar[]; href: (v: string) => string; selected?: string }) {
  if (!rows.length) return <NoData msg="No complaints against a client yet." />;
  const max = Math.max(...rows.map(r => r.count), 1);
  const any = !!selected;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(r => {
        const on = selected === r.key;
        return (
          <a key={r.key} href={href(r.key)} style={{ ...ROW, opacity: any && !on ? 0.4 : 1, outline: on ? '2px solid var(--accent)' : 'none' }}
            title={`${r.label}${r.code ? ` (${r.code})` : ''}: ${r.count} complaint${r.count === 1 ? '' : 's'}${r.open ? ` · ${r.open} open` : ' · all closed'}${r.overdue ? ` · ${r.overdue} overdue` : ''}${r.repeats ? ` · ${r.repeats} flagged as a repeat` : ''} · last raised ${r.last || 'unknown'}`}>
            <span style={{ ...LBL, flex: '0 1 230px' }}>{r.label}</span>
            <div style={{ flex: 1, minWidth: 40, height: 14, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
              {r.overdue > 0 && <div style={{ width: `${(r.overdue / max) * 100}%`, background: 'var(--neg)' }} />}
              {r.open - r.overdue > 0 && <div style={{ width: `${((r.open - r.overdue) / max) * 100}%`, background: 'color-mix(in oklab, var(--warn) 60%, transparent)' }} />}
              <div style={{ width: `${((r.count - r.open) / max) * 100}%`, background: 'color-mix(in oklab, var(--pos) 40%, transparent)' }} />
            </div>
            {r.repeats > 0 && <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--neg)' }} title={`${r.repeats} flagged as a repeat of an earlier complaint`}>↻{r.repeats}</span>}
            <span style={NUM}>{r.count}</span>
            <span style={{ ...NUM, width: 30, fontSize: 10.5, color: r.open ? 'var(--warn)' : 'var(--fg-4)' }}>{r.open || '·'}</span>
          </a>
        );
      })}
      <div style={{ display: 'flex', gap: 12, fontSize: 9.5, color: 'var(--fg-3)', marginTop: 2 }}>
        <span><Swatch c="var(--neg)" /> overdue</span>
        <span><Swatch c="var(--warn)" /> open</span>
        <span><Swatch c="var(--pos)" /> closed</span>
        <span style={{ marginLeft: 'auto' }}>total · open</span>
      </div>
    </div>
  );
}

// How much of the total sits with the worst few accounts. One client with ten
// complaints is a different problem from ten clients with one each.
function Concentration({ rows, total }: { rows: ClientBar[]; total: number }) {
  if (!total || !rows.length) return <NoData msg="Nothing to count." />;
  const share = (n: number) => rows.slice(0, n).reduce((a, r) => a + r.count, 0);
  const repeatClients = rows.filter(r => r.count > 1).length;
  const lines: [string, string][] = [
    ['Top client', `${rows[0].count} of ${total} · ${Math.round((rows[0].count / total) * 100)}%`],
    ['Top 5', `${share(5)} of ${total} · ${Math.round((share(5) / total) * 100)}%`],
    ['Top 10', `${share(10)} of ${total} · ${Math.round((share(10) / total) * 100)}%`],
    ['More than one', `${repeatClients} client${repeatClients === 1 ? '' : 's'}`],
    ['Exactly one', `${rows.length - repeatClients} client${rows.length - repeatClients === 1 ? '' : 's'}`],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {lines.map(([l, v]) => (
        <div key={l} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ ...LBL, flex: 1 }}>{l}</span>
          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── Holders: open now (bar = days sitting) + historic total ────

function Holders({ rows, href, selected, person }: { rows: HolderBar[]; href: (v: string) => string; selected?: string; person?: boolean }) {
  if (!rows.length) return <NoData msg="Nothing on the workflow yet." />;
  const max = Math.max(...rows.map(r => Math.max(r.days, r.totalDays)), 1);
  const any = !!selected;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map((r, i) => {
        const key = person ? String(r.userId ?? '') : r.department;
        const on = selected === key && key !== '';
        const link = !person || r.userId != null;
        const inner = (
          <>
            <span style={{ ...LBL, flex: '0 1 130px' }} title={r.label}>{r.label}</span>
            <div style={{ flex: 1, minWidth: 40, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ height: 9, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(r.days / max) * 100}%`, height: '100%', background: i === 0 && r.days > 0 ? 'var(--neg)' : 'color-mix(in oklab, var(--accent) 60%, transparent)' }} />
              </div>
              <div style={{ height: 5, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(r.totalDays / max) * 100}%`, height: '100%', background: 'color-mix(in oklab, var(--fg-3) 45%, transparent)' }} />
              </div>
            </div>
            <span style={{ ...NUM, width: 26 }}>{r.open}</span>
            <span style={{ ...NUM, width: 40, color: r.days > 14 ? 'var(--neg)' : 'var(--fg)' }}>{fmtDays(r.days)}</span>
            <span style={{ ...NUM, width: 40, color: 'var(--fg-3)', fontWeight: 400 }}>{fmtDays(r.totalDays)}</span>
          </>
        );
        const style: CSSProperties = { ...ROW, opacity: any && !on ? 0.4 : 1, outline: on ? '2px solid var(--accent)' : 'none' };
        const title = `${r.label}: ${r.open} open now, ${fmtDays(r.days)} sitting · ${fmtDays(r.totalDays)} held in all over ${r.stretches} stretch${r.stretches === 1 ? '' : 'es'} (avg ${fmtDays(r.avgDays)})`;
        return link ? <a key={r.key} href={href(key)} style={style} title={title}>{inner}</a> : <div key={r.key} style={style} title={title}>{inner}</div>;
      })}
      <div style={{ display: 'flex', fontSize: 9.5, color: 'var(--fg-3)', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 140 }}><Swatch c="color-mix(in oklab, var(--accent) 60%, transparent)" /> sitting now <Swatch c="color-mix(in oklab, var(--fg-3) 45%, transparent)" /> held in all</span>
        <span style={{ width: 26, textAlign: 'right' }}>open</span><span style={{ width: 40, textAlign: 'right' }}>now</span><span style={{ width: 40, textAlign: 'right' }}>ever</span>
      </div>
    </div>
  );
}

// ── Two series per month ───────────────────────────────────────

function PairBars({ points, height = 100 }: { points: { key: string; label: string; raised: number; closed: number }[]; height?: number }) {
  const max = Math.max(...points.flatMap(p => [p.raised, p.closed]), 1);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: height + 36 }}>
        {points.map(p => (
          <div key={p.key} title={`${p.label}: ${p.raised} raised · ${p.closed} closed`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 2, width: '100%', alignItems: 'flex-end', height }}>
              {[['raised', p.raised, 'var(--accent)'], ['closed', p.closed, 'var(--pos)']].map(([k, n, hue]) => (
                <div key={String(k)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: n ? 'var(--fg-2)' : 'var(--fg-4)' }}>{Number(n) || ''}</span>
                  <div style={{ width: '100%', height: Math.max((Number(n) / max) * (height - 14), n ? 3 : 0), background: `color-mix(in oklab, ${hue} 22%, transparent)`, borderTop: `3px solid ${hue}`, borderRadius: '3px 3px 0 0' }} />
                </div>
              ))}
            </div>
            <span style={{ fontSize: 9.5, color: 'var(--fg-3)' }}>{p.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 9.5, color: 'var(--fg-3)', marginTop: 4 }}>
        <span><Swatch c="var(--accent)" /> raised</span><span><Swatch c="var(--pos)" /> closed</span>
      </div>
    </div>
  );
}

const Swatch = ({ c }: { c: string }) => <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c, marginRight: 3, verticalAlign: 'middle' }} />;

const PANEL: CSSProperties = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' };
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'inherit', outlineOffset: 2, borderRadius: 4 };
const LBL: CSSProperties = { minWidth: 0, fontSize: 11, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const NUM: CSSProperties = { width: 34, flexShrink: 0, textAlign: 'right', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' };
