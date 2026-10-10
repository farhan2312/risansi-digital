import type { CSSProperties } from 'react';
import Link from 'next/link';

// Month / Quarter calendar for Field Activity. Each day box holds *every* rep's
// visits for that day, colour-coded by rep (the week grid stays as a separate
// view). `month` renders one full-detail grid; `quarter` renders three compact
// month grids side by side (dots instead of chips — a zoomed-out load view).

export interface CalDayVisit {
  id:          string;
  visit_date:  string;   // 'YYYY-MM-DD'
  status:      string;
  purpose:     string;
  client_name: string;
  client_code: string;
  rep_id:      string;
  rep_name:    string;
}

/**
 * An exhibition a team member is attending, as one block spanning its whole run.
 *
 * One entry per exhibition, not per attendee: a five-person exhibition would
 * otherwise put five identical chips in a day cell that only shows three visits
 * before it starts collapsing into "+N more". The attendees ride along so the
 * block can name them.
 */
export interface CalExhibition {
  id:         string;
  name:       string;
  venue:      string | null;
  city:       string | null;
  start_date: string;   // 'YYYY-MM-DD', inclusive
  end_date:   string;   // 'YYYY-MM-DD', inclusive
  /** Everyone on the team, including members this viewer cannot otherwise see. */
  team_size:  number;
  /** The attendees this viewer may see — a subset of team_size. */
  reps:       { id: string; name: string }[];
}

// Distinct, reasonably distinguishable hues. Reps map to a colour by their index
// in the (stable, name-sorted) colour basis, cycling if there are more than 16.
const REP_PALETTE = [
  '#2563EB', '#0E9F6E', '#D97706', '#7C3AED', '#DB2777', '#0891B2',
  '#65A30D', '#DC2626', '#4F46E5', '#EA580C', '#0D9488', '#9333EA',
  '#CA8A04', '#E11D48', '#0369A1', '#15803D',
];

// Everything the block cannot fit: where it is, how long it runs, and who is
// there. The names matter most — the block says a day is not free, and the next
// question is always "whose day".
function exTitle(ex: CalExhibition): string {
  const place = [ex.venue, ex.city].filter(Boolean).join(', ');
  const when  = ex.start_date === ex.end_date ? ex.start_date : `${ex.start_date} to ${ex.end_date}`;
  // team_size is the real headcount; ex.reps is only those this viewer may see.
  // Naming the difference is better than quietly reporting the smaller number to
  // the one person trying to work out who is available.
  const total = ex.team_size || ex.reps.length;
  const named = ex.reps.map(r => r.name).join(', ');
  const who   = !total ? ''
    : ex.reps.length >= total ? `${total} attending: ${named}`
    : named ? `${total} attending, ${ex.reps.length} you can see: ${named}`
    : `${total} attending`;
  return [ex.name, place, when, who].filter(Boolean).join(' · ');
}

const pad2  = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Weeks (Mon-first) covering `m0` (0-indexed month) of `year`, including the
// leading/trailing days from adjacent months so every row is full. Trailing
// all-other-month weeks are trimmed.
function monthWeeks(year: number, m0: number) {
  const first    = new Date(year, m0, 1);
  const startOff = (first.getDay() + 6) % 7;              // 0 = Mon
  const start    = new Date(year, m0, 1 - startOff);
  const weeks: { date: string; dayNum: number; om: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const days: { date: string; dayNum: number; om: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const dd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      days.push({ date: isoOf(dd), dayNum: dd.getDate(), om: dd.getMonth() !== m0 });
    }
    weeks.push(days);
  }
  while (weeks.length > 4 && weeks[weeks.length - 1].every(x => x.om)) weeks.pop();
  return weeks;
}

const WD_FULL  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function FieldMonthCalendar({
  view, months, visits, reps, todayISO, purposeColors, exhibitions = [],
}: {
  view:          'month' | 'quarter';
  months:        { year: number; month: number; label: string }[];
  visits:        CalDayVisit[];
  reps:          { id: string; name: string }[];   // stable colour basis
  todayISO:      string;
  purposeColors: Record<string, string>;
  exhibitions?:  CalExhibition[];
}) {
  const compact  = view === 'quarter';
  const repIndex = new Map(reps.map((r, i) => [r.id, i]));
  const repColor = (id: string) => REP_PALETTE[(repIndex.get(id) ?? 0) % REP_PALETTE.length];

  // Group visits by day, and collect the reps that actually appear (for the legend).
  const byDate = new Map<string, CalDayVisit[]>();
  const seen   = new Map<string, string>();   // rep_id → rep_name
  for (const v of visits) {
    const arr = byDate.get(v.visit_date) ?? [];
    arr.push(v);
    byDate.set(v.visit_date, arr);
    if (v.rep_id) seen.set(v.rep_id, v.rep_name);
  }
  const legendReps = [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Exhibition runs expanded to the days they cover. Done by walking the ISO
  // dates rather than by date arithmetic on the strings, so a run crossing a
  // month or year boundary needs no special case. Capped at a year of days per
  // exhibition purely so a bad end_date cannot spin here forever.
  const exByDate = new Map<string, CalExhibition[]>();
  for (const ex of exhibitions) {
    if (!ex.start_date || !ex.end_date || ex.end_date < ex.start_date) continue;
    const [sy, sm, sd] = ex.start_date.split('-').map(Number);
    const cur = new Date(sy, sm - 1, sd);
    for (let guard = 0; guard < 370; guard++) {
      const iso = isoOf(cur);
      if (iso > ex.end_date) break;
      const arr = exByDate.get(iso) ?? [];
      arr.push(ex);
      exByDate.set(iso, arr);
      cur.setDate(cur.getDate() + 1);
    }
  }
  const anyExhibitions = exByDate.size > 0;

  const cellCap = compact ? 6 : 3;

  const renderMonth = (mo: { year: number; month: number; label: string }) => (
    <div key={`${mo.year}-${mo.month}`}>
      {compact && (
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>{mo.label}</div>
      )}
      <div style={{
        background: 'var(--bg-paper)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', overflow: 'hidden',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid var(--line)' }}>
          {WD_FULL.map(d => (
            <div key={d} style={{
              padding: compact ? '5px 4px' : '7px 6px', textAlign: 'center',
              fontSize: 10, fontWeight: 600, color: 'var(--fg-3)',
              textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg-elev)',
            }}>
              {compact ? d[0] : d}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {monthWeeks(mo.year, mo.month).flat().map(day => {
            const dv      = byDate.get(day.date) ?? [];
            const dex     = exByDate.get(day.date) ?? [];
            const isToday = day.date === todayISO;
            return (
              <div key={day.date} style={{
                minHeight: compact ? 46 : 98,
                // Grid items default to min-width:auto, so a long non-wrapping
                // client name would widen its column past 1fr and push the day
                // cells out of line with the weekday header. Pin it to 0.
                minWidth: 0, overflow: 'hidden',
                borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)',
                padding: compact ? '3px 4px' : '4px 5px',
                background: day.om ? 'var(--bg-elev)' : 'var(--bg-paper)',
                display: 'flex', flexDirection: 'column', gap: compact ? 2 : 3,
                opacity: day.om ? 0.55 : 1,
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 600, alignSelf: 'flex-end', lineHeight: 1.4,
                  color: day.om ? 'var(--fg-3)' : 'var(--fg-2)',
                }}>
                  {isToday
                    ? <span style={{ background: 'var(--accent-fill)', color: 'var(--on-accent)', borderRadius: 999, padding: '0 6px' }}>{day.dayNum}</span>
                    : day.dayNum}
                </div>

                {/* Exhibitions sit above the visits and outside the visit cap.
                    Being away is the fact that frames the whole day, and it must
                    not be the thing pushed under a "+2 more" by a busy day. */}
                {dex.map(ex => (
                  <div key={`ex-${ex.id}`} title={exTitle(ex)} style={{
                    background: 'var(--purple-soft)', color: 'var(--purple)',
                    borderRadius: 3, padding: compact ? '1px 3px' : '2px 5px',
                    fontSize: compact ? 8.5 : 10.5, fontWeight: 700, lineHeight: 1.45,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <span aria-hidden style={{ flexShrink: 0 }}>&#9635;</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ex.name}</span>
                    {!compact && (ex.team_size || ex.reps.length) > 1 && (
                      <span style={{ marginLeft: 'auto', flexShrink: 0, fontWeight: 600, opacity: 0.85 }}>
                        {ex.team_size || ex.reps.length}
                      </span>
                    )}
                  </div>
                ))}

                {compact ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignContent: 'flex-start' }}>
                    {dv.slice(0, cellCap).map(v => (
                      <Link key={v.id} href={`/risansi/visits/${v.id}`} aria-label={`${v.client_name} — ${v.rep_name}`}
                        title={`${v.client_name} · ${v.rep_name}`} style={{
                        width: 8, height: 8, borderRadius: 999, background: repColor(v.rep_id), flexShrink: 0,
                      }} />
                    ))}
                    {dv.length > cellCap && (
                      <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--fg-3)', lineHeight: '8px' }}>+{dv.length - cellCap}</span>
                    )}
                  </div>
                ) : (
                  <>
                    {dv.slice(0, cellCap).map(v => (
                      <Link key={v.id} href={`/risansi/visits/${v.id}`}
                        title={`${v.client_name} · ${v.rep_name} · ${v.purpose || 'Routine'}`}
                        style={{
                          borderLeft: `3px solid ${repColor(v.rep_id)}`, background: 'var(--bg-elev)',
                          padding: '2px 5px', overflow: 'hidden',
                          display: 'block', textDecoration: 'none', color: 'inherit',
                        }}>
                        <div style={{
                          fontSize: 12, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 4,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: 999, flexShrink: 0,
                            background: purposeColors[v.purpose] ?? 'var(--fg-3)',
                          }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.client_name}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--fg-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {v.rep_name}
                        </div>
                      </Link>
                    ))}
                    {dv.length > cellCap && (
                      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--brand-blue)', paddingLeft: 2 }}>+{dv.length - cellCap} more</div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const gridStyle: CSSProperties = compact
    ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }
    : { display: 'block' };

  return (
    <div>
      <div style={gridStyle}>
        {months.map(renderMonth)}
      </div>

      {(legendReps.length > 0 || anyExhibitions) && (
        <div style={{
          marginTop: 12, padding: '10px 14px', background: 'var(--bg-elev)',
          border: '1px solid var(--line)', borderRadius: 'var(--radius)',
          display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center',
        }}>
          {legendReps.length > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Reps</span>
          )}
          {legendReps.map(r => (
            <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-2)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: repColor(r.id), flexShrink: 0 }} />
              {r.name}
            </span>
          ))}
          {anyExhibitions && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-2)' }}>
              <span style={{
                width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                background: 'var(--purple-soft)', border: '1px solid var(--purple)',
              }} />
              at an exhibition
            </span>
          )}
          {legendReps.length > 0 && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--fg-3)' }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--fg-3)', flexShrink: 0 }} />
              dot = visit purpose
            </span>
          )}
        </div>
      )}
    </div>
  );
}
