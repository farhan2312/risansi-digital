import {
  STATUSES, LEGACY_STATUSES, HEADLINE_STATUSES, isOpenStatus,
  type HeadlineStatus, type Severity,
} from '@/lib/risansi-complaint-flow';
import {
  preventiveActionPending, visitPending,
  type ComplaintListRow, type HolderDwell, type CapaState,
} from '@/lib/risansi-complaint-rows';

// The numbers above the complaints list: how many are open and late, how old
// they are, how long closing takes, who is holding them, who holds longest,
// what keeps going wrong. Pure — rows in, summary out — so a script can check
// it against the database and the page cannot disagree with the export.
//
// Nothing here decides whether a complaint is late. `overdue` and
// `overdue_kind` arrive on the row, computed by `overdueFor` in the flow
// module, and every tile and bar below only counts them. That is deliberate:
// the review's complaint was that the tiles disagreed with each other, and the
// surest way for them to disagree is for two of them to work out "overdue" in
// two places.

export interface Bar { key: string; label: string; count: number; overdue?: number; days?: number }
export interface HolderBar { key: string; label: string; department: string; userId: number | null; open: number; days: number; avgDays: number; stretches: number; totalDays: number }
export interface StatusStep { status: string; count: number; avgDays: number | null; stretches: number }
/** One of the five headline names, with the sub-stages behind it named for a tooltip. */
export interface HeadlineBar { key: HeadlineStatus; label: string; count: number; overdue: number; stages: string[] }
/** One client's record: how many complaints, how many are still live, how bad. */
export interface ClientBar {
  key: string;           // client_id as text, or 'none' for complaints raised against no client
  label: string;         // legal name
  code: string | null;
  count: number; open: number; overdue: number;
  /** Flagged at closure as a repeat of something already complained about. */
  repeats: number;
  /** Worst severity seen, S1 first. Null when nothing has been rated. */
  worst: Severity | null;
  /** The most recent complaint date, 'YYYY-MM-DD'. */
  last: string;
}

/**
 * One category, with the two figures the review asked for by name: how many of
 * its complaints are still open, and how long its closed ones took.
 */
export interface CategoryBar {
  key: string; label: string;
  count: number; open: number; overdue: number;
  /** Average days from raised to closed, over the ones that have closed. Null when none has. */
  avgClose: number | null;
  closed: number;
  /** True where the category name came from the old `defect_category` because the row has no new one. */
  legacy: boolean;
}

/** A step in the Damage → Joint → Bush → MOC drill-down. */
export interface DrillNode {
  /** The filter this node sets when clicked. */
  filter: string;
  value: string;
  label: string;
  count: number;
  open: number;
  children: DrillNode[];
}

export interface CapaCounts {
  /** A CAPA was asked for at all. Requirement (H)'s "raised". */
  raised: number;
  /** Asked for, nothing back. Requirement (H)'s "pending", and the Open bucket. */
  open: number;
  /** Came back, complaint still live — somebody has to read it. */
  review: number;
  /** Came back, complaint finished. */
  closed: number;
  /** Nothing was asked for. Page 6 lost its mandatory flag, so this is most of them. */
  none: number;
}

export interface ComplaintSummary {
  total: number; workflow: number; legacy: number;
  open: number; closed: number;
  /** The ones that actually reached Closed, as against `closed` which also counts Resolved and Feedback. */
  trulyClosed: number;
  resolvedAwaitingClose: number; awaitingFeedback: number;
  /** Late by the severity-graded age rule, and the two halves of it. */
  overdue: number; overdueNoAction: number; overdueActed: number;
  /** Severe / Immediate Response (decision 12). Not the same as S1. */
  severe: number; severeOpen: number;
  avgOpenAge: number | null; oldestOpen: number | null;
  /** Raised → closed, over the complaints that reached Closed. */
  avgTimeToClose: number | null; medianTimeToClose: number | null; closedCount: number;
  /** Raised → resolved, which is the earlier and more forgiving measure. Shown beside it so the two cannot be confused. */
  avgTimeToResolve: number | null; resolvedCount: number;
  raisedThisMonth: number; closedThisMonth: number; raised30: number; closed30: number;
  repeatCount: number; repeatRate: number | null; reopened: number;
  /** Flagged a repeat, or pointing at the original complaint (decision 4). */
  linkedCount: number;
  bySeverity: Bar[];                 // open, S1..S4 + unrated
  /** The five headline names over the eight sub-stages. Replaces the old purelyOpen / partiallyOpen pair. */
  byHeadline: HeadlineBar[];
  funnel: StatusStep[];              // current count per status + average days a complaint spends there
  byHolderDept: HolderBar[];         // who holds the open ones now, and for how long in total
  byHolderPerson: HolderBar[];       // the named people, longest first
  longestSitting: ComplaintListRow[];// top open by days in status
  byResponsible: Bar[];
  /** Complaint Category, with open count and average time to close per category. */
  byCategory: CategoryBar[];
  bySubcategory: Bar[];
  byAction: Bar[];
  byIndustry: Bar[];
  byChannel: Bar[];
  byClientType: Bar[];
  byRep: Bar[];
  capa: CapaCounts;
  preventivePending: number;
  visitPending: number;
  /** Damage → Joint → part → MOC. Empty branches are dropped. */
  drill: DrillNode[];
  /** Every client with a complaint, worst record first. The page shows the top few. */
  byClient: ClientBar[];
  /** How many clients are behind the complaints in view. */
  clientCount: number;
  months: { key: string; label: string; raised: number; closed: number }[];
  openByAge: { label: string; count: number }[];
}

const SEV_ORDER: (Severity | 'none')[] = ['High', 'Low', 'none'];
const SEV_LABEL: Record<string, string> = { High: 'High criticality', Low: 'Low criticality', none: 'Not yet rated' };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ym = (iso: string | null | undefined) => (iso ? iso.slice(0, 7) : null);

/** Days from raised to a given end, both as timestamps. Null when either is missing. */
function spanDays(r: ComplaintListRow, end: string | null): number | null {
  const from = r.complaint_date ?? r.created_at;
  if (!end || !from) return null;
  const a = Date.parse(from), b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const d = (b - a) / 86400000;
  return d >= 0 ? d : null;
}

function count<T>(rows: T[], key: (r: T) => string | null | undefined, opts: { label?: (k: string) => string; overdue?: (r: T) => boolean; blank?: string } = {}): Bar[] {
  const m = new Map<string, Bar>();
  for (const r of rows) {
    const k = key(r) || opts.blank || '';
    if (!k) continue;
    const b = m.get(k) ?? { key: k, label: opts.label ? opts.label(k) : k, count: 0, overdue: 0 };
    b.count++; if (opts.overdue?.(r)) b.overdue!++;
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Complaints rolled up by account, worst record first: most complaints, then
 * most still live, then most recent. 'none' collects the few raised against no
 * client at all.
 */
export function clientBars(rows: ComplaintListRow[]): ClientBar[] {
  const raised = (r: ComplaintListRow) => (r.complaint_date ?? r.created_at).slice(0, 10);
  const clients = new Map<string, ClientBar>();
  for (const r of rows) {
    const key = r.client_id == null ? 'none' : String(r.client_id);
    const b = clients.get(key) ?? {
      key, label: r.client_name ?? (key === 'none' ? 'No client on the complaint' : `Client #${key}`),
      code: r.client_code, count: 0, open: 0, overdue: 0, repeats: 0, worst: null, last: '',
    };
    b.count++;
    if (isOpenStatus(r.status)) b.open++;
    if (r.overdue) b.overdue++;
    if (r.repeat_complaint === true) b.repeats++;
    if (r.severity && (b.worst == null || SEV_ORDER.indexOf(r.severity) < SEV_ORDER.indexOf(b.worst))) b.worst = r.severity;
    const on = raised(r);
    if (on > b.last) b.last = on;
    clients.set(key, b);
  }
  return [...clients.values()].sort((a, b) =>
    b.count - a.count || b.open - a.open || b.last.localeCompare(a.last) || a.label.localeCompare(b.label));
}

/**
 * Category-wise open count and category-wise average time to close, the two
 * figures the review asked for by name.
 *
 * Keyed on `category_any`, so the 31 complaints migration 0114 could read onto
 * a new Complaint Category are counted under it and the 5 it could not are
 * still counted — under the old `defect_category` wording, marked legacy, so a
 * reader can see which bars are the old vocabulary rather than wondering why
 * the bars do not add up to the total.
 */
export function categoryBars(rows: ComplaintListRow[]): CategoryBar[] {
  const m = new Map<string, CategoryBar & { closeDays: number[] }>();
  for (const r of rows) {
    const key = r.category_any;
    if (!key) continue;
    const legacy = r.complaint_category == null;
    const b = m.get(key) ?? { key, label: key, count: 0, open: 0, overdue: 0, avgClose: null, closed: 0, legacy, closeDays: [] };
    b.count++;
    if (isOpenStatus(r.status)) b.open++; else b.closed++;
    if (r.overdue) b.overdue++;
    // A category is "legacy" only while every row under it is.
    if (!legacy) b.legacy = false;
    const d = spanDays(r, r.closed_at);
    if (d != null) b.closeDays.push(d);
    m.set(key, b);
  }
  return [...m.values()]
    .map(({ closeDays, ...b }) => ({ ...b, avgClose: avg(closeDays) }))
    .sort((a, b) => b.open - a.open || b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The drill-down the review asked for: Complaint Category → Sub-Category →
 * part → MOC, each level a filter the next one narrows.
 *
 * Levels three and four read `complaint_parts`, which is where page 2's part
 * rows live now. The old single-part columns on `complaints` are read as a
 * fallback so historical rows still appear at the part level instead of the
 * branch going dead under them. A branch with nothing under it stops rather
 * than rendering an empty level.
 */
export function drillTree(rows: ComplaintListRow[]): DrillNode[] {
  const node = (filter: string, value: string): DrillNode =>
    ({ filter, value, label: value, count: 0, open: 0, children: [] });
  const find = (list: DrillNode[], filter: string, value: string) => {
    let n = list.find(x => x.value === value);
    if (!n) { n = node(filter, value); list.push(n); }
    return n;
  };

  const top: DrillNode[] = [];
  for (const r of rows) {
    const cat = r.category_any;
    if (!cat) continue;
    const open = isOpenStatus(r.status) ? 1 : 0;
    const c = find(top, 'cat', cat);
    c.count++; c.open += open;
    const sub = r.complaint_subcategory;
    if (!sub) continue;
    const s = find(c.children, 'subcat', sub);
    s.count++; s.open += open;
    // Every part named on the complaint, or the single part the old schema held.
    const parts: { part_name: string | null; moc: string | null }[] = r.parts.length
      ? r.parts
      : (r.part_name ? [{ part_name: r.part_name, moc: null }] : []);
    for (const p of parts) {
      if (!p.part_name) continue;
      const pn = find(s.children, 'pname', p.part_name);
      pn.count++; pn.open += open;
      if (!p.moc) continue;
      const mo = find(pn.children, 'moc', p.moc);
      mo.count++; mo.open += open;
    }
  }
  const sortDeep = (list: DrillNode[]): DrillNode[] =>
    list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .map(n => ({ ...n, children: sortDeep(n.children) }));
  return sortDeep(top);
}

export function summariseComplaints(rows: ComplaintListRow[], dwells: HolderDwell[], nowIso = new Date().toISOString()): ComplaintSummary {
  const today = nowIso.slice(0, 10), thisMonth = today.slice(0, 7);
  const d30 = new Date(Date.parse(nowIso) - 30 * 86400000).toISOString().slice(0, 10);

  const openRows = rows.filter(r => isOpenStatus(r.status));
  const closedRows = rows.filter(r => !isOpenStatus(r.status));
  const wf = rows.filter(r => r.schema_version >= 2);
  // Time to close means time to CLOSED. The old figure measured every finished
  // complaint to whichever of closed_at / resolved_at it had, which quietly
  // folded 20 complaints that are resolved and still waiting to be closed into
  // an average labelled "time to close" and pulled it down. The two measures
  // are now separate and both are shown.
  const closeDays = rows.map(r => spanDays(r, r.closed_at)).filter((d): d is number => d != null);
  const resolveDays = rows.map(r => spanDays(r, r.resolved_at ?? r.closed_at)).filter((d): d is number => d != null);
  const openAges = openRows.map(r => r.age_days);

  const closedOn = (r: ComplaintListRow) => (r.closed_at ?? r.resolved_at ?? '').slice(0, 10);
  const raisedOn = (r: ComplaintListRow) => (r.complaint_date ?? r.created_at).slice(0, 10);

  // Twelve months, raised vs closed.
  const months: ComplaintSummary['months'] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    months.push({ key, label: d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), raised: 0, closed: 0 });
  }
  const mi = new Map(months.map((m, i) => [m.key, i]));
  const closedSet = new Set(closedRows);
  for (const r of rows) {
    const a = mi.get(ym(raisedOn(r)) ?? ''); if (a != null) months[a].raised++;
    const c = closedSet.has(r) ? mi.get(ym(closedOn(r)) ?? '') : undefined; if (c != null) months[c].closed++;
  }

  // Funnel: where the open ones are now, and how long complaints spend in each status (historic, workflow only).
  const perStatus = new Map<string, number[]>();
  for (const d of dwells) (perStatus.get(d.status) ?? perStatus.set(d.status, []).get(d.status)!).push(d.days);
  // The eight workflow stages, plus any legacy stage that actually holds rows —
  // otherwise "every stage" quietly leaves out the In Progress and Awaiting
  // Client complaints that make up most of the history.
  const step = (s: string): StatusStep => ({
    status: s, count: rows.filter(r => r.status === s).length,
    avgDays: avg(perStatus.get(s) ?? []), stretches: (perStatus.get(s) ?? []).length,
  });
  const funnel: StatusStep[] = [
    ...STATUSES.map(step),
    ...LEGACY_STATUSES.filter(s => !(STATUSES as readonly string[]).includes(s))
      .map(step).filter(x => x.count > 0),
  ];

  // The five headline names. Every complaint lands on exactly one, so these sum
  // to the total — which is the property the old purelyOpen / partiallyOpen /
  // closed triple did not have once Feedback arrived.
  const byHeadline: HeadlineBar[] = HEADLINE_STATUSES.map(h => {
    const mine = rows.filter(r => r.headline === h);
    return {
      key: h, label: h, count: mine.length,
      overdue: mine.filter(r => r.overdue).length,
      stages: [...new Set(mine.map(r => r.status))].sort(),
    };
  });

  // Holders: current load (open now) and total historic time held.
  const holderKey = (dept: string, uid: number | null, name: string | null) => (uid != null ? `${dept}|${uid}` : dept);
  const holders = new Map<string, HolderBar>();
  const bump = (dept: string, uid: number | null, name: string | null, byPerson: boolean) => {
    const key = byPerson ? holderKey(dept, uid, name) : dept;
    const label = byPerson ? (name ? `${name} · ${dept}` : `${dept} (unassigned)`) : dept;
    let h = holders.get(key);
    if (!h) { h = { key, label, department: dept, userId: byPerson ? uid : null, open: 0, days: 0, avgDays: 0, stretches: 0, totalDays: 0 }; holders.set(key, h); }
    return h;
  };
  const deptBars = new Map<string, HolderBar>(), personBars = new Map<string, HolderBar>();
  for (const [byPerson, store] of [[false, deptBars], [true, personBars]] as const) {
    holders.clear();
    for (const r of openRows) {
      if (r.schema_version < 2) continue;
      const h = bump(r.holder_department ?? 'Complaint Team', r.holder_user_id, r.holder_name, byPerson);
      h.open++; h.days += r.days_in_status;
    }
    for (const d of dwells) {
      const h = bump(d.department, d.holder_user_id, d.holder_name, byPerson);
      h.totalDays += d.days; h.stretches++;
    }
    for (const h of holders.values()) { h.avgDays = h.stretches ? h.totalDays / h.stretches : 0; store.set(h.key, h); }
  }
  const sortHolders = (m: Map<string, HolderBar>) => [...m.values()].sort((a, b) => b.days - a.days || b.totalDays - a.totalDays);

  const openWf = openRows.filter(r => r.schema_version >= 2);
  const bySeverity: Bar[] = SEV_ORDER.map(s => ({
    key: s, label: SEV_LABEL[s],
    count: openWf.filter(r => (r.severity ?? 'none') === s).length,
    overdue: openWf.filter(r => (r.severity ?? 'none') === s && r.overdue).length,
  }));

  const ageBuckets = [[-1, 7, '≤7d'], [7, 30, '8–30d'], [30, 90, '31–90d'], [90, Infinity, '>90d']] as const;
  const openByAge = ageBuckets.map(([lo, hi, label]) => ({ label, count: openRows.filter(r => r.age_days > lo && r.age_days <= hi).length }));

  const byClient = clientBars(rows);

  const repeatBase = wf.filter(r => r.repeat_complaint != null);
  const repeatCount = wf.filter(r => r.repeat_complaint === true).length;

  const capaOf = (s: CapaState) => rows.filter(r => r.capa_state === s).length;
  const capa: CapaCounts = {
    raised: rows.filter(r => r.capa_required === true).length,
    open: capaOf('open'), review: capaOf('review'), closed: capaOf('closed'), none: capaOf('none'),
  };

  return {
    total: rows.length, workflow: wf.length, legacy: rows.length - wf.length,
    open: openRows.length, closed: closedRows.length,
    trulyClosed: rows.filter(r => r.status === 'Closed').length,
    resolvedAwaitingClose: rows.filter(r => r.status === 'Resolved').length,
    awaitingFeedback: rows.filter(r => r.status === 'Feedback').length,
    overdue: openRows.filter(r => r.overdue).length,
    overdueNoAction: rows.filter(r => r.overdue_kind === 'no-action').length,
    overdueActed: rows.filter(r => r.overdue_kind === 'acted').length,
    severe: rows.filter(r => r.severe).length,
    severeOpen: openRows.filter(r => r.severe).length,
    avgOpenAge: avg(openAges), oldestOpen: openAges.length ? Math.round(Math.max(...openAges)) : null,
    avgTimeToClose: avg(closeDays), medianTimeToClose: median(closeDays), closedCount: closeDays.length,
    avgTimeToResolve: avg(resolveDays), resolvedCount: resolveDays.length,
    raisedThisMonth: rows.filter(r => raisedOn(r).startsWith(thisMonth)).length,
    closedThisMonth: closedRows.filter(r => closedOn(r).startsWith(thisMonth)).length,
    raised30: rows.filter(r => raisedOn(r) >= d30).length,
    closed30: closedRows.filter(r => closedOn(r) >= d30).length,
    repeatCount, repeatRate: repeatBase.length ? repeatCount / repeatBase.length : null,
    reopened: wf.filter(r => r.reopen_count > 0).length,
    linkedCount: rows.filter(r => r.linked_complaint_id != null || r.repeat_complaint === true).length,
    bySeverity, byHeadline, funnel,
    byHolderDept: sortHolders(deptBars), byHolderPerson: sortHolders(personBars).filter(h => h.userId != null || h.open > 0),
    longestSitting: [...openWf].sort((a, b) => b.days_in_status - a.days_in_status).slice(0, 6),
    byResponsible: count(wf, r => r.responsible_department, { overdue: r => r.overdue }),
    byCategory: categoryBars(rows),
    bySubcategory: count(rows, r => r.complaint_subcategory, { overdue: r => r.overdue }),
    byAction: count(rows, r => r.action_category, { overdue: r => r.overdue }),
    byIndustry: count(rows, r => r.industry, { overdue: r => r.overdue, blank: 'No industry on file' }),
    byChannel: count(rows, r => r.channel, { overdue: r => r.overdue }),
    byClientType: count(rows, r => r.client_type, { overdue: r => r.overdue }),
    byRep: count(openRows, r => r.rep_name ?? (r.rep_user_id ? `#${r.rep_user_id}` : 'No rep'), { overdue: r => r.overdue }),
    capa,
    preventivePending: rows.filter(preventiveActionPending).length,
    visitPending: rows.filter(visitPending).length,
    drill: drillTree(rows),
    byClient, clientCount: byClient.length,
    months, openByAge,
  };
}
