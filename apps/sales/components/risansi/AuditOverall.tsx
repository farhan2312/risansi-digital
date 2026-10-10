import type { CSSProperties } from 'react';
import Link from 'next/link';
import type { OverallData } from '@/lib/risansi-audit-overall';
import { OVERALL_WINDOWS } from '@/lib/risansi-audit-overall';
import { AuditDrilldownProvider, DrillTile } from './AuditDrilldown';
import { AuditPeopleTable, COL_HELP } from './AuditTables';
import type { DrillKind } from '@/app/actions/risansi-audit-drilldown';

// The people table moved to AuditTables, which is a client island, so its
// columns can be sorted. Everything else here stays a server component: the
// charts below are static SVG and have nothing to hydrate. COL_HELP travels
// with the table it labels and is re-exported for the audit page, which also
// uses it on the Usage tab.
export { COL_HELP };

// The Overall tab, laid out as the questions get asked rather than as the tables
// happen to be shaped:
//
//   1  Is it being used, and by how many of the people who have accounts
//   2  Is that going up or down, day by day
//   3  When in the week does the work happen, and on what device
//   4  What is the application actually being used FOR
//   5  Who is doing it, measured against the size of their book
//   6  What came out of it
//   7  What is not happening that should be
//
// Charts are inline SVG rather than a library: this is a server component, the
// shapes are simple, and a charting bundle would cost more to ship than the
// eighty lines below.

const NAVY = 'var(--accent)', GREEN = 'var(--pos)', AMBER = 'var(--warn)', RED = 'var(--neg)';
const MUTED = 'var(--fg-4)';
/** A translucent wash of a token colour, for bar fills that sit under a solid edge. */
const wash = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
const cr = (n: number) => `₹${(n / 1e7).toFixed(2)} Cr`;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MODULE_LABEL: Record<string, string> = {
  pipeline: 'Opportunities', clients: 'Client 360', visits: 'Visit reports',
  field: 'Field Activity', admin: 'Admin', revenue: 'Revenue',
  complaints: 'Complaints', registry: 'Action Registry', compete: 'Competition',
  exhibitions: 'Exhibitions', mobile: 'Mobile', 'executive-review': 'Executive Review',
  Dashboard: 'Dashboard',
};

export function AuditOverall({ d, win, role, user, people, print = false }: {
  d: OverallData;
  win: string; role: string; user: string;
  /** Everyone selectable in the user filter. */
  people: { email: string; name: string }[];
  /** Drops the filter form. The print view is a snapshot of one set of
   *  filters, and a form nobody can submit is just a row of dead controls. */
  print?: boolean;
}) {
  const k = d.kpi;
  const adoptionPct = k.accounts > 0 ? Math.round((k.activeUsers / k.accounts) * 100) : 0;

  // No provider in print mode, and DrillTile then renders its children plainly.
  // Two reasons: a handout has nothing to click, and globals.css hides every
  // <button> when printing — wrapping the tiles unconditionally would have
  // deleted the whole Adoption row from the PDF.
  const Wrap = print
    ? ({ children }: { children: React.ReactNode }) => <>{children}</>
    : ({ children }: { children: React.ReactNode }) => (
        <AuditDrilldownProvider filters={{ win, role, user }}>{children}</AuditDrilldownProvider>
      );

  return (
    <Wrap>
    <div style={{ display: 'grid', gap: 14 }}>
      {!print && <Filters win={win} role={role} user={user} people={people} />}

      {/* ── 1. Is it being used ─────────────────────────────────── */}
      <Section
        title="Adoption"
        note={`${d.windowLabel}${d.from ? ` · ${d.from} to ${d.to}` : ''}`}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1, background: 'var(--line)' }}>
          <DrillTile kind="active"><Kpi label="Active users" value={`${k.activeUsers}`} sub={`of ${k.accounts} accounts · ${adoptionPct}%`} tone={adoptionPct >= 70 ? GREEN : adoptionPct >= 40 ? AMBER : RED} /></DrillTile>
          <DrillTile kind="never"><Kpi label="Never signed in" value={`${k.neverIn}`} sub="accounts with no login ever" tone={k.neverIn > 0 ? RED : GREEN} /></DrillTile>
          <DrillTile kind="dormant"><Kpi label="Dormant" value={`${k.dormant}`} sub="signed in once, nothing in 30 days" tone={k.dormant > 0 ? AMBER : GREEN} /></DrillTile>
          <DrillTile kind="sessions"><div title={COL_HELP.Sessions}><Kpi label="Sessions" value={k.sessions.toLocaleString('en-IN')} sub={`avg ${k.avgSessionMin.toFixed(0)} min each`} /></div></DrillTile>
          <DrillTile kind="hours"><div title={COL_HELP.Hours}><Kpi label="Active hours" value={k.hours.toLocaleString('en-IN')} sub={`${k.pageViews.toLocaleString('en-IN')} page views`} /></div></DrillTile>
          <DrillTile kind="records"><div title={COL_HELP.Records}><Kpi label="Records touched" value={k.records.toLocaleString('en-IN')} sub="things created, edited or deleted" tone={NAVY} /></div></DrillTile>
          <DrillTile kind="logins"><Kpi label="Sign-ins" value={k.logins.toLocaleString('en-IN')} sub={`${k.failed} failed`} tone={k.failed > k.logins * 0.15 ? AMBER : undefined} /></DrillTile>
        </div>
      </Section>

      {/* ── 2. Which way is it going ────────────────────────────── */}
      <Section
        title="Day by day"
        note="active users, hours in the app, and records touched"
      >
        <div style={{ padding: '9px 16px 0', fontSize: 11, color: 'var(--fg-3)', lineHeight: 1.5 }}>
          A <strong style={{ color: 'var(--fg-2)' }}>record touched</strong> is one write the portal
          logged — a visit filed, an opportunity moved, a client edited, a quotation uploaded, an
          action closed. Reading a screen is not one. Hours going up while this line stays flat is
          time spent without anything being written down, which is the pair worth watching.
        </div>
        <div style={{ padding: '14px 16px' }}>
          {d.daily.length < 2
            ? <Empty>Not enough days in this window to show a trend.</Empty>
            : <DailyChart rows={d.daily} />}
        </div>
      </Section>

      {/* ── 3. When, and on what ────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr)', gap: 14 }} className="r-grid-2">
        <Section title="When the work happens" note="active hours · IST · darker is busier">
          <div style={{ padding: '14px 16px' }}>
            {d.heat.length === 0 ? <Empty>No activity in this window.</Empty> : <Heatmap cells={d.heat} />}
          </div>
        </Section>
        <Section title="Desktop or phone" note="by session">
          <div style={{ padding: '14px 16px' }}>
            {d.devices.length === 0 ? <Empty>No sessions.</Empty> : <Devices rows={d.devices} />}
          </div>
        </Section>
      </div>

      {/* ── 4. What it is used for ──────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 14 }} className="r-grid-2">
        <Section title="What the time goes on" note="by module · hours, page views and how many people">
          <div style={{ padding: '14px 16px' }}>
            {d.modules.length === 0 ? <Empty>No activity in this window.</Empty> : <Modules rows={d.modules} />}
          </div>
        </Section>

        {/* Reading, editing and filing are three different kinds of use, and a
            module can look busy while nothing is written down. */}
        <Section title="Reading or writing" note="recorded actions">
          <div style={{ padding: '14px 16px' }}>
            {d.actions.length === 0 ? <Empty>Nothing recorded in this window.</Empty> : <Actions rows={d.actions} />}
          </div>
        </Section>
      </div>

      {/* ── 5. Who is doing it ──────────────────────────────────── */}
      <Section
        title="Who is doing the work"
        note="red · never signed in, or quiet over a large book · amber · dormant, nothing in 30 days"
      >
        <AuditPeopleTable rows={d.people} print={print} />
      </Section>

      {/* ── 6. What came out of it ──────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr)', gap: 14 }} className="r-grid-2">
        <Section title="What was produced" note={`${d.windowLabel.toLowerCase()} · credited to whoever created the record`}>
          <div style={{ padding: '6px 0' }}>
            {d.output.map(o => (
              <div key={o.label} style={OUT_ROW}>
                <span style={{ fontSize: 12.5 }}>{o.label}</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: o.n > 0 ? 'var(--fg)' : 'var(--fg-4)' }}>
                  {o.n.toLocaleString('en-IN')}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Where those opportunities stand now" note="opportunities raised in this window, by the stage they have reached">
          <div style={{ padding: '14px 16px' }}>
            {d.funnel.length === 0 ? <Empty>No opportunities raised in this window.</Empty> : <Funnel rows={d.funnel} />}
          </div>
        </Section>
      </div>

      {/* ── 7. What is not happening ────────────────────────────── */}
      <Section title="Needs attention" note="current state, not limited to the window above">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 1, background: 'var(--line)' }}>
          {d.attention.map(a => (
            <DrillTile key={a.label} kind={ATTENTION_KIND[a.label] ?? 'unowned'}>
              <div style={{ background: 'var(--bg-paper)', padding: '13px 15px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 21, fontWeight: 700, color: a.n === 0 ? GREEN : a.tone === 'neg' ? RED : AMBER }}>
                  {a.n.toLocaleString('en-IN')}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{a.label}</div>
                <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 1 }}>{a.detail}</div>
              </div>
            </DrillTile>
          ))}
        </div>
      </Section>
    </div>
    </Wrap>
  );
}

/** Attention tile label → the list behind it. Keyed on the label the query
 *  returns, so adding a tile without a list here is visible rather than silent. */
const ATTENTION_KIND: Record<string, DrillKind> = {
  'Clients with no owner': 'unowned',
  'Overdue actions': 'overdue',
  'Open complaints': 'complaints',
  'Active clients never visited': 'unvisited',
  'Opportunities quoted over 60 days': 'stale_quotes',
};

// ── Filters ───────────────────────────────────────────────────────

function Filters({ win, role, user, people }: {
  win: string; role: string; user: string; people: { email: string; name: string }[];
}) {
  const active = (win !== '30d') || role || user;
  return (
    <form method="GET" style={{
      display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
      padding: '10px 14px', background: 'var(--bg-elev)',
      border: '1px solid var(--line)', borderRadius: 'var(--radius)',
    }}>
      <input type="hidden" name="tab" value="overall" />
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)' }}>
        Filter
      </span>
      <select name="win" defaultValue={win} style={SEL} aria-label="Time window">
        {OVERALL_WINDOWS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
      </select>
      <select name="role" defaultValue={role} style={SEL} aria-label="Role">
        <option value="">All roles</option>
        {['rep', 'manager', 'admin', 'sysadmin'].map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <select name="user" defaultValue={user} style={{ ...SEL, minWidth: 190 }} aria-label="User">
        <option value="">Everyone</option>
        {people.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
      </select>
      <button type="submit" style={{
        padding: '7px 15px', fontSize: 12.5, fontWeight: 600, background: NAVY,
        color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
      }}>Apply</button>
      <button
        type="submit" formAction="/print/portal-overall" formTarget="_blank"
        title="Opens a print view of this page with the filters as they are set here"
        style={{
          padding: '7px 15px', fontSize: 12.5, fontWeight: 600, background: 'transparent',
          color: NAVY, border: `1px solid ${NAVY}`, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >⭳ PDF of this view</button>
      {active && (
        <Link href="/risansi/admin/audit?tab=overall" style={{ fontSize: 12, color: 'var(--fg-3)' }}>Reset</Link>
      )}
    </form>
  );
}

// ── 2. The daily curve ────────────────────────────────────────────
// Hours as an area, records as a line on their own scale, users as a number on
// hover. Two scales on one chart is usually a way to imply a relationship that
// is not there — here it is the point: time spent that produces no records is
// exactly what this tab exists to surface.

function DailyChart({ rows }: { rows: OverallData['daily'] }) {
  const W = 1000, H = 190, padL = 38, padR = 40, padB = 26, padT = 12;
  const maxH = Math.max(...rows.map(r => r.hours), 1);
  const maxR = Math.max(...rows.map(r => r.records), 1);
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(rows.length - 1, 1);
  const yH = (v: number) => H - padB - (v / maxH) * (H - padB - padT);
  const yR = (v: number) => H - padB - (v / maxR) * (H - padB - padT);

  const area = `M ${x(0)} ${H - padB} ` + rows.map((r, i) => `L ${x(i)} ${yH(r.hours)}`).join(' ') + ` L ${x(rows.length - 1)} ${H - padB} Z`;
  const line = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${yR(r.records)}`).join(' ');
  // Enough labels to read the axis, not so many they collide.
  const step = Math.max(1, Math.ceil(rows.length / 12));

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
        aria-label="Active hours and records touched per day">
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <line key={t} x1={padL} x2={W - padR} y1={padT + t * (H - padB - padT)} y2={padT + t * (H - padB - padT)}
            stroke="var(--line)" strokeWidth="1" />
        ))}
        <path d={area} fill={wash(NAVY, 14)} />
        <path d={rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${yH(r.hours)}`).join(' ')}
          fill="none" stroke={NAVY} strokeWidth="2" />
        <path d={line} fill="none" stroke={AMBER} strokeWidth="1.8" strokeDasharray="4 3" />
        {rows.map((r, i) => (
          <g key={r.d}>
            <circle cx={x(i)} cy={yH(r.hours)} r="2.5" fill={NAVY} />
            <title>{`${r.d} — ${r.users} user${r.users === 1 ? '' : 's'}, ${r.hours}h, ${r.records} records`}</title>
          </g>
        ))}
        {rows.filter((_, i) => i % step === 0).map((r, j) => (
          <text key={r.d} x={x(j * step)} y={H - 8} fontSize="10" fill="var(--fg-3)" textAnchor="middle">
            {r.d.slice(5)}
          </text>
        ))}
        <text x={4} y={padT + 8} fontSize="10" fill={NAVY} fontWeight="600">{maxH}h</text>
        <text x={W - padR + 6} y={padT + 8} fontSize="10" fill={AMBER} fontWeight="600">{maxR}</text>
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--fg-3)', marginTop: 6 }}>
        <Legend colour={NAVY} label="Active hours" />
        <Legend colour={AMBER} label="Records touched" dashed />
        <span style={{ marginLeft: 'auto' }}>hover a point for that day&apos;s users</span>
      </div>
    </>
  );
}

// ── 3. Hour × weekday ─────────────────────────────────────────────

function Heatmap({ cells }: { cells: OverallData['heat'] }) {
  const map = new Map(cells.map(c => [`${c.dow}|${c.hour}`, c.hours]));
  const max = Math.max(...cells.map(c => c.hours), 0.01);
  // Office hours plus a margin either side. Showing all 24 wastes half the width
  // on a band that is empty in every real week.
  const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);   // 06:00–21:00
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            {HOURS.map(h => (
              <th key={h} style={{ fontSize: 9, fontWeight: 500, color: 'var(--fg-3)', paddingBottom: 3 }}>
                {h % 3 === 0 ? h : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 0].map(dow => (
            <tr key={dow}>
              <td style={{ fontSize: 10, color: 'var(--fg-3)', paddingRight: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {DOW[dow]}
              </td>
              {HOURS.map(h => {
                const v = map.get(`${dow}|${h}`) ?? 0;
                const t = v / max;
                return (
                  <td key={h} title={`${DOW[dow]} ${String(h).padStart(2, '0')}:00 — ${v.toFixed(1)}h`}
                    style={{
                      width: 20, height: 18, borderRadius: 3,
                      background: v === 0 ? 'var(--bg-sunk)' : NAVY,
                      opacity: v === 0 ? 1 : Number((0.14 + t * 0.86).toFixed(3)),
                    }} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--fg-3)', marginTop: 8 }}>
        <span>less</span>
        {[0.12, 0.35, 0.55, 0.75, 1].map(t => (
          <span key={t} style={{ width: 16, height: 10, borderRadius: 2, background: NAVY, opacity: t }} />
        ))}
        <span>more</span>
        <span style={{ marginLeft: 'auto' }}>hover a cell for the hours</span>
      </div>
    </div>
  );
}

// ── 3b. Device split ──────────────────────────────────────────────

function Devices({ rows }: { rows: OverallData['devices'] }) {
  const total = rows.reduce((s, r) => s + r.sessions, 0) || 1;
  const COLOURS: Record<string, string> = { Desktop: NAVY, Mobile: GREEN, Unknown: MUTED };
  let acc = 0;
  const R = 52, C = 66, STROKE = 20, circ = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <svg viewBox="0 0 132 132" style={{ width: 118, height: 118, flexShrink: 0 }} role="img" aria-label="Sessions by device">
        {rows.map(r => {
          const frac = r.sessions / total;
          const dash = `${frac * circ} ${circ}`;
          const rot = (acc * 360) - 90;
          acc += frac;
          return (
            <circle key={r.kind} cx={C} cy={C} r={R} fill="none"
              stroke={COLOURS[r.kind] ?? MUTED} strokeWidth={STROKE}
              strokeDasharray={dash} transform={`rotate(${rot} ${C} ${C})`}>
              <title>{`${r.kind} — ${r.sessions} sessions, ${r.hours}h`}</title>
            </circle>
          );
        })}
        <text x={C} y={C - 2} textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--fg)">
          {Math.round(((rows.find(r => r.kind === 'Mobile')?.sessions ?? 0) / total) * 100)}%
        </text>
        <text x={C} y={C + 14} textAnchor="middle" fontSize="9" fill="var(--fg-3)">on mobile</text>
      </svg>
      <div style={{ display: 'grid', gap: 5, minWidth: 118 }}>
        {rows.map(r => (
          <div key={r.kind} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: COLOURS[r.kind] ?? MUTED, flexShrink: 0 }} />
            <span>{r.kind}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
              {r.sessions} · {r.hours}h
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 4. Modules ────────────────────────────────────────────────────

function Modules({ rows }: { rows: OverallData['modules'] }) {
  const max = Math.max(...rows.map(r => r.hours), 0.1);
  const total = rows.reduce((s, r) => s + r.hours, 0) || 1;
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {rows.slice(0, 12).map(r => (
        <div key={r.module} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 128, flexShrink: 0, fontSize: 12, fontWeight: 500 }}>
            {MODULE_LABEL[r.module] ?? r.module}
          </span>
          <div style={{ flex: 1, height: 18, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden', minWidth: 60 }}>
            <div style={{
              height: '100%', width: `${Math.max((r.hours / max) * 100, 1.5)}%`,
              background: NAVY, borderRadius: 4,
            }} />
          </div>
          <span style={{ width: 54, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 600 }}>
            {r.hours}h
          </span>
          <span style={{ width: 42, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-3)' }}>
            {Math.round((r.hours / total) * 100)}%
          </span>
          <span style={{ width: 74, flexShrink: 0, textAlign: 'right', fontSize: 10.5, color: 'var(--fg-3)' }}>
            {r.users} {r.users === 1 ? 'person' : 'people'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 4b. The shape of the writing ──────────────────────────────────

function Actions({ rows }: { rows: OverallData['actions'] }) {
  const total = rows.reduce((s, r) => s + r.n, 0) || 1;
  const max = Math.max(...rows.map(r => r.n), 1);
  // create/submit is new information; update is maintenance; delete and export
  // are worth being able to see on their own.
  const TONE: Record<string, string> = {
    create: GREEN, submit: GREEN, assign: NAVY, update: NAVY,
    export: AMBER, delete: RED, activity: MUTED,
  };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map(r => (
        <div key={r.action} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 62, flexShrink: 0, fontSize: 11.5, fontWeight: 500 }}>{r.action}</span>
          <div style={{ flex: 1, height: 14, background: 'var(--bg-sunk)', borderRadius: 3, overflow: 'hidden', minWidth: 30 }}>
            <div style={{ height: '100%', width: `${Math.max((r.n / max) * 100, 2)}%`, background: TONE[r.action] ?? MUTED }} />
          </div>
          <span style={{ width: 46, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
            {r.n.toLocaleString('en-IN')}
          </span>
          <span style={{ width: 32, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-3)' }}>
            {Math.round((r.n / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 6. Funnel ─────────────────────────────────────────────────────

function Funnel({ rows }: { rows: OverallData['funnel'] }) {
  // The line an opportunity travels, so the bars read as a journey rather than
  // as an alphabetical list of stages.
  const ORDER = ['Prospect', 'Suspect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped'];
  const TONE: Record<string, string> = {
    Won: GREEN, Lost: RED, Dropped: MUTED, 'On Hold': AMBER,
    Quoted: NAVY, Negotiating: NAVY, Prospect: 'var(--fg-3)', Suspect: MUTED,
  };
  const sorted = ORDER.map(s => rows.find(r => r.stage === s)).filter(Boolean) as OverallData['funnel'];
  const max = Math.max(...sorted.map(r => r.n), 1);
  const total = sorted.reduce((s, r) => s + r.n, 0);
  const won = sorted.find(r => r.stage === 'Won')?.n ?? 0;
  const lost = sorted.find(r => r.stage === 'Lost')?.n ?? 0;

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {sorted.map(r => (
        <div key={r.stage} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 88, flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: TONE[r.stage] }}>{r.stage}</span>
          <div style={{ flex: 1, height: 16, background: 'var(--bg-sunk)', borderRadius: 4, overflow: 'hidden', minWidth: 40 }}>
            <div style={{ height: '100%', width: `${Math.max((r.n / max) * 100, 2)}%`, background: wash(TONE[r.stage], 20), borderLeft: `3px solid ${TONE[r.stage]}` }} />
          </div>
          <span style={{ width: 34, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 600 }}>{r.n}</span>
          <span style={{ width: 84, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-3)' }}>
            {r.value > 0 ? cr(r.value) : '—'}
          </span>
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
        {total} raised · {won + lost > 0
          ? `${Math.round((won / (won + lost)) * 100)}% of the ${won + lost} decided were won`
          : 'none decided yet'}
      </div>
    </div>
  );
}

// ── shared ────────────────────────────────────────────────────────

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    // ov-panel is what the print route targets to keep the outline while
    // stripping the border the global print stylesheet would otherwise add to
    // every rounded element on the page, mini-bars and heat cells included.
    <div style={PANEL} className="ov-panel">
      <div style={{ padding: '11px 15px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--title)' }}>{title}</span>
        {note && <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 'auto' }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div style={{ background: 'var(--bg-paper)', padding: '13px 15px' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 23, fontWeight: 700, color: tone ?? 'var(--fg)', lineHeight: 1.15, marginTop: 3 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Legend({ colour, label, dashed }: { colour: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 14, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${colour}` }} />
      {label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '22px 4px', textAlign: 'center', fontSize: 12.5, color: 'var(--fg-3)' }}>{children}</div>;
}

const PANEL: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)', overflow: 'hidden',
};
const SEL: CSSProperties = {
  padding: '6px 10px', fontSize: 12.5, fontFamily: 'inherit', background: 'var(--bg-paper)',
  border: '1px solid var(--line-strong)', borderRadius: 6, color: 'var(--fg)', cursor: 'pointer',
};
const OUT_ROW: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '8px 15px', borderBottom: '1px solid var(--line-2)',
};
