import type { CSSProperties } from 'react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { getServerSession } from 'next-auth/next';
import { Topbar, Tag, SortableTH } from '@/components/risansi';
import { MobileSortUrl } from '@/components/risansi/MobileSort';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientVisibilitySql, clientScopeSql, OWN_OPEN, orphanSql } from '@/lib/risansi-auth';
import { parseVisitFilters, getVisitFilterOptions, getScopedRepNames, getExhibitionScopeUserIds } from '@/lib/risansi-visit-filters';
import { FieldFilterBar } from '@/components/risansi/FieldFilterBar';
import { PlannedVisitsExport } from '@/components/risansi/PlannedVisitsExport';
import { IndiaMapWrapper } from '@/components/risansi/IndiaMapWrapper';
import { ClientCoverageList } from '@/components/risansi/ClientCoverageList';
import { WeekNav } from '@/components/risansi/WeekNav';
import { MonthNav } from '@/components/risansi/MonthNav';
import { QuarterNav } from '@/components/risansi/QuarterNav';
import { CalViewToggle } from '@/components/risansi/CalViewToggle';
import { FieldMonthCalendar, type CalExhibition } from '@/components/risansi/FieldMonthCalendar';
import { CALENDAR_BLOCKING_STATUSES } from '@/lib/risansi-exhibition-fields';
import { ActivitiesTab, type ActivityTask } from '@/components/risansi/ActivitiesTab';
import { AssignVisitButton } from '@/components/risansi/AssignVisitButton';
import AssignVisitDrawer, { AssignVisitRowBtn } from '@/components/risansi/AssignVisitDrawer';
import type { DrawerRep } from '@/components/risansi/AssignVisitDrawer';
import { VisitReportsTab, type VisitReportRow } from '@/components/risansi/VisitReportsTab';
import { EditVisitButton } from '@/components/risansi/EditVisitButton';

// ── Helpers ────────────────────────────────────────────────────

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  // Log before falling back — a swallowed query error otherwise renders a panel
  // as empty/zero data with no signal that anything failed.
  try { return await fn(); } catch (e) { console.error('[field] panel query failed', e); return fallback; }
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function dateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Types ──────────────────────────────────────────────────────

interface VisitFeedRow {
  id: string; visit_date: string; status: string; purpose: string | null;
  outcome: string | null; summary: string | null; performance_feedback: string | null;
  action_points: string | null;
  check_in_time: string | null; submitted_at: string | null;
  client_id: string; legal_name: string; code: string; industry: string | null;
  city: string | null; tier: string | null;
  rep_id: string; rep_name: string;
  /** The visit's rep is a stranger to the client: not owner, cover or their manager. Shown as Blocked. */
  orphan: boolean;
}

// One row per (exhibition × team member) whose run overlaps the visible window.
// Grouped into per-exhibition blocks below; the query returns the flat join so
// the attendee list comes back in the same pass.
interface ExhibitionDay {
  id: string; name: string; venue: string | null; city: string | null;
  start_date: string; end_date: string; status: string; team_size: number;
  rep_id: string; rep_name: string;
}

interface OverdueRow {
  id: string; code: string; legal_name: string;
  industry: string | null; tier: string | null; status: string;
  state: string | null; city: string | null;
  last_visit_date: string | null; days_overdue: number | null;
  rep_name: string; primary_rep_id: string | null;
}

interface CalendarVisit {
  id: string; visit_date: string; status: string; purpose: string;
  outcome: string | null;
  client_id: string; client_name: string; client_code: string;
  industry: string | null; city: string | null; tier: string | null;
  rep_id: string; rep_name: string;
}

interface MapClient {
  id: string; code: string; legal_name: string;
  industry: string | null; city: string | null; state: string | null;
  country: string | null;
  last_visit_date: string | null; days_since: number | null;
  tier: string | null; rep_name: string | null;
}

interface StatsRow {
  // Activity over the visible period — what the tiles show.
  visits: number; clients: number; completed: number; missed: number;
  // Coverage of the client base — the second tile row, and the Overdue tab.
  total_active: number; visited_90: number; overdue: number; never_visited: number;
}

// ── Constants ──────────────────────────────────────────────────

const PURPOSE_COLORS: Record<string, string> = {
  'Routine':                       '#3B82F6',
  'Quote Follow-up':               'var(--warn)',
  'Complaint Resolution':          'var(--neg)',
  'New Opportunity':               'var(--pos)',
  'Equipment Assessment':          'var(--purple)',
  'Management Relationship Visit': 'var(--title)',
};

const STATUS_BG: Record<string, string> = {
  'planned':    'var(--bg-elev)',
  'checked-in': 'var(--info-soft)',
  'completed':  'var(--pos-soft)',
  'missed':     'var(--neg-soft)',
  'cancelled':  'var(--bg-elev)',
};

// Every column the Overdue table shows, and nothing else: an unmapped ?sort=
// falls back to days_overdue rather than reaching the query.
// What the phone sort menu offers for the Overdue list, and which way each
// column opens. Reps read this tab on a handset, where the table is cards and
// the sortable header row is hidden, so without this it is stuck in one order
// on the device it is most used from. Keys must be SORT_MAP's keys — anything
// else is dropped by the whitelist and the tap would appear to do nothing.
const OVERDUE_SORT_OPTIONS = [
  { key: 'days_overdue', label: 'Days overdue' },
  { key: 'last_visit',   label: 'Last visit' },
  { key: 'name',         label: 'Client name' },
  { key: 'industry',     label: 'Industry' },
  { key: 'state',        label: 'State' },
  { key: 'tier',         label: 'Tier' },
  { key: 'rep',          label: 'Rep' },
];
const OVERDUE_SORT_KINDS = {
  days_overdue: 'number', last_visit: 'date', name: 'text',
  industry: 'text', state: 'text', tier: 'text', rep: 'text',
} as const;

const SORT_MAP: Record<string, string> = {
  name:         'c.legal_name',
  industry:     'c.industry',
  state:        'c.state',
  tier:         'c.tier',
  // Never visited is the extreme of both of these, not a gap in them: the
  // Overdue tab exists to surface exactly those accounts, and sorting them as
  // absences dropped them to the bottom of the list they most belong at the top
  // of. Ordering off a floor date makes "never" read as longest-overdue, while
  // the SELECT still returns NULL so the cell still says Never.
  days_overdue: `(CURRENT_DATE - COALESCE(c.last_visit_date, DATE '0001-01-01'))`,
  last_visit:   `COALESCE(c.last_visit_date, DATE '0001-01-01')`,
  rep:          'rep_name',
};

// ── Page ───────────────────────────────────────────────────────

export default async function FieldActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  const role    = session?.user?.role ?? 'rep';
  const isRep   = role === 'rep';

  // On phones, drop Calendar & Map and default to the Visit Feed.
  const ua = (await headers()).get('user-agent') ?? '';
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(ua);

  const sp         = await searchParams;
  let   tab        = typeof sp.tab  === 'string' ? sp.tab  : (isMobile ? 'feed' : 'calendar');
  if (isMobile && (tab === 'calendar' || tab === 'map')) tab = 'feed';
  const feedTab    = typeof sp.feed === 'string' ? sp.feed : 'today';
  const sortKey    = typeof sp.sort === 'string' ? sp.sort : 'days_overdue';
  const sortDir    = sp.dir === 'asc' ? 'ASC' : 'DESC';
  const curDir     = sortDir === 'ASC' ? 'asc' as const : 'desc' as const;

  // Server-side date-range filters — Visit Feed (ffrom/fto) and Visit Reports
  // (rfrom/rto). Both queries are LIMITed, so the range scopes the query itself.
  const isoDate  = (v: unknown): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const feedFrom = isoDate(sp.ffrom), feedTo = isoDate(sp.fto);
  const repFrom  = isoDate(sp.rfrom), repTo  = isoDate(sp.rto);
  // Visit Reports search + purpose (server-side, driven from the shared filter bar).
  const repSearch  = (typeof sp.rsearch  === 'string' ? sp.rsearch  : '').trim();
  const repPurpose =  typeof sp.rpurpose === 'string' ? sp.rpurpose : '';
  const sortCol    = SORT_MAP[sortKey] ?? 'days_overdue';
  const weekOffset  = parseInt(typeof sp.week  === 'string' ? sp.week  : '0', 10) || 0;
  const monthOffset = parseInt(typeof sp.month === 'string' ? sp.month : '0', 10) || 0;

  // ── Date range computation ───────────────────────────────────

  // Compute "today" in IST so week/month bounds match the business timezone,
  // not the server's UTC clock (e.g. June 4 late-night UTC = June 5 IST).
  // dateStr() reads local date parts, so the IST-shifted Date yields IST dates.
  const todayDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const todayISO  = dateStr(todayDate);

  // Week bounds (for admin calendar)
  const dow  = todayDate.getDay();
  const mon  = new Date(todayDate);
  mon.setDate(todayDate.getDate() - (dow === 0 ? 6 : dow - 1) + weekOffset * 7);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const weekStart = dateStr(mon);
  const weekEnd   = dateStr(sun);
  // Exclusive upper bound for the query = Monday of NEXT week (mon + 7).
  // Using weekEnd (Sunday) with `< weekEnd` silently dropped all Sunday visits.
  const nextMon = new Date(mon);
  nextMon.setDate(mon.getDate() + 7);
  const weekEndExclusive = dateStr(nextMon);
  const weekLabel = `${mon.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${sun.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const weekDays  = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    const ds = dateStr(d);
    return {
      date:    ds,
      label:   d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
      isToday: ds === todayISO,
    };
  });

  // Month bounds (for rep calendar)
  const mDate     = new Date(todayDate.getFullYear(), todayDate.getMonth() + monthOffset, 1);
  const mNext     = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 1);
  const monthStart = dateStr(mDate);
  const monthEnd   = dateStr(mNext);
  const monthLabel = mDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  // ── Calendar view (week / month / quarter) ───────────────────
  const calViewRaw = typeof sp.cal === 'string' ? sp.cal : '';
  const calView: 'week' | 'month' | 'quarter' =
    calViewRaw === 'month' || calViewRaw === 'quarter' || calViewRaw === 'week'
      ? calViewRaw
      : (isRep ? 'month' : 'week');
  const quarterOffset = parseInt(typeof sp.q === 'string' ? sp.q : '0', 10) || 0;

  // Visible grid bounds for a month: Monday before the 1st … day after the last
  // Sunday (exclusive), so leading/trailing cells from adjacent months show visits too.
  const gridBounds = (y: number, m: number): [string, string] => {
    const first    = new Date(y, m, 1);
    const startOff = (first.getDay() + 6) % 7;              // 0 = Mon
    const gStart   = new Date(y, m, 1 - startOff);
    const last     = new Date(y, m + 1, 0);
    const endOff   = 6 - ((last.getDay() + 6) % 7);
    const gEnd     = new Date(y, m, last.getDate() + endOff + 1);   // exclusive
    return [dateStr(gStart), dateStr(gEnd)];
  };

  const [mGridStart, mGridEnd] = gridBounds(mDate.getFullYear(), mDate.getMonth());

  // Quarter = the calendar quarter (Jan–Mar / Apr–Jun / …) containing today, shifted by q.
  const qStart0      = todayDate.getMonth() - (todayDate.getMonth() % 3);
  const qMonths      = [0, 1, 2].map(i => new Date(todayDate.getFullYear(), qStart0 + quarterOffset * 3 + i, 1));
  const [qGridStart] = gridBounds(qMonths[0].getFullYear(), qMonths[0].getMonth());
  const [, qGridEnd] = gridBounds(qMonths[2].getFullYear(), qMonths[2].getMonth());

  // Months handed to FieldMonthCalendar for the active view (1 for month, 3 for quarter).
  const calMonths = (calView === 'quarter' ? qMonths : [mDate]).map(d => ({
    year:  d.getFullYear(),
    month: d.getMonth(),
    label: d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
  }));
  const quarterLabel = (() => {
    const a = qMonths[0], b = qMonths[2];
    const same = a.getFullYear() === b.getFullYear();
    return `${a.toLocaleDateString('en-IN', same ? { month: 'short' } : { month: 'short', year: 'numeric' })} – ${b.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;
  })();

  // The range the KPI tiles cover: exactly what the calendar is rendering, grid
  // cells included, so a visit visible in a trailing cell is also counted above.
  // Pinning the tiles to a fixed 90 days while the calendar moved underneath them
  // is half of why they looked frozen.
  const [statsFrom, statsTo] =
    calView === 'week'    ? [weekStart, weekEndExclusive]
    : calView === 'quarter' ? [qGridStart, qGridEnd]
    : [mGridStart, mGridEnd];

  // ── Rep lookup ───────────────────────────────────────────────

  // Prefer the session's linked rep_id; fall back to email lookup for reps
  // approved before rep-linking existed.
  let repId: string | null = session?.user?.repId != null ? String(session.user.repId) : null;
  if (isRep && !repId && session?.user?.email) {
    const { rows } = await risansiPool.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [session.user.email],
    );
    repId = rows[0]?.id ?? null;
  }

  // Per-user visibility predicates (inline integer ids, no params).
  //   clients aliased c · visits aliased v · these replace the old repId-only scoping.
  const currentUser   = await getCurrentUser();
  const cVis          = clientVisibilitySql(currentUser, 'c');
  const cVisAnd       = cVis ? ` AND (${cVis})` : '';
  const vVis          = clientScopeSql(currentUser, 'v.client_id', OWN_OPEN.visit('v'));
  const vVisAnd       = vVis ? ` AND (${vVis})` : '';

  // Zone / tour / rep filters (clients aliased c, visits aliased v).
  const filters    = parseVisitFilters(sp);
  // Coverage is an active-client idea by default — "how much of the territory
  // has been touched". Choosing a client status makes that the question instead,
  // so every coverage panel has to follow, or the tiles keep quoting 1,075
  // Active while the list under them shows leads.
  const coverStatus = filters.statuses.length ? 'TRUE' : `c.status = 'ACTIVE'`;
  const filterOpts = await getVisitFilterOptions(currentUser);

  // ── Queries ──────────────────────────────────────────────────

  const [feed, overdue, calendarVisits, calendarReps, mapClients, stats, reportsVisits, exhibitionDays] = await Promise.all([

    // 1. Visit feed — filtered by sub-tab (upcoming / today / past)
    q<VisitFeedRow[]>(async () => {
      const repCond = vVisAnd;
      const params: (string | null)[] = [];
      const dateConds: string[] = [];
      if (feedFrom) { params.push(feedFrom); dateConds.push(`v.visit_date >= $${params.length}`); }
      if (feedTo)   { params.push(feedTo);   dateConds.push(`v.visit_date <= $${params.length}`); }
      const dateSql = dateConds.length ? ` AND ${dateConds.join(' AND ')}` : '';
      const filter =
        feedTab === 'upcoming' ? `v.status = 'planned' AND v.visit_date >= CURRENT_DATE`
        : feedTab === 'today'  ? `v.visit_date = CURRENT_DATE`
        : `(v.visit_date < CURRENT_DATE OR v.status = 'completed')`;
      const orderBy =
        feedTab === 'upcoming' ? `v.visit_date ASC`
        : feedTab === 'today'  ? `v.check_in_time ASC NULLS LAST`
        : `v.visit_date DESC, v.created_at DESC`;
      const { rows } = await risansiPool.query<VisitFeedRow>(
        `SELECT
           v.id,
           v.visit_date::text          AS visit_date,
           v.status,
           COALESCE(v.purpose, '')     AS purpose,
           v.outcome,
           v.summary,
           v.performance_feedback,
           LEFT(v.action_points, 100)  AS action_points,
           v.check_in_time::text       AS check_in_time,
           v.submitted_at::text        AS submitted_at,
           c.id::text                  AS client_id,
           c.legal_name,
           c.code,
           c.industry,
           c.city,
           c.tier,
           COALESCE(v.rep_id::text, '') AS rep_id,
           COALESCE(r.name, '—')       AS rep_name,
           ${orphanSql('v.rep_id', 'c')} AS orphan
         FROM visits v
         JOIN clients c ON c.id = v.client_id
         LEFT JOIN users r ON r.id = v.rep_id
         WHERE ${filter} ${repCond}${filters.visitAnd}${dateSql}
         ORDER BY ${orderBy}
         LIMIT 50`,
        params,
      );
      return rows;
    }, []),

    // 2. Overdue accounts
    q<OverdueRow[]>(async () => {
      const { rows } = await risansiPool.query<OverdueRow>(
        `SELECT
           c.id::text, c.code, c.legal_name, c.industry, c.tier, c.status,
           c.state, c.city, c.last_visit_date::text,
           CASE
             WHEN c.last_visit_date IS NULL THEN NULL
             ELSE (CURRENT_DATE - c.last_visit_date)
           END AS days_overdue,
           COALESCE(
             (SELECT string_agg(u.name, ', ' ORDER BY r.rank, u.name)
                FROM (SELECT c2.primary_rep_id AS user_id, 0 AS rank FROM clients c2
                       WHERE c2.id = c.id AND c2.primary_rep_id IS NOT NULL
                      UNION ALL
                      SELECT s.rep_id, 1 FROM client_secondary_reps s WHERE s.client_id = c.id) r
                JOIN users u ON u.id = r.user_id),
             '—') AS rep_name,
           NULL::text AS primary_rep_id
         FROM clients c
         WHERE ${coverStatus}
           AND c.deleted_at IS NULL
           -- exclude future dates (planned visits that leaked into last_visit_date)
           AND (c.last_visit_date IS NULL OR c.last_visit_date <= CURRENT_DATE)
           AND (
             c.last_visit_date IS NULL OR
             c.last_visit_date < CURRENT_DATE - INTERVAL '90 days'
           )${cVisAnd}${filters.clientAnd}
         -- NULLS LAST, not FIRST. A never-visited client has no days_overdue
         -- and no last visit, and floating those to the top of a descending
         -- column pushed the rows with real figures off the first screen.
         ORDER BY ${sortCol} ${sortDir} NULLS LAST, c.id
         LIMIT 200`,
      );
      return rows;
    }, []),

    // 3. Calendar visits — window follows the selected view (week / month / quarter)
    q<CalendarVisit[]>(async () => {
      const [from, to] =
        calView === 'quarter' ? [qGridStart, qGridEnd]
        : calView === 'month' ? [mGridStart, mGridEnd]
        : [weekStart, weekEndExclusive];
      const repCond    = vVisAnd;
      const params: (string | null)[] = [from, to];
      const { rows } = await risansiPool.query<CalendarVisit>(
        `SELECT
           v.id::text,
           v.visit_date::text          AS visit_date,
           v.status,
           COALESCE(v.purpose, '')     AS purpose,
           v.outcome,
           c.id::text                  AS client_id,
           c.legal_name                AS client_name,
           c.code                      AS client_code,
           c.industry, c.city, c.tier,
           COALESCE(r.id::text, '')    AS rep_id,
           COALESCE(r.name, '—')       AS rep_name
         FROM visits v
         JOIN clients c ON c.id = v.client_id
         LEFT JOIN users r ON r.id = v.rep_id
         WHERE v.visit_date >= $1
           AND v.visit_date < $2
           ${repCond}${filters.visitAnd}
         ORDER BY v.visit_date ASC, v.created_at ASC NULLS LAST`,
        params,
      );
      return rows;
    }, []),

    // 4. Reps list (admin only, for week grid + AssignVisit)
    q<DrawerRep[]>(async () => {
      if (isRep) return [];
      const { rows } = await risansiPool.query<{ id: string; name: string; route: string | null }>(
        `SELECT id::text AS id, name, route FROM users WHERE is_active = TRUE AND role IN ('rep', 'manager') ORDER BY name ASC`,
      );
      return rows;
    }, []),

    // 5. Map data
    q<MapClient[]>(async () => {
      // Only the Map tab renders these pins, but the query ran on every tab and
      // shipped the whole active-client set (≈1,400 for an admin) to the browser
      // each time. Gate it to the tab that uses it, mirroring the reports query.
      if (tab !== 'map') return [];
      const { rows } = await risansiPool.query<MapClient>(
        `SELECT
           c.id::text, c.code, c.legal_name,
           c.industry, c.city, c.state, c.country,
           c.last_visit_date::text,
           EXTRACT(DAY FROM NOW() - c.last_visit_date)::int AS days_since,
           c.tier,
           (SELECT string_agg(u.name, ', ' ORDER BY r.rank, u.name)
                FROM (SELECT c2.primary_rep_id AS user_id, 0 AS rank FROM clients c2
                       WHERE c2.id = c.id AND c2.primary_rep_id IS NOT NULL
                      UNION ALL
                      SELECT s.rep_id, 1 FROM client_secondary_reps s WHERE s.client_id = c.id) r
                JOIN users u ON u.id = r.user_id) AS rep_name
         FROM clients c
         WHERE ${coverStatus}
           AND c.deleted_at IS NULL${cVisAnd}${filters.clientAnd}
         ORDER BY c.last_visit_date ASC NULLS FIRST`,
      );
      return rows;
    }, []),

    // 6. Stats — ACTIVITY over the period the calendar is showing.
    //
    // These used to count CLIENTS: active clients whose last_visit_date fell in a
    // fixed 90-day window, scoped by the selected rep's TOUR. Three things made
    // that read as broken next to the calendar. It counted clients while the
    // calendar counted visits; `status = 'ACTIVE'` excluded leads and prospects,
    // which for one rep meant 9 of the 68 clients he had actually visited; and
    // tour membership credited him for colleagues' visits while ignoring his own
    // off-tour work. Selecting that rep showed 5 against 82 visits on screen.
    //
    // Now: visits in the visible range, attributed to whoever made them.
    q<StatsRow>(async () => {
      const { rows } = await risansiPool.query<{
        visits: string; clients: string; completed: string; missed: string;
      }>(
        `SELECT
           COUNT(*)::text                                                        AS visits,
           COUNT(DISTINCT v.client_id)::text                                     AS clients,
           COUNT(*) FILTER (WHERE v.status = 'completed')::text                  AS completed,
           -- Still marked planned with the day gone by. Anything planned ahead of
           -- today is simply upcoming, and counting it as missed would make every
           -- forward plan look like a failure.
           COUNT(*) FILTER (WHERE v.status = 'planned'
             AND v.visit_date < CURRENT_DATE)::text                              AS missed
         FROM visits v
         WHERE v.visit_date >= $1 AND v.visit_date < $2
           ${vVisAnd}${filters.visitAnd}`,
        [statsFrom, statsTo],
      );

      // Coverage of the client base. A deliberately different question from the
      // row above — how much of the territory has been touched, rather than what
      // happened this month — so it keeps its own fixed 90-day window and its own
      // client-based scoping, and the labels say so. Conflating the two is what made
      // the old single row read as broken.
      const { rows: cov } = await risansiPool.query<{
        total_active: string; visited_90: string; overdue: string; never_visited: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE ${coverStatus})::text                          AS total_active,
           COUNT(*) FILTER (WHERE ${coverStatus}
             AND c.last_visit_date >= CURRENT_DATE - INTERVAL '90 days')::text   AS visited_90,
           COUNT(*) FILTER (WHERE ${coverStatus}
             AND (c.last_visit_date IS NULL
               OR c.last_visit_date < CURRENT_DATE - INTERVAL '90 days'))::text  AS overdue,
           COUNT(*) FILTER (WHERE ${coverStatus}
             AND c.last_visit_date IS NULL)::text                                AS never_visited
           FROM clients c
          WHERE c.deleted_at IS NULL${cVisAnd}${filters.clientAnd}`,
      );
      const r = rows[0];
      return {
        visits:    Number(r?.visits    ?? 0),
        clients:   Number(r?.clients   ?? 0),
        completed: Number(r?.completed ?? 0),
        missed:    Number(r?.missed    ?? 0),
        total_active:  Number(cov[0]?.total_active  ?? 0),
        visited_90:    Number(cov[0]?.visited_90    ?? 0),
        overdue:       Number(cov[0]?.overdue       ?? 0),
        never_visited: Number(cov[0]?.never_visited ?? 0),
      };
    }, { visits: 0, clients: 0, completed: 0, missed: 0,
         total_active: 0, visited_90: 0, overdue: 0, never_visited: 0 }),

    // 7. Visit Reports — submitted visits with related aggregates (only when tab open).
    //    Rep scope is parameterized; search/purpose/rep filtering happens client-side.
    q<VisitReportRow[]>(async () => {
      if (tab !== 'reports') return [];
      const repScope = vVisAnd;
      const params: string[] = [];
      const conds: string[] = [];
      if (repFrom)    { params.push(repFrom);            conds.push(`v.visit_date >= $${params.length}`); }
      if (repTo)      { params.push(repTo);              conds.push(`v.visit_date <= $${params.length}`); }
      if (repPurpose) { params.push(repPurpose);         conds.push(`v.purpose = $${params.length}`); }
      if (repSearch)  { params.push(`%${repSearch}%`);   conds.push(`(c.legal_name ILIKE $${params.length} OR c.code ILIKE $${params.length})`); }
      const filterSql = conds.length ? ` AND ${conds.join(' AND ')}` : '';
      const { rows } = await risansiPool.query(
        `SELECT
           v.id::text AS id, v.visit_date::text AS visit_date, v.status,
           v.submitted_at::text AS submitted_at,
           v.purpose, v.outcome, v.summary,
           v.is_planned, v.is_unplanned, v.unplanned_reason,
           v.check_in_time::text AS check_in_time, v.check_out_time::text AS check_out_time,
           v.gps_within_radius, v.manual_checkin,
           v.competitor_activity_observed,
           v.sample_or_gift_given, v.sample_gift_detail, v.sample_gift_value,
           v.follow_up_required, v.follow_up_text, v.follow_up_due_date::text AS follow_up_due_date,
           v.next_visit_recommendation::text AS next_visit_recommendation,
           v.industry_format, v.performance_feedback, v.pcp_competitor,
           v.mgmt_intervention, v.action_points, v.complaint_notes,
           v.competitors_observed, v.open_remarks, v.major_remarks,
           v.ice_dispersal_by, v.negotiation_by,
           c.id::text AS client_id, c.legal_name AS client_name, c.code AS client_code,
           c.industry, c.is_sugar, c.city, c.state, c.tier,
           COALESCE(r.name, '—') AS rep_name, r.id::text AS rep_id,
           -- Pumps, not rows: a line "Roto · PCP · qty 4" is four pumps. Counted
           -- per visit in a subquery, since the joins below multiply rows.
           (SELECT COALESCE(SUM(COALESCE(e2.qty, 1)), 0) FROM equipment e2 WHERE e2.visit_id = v.id AND e2.is_ril = TRUE)  AS ril_equip_count,
           (SELECT COALESCE(SUM(COALESCE(e2.qty, 1)), 0) FROM equipment e2 WHERE e2.visit_id = v.id AND e2.is_ril = FALSE) AS competitor_equip_count,
           COUNT(DISTINCT e.id) FILTER (WHERE e.is_opportunity = TRUE) AS displacement_opp_count,
           COUNT(DISTINCT o.id) FILTER (WHERE o.auto_created = TRUE)   AS auto_opp_count,
           COUNT(DISTINCT t.id) AS task_count,
           MAX(CASE WHEN vsr.has_expansion          THEN 1 ELSE 0 END) AS has_expansion,
           MAX(CASE WHEN vsr.has_complaints         THEN 1 ELSE 0 END) AS has_complaints,
           MAX(CASE WHEN vsr.has_pending_offers     THEN 1 ELSE 0 END) AS has_pending_offers,
           MAX(CASE WHEN vsr.has_outstanding_issues THEN 1 ELSE 0 END) AS has_outstanding_issues,
           MAX(CASE WHEN vsr.competitor_prices_captured THEN 1 ELSE 0 END) AS competitor_prices_captured
         FROM visits v
         JOIN clients c ON v.client_id = c.id
         LEFT JOIN users r ON v.rep_id = r.id
         LEFT JOIN equipment e ON e.visit_id = v.id
         LEFT JOIN opportunities o ON o.visit_id = v.id
         LEFT JOIN tasks t ON t.visit_id = v.id
         LEFT JOIN visit_sugar_report vsr ON vsr.visit_id = v.id
         WHERE v.submitted_at IS NOT NULL
           ${repScope}${filters.visitAnd}${filterSql}
         GROUP BY v.id, c.id, r.id, r.name
         ORDER BY v.visit_date DESC, v.submitted_at DESC
         LIMIT 100`,
        params,
      );
      return rows as VisitReportRow[];
    }, []),

    // 8. Exhibition attendance — a team member away at an exhibition should not
    //    read as free, but only on the days they are actually there.
    //
    //    Days come from exhibition_team_days, one row per person per day. The
    //    block used to span the exhibition's whole run for every member, which
    //    is right for whoever is there start to finish and wrong for everyone
    //    flying in for a day: their calendar read busy on days they were
    //    available, which is the same failure as reading free when they are
    //    away, only quieter.
    //
    //    Scope is by REP rather than by client, because an exhibition has no
    //    client and so none of the client-based visit scoping applies to it. The
    //    set of reps is the same one the filter bar offers this viewer, which is
    //    already "reps whose work you may see", plus the viewer themselves — a
    //    manager with no tour assignments would otherwise not see their own.
    //
    //    Deliberately NOT filtered by exhibitionVisibilitySql: the point of the
    //    block is that nobody schedules a visit for someone who is away, and
    //    hiding it from a manager who happens not to be on that exhibition's
    //    team would cause exactly the mistake this exists to prevent.
    q<ExhibitionDay[]>(async () => {
      // Only the calendar tab renders these, and the mobile redirect above has
      // already turned a calendar request into a feed one, so this also skips
      // the join on phones. Matches how the map and reports queries opt out.
      if (tab !== 'calendar') return [];
      const [from, to] =
        calView === 'quarter' ? [qGridStart, qGridEnd]
        : calView === 'month' ? [mGridStart, mGridEnd]
        : [weekStart, weekEndExclusive];

      // Who this viewer may see, already narrowed by the active filters. Ids,
      // every role, and an empty result genuinely meaning empty — see
      // getExhibitionScopeUserIds for why each of those matters here.
      const scopeIds = await getExhibitionScopeUserIds(currentUser, filters);
      if (!scopeIds.length) return [];

      const { rows } = await risansiPool.query<ExhibitionDay>(
        `SELECT e.id::text            AS id,
                e.name,
                e.venue, e.city,
                -- The block spans THIS PERSON's first and last day, not the
                -- exhibition's. Two people on the same exhibition can now carry
                -- different blocks, which is the point.
                min(d.day)::text       AS start_date,
                max(d.day)::text       AS end_date,
                e.status,
                -- The WHOLE team, not the part this viewer can see. The block
                -- says how many people are away; counting only the visible ones
                -- would under-report that to exactly the person planning around it.
                (SELECT count(*) FROM exhibition_team tt WHERE tt.exhibition_id = e.id)::int AS team_size,
                u.id::text             AS rep_id,
                u.name                 AS rep_name
           FROM exhibitions e
           JOIN exhibition_team t      ON t.exhibition_id = e.id
           JOIN exhibition_team_days d ON d.team_id = t.id
           JOIN users u                ON u.id = t.user_id
          WHERE e.status = ANY($1)
            -- The person's own days overlap the visible window, which is [from, to).
            AND d.day >= $2::date AND d.day < $3::date
            AND u.id = ANY($4)
          GROUP BY e.id, e.name, e.venue, e.city, e.status, u.id, u.name
          ORDER BY min(d.day), e.name, u.name`,
        [[...CALENDAR_BLOCKING_STATUSES], from, to, scopeIds],
      );
      return rows;
    }, []),
  ]);

  // The flat (exhibition x member) join folded into one block per exhibition,
  // carrying its attendees. Insertion order preserves the query's ORDER BY, so
  // blocks come out in start-date order and attendees alphabetically.
  const exhibitionBlocks: CalExhibition[] = (() => {
    const byId = new Map<string, CalExhibition>();
    for (const r of exhibitionDays) {
      const cur = byId.get(r.id) ?? {
        id: r.id, name: r.name, venue: r.venue, city: r.city,
        start_date: r.start_date, end_date: r.end_date,
        team_size: r.team_size, reps: [],
      };
      if (r.rep_id && !cur.reps.some(x => x.id === r.rep_id)) cur.reps.push({ id: r.rep_id, name: r.rep_name });
      byId.set(r.id, cur);
    }
    return [...byId.values()];
  })();

  // Which reps are at which exhibition on which day — the week grid is a
  // reps x days table, so it needs the answer per rep rather than per day.
  const exhibitionByRepDay = new Map<string, CalExhibition[]>();
  for (const ex of exhibitionBlocks) {
    if (!ex.start_date || !ex.end_date || ex.end_date < ex.start_date) continue;
    const [sy, sm, sd] = ex.start_date.split('-').map(Number);
    const cur = new Date(sy, sm - 1, sd);
    for (let guard = 0; guard < 370; guard++) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      if (iso > ex.end_date) break;
      for (const rep of ex.reps) {
        const k = `${rep.id}|${iso}`;
        exhibitionByRepDay.set(k, [...(exhibitionByRepDay.get(k) ?? []), ex]);
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Activities tab — scope EVERY non-admin, not just reps. Managers (non-admin)
  // used to fall through to the empty scope and receive the whole company's task
  // register. clientScopeSql returns null for admins (no restriction) and the
  // ownership predicate for rep/manager (uid inlined, injection-safe); a person
  // always also sees tasks assigned to or created by them, including client-less
  // ones the tour predicate wouldn't match.
  const taskScope      = clientScopeSql(currentUser, 't.client_id');
  const activityScope  = taskScope ? `WHERE (${taskScope} OR t.assigned_to_rep = $1 OR t.created_by = $2)` : '';
  const activityParams = taskScope ? [currentUser.id ?? 0, currentUser.email ?? ''] : [];
  const activityTasks = await risansiPool.query<ActivityTask>(
    `SELECT
       t.id, t.title, t.description, t.due_date::text AS due_date, t.priority, t.status,
       t.assigned_to_external, t.resolution_note,
       c.id AS client_id, c.code AS client_code, c.legal_name AS client_name,
       v.id AS visit_id, v.visit_date,
       COALESCE(r.name, '—') AS assigned_rep_name
     FROM tasks t
     LEFT JOIN clients c ON t.client_id = c.id
     LEFT JOIN visits v ON t.visit_id = v.id
     LEFT JOIN users r ON t.assigned_to_rep = r.id
     ${activityScope}
     ORDER BY
       CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END,
       t.due_date ASC NULLS LAST
     LIMIT 200`,
    activityParams,
  ).then(res => res.rows).catch(() => [] as ActivityTask[]);
  const openTaskCount = activityTasks.filter(t => t.status !== 'completed').length;

  // ── Derived ──────────────────────────────────────────────────

  const INDIAN_STATES = new Set([
    'Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
    'Jammu And Kashmir', 'Jharkhand', 'Karnataka', 'Kerala',
    'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
    'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
    'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    'Dadra & Nagar Haveli',
  ]);
  // State values in the DB are uppercase (e.g. "MAHARASHTRA"), so match
  // case-insensitively — otherwise no client lands on the India map.
  const INDIAN_STATES_UC = new Set([...INDIAN_STATES].map(s => s.toUpperCase()));
  const isIndianState = (s: string | null) => !!s && INDIAN_STATES_UC.has(s.trim().toUpperCase());
  const indiaMapClients = mapClients.filter(c => isIndianState(c.state));
  const intlMapClients  = mapClients.filter(c => !isIndianState(c.state));

  // Calendar stats (for week view header)
  const calPlanned   = calendarVisits.filter(v => v.status !== 'cancelled').length;
  const calCompleted = calendarVisits.filter(v => v.status === 'completed').length;
  const calPct       = calPlanned > 0 ? Math.round((calCompleted / calPlanned) * 100) : 0;

  // Calendar rep rows: rep filter → exactly those reps; zone/tour filter → the
  // reps assigned to that zone/tour (shown even with no visits this period);
  // no filter → all reps.
  const anyZoneTour = filters.zones.length > 0 || filters.tours.length > 0;
  const scopedRepNames = anyZoneTour ? await getScopedRepNames(filters) : [];
  const calReps = calendarReps.filter(rep => {
    if (filters.reps.length) return filters.reps.includes(rep.name);
    if (anyZoneTour) return scopedRepNames.includes(rep.name);
    return true;
  });

  // Reps present in the window's visits (name-sorted) — legend + week-grid fallback.
  //
  // Exhibition attendees are folded in, and that is not a nicety. The week grid
  // rows are calReps when we have the roster and these otherwise, and calReps is
  // empty for a rep viewing their own page — so a rep who is at an exhibition all
  // week with no visits booked would get no row at all, and the block saying
  // where they are would have nowhere to render. That is the exact mistake the
  // blocks exist to prevent, on the one view where it matters most.
  const visitReps = Array.from(
    new Map(
      calendarVisits
        .filter(v => v.rep_id)
        .map(v => [v.rep_id, { id: v.rep_id, name: v.rep_name, route: '' as string | null }] as const),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const derivedReps = Array.from(
    new Map([
      ...visitReps.map(r => [r.id, r] as const),
      ...exhibitionBlocks.flatMap(ex =>
        ex.reps.map(r => [r.id, { id: r.id, name: r.name, route: null as string | null }] as const)),
    ]).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  // Stable colour basis for the month/quarter calendar: roster ∪ visit-reps, so a
  // rep keeps the same colour regardless of which reps have visits this period.
  const colorReps = Array.from(
    new Map<string, { id: string; name: string }>([
      ...calReps.map(r => [r.id, { id: r.id, name: r.name }] as const),
      // Visit reps only. Exhibition attendees are week-grid rows but carry no
      // rep colour, and rep colours are an index into this name-sorted list —
      // adding a name shifts every colour after it for nothing.
      ...visitReps.map(r => [r.id, { id: r.id, name: r.name }] as const),
    ]).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));
  // Week-grid rows: the roster when we have it, else the reps seen in visits.
  const weekReps = calReps.length ? calReps : derivedReps;

  // A tab link carries EVERYTHING in the current URL and changes only the tab.
  // It used to copy seven named filters and drop the rest — the feed's date
  // range, the reports' search and purpose, the week the calendar was on — so
  // a range set on Visit Reports was gone after a look at the Calendar. Each
  // tab's own parameters are already namespaced (ffrom/fto, rfrom/rto, week,
  // month), so carrying all of them is safe; nothing here is a filter that
  // means something different on another tab.
  function tabHref(t: string, extra?: Record<string, string>) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v) p.set(k, v);
    p.set('tab', t);
    for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
    return `/risansi/field?${p.toString()}`;
  }

  // ── Render ───────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Field Activity']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>

        {/* Page header */}
        <div style={{ marginBottom: 18, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
              Field Activity
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 3 }}>
              {isRep ? 'Your visits and clients' : 'All reps · visits and coverage'}
            </div>
          </div>
          <PlannedVisitsExport reps={calendarReps} />
        </div>

        {/* Activity — tracks the calendar's period and the selected rep. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 10 }}>
          <StatCard label="Visits"          value={stats.visits} />
          <StatCard label="Clients Covered" value={stats.clients}   color="var(--pos)" />
          <StatCard label="Completed"       value={stats.completed} color="var(--pos)" />
          <StatCard label="Missed"          value={stats.missed}    color="var(--neg)" />
        </div>

        {/* Coverage — the client base, on its own fixed window. Captioned because
            the two rows answer different questions and sit inches apart. */}
        <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginBottom: 6 }}>
          Client coverage · active clients only · last 90 days, not the period above
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          <StatCard small label="Active Clients"  value={stats.total_active} />
          <StatCard small label="Visited (90d)"   value={stats.visited_90}    color="var(--pos)" />
          <StatCard small label="Overdue (90d+)"  value={stats.overdue}       color="var(--warn)" />
          <StatCard small label="Never Visited"   value={stats.never_visited} color="var(--neg)" />
        </div>

        {/* AssignVisit drawer — always mounted so overdue-row buttons can open it
            via the OPEN_VISIT_DRAWER event. It hides itself when closed (off-screen
            transform) and hideButton suppresses its own trigger, so no wrapper that
            sets display:none — that previously stopped the drawer from ever showing. */}
        <AssignVisitDrawer reps={calendarReps} hideButton={true} role={role} repId={repId ?? undefined} currentUserName={session?.user?.name ?? undefined} />

        {/* Shared filter row — Zone/Tour/Rep, plus Search/Purpose (reports) and the
            right-aligned date range (reports/feed). One row above the tabs. */}
        <FieldFilterBar
          tab={tab}
          opts={filterOpts}
          sel={{
            zones: filters.zones, tours: filters.tours, reps: filters.reps,
            managers: filters.managers, statuses: filters.statuses,
            industries: filters.industries, vstatus: filters.vstatus,
          }}
          purposes={Object.keys(PURPOSE_COLORS)}
          search={repSearch}
          purpose={repPurpose}
        />

        {/* Tabs — underline on desktop, snappy scroll-snap pills on mobile (mobile.css) */}
        <div className="field-tabs" style={{ display: 'flex', gap: 2, marginBottom: 18, borderBottom: '1px solid var(--line)', paddingBottom: 0, overflowX: 'auto', scrollSnapType: 'x proximity' }}>
          {[
            { id: 'calendar', label: 'Calendar' },
            { id: 'feed',     label: 'Visit Feed' },
            { id: 'reports',  label: 'Visit Reports' },
            { id: 'activities', label: `Action Register (${openTaskCount})` },
            { id: 'overdue',  label: `Overdue (${stats.overdue.toLocaleString('en-IN')})` },
            { id: 'map',      label: 'Map' },
          ].filter(t => !isMobile || !['calendar', 'map'].includes(t.id)).map(t => (
            <a key={t.id} href={tabHref(t.id)} aria-current={tab === t.id} style={{
              display: 'block', padding: '8px 16px', fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--accent)' : 'var(--fg-3)',
              textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap', scrollSnapAlign: 'center',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.1s',
            }}>
              {t.label}
            </a>
          ))}
        </div>

        {/* ── Tab: Visit Feed ──────────────────────────────────── */}
        {tab === 'feed' && (
          <div>
            {/* Sub-tabs (the date range lives in the shared filter bar above). */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
              {[
                { id: 'upcoming', label: 'Upcoming' },
                { id: 'today',    label: 'Today' },
                { id: 'past',     label: 'Past' },
              ].map(st => (
                <a key={st.id} href={tabHref('feed', { feed: st.id, ...(feedFrom ? { ffrom: feedFrom } : {}), ...(feedTo ? { fto: feedTo } : {}) })} style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 12,
                  fontWeight: feedTab === st.id ? 600 : 400,
                  textDecoration: 'none',
                  color: feedTab === st.id ? 'var(--title)' : 'var(--fg-3)',
                  background: feedTab === st.id ? 'var(--accent-soft)' : 'transparent',
                  border: `1px solid ${feedTab === st.id ? 'var(--brand-blue)' : 'var(--line)'}`,
                }}>
                  {st.label}
                </a>
              ))}
            </div>

            {feed.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--fg-3)', fontSize: 13 }}>
                {(feedFrom || feedTo) ? 'No visits in this date range'
                  : feedTab === 'upcoming' ? 'No upcoming visits planned'
                  : feedTab === 'today' ? 'No visits scheduled today'
                  : 'No past visits'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {feed.map(v => {
                  const statusKind = v.status === 'completed' ? 'pos' : v.status === 'checked-in' ? 'info' : 'warn';
                  const isClosed   = !!v.submitted_at;
                  const cta        = isClosed ? '🔒 View Report'
                    : v.check_in_time ? 'Continue Report →' : 'Start Report →';
                  return (
                    <Link key={v.id} href={`/risansi/visits/${v.id}`} style={{ ...FEED_CARD, display: 'block', textDecoration: 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: v.outcome || v.summary ? 8 : 0 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--fg)' }}>{v.legal_name}</span>
                            {v.tier && <Tag kind="accent">{v.tier}</Tag>}
                            {v.industry && <Tag>{v.industry}</Tag>}
                            <Tag kind={statusKind}>{v.status}</Tag>
                            {v.orphan && !isClosed && (
                              <span title={`${v.rep_name} does not work this client — not its owner, covering it, or their manager. Blocked until an admin assigns the client on Reps & Managers.`}
                                style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: 'var(--neg-soft)', color: 'var(--neg)', border: '1px solid var(--neg)' }}>
                                Blocked · client not assigned
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                            {v.rep_name} · {v.visit_date} {v.city ? `· ${v.city}` : ''}{v.purpose ? ` · ${v.purpose}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          {v.status !== 'completed' && !v.submitted_at && (
                            <EditVisitButton
                              role={role}
                              visit={{ id: v.id, visit_date: v.visit_date, purpose: v.purpose || 'Routine',
                                       client_name: v.legal_name, rep_id: v.rep_id, rep_name: v.rep_name }}
                            />
                          )}
                          <span style={{ fontSize: 11, fontWeight: 500, color: isClosed ? 'var(--fg-3)' : 'var(--title)' }}>
                            {cta}
                          </span>
                        </div>
                      </div>
                      {(v.outcome || v.summary) && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {v.outcome && (
                            <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                              <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>Outcome: </span>{v.outcome}
                            </div>
                          )}
                          {v.summary && (
                            <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
                              <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>Summary: </span>{v.summary}
                            </div>
                          )}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Visit Reports ───────────────────────────────── */}
        {tab === 'reports' && (
          <VisitReportsTab visits={reportsVisits} filterActive={!!(repSearch || repPurpose || repFrom || repTo)} />
        )}

        {tab === 'activities' && (
          <ActivitiesTab tasks={activityTasks} />
        )}

        {/* ── Tab: Calendar ────────────────────────────────────── */}
        {tab === 'calendar' && (
          <div>
            {/* Calendar header — view label + Week/Month/Quarter toggle + nav */}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10,
            }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>
                  {calView === 'week' ? `Week of ${weekLabel}` : calView === 'quarter' ? quarterLabel : monthLabel}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <span style={CHIP}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{calPlanned}</span>
                    {' '}visits
                  </span>
                  {calView === 'week' && (
                    <span style={{
                      ...CHIP,
                      color: calPct >= 80 ? 'var(--pos-strong)' : calPct >= 50 ? 'var(--warn-strong)' : 'var(--neg-strong)',
                      background: calPct >= 80 ? 'var(--pos-soft)' : calPct >= 50 ? 'var(--warn-soft)' : 'var(--neg-soft)',
                      borderColor: calPct >= 80 ? '#6EE7B7' : calPct >= 50 ? '#FCD34D' : '#FCA5A5',
                    }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{calPct}%</span>
                      {' '}done
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <CalViewToggle current={calView} />
                {calView === 'week'
                  ? <WeekNav currentOffset={weekOffset} />
                  : calView === 'quarter'
                    ? <QuarterNav currentOffset={quarterOffset} />
                    : <MonthNav currentOffset={monthOffset} />}
                <AssignVisitButton reps={calendarReps} role={role} repId={repId ?? undefined} currentUserName={session?.user?.name ?? undefined} />
              </div>
            </div>

            {calView !== 'week' ? (
              <FieldMonthCalendar
                view={calView}
                months={calMonths}
                visits={calendarVisits}
                reps={colorReps}
                todayISO={todayISO}
                purposeColors={PURPOSE_COLORS}
                exhibitions={exhibitionBlocks}
              />
            ) : (
              /* ─── Week grid (reps × days) ─── */
              <div style={{
                background: 'var(--bg-paper)', border: '1px solid var(--line)',
                borderRadius: 'var(--radius)', overflow: 'hidden',
              }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th style={{
                          width: 140, padding: '10px 12px', textAlign: 'left',
                          background: 'var(--bg-elev)', borderBottom: '2px solid var(--line)',
                          borderRight: '1px solid var(--line)',
                          fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                          fontWeight: 600, color: 'var(--fg-3)',
                        }}>
                          Rep
                        </th>
                        {weekDays.map(day => (
                          <th key={day.date} style={{
                            padding: '8px 6px', textAlign: 'center',
                            background: day.isToday ? 'var(--accent-soft)' : 'var(--bg-elev)',
                            borderBottom: '2px solid var(--line)',
                            borderRight: '1px solid rgba(0,0,0,0.05)',
                            fontSize: 11,
                            fontWeight: day.isToday ? 700 : 500,
                            color: day.isToday ? 'var(--brand-blue)' : 'var(--fg-3)',
                          }}>
                            {day.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {weekReps.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
                            No reps match the filter
                          </td>
                        </tr>
                      ) : weekReps.map(rep => (
                        <tr key={rep.id}>
                          <td style={{
                            padding: '8px 10px', verticalAlign: 'top',
                            borderBottom: '1px solid var(--line)', borderRight: '1px solid var(--line)',
                            background: 'var(--bg-paper)',
                          }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>{rep.name}</div>
                            {rep.route && <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>{rep.route}</div>}
                          </td>
                          {weekDays.map(day => {
                            const dayVisits = calendarVisits.filter(v => String(v.rep_id) === String(rep.id) && v.visit_date === day.date);
                            const dayEx = exhibitionByRepDay.get(`${rep.id}|${day.date}`) ?? [];
                            return (
                              <td key={day.date} style={{
                                padding: 4, verticalAlign: 'top',
                                background: day.isToday ? 'rgba(235,241,251,0.45)' : 'transparent',
                                borderBottom: '1px solid var(--line)',
                                borderRight: '1px solid rgba(0,0,0,0.04)', minHeight: 60,
                              }}>
                                {/* Above the visits, because a rep at an exhibition
                                    can still have a visit booked that day — the two
                                    coexist, and the exhibition is the wider fact. */}
                                {dayEx.map(ex => (
                                  <div key={`ex-${ex.id}`}
                                    title={[ex.name, [ex.venue, ex.city].filter(Boolean).join(', '),
                                            ex.start_date === ex.end_date ? ex.start_date : `${ex.start_date} to ${ex.end_date}`]
                                            .filter(Boolean).join(' · ')}
                                    style={{
                                      margin: 2, padding: '3px 6px', borderRadius: 4,
                                      background: 'var(--purple-soft)', color: 'var(--purple)',
                                      fontSize: 10.5, fontWeight: 700, lineHeight: 1.4,
                                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>
                                    <span aria-hidden>&#9635;</span> {ex.name}
                                  </div>
                                ))}
                                {/* The dashed slot stays even under an exhibition
                                    block: a rep at a stand can still take a visit
                                    that day, and removing it also collapsed that
                                    rep's row to a fraction of the others' height. */}
                                {dayVisits.length > 0
                                  ? dayVisits.map(v => <CalendarVisitCard key={v.id} visit={v} role={role} />)
                                  : <div style={{ height: dayEx.length ? 28 : 50, margin: 2, border: '1px dashed rgba(0,0,0,0.08)', borderRadius: 4 }} />
                                }
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Legend */}
                <div style={{
                  padding: '10px 14px', borderTop: '1px solid var(--line)',
                  display: 'flex', gap: 16, flexWrap: 'wrap', background: 'var(--bg-elev)',
                }}>
                  {Object.entries(PURPOSE_COLORS).map(([label, color]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--fg-3)' }}>
                      <div style={{ width: 3, height: 12, borderRadius: 1, background: color, flexShrink: 0 }} />
                      {label}
                    </div>
                  ))}
                  {/* The month and quarter views explain the purple band in their
                      own legend; this view has its own, so it needs the key too. */}
                  {exhibitionBlocks.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--fg-3)' }}>
                      <div style={{
                        width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                        background: 'var(--purple-soft)', border: '1px solid var(--purple)',
                      }} />
                      at an exhibition
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Overdue ─────────────────────────────────────── */}
        {tab === 'overdue' && (
          stats.overdue === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--pos)', fontSize: 13, fontWeight: 500 }}>
              ✓ All clients visited within 90 days
            </div>
          ) : (
            <>
              {stats.overdue > 200 && (
                <div style={{ fontSize: 11, color: 'var(--fg-3)', padding: '0 0 12px', textAlign: 'right' }}>
                  Showing first 200 of {stats.overdue.toLocaleString('en-IN')}
                </div>
              )}

              <div style={{
                background: 'var(--bg-paper)', border: '1px solid var(--line)',
                borderRadius: 'var(--radius)', overflow: 'hidden',
              }}>
                <div className="r-mobile-only" style={{ padding: '8px 10px 0' }}>
                  <MobileSortUrl
                    options={OVERDUE_SORT_OPTIONS}
                    kinds={OVERDUE_SORT_KINDS}
                    currentSort={sortKey}
                    currentDir={curDir}
                  />
                </div>
                <table className="r-cards" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-elev)' }}>
                      {/* Every column sorts in SQL, because this list is the first
                          200 of the overdue accounts — reordering the 200 on
                          screen would claim to rank the whole backlog. */}
                      <SortableTH col="name"         label="Client"       kind="text"   currentSort={sortKey} currentDir={curDir} style={TH} />
                      <SortableTH col="industry"     label="Industry"     kind="text"   currentSort={sortKey} currentDir={curDir} style={TH} />
                      <SortableTH col="state"        label="State"        kind="text"   currentSort={sortKey} currentDir={curDir} style={TH} />
                      <SortableTH col="tier"         label="Tier"         kind="text"   currentSort={sortKey} currentDir={curDir} style={TH} />
                      <SortableTH col="rep"          label="Rep"          kind="text"   currentSort={sortKey} currentDir={curDir} style={TH} />
                      <SortableTH col="last_visit"   label="Last Visit"   kind="date"   currentSort={sortKey} currentDir={curDir} style={TH} />
                      <SortableTH col="days_overdue" label="Days Overdue" kind="number" currentSort={sortKey} currentDir={curDir} style={TH} />
                      {/* The assign button has nothing to order by. */}
                      <th style={TH}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdue.map((acc, i) => {
                      const d      = acc.days_overdue;
                      const dColor = d == null || d > 365 ? 'var(--neg)' : d > 180 ? 'oklch(0.55 0.18 50)' : 'var(--warn)';
                      return (
                        <tr key={acc.id} style={{ borderBottom: i < overdue.length - 1 ? '1px solid var(--line)' : 'none' }}>
                          <td data-label="" style={{ ...TD, minWidth: 160 }}>
                            <Link href={`/risansi/clients/${acc.code}`}
                              style={{ fontWeight: 500, color: 'var(--fg)', textDecoration: 'none' }}>
                              {acc.legal_name}
                            </Link>
                            <div style={{ fontSize: 10, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
                              {acc.code}
                            </div>
                          </td>
                          <td data-label="Industry" style={TD}>{acc.industry ?? '—'}</td>
                          <td data-label="State" style={{ ...TD, color: 'var(--fg-3)' }}>{acc.state ?? '—'}</td>
                          <td data-label="Tier" style={TD}>
                            {acc.tier ? <Tag kind={acc.tier === 'Key' ? 'accent' : undefined}>{acc.tier}</Tag> : '—'}
                          </td>
                          <td data-label="Rep" style={{ ...TD, fontSize: 11, color: 'var(--fg-2)' }}>{acc.rep_name}</td>
                          <td data-label="Last Visit" style={{ ...TD, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                            {acc.last_visit_date ?? <span style={{ color: 'var(--neg)' }}>Never</span>}
                          </td>
                          <td data-label="Days Overdue" style={{ ...TD, fontFamily: 'var(--font-mono)', color: dColor, fontWeight: 500 }}>
                            {d == null ? '—' : d > 365 ? '1yr+' : `${d}d`}
                          </td>
                          <td data-label="Action" style={TD}>
                            <AssignVisitRowBtn
                              clientId={acc.id}
                              clientName={acc.legal_name}
                              clientCode={acc.code}
                              repId={acc.primary_rep_id ?? undefined}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}

        {/* ── Tab: Map ─────────────────────────────────────────── */}
        {tab === 'map' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
            <div>
              <IndiaMapWrapper clients={indiaMapClients.map(c => ({
                id:              c.id,
                legal_name:      c.legal_name,
                city:            c.city,
                state:           c.state,
                last_visit_date: c.last_visit_date,
                tier:            c.tier,
                rep_name:        c.rep_name ?? '',
              }))} />
              <InternationalPanel clients={intlMapClients} />
            </div>
            <ClientCoverageList clients={mapClients.map(c => ({
              id:              c.id,
              code:            c.code,
              legal_name:      c.legal_name,
              city:            c.city,
              state:           c.state,
              country:         c.country,
              industry:        c.industry,
              tier:            c.tier,
              last_visit_date: c.last_visit_date,
              rep_name:        c.rep_name,
            }))} />
          </div>
        )}

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function CalendarVisitCard({ visit, compact = false, role }: { visit: CalendarVisit; compact?: boolean; role: string }) {
  const color = PURPOSE_COLORS[visit.purpose] ?? 'var(--fg-3)';
  const bg    = STATUS_BG[visit.status] ?? 'var(--bg-elev)';
  const statusColor =
    visit.status === 'completed'  ? 'var(--pos)' :
    visit.status === 'missed'     ? 'var(--neg)' :
    visit.status === 'checked-in' ? 'var(--brand-blue)' :
    'var(--fg-3)';

  return (
    <div style={{ position: 'relative' }}>
      <Link
        href={`/risansi/visits/${visit.id}`}
        style={{
          display: 'block', margin: '2px', padding: compact ? '3px 5px' : '5px 7px',
          borderRadius: 4, borderLeft: `3px solid ${color}`,
          background: bg, textDecoration: 'none',
        }}
      >
        <div style={{
          fontSize: compact ? 10 : 11, fontWeight: 600, color: 'var(--fg)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: compact ? 100 : 130, paddingRight: 14,
        }}>
          {visit.client_name}
        </div>
        {!compact && (
          <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 1 }}>
            {visit.purpose || 'Visit'}
          </div>
        )}
        <div style={{ marginTop: 2 }}>
          <span style={{
            fontSize: 9, fontWeight: 600, textTransform: 'uppercase' as const,
            letterSpacing: '0.06em', color: statusColor,
          }}>
            {visit.status}
          </span>
        </div>
      </Link>
      {visit.status !== 'completed' && (
        <div style={{ position: 'absolute', top: 3, right: 3 }}>
          <EditVisitButton
            role={role}
            compact
            visit={{ id: visit.id, visit_date: visit.visit_date, purpose: visit.purpose || 'Routine',
                     client_name: visit.client_name, rep_id: visit.rep_id, rep_name: visit.rep_name }}
          />
        </div>
      )}
    </div>
  );
}

function InternationalPanel({ clients }: { clients: MapClient[] }) {
  if (clients.length === 0) return null;

  const grouped: Record<string, MapClient[]> = {};
  clients.forEach(c => {
    const region = c.state || c.country || 'Unknown';
    if (!grouped[region]) grouped[region] = [];
    grouped[region].push(c);
  });

  const now = Date.now();

  return (
    <div style={{
      marginTop: 12, background: 'var(--bg-paper)',
      border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--title)' }}>
          International Clients
        </span>
        <span style={{ fontSize: 12, color: 'var(--fg-3)', marginLeft: 'auto' }}>
          {clients.length} clients · {Object.keys(grouped).length} regions
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--line)' }}>
        {Object.entries(grouped)
          .sort((a, b) => b[1].length - a[1].length)
          .map(([region, regionClients]) => (
            <div key={region} style={{ padding: '10px 14px', background: 'var(--bg-paper)' }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--title)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
              }}>
                {region} ({regionClients.length})
              </div>
              {regionClients.slice(0, 4).map(c => {
                const days = c.last_visit_date
                  ? Math.floor((now - new Date(c.last_visit_date).getTime()) / 86_400_000)
                  : null;
                // null OR future date → treat as never visited (red)
                const dot = days === null || days < 0 ? 'var(--neg)' : days <= 90 ? 'var(--pos)' : 'var(--warn)';
                return (
                  <div key={c.id} style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.legal_name}</span>
                  </div>
                );
              })}
              {regionClients.length > 4 && (
                <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 2 }}>
                  +{regionClients.length - 4} more
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, small }: { label: string; value: number; color?: string; small?: boolean }) {
  return (
    <div style={{
      background: 'var(--bg-paper)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius)', padding: small ? '9px 14px' : '14px 16px',
    }}>
      <div style={{ fontSize: small ? 9.5 : 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-3)', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: small ? 19 : 28, fontWeight: 700, color: color ?? 'var(--fg)', lineHeight: 1.1, marginTop: small ? 2 : 4 }}>
        {value.toLocaleString('en-IN')}
      </div>
    </div>
  );
}

// OverdueSortTH used to live here: a hand-rolled header with its own arrows and
// its own direction rule, whose link rebuilt the URL from scratch as
// /risansi/field?tab=overdue&sort=… and so dropped every zone, tour, rep and
// date filter the viewer had set. SortableTH keeps them and shares one
// direction rule with the rest of the portal.

// ── Style constants ────────────────────────────────────────────

const FEED_CARD: CSSProperties = {
  background: 'var(--bg-paper)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius)', padding: '14px 16px',
};

const CHIP: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  padding: '4px 10px', borderRadius: 20, fontSize: 12,
  background: 'var(--bg-elev)', color: 'var(--fg-2)', border: '1px solid var(--line)',
};

const TH: CSSProperties = {
  padding: '9px 12px', textAlign: 'left', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.08em',
  fontWeight: 500, color: 'var(--fg-3)',
  borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap',
  background: 'var(--bg-elev)',
};

const TD: CSSProperties = { padding: '10px 12px', verticalAlign: 'middle' };
