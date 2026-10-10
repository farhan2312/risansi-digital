import { ChartPanel, StageKpi, NoData } from '@/components/risansi/StageCharts';
import type { ActionSummary, OwnerBar } from '@/lib/risansi-action-stats';

// The dashboard above the Action Registry's All actions list.
//
// Server-rendered from summariseActions — no client state. The owner and
// priority rows are links into the list's own filters (?resp=, ?priority=), so
// clicking a bar narrows the list below the way the stage dashboards do; the
// caller supplies the hrefs because it owns the URL.

const fmtDays = (d: number | null) => (d == null ? '—' : d < 1 ? '<1d' : `${d.toFixed(d >= 10 ? 0 : 1)}d`);
const fmtHours = (h: number | null) => (h == null ? '—' : h < 1 ? '<1h' : h < 48 ? `${h.toFixed(0)}h` : `${(h / 24).toFixed(1)}d`);
const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function ActionStats({ s, hrefOwner, hrefPriority, selectedOwners, selectedPriorities }: {
  s: ActionSummary;
  hrefOwner: (name: string) => string;
  hrefPriority: (p: string) => string;
  selectedOwners: string[];
  selectedPriorities: string[];
}) {
  if (!s.total) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      {/* Tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <StageKpi label="Open" value={String(s.open)} sub={`of ${s.total} · ${s.done} done`} />
        <StageKpi label="Overdue" value={String(s.overdue)}
          sub={s.overdue ? `avg ${fmtDays(s.avgOverdueBy)} past due` : 'nothing past its date'}
          color={s.overdue ? 'var(--neg)' : undefined} alert={s.overdue > 0} />
        <StageKpi label="Due in 7 days" value={String(s.dueSoon)} sub="open, dated within the week" color={s.dueSoon ? 'var(--warn, #B45309)' : undefined} />
        <StageKpi label="Avg age of open" value={fmtDays(s.avgOpenAge)}
          sub={s.oldestOpen != null ? `oldest ${s.oldestOpen}d` : undefined} />
        <StageKpi label="Avg time to close" value={fmtDays(s.avgTimeToClose)}
          sub={s.medianTimeToClose != null ? `median ${fmtDays(s.medianTimeToClose)} · ${s.done} closed` : 'nothing closed yet'} />
        <StageKpi label="Closed on time" value={pct(s.onTimeRate)}
          sub={s.onTimeBase ? `of ${s.onTimeBase} closed with a due date` : 'no dated closures yet'}
          color={s.onTimeRate == null ? undefined : s.onTimeRate >= 0.7 ? 'var(--pos)' : s.onTimeRate >= 0.4 ? 'var(--warn, #B45309)' : 'var(--neg)'} />
        <StageKpi label="Date moves" value={s.avgExtensions.toFixed(2)}
          sub={`per action · ${s.extendedCount} action${s.extendedCount === 1 ? '' : 's'} moved ${s.extensionsTotal} time${s.extensionsTotal === 1 ? '' : 's'}`}
          color={s.avgExtensions >= 1 ? 'var(--warn, #B45309)' : undefined} />
        <StageKpi label="First response" value={fmtHours(s.medianFirstResponseH)}
          sub={s.respondedCount ? `median · avg ${fmtHours(s.avgFirstResponseH)} · ${s.respondedCount} responded` : 'no updates recorded yet'} />
      </div>

      {/* Charts */}
      <div className="stage-grid-4">
        <ChartPanel title="By owner" sub={`${s.byOwner.length} people`}
          note="Open, of which overdue in red, and done. Sorted by open. Click a name to filter the list to them.">
          <StackedRows rows={s.byOwner.slice(0, 10)} hrefFor={hrefOwner} selected={selectedOwners} />
        </ChartPanel>
        <ChartPanel title="By priority" note="Click a priority to filter the list.">
          <StackedRows rows={s.byPriority} hrefFor={hrefPriority} selected={selectedPriorities} />
        </ChartPanel>
        <ChartPanel title="Open actions by age" sub={`${s.open} open`} note="Days since the action was raised. Anything past 30 days wants a look.">
          <CountBars buckets={s.openByAge} warnFrom={2} />
        </ChartPanel>
        <ChartPanel title="Raised vs closed" sub="last 6 months" note="Raised by the month it was created, closed by the month it was marked done.">
          <PairBars points={s.months} />
        </ChartPanel>
      </div>

      {s.mostExtended.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--fg-3)' }}>
          Most moved: {s.mostExtended.map((r, i) => (
            <span key={r.id}>{i > 0 ? ' · ' : ''}<span style={{ color: 'var(--fg-2)' }}>{r.client_name ?? 'no client'}</span> ×{r.extensions}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stacked horizontal rows: open (overdue as a darker red part) + done ──

function StackedRows({ rows, hrefFor, selected }: { rows: OwnerBar[]; hrefFor: (label: string) => string; selected: string[] }) {
  if (!rows.length) return <NoData msg="Nothing to show yet." />;
  const max = Math.max(...rows.map(r => r.total), 1);
  const any = selected.length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {rows.map(r => {
        const on = selected.includes(r.label);
        const w = (n: number) => `${(n / max) * 100}%`;
        const onTimeOpen = r.open - r.overdue;
        return (
          <a key={r.label} href={hrefFor(r.label)} title={`${r.label}: ${r.open} open (${r.overdue} overdue) · ${r.done} done · ${r.total} total`}
            style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'inherit', opacity: any && !on ? 0.45 : 1,
                     outline: on ? '2px solid var(--accent)' : 'none', outlineOffset: 2, borderRadius: 4 }}>
            <span style={{ width: 118, flexShrink: 0, fontSize: 11, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            <div style={{ flex: 1, height: 16, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden', display: 'flex', minWidth: 40 }}>
              {r.overdue > 0 && <div style={{ width: w(r.overdue), background: 'var(--neg)' }} />}
              {onTimeOpen > 0 && <div style={{ width: w(onTimeOpen), background: 'color-mix(in oklab, var(--accent) 55%, transparent)' }} />}
              {r.done > 0 && <div style={{ width: w(r.done), background: 'color-mix(in oklab, var(--pos) 35%, transparent)' }} />}
            </div>
            <span style={{ width: 40, flexShrink: 0, textAlign: 'right', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{r.open}</span>
            <span style={{ width: 34, flexShrink: 0, textAlign: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono)', color: r.overdue ? 'var(--neg)' : 'var(--fg-4)' }}>{r.overdue || '·'}</span>
            <span style={{ width: 34, flexShrink: 0, textAlign: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>{r.done}</span>
          </a>
        );
      })}
      <div style={{ display: 'flex', gap: 9, fontSize: 9.5, color: 'var(--fg-3)', paddingLeft: 127, marginTop: 2 }}>
        <span style={{ flex: 1 }}><Swatch c="var(--neg)" /> overdue <Swatch c="color-mix(in oklab, var(--accent) 55%, transparent)" /> open <Swatch c="color-mix(in oklab, var(--pos) 35%, transparent)" /> done</span>
        <span style={{ width: 40, textAlign: 'right' }}>open</span>
        <span style={{ width: 34, textAlign: 'right' }}>late</span>
        <span style={{ width: 34, textAlign: 'right' }}>done</span>
      </div>
    </div>
  );
}

const Swatch = ({ c }: { c: string }) => <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c, marginRight: 3, verticalAlign: 'middle' }} />;

// ── Count columns ──────────────────────────────────────────────

function CountBars({ buckets, warnFrom, height = 110 }: { buckets: { label: string; count: number }[]; warnFrom: number; height?: number }) {
  const max = Math.max(...buckets.map(b => b.count), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: height + 36 }}>
      {buckets.map((b, i) => {
        const h = Math.max((b.count / max) * height, b.count > 0 ? 3 : 0);
        const hue = i >= warnFrom ? 'var(--neg)' : 'var(--accent)';
        return (
          <div key={b.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: b.count ? 'var(--fg)' : 'var(--fg-4)' }}>{b.count}</span>
            <div style={{ width: '100%', height: h, background: `color-mix(in oklab, ${hue} 22%, transparent)`, borderTop: `3px solid ${hue}`, borderRadius: '3px 3px 0 0' }} />
            <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Two series side by side per month ──────────────────────────

function PairBars({ points, height = 110 }: { points: { key: string; label: string; raised: number; closed: number }[]; height?: number }) {
  const max = Math.max(...points.flatMap(p => [p.raised, p.closed]), 1);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: height + 36 }}>
        {points.map(p => (
          <div key={p.key} title={`${p.label}: ${p.raised} raised · ${p.closed} closed`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
            <div style={{ display: 'flex', gap: 3, width: '100%', alignItems: 'flex-end', height }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: p.raised ? 'var(--fg-2)' : 'var(--fg-4)' }}>{p.raised}</span>
                <div style={{ width: '100%', height: Math.max((p.raised / max) * (height - 14), p.raised ? 3 : 0), background: 'color-mix(in oklab, var(--accent) 22%, transparent)', borderTop: '3px solid var(--accent)', borderRadius: '3px 3px 0 0' }} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: p.closed ? 'var(--fg-2)' : 'var(--fg-4)' }}>{p.closed}</span>
                <div style={{ width: '100%', height: Math.max((p.closed / max) * (height - 14), p.closed ? 3 : 0), background: 'color-mix(in oklab, var(--pos) 22%, transparent)', borderTop: '3px solid var(--pos)', borderRadius: '3px 3px 0 0' }} />
              </div>
            </div>
            <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>{p.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 9.5, color: 'var(--fg-3)', marginTop: 4 }}>
        <span><Swatch c="var(--accent)" /> raised</span><span><Swatch c="var(--pos)" /> closed</span>
      </div>
    </div>
  );
}
