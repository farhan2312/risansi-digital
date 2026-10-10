import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Topbar, MultiSelectFilter, ActiveFilterBar } from '@/components/risansi';
import { DateRangeFilter } from '@/components/risansi/DateRangeFilter';
import { ActionQueueRow, type QueueTask } from '@/components/risansi/ActionQueueRow';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import {
  buildTasksQuery, buildTasksCountQuery, buildTasksStatsQuery, TASK_DUE_BUCKETS,
  RESP_EXTERNAL, type TaskFilters,
} from '@/lib/risansi-action-queue';
import { summariseActions, type ActionStatRow } from '@/lib/risansi-action-stats';
import { ActionStats } from '@/components/risansi/ActionStats';

export const dynamic = 'force-dynamic';

async function q<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) { console.error('[registry] panel query failed', e); return fallback; }
}

// Array-safe: a repeated query key arrives as string[]; flatten either shape and
// split comma-joined values uniformly so filters never silently drop.
const parseList = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).flatMap(s => s.split(',')).filter(Boolean);

export default async function ActionRegistryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? '';
  const user  = await getCurrentUser();
  const isAdmin = hasRole(user.role, 'admin');

  // Resolve the user's users.id for the scoped query (sessions usually carry it).
  let repId: number | null = user.id;
  if (repId == null && email) {
    repId = await q<number | null>(async () => {
      const { rows } = await risansiPool.query<{ id: number }>(
        'SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [email],
      );
      return rows[0]?.id ?? null;
    }, null);
  }

  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const filters: TaskFilters = {
    status:      parseList(sp.status),
    priority:    parseList(sp.priority),
    responsible: parseList(sp.resp),
    due:         parseList(sp.due),
    dueFrom:     day(sp.dfrom), dueTo: day(sp.dto),
    raisedFrom:  day(sp.rfrom), raisedTo: day(sp.rto),
  };
  const hasFilters = Object.values(filters).some(v => (Array.isArray(v) ? v.length > 0 : !!v));

  // Default the board to the caller's own actions (assigned to or created by
  // them); "All actions" (mine=all) opens it up to everyone they can see.
  const mine = sp.mine !== 'all';
  const buildHref = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && v) p.set(k, v);
    for (const [k, v] of Object.entries(over)) { if (v == null) p.delete(k); else p.set(k, v); }
    const s = p.toString();
    return s ? `/risansi/registry?${s}` : '/risansi/registry';
  };

  // Filter option lists (small, so fetched unscoped).
  const [statusOpts, priorityOpts, respOpts] = await Promise.all([
    q<string[]>(async () => (await risansiPool.query<{ v: string }>(
      `SELECT DISTINCT status AS v FROM tasks WHERE status IS NOT NULL AND status <> '' ORDER BY 1`)).rows.map(r => r.v), ['open', 'completed']),
    q<string[]>(async () => (await risansiPool.query<{ v: string }>(
      `SELECT DISTINCT priority AS v FROM tasks WHERE priority IS NOT NULL AND priority <> ''
        ORDER BY CASE lower(priority) WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END`)).rows.map(r => r.v), []),
    q<string[]>(async () => (await risansiPool.query<{ v: string }>(
      `SELECT DISTINCT u.name AS v FROM tasks t JOIN users u ON u.id = t.assigned_to_rep ORDER BY 1`)).rows.map(r => r.v), []),
  ]);
  // No "Unassigned" option: every action names somebody now, so the filter
  // could only ever return an empty list and imply the data was missing.
  const responsibleOptions = [...respOpts, RESP_EXTERNAL];

  const blocked = !isAdmin && repId == null;

  const tasks = await q<QueueTask[]>(async () => {
    if (blocked) return [];
    const { sql, params } = buildTasksQuery({ isAdmin, repId, email, filters, mine });
    const { rows } = await risansiPool.query<QueueTask>(sql, params as (string | number)[]);
    return rows;
  }, []);

  // Counts come from a dedicated aggregate (no LIMIT), so the header reflects the
  // whole matched set rather than plateauing at the 200-row page cap. Overdue
  // uses the same < today, non-completed rule as the Overdue filter bucket.
  const counts = await q<{ open: number; overdue: number }>(async () => {
    if (blocked) return { open: 0, overdue: 0 };
    const { sql, params } = buildTasksCountQuery({ isAdmin, repId, email, filters, mine });
    const { rows } = await risansiPool.query<{ open_count: string; overdue_count: string }>(sql, params as (string | number)[]);
    return { open: Number(rows[0]?.open_count ?? 0), overdue: Number(rows[0]?.overdue_count ?? 0) };
  }, { open: 0, overdue: 0 });
  const openCount    = counts.open;
  const overdueCount = counts.overdue;

  // The dashboard above the All actions list: same WHERE as the list, no cap.
  // Today on the Indian clock, because due dates are plain dates and Vercel
  // runs on UTC — at 04:00 IST an action due today would otherwise read overdue.
  const todayIst = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const stats = !mine && !blocked
    ? await q(async () => {
        const { sql, params } = buildTasksStatsQuery({ isAdmin, repId, email, filters, mine });
        const { rows } = await risansiPool.query<ActionStatRow>(sql, params as (string | number)[]);
        return summariseActions(rows, todayIst);
      }, null)
    : null;
  // Owner and priority bars toggle the list's own filters.
  const toggleList = (param: string, current: string[], value: string) => {
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    return buildHref({ [param]: next.length ? next.join(',') : null });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <Topbar crumbs={['Risansi', 'Action Registry']} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px 40px', background: 'var(--bg)' }}>
        {/* Scope: the caller's own actions (default) vs everyone's */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <a href={buildHref({ mine: null })} style={{
            padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, textDecoration: 'none',
            border: '1px solid var(--line)',
            background: mine ? 'var(--accent-fill)' : 'var(--bg-elev)', color: mine ? 'var(--on-accent)' : 'var(--fg-3)',
          }}>My actions</a>
          <a href={buildHref({ mine: 'all' })} style={{
            padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, textDecoration: 'none',
            border: '1px solid var(--line)',
            background: !mine ? 'var(--accent-fill)' : 'var(--bg-elev)', color: !mine ? 'var(--on-accent)' : 'var(--fg-3)',
          }}>All actions</a>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <MultiSelectFilter param="status"   label="Status"        options={statusOpts}          selected={filters.status ?? []} />
          <MultiSelectFilter param="resp"     label="Responsible"   options={responsibleOptions}  selected={filters.responsible ?? []} />
          <MultiSelectFilter param="due"      label="Due"           options={TASK_DUE_BUCKETS}    selected={filters.due ?? []} />
          <MultiSelectFilter param="priority" label="Priority"      options={priorityOpts}        selected={filters.priority ?? []} />
        </div>
        {/* Two ranges, each with the named ones — this month, this quarter,
            this FY — beside it. Due answers "what lands in October", raised
            answers "what came in last month". */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <DateRangeFilter fromParam="dfrom" toParam="dto" from={filters.dueFrom ?? ''} to={filters.dueTo ?? ''} label="Due date" presets />
          <DateRangeFilter fromParam="rfrom" toParam="rto" from={filters.raisedFrom ?? ''} to={filters.raisedTo ?? ''} label="Raised" presets />
        </div>
        <ActiveFilterBar filters={[
          { param: 'status',   label: 'Status',      values: filters.status ?? [] },
          { param: 'resp',     label: 'Responsible', values: filters.responsible ?? [] },
          { param: 'due',      label: 'Due',         values: filters.due ?? [] },
          { param: 'priority', label: 'Priority',    values: filters.priority ?? [] },
          { param: 'dfrom',    label: 'Due from',    values: filters.dueFrom ? [filters.dueFrom] : [] },
          { param: 'dto',      label: 'Due to',      values: filters.dueTo ? [filters.dueTo] : [] },
          { param: 'rfrom',    label: 'Raised from', values: filters.raisedFrom ? [filters.raisedFrom] : [] },
          { param: 'rto',      label: 'Raised to',   values: filters.raisedTo ? [filters.raisedTo] : [] },
        ]} />

        {stats && (
          <div style={{ marginTop: 10 }}>
            <ActionStats
              s={stats}
              hrefOwner={name => toggleList('resp', filters.responsible ?? [], name)}
              hrefPriority={p => toggleList('priority', filters.priority ?? [], p)}
              selectedOwners={filters.responsible ?? []}
              selectedPriorities={filters.priority ?? []}
            />
          </div>
        )}

        <div className="panel" style={{ marginTop: 8 }}>
          <div className="panel-header">
            <span className="panel-title">Action Registry</span>
            <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
              {openCount} open
              {overdueCount > 0 && (
                <span style={{ marginLeft: 8, color: 'var(--neg)', fontWeight: 600 }}>· {overdueCount} overdue</span>
              )}
            </span>
          </div>
          <div>
            {tasks.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
                {hasFilters ? 'No action items match these filters.' : 'No action items — all caught up ✓'}
              </div>
            ) : (
              tasks.map(task => <ActionQueueRow key={task.id} task={task} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
