import risansiPool from '@/lib/db-risansi';
import { complaintVisibilitySql, type CurrentUser } from '@/lib/risansi-auth';
import {
  HEADLINE_STATUSES, headlineStatus, isOpenStatus, statusesFor, statusesUnderHeadline,
  overdueFor, isImmediateResponse,
  type HeadlineStatus, type OverdueKind, type Severity,
} from '@/lib/risansi-complaint-flow';
// The thresholds have one loader, in the module that owns the three
// Admin-editable tables. The export route and the Client 360 panel read the
// same one, so a threshold edited in Admin cannot mean different things to the
// dashboard and the sheet it downloads.
import { loadSlaThresholds } from '@/lib/risansi-complaint-admin';

// The complaints list, as rows, and the numbers on top of it.
//
// One loader feeds the Complaints page, its analytics, the Client 360 panel
// and the export, so they never disagree about who holds what. The holder of
// a complaint is whoever the latest stage-log row names; "days in status" is
// measured from that row. Everything is computed for the rows the user may
// see — a rep's analytics are over their clients' complaints, the Complaint
// Team's over all.
//
// Whether a complaint is LATE is deliberately not computed in SQL. It used to
// be, as `target_completion_date < CURRENT_DATE`, and that is the single
// biggest reason the dashboard could not be trusted: a target date is only
// typed on page 5, so a complaint sitting at Open — the ones most worth
// chasing — could never be late. The rule is now age since raised against the
// threshold the severity earns, and the only implementation of it is
// `overdueFor` in lib/risansi-complaint-flow.ts. This module calls it on every
// row after the query comes back rather than mirroring it in SQL, so the two
// cannot drift: there is no second copy to keep in step.

/** One part named on a complaint, for the Damage → Joint → part → MOC drill-down. */
export interface ComplaintPartRow {
  part_type: string | null; part_name: string | null; moc: string | null;
  quantity: number | null; vendor_name: string | null; part_code: string | null;
}

export interface ComplaintListRow {
  id: number; complaint_no: string; legacy_ref: string | null;
  client_id: number | null; client_name: string | null; client_code: string | null;
  /** The OEM it came through, when it did. Lets a record tell a complaint
   *  about this client apart from one this client raised. */
  oem_client_id: number | null; oem_client_name: string | null;
  /** The client's industry, for the industry-wise view. Null where no client is on the complaint. */
  industry: string | null;
  status: string; schema_version: number; severity: Severity | null;
  /** The five headline names, derived from `status`. The sub-stage stays in `status`. */
  headline: HeadlineStatus;
  /** NEW (decision 1 / page 1). `complaint_type` and `defect_category` below are what historical rows carry instead. */
  complaint_category: string | null; complaint_subcategory: string | null;
  complaint_type: string | null; defect_category: string | null; defect_reason: string | null;
  /** The category a filter should match: the new answer, or the old one on a row that has no new answer. */
  category_any: string | null;
  root_cause_category: string | null; root_cause_sub: string | null;
  part_type: string | null; part_name: string | null;
  /** Every part named on page 2, newest schema only — the drill-down reads these. */
  parts: ComplaintPartRow[];
  responsible_department: string | null; channel: string | null;
  /** Direct / OEM (renamed from supply_through). */
  client_type: string | null;
  pump_model: string | null; model_version: string | null; model_series: string | null;
  complaint_date: string | null; created_at: string; resolved_at: string | null; closed_at: string | null;
  details: string | null; contact_person: string | null;
  /** The rep the complaint is attributed to: the client's owner. Carries the
   *  column's old name because every reader keys on it; see the query. */
  rep_user_id: number | null; rep_name: string | null;
  holder_department: string | null; holder_user_id: number | null; holder_name: string | null;
  since: string | null; days_in_status: number; age_days: number;
  target_completion_date: string | null;
  /** Late by the severity-graded age rule. Computed by `overdueFor`, never in SQL. */
  overdue: boolean;
  /** 'no-action' — still at an Open headline; 'acted' — moved on and late anyway. */
  overdue_kind: OverdueKind;
  /** Days since raised, and the threshold its severity earned, so a tile can explain itself. */
  overdue_days: number | null; overdue_threshold: number | null;
  /** Severe / Immediate Response: any one of Safety, Shutdown, Penalty, Repeat answered Yes. */
  severe: boolean;
  /**
   * Lodged but not yet registered: it has a number and a client and nothing
   * else. The lodge window asks for almost nothing on purpose, so these have to
   * be findable — otherwise a complaint somebody phoned in sits among the open
   * ones looking like it has been dealt with.
   */
  awaiting_registration: boolean;
  repeat_complaint: boolean | null; reopen_count: number;
  /** The original this one repeats (decision 4 / page 8). */
  linked_complaint_id: number | null; linked_complaint_no: string | null;
  investigation_assigned_to: number | null; action_assigned_to: number | null;
  action_category: string | null; pump_serial_no: string | null; quantity: number | null;
  /** Commercial flag from page 5. Not `risk_cost_impact`, which grades severity. */
  cost_impact: boolean | null;
  /** CAPA: what was asked for, what came back, and the derived state the dashboard filters on. */
  capa_required: boolean | null; capa_received_date: string | null;
  capa_departments: string[] | null;
  corrective_action_required: boolean | null;
  corrective_action_remarks: string | null; preventive_action_remarks: string | null;
  preventive_action: string | null;
  capa_state: CapaState;
  /** A free replacement was promised, and the paperwork behind it. */
  free_replacement: boolean; fr_ec_no: string | null; target_dispatch_date: string | null;
  /** Customer communication files (letters, emails, confirmations), for a link straight from the list. */
  customer_files: { id: number; file_name: string }[];
}

export interface ComplaintFilters {
  status?: string;      // one status, or 'open' / 'closed'
  /** One of the five headline names (decision 1). Expands to its sub-stages. */
  headline?: string;
  sev?: string;         // S1..S4 or 'none'
  dept?: string;        // current holder department
  holder?: string;      // current holder user id
  cat?: string;         // complaint_category (was defect_category)
  subcat?: string;      // complaint_subcategory
  /** defect_category, offered only for the historical rows the mapping left unmapped. */
  dcat?: string;
  resp?: string;        // responsible_department
  rep?: string;         // the client's owner (see rep_user_id above)
  era?: string;         // 'workflow' | 'legacy'
  q?: string;           // free text
  /** '1' for any, or 'no-action' / 'acted' — the two halves the dashboard asked for. */
  overdue?: string;
  from?: string; to?: string; // complaint_date range
  rcc?: string;         // root_cause_category (page 4)
  rcs?: string;         // root_cause_sub (page 4)
  ptype?: string;       // part_type (page 2, or complaint_parts)
  pname?: string;       // part_name (page 2, or complaint_parts), matched loosely
  moc?: string;         // MOC on complaint_parts — the last step of the drill-down
  client?: string;      // client_id — set by the by-client chart
  ind?: string;         // the client's industry
  ctype?: string;       // client_type: Direct / OEM
  action?: string;      // action_category ("Action Taken")
  /** Derived CAPA state: 'open' | 'review' | 'closed' | 'raised' | 'pending' | 'none'. */
  capa?: string;
  /** 'pending' — nothing written in either preventive-action field. */
  pa?: string;
  /** 'pending' — Visit Planned and the complaint is still live. */
  visit?: string;
  /** '1' — Severe / Immediate Response. */
  severe?: string;
  unregistered?: string;   // '1' — lodged, Registration not filled in yet
  /** '1' — flagged a repeat, or linked to an earlier complaint. */
  linked?: string;
  /** Model version code, e.g. V06. Free text on the column, so matched exactly. */
  mver?: string;
  /** Model series. Free text by decision 12 — see the note on MODEL_SERIES_UNORDERED. */
  mseries?: string;
  /**
   * How far along: 'open' (untouched), 'partial' (started, not finished),
   * 'closed' (resolved or closed), or the legacy 'live' (open + partial).
   * See ComplaintState in risansi-complaint-flow.
   *
   * Superseded on screen by `headline`, which is the vocabulary the business
   * uses (decision 1). Still honoured here so an old bookmark or a shared
   * link keeps selecting what it used to.
   */
  state?: string;
}

export const FILTER_KEYS: (keyof ComplaintFilters)[] = [
  'state', 'headline', 'status', 'sev', 'dept', 'holder', 'cat', 'subcat', 'dcat', 'resp', 'rep', 'era', 'q',
  'overdue', 'from', 'to', 'rcc', 'rcs', 'ptype', 'pname', 'moc', 'client', 'ind', 'ctype', 'action',
  'capa', 'pa', 'visit', 'severe', 'unregistered', 'linked', 'mver', 'mseries',
];

/*
 * Why requirement (A), "pumps of H100 and above", is not a filter.
 *
 * It needs an ordering over pump sizes. `model_series` was made free text by
 * decision 12, and holds nothing on any of the 219 complaints on file; the
 * H-number is otherwise buried inside `pump_model`, where it appears as
 * RTOH**61100**ABBN, RTOHAG**10190**ABBN, PSLH**4160**AABN and ZLPRO300…,
 * three different encodings in which the digits after the H are not a size on
 * a single scale. Parsing "100" out of RTOH101100AABN and comparing it with
 * the 100 in PSLH101100AABN would produce a number the dashboard could sort
 * and nobody could trust. Until a series is captured as a bounded list, the
 * honest answer is that the filter cannot be built — see the report.
 */

/** Column sorts the list offers; anything else falls back to the default (open first, longest-sitting first). */
export const SORT_KEYS = ['raised', 'since', 'age', 'target'] as const;
export type ComplaintSortKey = typeof SORT_KEYS[number];
export interface ComplaintSort { key: ComplaintSortKey; dir: 'asc' | 'desc' }

export function parseComplaintSort(sp: Record<string, string | string[] | undefined>): ComplaintSort | null {
  const v = typeof sp.sort === 'string' ? sp.sort : '';
  const m = v.match(/^(raised|since|age|target)_(asc|desc)$/);
  return m ? { key: m[1] as ComplaintSortKey, dir: m[2] as 'asc' | 'desc' } : null;
}

/**
 * What an old `?status=` roll-up meant. 'open' was everything unfinished,
 * which is the union the three-way split calls 'live'; 'closed' is unchanged.
 */
const legacyState = (status: string | undefined) =>
  status === 'open' ? 'live' : status === 'closed' ? 'closed' : undefined;

export function parseComplaintFilters(sp: Record<string, string | string[] | undefined>): ComplaintFilters {
  const f: ComplaintFilters = {};
  for (const k of FILTER_KEYS) { const v = sp[k]; if (typeof v === 'string' && v !== '') f[k] = v; }
  // Before the states and the stages were split, one `status` param carried
  // both. A bookmark or a shared link holding the old roll-up still selects
  // what it used to, and lands in the control it now belongs to.
  const legacy = legacyState(f.status);
  if (legacy) { f.state = f.state ?? legacy; delete f.status; }
  // `?type=` filtered `complaint_type`, which is no longer collected. The nearest
  // honest reading of an old link is the category, which is what replaced it.
  if (!f.cat && typeof sp.type === 'string' && sp.type !== '') f.cat = sp.type;
  if (f.headline && !(HEADLINE_STATUSES as readonly string[]).includes(f.headline)) delete f.headline;
  return f;
}

const SORT_SQL: Record<ComplaintSortKey, string> = {
  raised: 'COALESCE(x.complaint_date::date, x.created_at::date)',
  since:  'x.since::timestamptz',
  age:    'x.age_days',
  target: 'x.target_completion_date',
};

// ── Derived CAPA state ─────────────────────────────────────────────────────

export type CapaState = 'none' | 'open' | 'review' | 'closed';

/**
 * Where a complaint's CAPA has got to, from the three things actually stored:
 * whether one was asked for, whether it came back, and whether the complaint
 * itself is still live.
 *
 * - `none`   — no CAPA was asked for. Page 6 lost its mandatory flag
 *              (decision 12), so this is most complaints and is not a failing.
 * - `open`   — asked for, nothing back yet. This is the "pending" half of
 *              requirement (H)'s "raised vs pending".
 * - `review` — a CAPA came back and the complaint is still live: somebody has
 *              to read it.
 * - `closed` — came back, complaint finished.
 */
export function capaStateOf(c: {
  status: string; capa_required: boolean | null;
  capa_received_date: string | null; corrective_action_remarks: string | null;
}): CapaState {
  if (c.capa_required !== true) return 'none';
  const back = !!c.capa_received_date || !!(c.corrective_action_remarks ?? '').trim();
  if (!back) return 'open';
  return isOpenStatus(c.status) ? 'review' : 'closed';
}

/**
 * A preventive action is owed and has not been written.
 *
 * Deliberately not "every open complaint with the field blank". That reading
 * returns 32 of 32 open complaints today, which is the same number as the Open
 * tile and so tells a reader nothing. A preventive action only becomes due
 * once somebody knows what went wrong or has asked the vendor for a CAPA, so
 * the requirement's "Preventive Action pending" is scoped to those: a root
 * cause recorded, a corrective action required, or a CAPA asked for.
 */
export const preventiveActionPending = (c: {
  status: string; preventive_action: string | null; preventive_action_remarks: string | null;
  root_cause_category: string | null; corrective_action_required: boolean | null;
  capa_required: boolean | null;
}): boolean =>
  isOpenStatus(c.status)
  && (!!c.root_cause_category || c.corrective_action_required === true || c.capa_required === true)
  && !(c.preventive_action ?? '').trim()
  && !(c.preventive_action_remarks ?? '').trim();

/** A visit was the action taken and the complaint has not closed out. */
export const visitPending = (c: { status: string; action_category: string | null }): boolean =>
  c.action_category === 'Visit Planned' && isOpenStatus(c.status);

// ── The rows ───────────────────────────────────────────────────────────────

/** The default order, in memory rather than in SQL, because `overdue` is. */
function defaultOrder(rows: ComplaintListRow[]): ComplaintListRow[] {
  return [...rows].sort((a, b) =>
    (isOpenStatus(a.status) ? 0 : 1) - (isOpenStatus(b.status) ? 0 : 1)
    || Number(b.overdue) - Number(a.overdue)
    || b.days_in_status - a.days_in_status
    || b.id - a.id);
}

export async function loadComplaintRows(user: CurrentUser, opts: {
  clientId?: number;
  /**
   * Also return complaints this client RAISED on somebody else's pump, which
   * only happens when they are an OEM. A complaint that comes through an OEM
   * belongs to the mill — that is where the pump, the visit history and the
   * responsible rep are — but it is still the OEM's complaint to ask about, and
   * their own record would otherwise show nothing at all. Opt-in, so the
   * Complaints page's own client filter still means one thing.
   */
  includeRaisedAsOem?: boolean;
  filters?: ComplaintFilters;
  sort?: ComplaintSort | null;
} = {}): Promise<ComplaintListRow[]> {
  const f = opts.filters ?? {};
  const conds: string[] = [];
  const outer: string[] = [];   // on the lateral holder row, so after the subquery
  const params: unknown[] = [];
  const add = (sql: string, v: unknown, into: string[] = conds) => { params.push(v); into.push(sql.replace('?', `$${params.length}`)); };
  const literalList = (xs: string[]) => xs.map(x => `'${x.replace(/'/g, "''")}'`).join(',');

  const vis = complaintVisibilitySql(user, 'c');
  if (vis) conds.push(`(${vis})`);
  if (opts.clientId != null) {
    if (opts.includeRaisedAsOem) {
      params.push(opts.clientId);
      const i = params.length;
      conds.push(`(c.client_id = $${i} OR c.oem_client_id = $${i})`);
    } else {
      add('c.client_id = ?', opts.clientId);
    }
  }

  // How far along. Built from statusesFor, so the rows, the stage dropdown and
  // the chart can never disagree about what "partially open" contains.
  // parseComplaintFilters folds a legacy roll-up into `state`; a caller that
  // builds filters by hand may still pass it the old way.
  const state = f.state ?? legacyState(f.status);
  if (state) conds.push(`c.status = ANY(ARRAY[${literalList(statusesFor(state))}])`);
  // One of the five headline names, expanded to the sub-stages behind it, so a
  // tile and the list agree about what "Action Taken" contains.
  if (f.headline) {
    const list = statusesUnderHeadline(f.headline as HeadlineStatus);
    conds.push(list.length ? `c.status = ANY(ARRAY[${literalList(list)}])` : 'FALSE');
  }
  // Stage: one named status.
  if (f.status && f.status !== 'open' && f.status !== 'closed') add('c.status = ?', f.status);
  if (f.sev === 'none') conds.push('c.severity IS NULL AND c.schema_version >= 2');
  else if (f.sev) add('c.severity = ?', f.sev);
  // The category question, on the new column. 31 of the 36 old `defect_category`
  // answers were read onto it by migration 0114; the five it could not map
  // without guessing are reachable through `dcat` instead, and both are offered.
  if (f.cat) add('c.complaint_category = ?', f.cat);
  if (f.subcat) add('c.complaint_subcategory = ?', f.subcat);
  if (f.dcat) add('c.defect_category = ?', f.dcat);
  if (f.resp) add('c.responsible_department = ?', f.resp);
  // The Rep filter means the client's owner, which is who the complaint is
  // attributed to (lib/risansi-attribution.ts). c.rep_user_id is kept and
  // still written, but it is blank on 182 of 216 complaints and agrees with
  // the owner on every one of the 34 that carry it, so reading it was giving
  // the column nothing to say. It is the fallback only where there is no
  // client to own the complaint at all.
  if (f.rep) add('COALESCE(cl.primary_rep_id, c.rep_user_id) = ?', Number(f.rep) || 0);
  // 'none' is the handful of complaints raised against no client at all.
  if (f.client === 'none') conds.push('c.client_id IS NULL');
  else if (f.client) add('c.client_id = ?', Number(f.client) || 0);
  if (f.ind === 'none') conds.push('cl.industry IS NULL');
  else if (f.ind) add('cl.industry = ?', f.ind);
  if (f.ctype) add('c.client_type = ?', f.ctype);
  if (f.rcc) add('c.root_cause_category = ?', f.rcc);
  if (f.rcs) add('c.root_cause_sub = ?', f.rcs);
  if (f.action) add('c.action_category = ?', f.action);
  if (f.mver) add('c.model_version = ?', f.mver);
  if (f.mseries) add('c.model_series = ?', f.mseries);
  // Part type / name / MOC read page 2's own columns and the complaint_parts
  // rows that replaced them, so the drill-down works across both schemas.
  if (f.ptype) {
    // One parameter read twice, so it is placed by hand: `add` replaces the
    // first `?` only and would leave the second one in the SQL.
    params.push(f.ptype);
    const p = `$${params.length}`;
    conds.push(`(c.part_type = ${p} OR EXISTS (SELECT 1 FROM complaint_parts p1 WHERE p1.complaint_id = c.id AND p1.part_type = ${p}))`);
  }
  if (f.pname) {
    params.push(`%${f.pname.trim()}%`);
    const p = `$${params.length}`;
    conds.push(`(c.part_name ILIKE ${p} OR EXISTS (SELECT 1 FROM complaint_parts p2 WHERE p2.complaint_id = c.id AND p2.part_name ILIKE ${p}))`);
  }
  if (f.moc) {
    params.push(f.moc);
    const p = `$${params.length}`;
    conds.push(`(c.rubber_moc = ${p} OR EXISTS (SELECT 1 FROM complaint_parts p3 WHERE p3.complaint_id = c.id AND p3.moc = ${p}))`);
  }
  if (f.severe === '1') conds.push('(c.risk_safety OR c.risk_shutdown OR c.risk_penalty OR c.risk_repeat_failure)');
  if (f.linked === '1') conds.push('(c.linked_complaint_id IS NOT NULL OR c.repeat_complaint)');
  if (f.era === 'legacy') conds.push('c.schema_version < 2');
  else if (f.era === 'workflow') conds.push('c.schema_version >= 2');
  if (f.from) add('COALESCE(c.complaint_date, c.created_at::date) >= ?::date', f.from);
  if (f.to) add('COALESCE(c.complaint_date, c.created_at::date) <= ?::date', f.to);
  if (f.q) {
    params.push(`%${f.q.trim()}%`);
    const p = `$${params.length}`;
    conds.push(`(c.complaint_no ILIKE ${p} OR c.legacy_ref ILIKE ${p} OR cl.legal_name ILIKE ${p} OR c.details ILIKE ${p} OR c.pump_serial_no ILIKE ${p} OR c.ec_no ILIKE ${p})`);
  }
  if (f.dept) add('x.holder_department = ?', f.dept, outer);
  if (f.holder) add('x.holder_user_id = ?', Number(f.holder) || 0, outer);

  const [thresholds, result] = await Promise.all([
    loadSlaThresholds(),
    risansiPool.query<Omit<ComplaintListRow, 'headline' | 'overdue' | 'overdue_kind' | 'overdue_days' | 'overdue_threshold' | 'severe' | 'capa_state' | 'category_any' | 'awaiting_registration'> & {
      risk_safety: boolean | null; risk_shutdown: boolean | null; risk_penalty: boolean | null; risk_repeat_failure: boolean | null;
    }>(`
    SELECT * FROM (
      SELECT c.id, c.complaint_no, c.legacy_ref, c.client_id, cl.legal_name AS client_name, cl.code AS client_code,
             c.oem_client_id, oem.legal_name AS oem_client_name,
             cl.industry,
             c.status, c.schema_version, c.severity,
             c.complaint_category, c.complaint_subcategory,
             c.complaint_type, c.defect_category, c.defect_reason,
             c.root_cause_category, c.root_cause_sub, c.part_type, c.part_name,
             c.client_type, c.pump_model, c.model_version, c.model_series,
             -- COALESCE, because a complaint with no action decided yet gives
             -- NULL here, not false, and the row's type says boolean.
             COALESCE(c.action_category = 'Free Replacement', FALSE) AS free_replacement,
             c.fr_ec_no, c.target_dispatch_date::text AS target_dispatch_date,
             c.responsible_department, c.channel,
             c.complaint_date::text AS complaint_date, c.created_at::text AS created_at,
             c.resolved_at::text AS resolved_at, c.closed_at::text AS closed_at,
             c.details, c.contact_person,
             c.cost_impact, c.capa_required, c.capa_received_date::text AS capa_received_date,
             c.capa_departments, c.corrective_action_required,
             c.corrective_action_remarks, c.preventive_action_remarks, c.preventive_action,
             c.risk_safety, c.risk_shutdown, c.risk_penalty, c.risk_repeat_failure,
             COALESCE(cl.primary_rep_id, c.rep_user_id) AS rep_user_id, ur.name AS rep_name,
             l.holder_department, l.holder_user_id, hu.name AS holder_name, l.created_at::text AS since,
             COALESCE(EXTRACT(EPOCH FROM (now() - l.created_at)) / 86400, 0)::float AS days_in_status,
             (EXTRACT(EPOCH FROM (COALESCE(c.closed_at, c.resolved_at, now()) - COALESCE(c.complaint_date::timestamptz, c.created_at))) / 86400)::float AS age_days,
             c.target_completion_date::text AS target_completion_date,
             c.repeat_complaint, COALESCE(c.reopen_count, 0)::int AS reopen_count,
             c.linked_complaint_id, lk.complaint_no AS linked_complaint_no,
             c.investigation_assigned_to, c.action_assigned_to, c.action_category, c.pump_serial_no, c.quantity,
             COALESCE((SELECT json_agg(json_build_object(
                           'part_type', p.part_type, 'part_name', p.part_name, 'moc', p.moc,
                           'quantity', p.quantity, 'vendor_name', p.vendor_name, 'part_code', p.part_code)
                         ORDER BY p.sort_order, p.id)
                         FROM complaint_parts p WHERE p.complaint_id = c.id), '[]'::json) AS parts,
             COALESCE((SELECT json_agg(json_build_object('id', a.id, 'file_name', a.file_name) ORDER BY a.uploaded_at)
                         FROM complaint_attachments a WHERE a.complaint_id = c.id AND a.category = 'customer'), '[]'::json) AS customer_files
        FROM complaints c
        LEFT JOIN clients cl ON cl.id = c.client_id
        LEFT JOIN clients oem ON oem.id = c.oem_client_id
        LEFT JOIN complaints lk ON lk.id = c.linked_complaint_id
        LEFT JOIN users ur ON ur.id = COALESCE(cl.primary_rep_id, c.rep_user_id)
        LEFT JOIN LATERAL (
          SELECT s.holder_department, s.holder_user_id, s.created_at
            FROM complaint_stage_log s WHERE s.complaint_id = c.id
           ORDER BY s.created_at DESC, s.id DESC LIMIT 1) l ON TRUE
        LEFT JOIN users hu ON hu.id = l.holder_user_id
       ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
    ) x
    ${outer.length ? `WHERE ${outer.join(' AND ')}` : ''}
    ${opts.sort
      ? `ORDER BY ${SORT_SQL[opts.sort.key]} ${opts.sort.dir === 'asc' ? 'ASC NULLS LAST' : 'DESC NULLS LAST'}, x.id ${opts.sort.dir === 'asc' ? 'ASC' : 'DESC'}`
      : ''}`, params),
  ]);

  const now = new Date();
  let rows: ComplaintListRow[] = result.rows.map(r => {
    // One call, one rule. Mirroring overdueFor in SQL would mean two places to
    // change the thresholds, the Feedback status and the no-action split.
    const o = overdueFor(r, thresholds, now);
    return {
      ...r,
      headline: headlineStatus(r.status),
      category_any: r.complaint_category ?? r.defect_category,
      overdue: o.overdue, overdue_kind: o.kind, overdue_days: o.days, overdue_threshold: o.threshold,
      severe: isImmediateResponse(r),
      // Source and description are the two answers Registration cannot do
      // without and lodging never collects. Category is deliberately not part
      // of this: 188 historical complaints have no category and were plainly
      // registered, so including it would flag them all.
      awaiting_registration: isOpenStatus(r.status)
        && (!String(r.channel ?? '').trim() || !String(r.details ?? '').trim()),
      capa_state: capaStateOf(r),
      parts: Array.isArray(r.parts) ? r.parts : [],
      customer_files: Array.isArray(r.customer_files) ? r.customer_files : [],
    };
  });

  // The filters that read a computed column have to run here, after it exists.
  if (f.unregistered === '1') rows = rows.filter(r => r.awaiting_registration);
  if (f.overdue === '1') rows = rows.filter(r => r.overdue);
  else if (f.overdue === 'no-action') rows = rows.filter(r => r.overdue_kind === 'no-action');
  else if (f.overdue === 'acted') rows = rows.filter(r => r.overdue_kind === 'acted');
  if (f.capa === 'raised') rows = rows.filter(r => r.capa_required === true);
  else if (f.capa === 'pending') rows = rows.filter(r => r.capa_state === 'open');
  else if (f.capa) rows = rows.filter(r => r.capa_state === f.capa);
  if (f.pa === 'pending') rows = rows.filter(preventiveActionPending);
  if (f.visit === 'pending') rows = rows.filter(visitPending);
  else if (f.visit === 'planned') rows = rows.filter(r => r.action_category === 'Visit Planned');

  return opts.sort ? rows : defaultOrder(rows);
}

// ── Historic dwell per holder, across every complaint the user may see ──

export interface HolderDwell {
  department: string; holder_user_id: number | null; holder_name: string | null;
  status: string; complaint_id: number; days: number; current: boolean;
}

export async function loadHolderDwells(user: CurrentUser, opts: { clientId?: number } = {}): Promise<HolderDwell[]> {
  const vis = complaintVisibilitySql(user, 'c');
  const params: unknown[] = [];
  const conds = ['c.schema_version >= 2'];
  if (vis) conds.push(`(${vis})`);
  if (opts.clientId != null) { params.push(opts.clientId); conds.push(`c.client_id = $${params.length}`); }
  const { rows } = await risansiPool.query<HolderDwell>(`
    SELECT COALESCE(l.holder_department, 'Complaint Team') AS department, l.holder_user_id, u.name AS holder_name,
           l.to_status AS status, l.complaint_id,
           (EXTRACT(EPOCH FROM (COALESCE(LEAD(l.created_at) OVER w, now()) - l.created_at)) / 86400)::float AS days,
           (LEAD(l.created_at) OVER w IS NULL) AS current
      FROM complaint_stage_log l
      JOIN complaints c ON c.id = l.complaint_id
      LEFT JOIN users u ON u.id = l.holder_user_id
     WHERE ${conds.join(' AND ')}
    WINDOW w AS (PARTITION BY l.complaint_id ORDER BY l.created_at, l.id)`, params);
  // Time after Resolved / Closed is nobody's.
  return rows.filter(r => isOpenStatus(r.status));
}
