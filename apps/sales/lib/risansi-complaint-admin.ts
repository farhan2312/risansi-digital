import risansiPool from '@/lib/db-risansi';
import {
  CASCADING_LOOKUP_KINDS, PROVISIONAL_SLA_DAYS, SEVERITIES, headlineStatus,
  type Severity, type SlaThresholds,
} from '@/lib/risansi-complaint-flow';

// What the complaint module lets the Complaint Team change without a developer,
// read from the three tables that hold it.
//
//   complaint_lookups             every dropdown the form offers
//   complaint_action_assignment   which Action Taken hands the work to whom
//   complaint_sla_thresholds      how many days each severity gets
//
// The loaders live here rather than in the Admin page because three other
// readers need the same rows: the Client 360 complaints panel and the export
// both grade overdue off the thresholds, and the preview script renders both.
// Nothing here writes — the writes are server actions in
// app/actions/risansi-complaint-admin.ts, which validate first.

// ── Lists ──────────────────────────────────────────────────────────────────

export interface LookupRow {
  kind: string;
  value: string;
  /** The parent choice this value hangs under, for a cascading kind. */
  parent_value: string | null;
  sort_order: number;
  is_active: boolean;
  /** True when the Add On control put it there rather than a seed migration. */
  is_user_added: boolean;
  /** How many complaints currently answer with this value. Zero is not "unused". */
  in_use: number;
}

/**
 * Every lookup row, active and inactive, in the order a list reads.
 *
 * Inactive rows are included on purpose: Admin is the one screen that has to
 * show them, because an inactive value is still resolving a label on the
 * complaints filed under it and reactivating one is how a list is restored.
 *
 * `in_use` counts the complaints answering with the value. It is a count per
 * (kind, value) and not per (kind, value, parent) — the complaints table holds
 * the answer and not the parent it was chosen under, so Shaft under External
 * and Shaft under Child Parts of Joints share a count. Shown as a reason not
 * to retire something, which it is either way.
 */
export async function loadComplaintLookupRows(): Promise<LookupRow[]> {
  const { rows } = await risansiPool.query<LookupRow>(`
    WITH used AS (
      SELECT 'source'                AS kind, channel               AS value, count(*)::int AS n FROM complaints WHERE channel               IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'complaint_category',     complaint_category,     count(*)::int FROM complaints WHERE complaint_category     IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'complaint_subcategory',  complaint_subcategory,  count(*)::int FROM complaints WHERE complaint_subcategory  IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'complaint_type',         complaint_type,         count(*)::int FROM complaints WHERE complaint_type         IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'defect_category',        defect_category,        count(*)::int FROM complaints WHERE defect_category        IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'defect_reason',          defect_reason,          count(*)::int FROM complaints WHERE defect_reason          IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'ec_made_by',             ec_made_by,             count(*)::int FROM complaints WHERE ec_made_by             IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'action_category',        action_category,        count(*)::int FROM complaints WHERE action_category        IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'root_cause_category',    root_cause_category,    count(*)::int FROM complaints WHERE root_cause_category    IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'root_cause_sub',         root_cause_sub,         count(*)::int FROM complaints WHERE root_cause_sub         IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'responsible_department', responsible_department, count(*)::int FROM complaints WHERE responsible_department IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'returnable_status',      returnable_status,      count(*)::int FROM complaints WHERE returnable_status      IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'accounts_action',        accounts_action,        count(*)::int FROM complaints WHERE accounts_action        IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'effectiveness',          action_effectiveness,   count(*)::int FROM complaints WHERE action_effectiveness   IS NOT NULL GROUP BY 2
      -- The part lists are answered on complaint_parts now and on the old
      -- single-part columns before that, so both are counted.
      UNION ALL SELECT 'part_type', part_type, count(*)::int FROM complaints      WHERE part_type IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'part_type', part_type, count(*)::int FROM complaint_parts WHERE part_type IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'part_name', part_name, count(*)::int FROM complaints      WHERE part_name IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'part_name', part_name, count(*)::int FROM complaint_parts WHERE part_name IS NOT NULL GROUP BY 2
    )
    SELECT l.kind, l.value, l.parent_value, l.sort_order, l.is_active, l.is_user_added,
           COALESCE((SELECT sum(u.n)::int FROM used u WHERE u.kind = l.kind AND u.value = l.value), 0) AS in_use
      FROM complaint_lookups l
     ORDER BY l.kind, COALESCE(l.parent_value, ''), l.sort_order, l.value`);
  return rows;
}

/** A human name for each list, and whether the form still asks for it. */
export interface KindMeta { label: string; note: string; retired?: boolean }

export const LOOKUP_KINDS: Record<string, KindMeta> = {
  source:                 { label: 'Complaint source',      note: 'Page 1 — how the complaint reached us.' },
  complaint_category:     { label: 'Complaint category',    note: 'Page 1 — the five. Decides whether QC or the Complaint Team investigates.' },
  complaint_subcategory:  { label: 'Complaint sub-category', note: 'Page 1 — hangs under the category. Client Related has none yet; add them here.' },
  part_type:              { label: 'Part type',             note: 'Page 2 parts — the five types a complaint can be about.' },
  part_name:              { label: 'Part name',             note: 'Page 2 parts — hangs under the part type.' },
  ec_made_by:             { label: 'EC made by',            note: 'Page 2 — who prepared the EC.' },
  root_cause_category:    { label: 'Root cause category',   note: 'Page 4 — Human Error, Design or Process.' },
  root_cause_sub:         { label: 'Root cause',            note: 'Page 4 — hangs under the category. Design and Process are still pending; add them here.' },
  responsible_department: { label: 'Responsible department', note: 'Page 4 — filled from the root cause, overridable.' },
  action_category:        { label: 'Action taken',          note: 'Page 5 — and the key the assignment map below is built on.' },
  returnable_status:      { label: 'Returnable status',     note: 'Page 7 — where the returnable material has got to.' },
  accounts_action:        { label: 'Accounts action',       note: 'Page 7 — what Accounts did about it.' },
  effectiveness:          { label: 'Action effectiveness',  note: 'Page 8 — how well the corrective action worked.' },
  complaint_type:         { label: 'Complaint type',        note: 'Retired. The form stopped asking; the complaints filed under it still read their answer.', retired: true },
  defect_category:        { label: 'Defect category',       note: 'Retired, replaced by Complaint category. Kept so the 36 complaints filed under it still read.', retired: true },
  defect_reason:          { label: 'Defect reason',         note: 'Retired. The form stopped asking; historical answers still read.', retired: true },
};

export const kindLabel = (kind: string) => LOOKUP_KINDS[kind]?.label ?? kind;

/** The kind a cascading list hangs under, or null when it stands alone. */
export const parentKindOf = (kind: string): string | null => CASCADING_LOOKUP_KINDS[kind] ?? null;

// ── Action assignment ──────────────────────────────────────────────────────

export type AssigneeKind = 'user' | 'department' | 'client_rep';

export interface ActionAssignmentRow {
  action: string;
  /** False when the action is on the list but nothing says who picks it up. */
  mapped: boolean;
  assignee_kind: AssigneeKind | null;
  user_id: number | null;
  user_name: string | null;
  department: string | null;
  /** The action is still offered on page 5. An unlisted action is history. */
  active: boolean;
  /** Complaints currently answering with this action. */
  in_use: number;
}

/**
 * Two rows that are standing in for somebody.
 *
 * The requirement names Krishna for calling material back and for replacing
 * it. There is no Krishna in `users` — not by name, not by email — so there was
 * no id to point the rows at, and both were seeded to the Complaint Team as a
 * department instead. That is a placeholder and should not be mistaken for the
 * decision: the Admin screen says so on the row, and says it louder when a
 * Krishna account turns up.
 */
export const PROVISIONAL_ASSIGNMENTS: Record<string, { person: string; why: string }> = {
  'Call Back Material': {
    person: 'Krishna',
    why: 'The requirement of 2 Oct gives this to Krishna. He has no login, so the Complaint Team holds it meanwhile.',
  },
  'Replace Material': {
    person: 'Krishna',
    why: 'The requirement of 2 Oct gives this to Krishna. He has no login, so the Complaint Team holds it meanwhile.',
  },
};

/** Is this row still the placeholder, rather than somebody's actual decision? */
export function isProvisionalAssignment(r: Pick<ActionAssignmentRow, 'action' | 'assignee_kind'>): boolean {
  return r.action in PROVISIONAL_ASSIGNMENTS && r.assignee_kind !== 'user';
}

/**
 * Every Action Taken on the list, with who it assigns to — including the ones
 * nothing assigns, which is the row that needs attention and would be invisible
 * if the map were read on its own.
 */
export async function loadActionAssignments(): Promise<ActionAssignmentRow[]> {
  const { rows } = await risansiPool.query<ActionAssignmentRow>(`
    SELECT l.value AS action,
           (a.action IS NOT NULL) AS mapped,
           a.assignee_kind, a.user_id, u.name AS user_name, a.department,
           l.is_active AS active,
           COALESCE((SELECT count(*)::int FROM complaints c WHERE c.action_category = l.value), 0) AS in_use
      FROM complaint_lookups l
      LEFT JOIN complaint_action_assignment a ON a.action = l.value
      LEFT JOIN users u ON u.id = a.user_id
     WHERE l.kind = 'action_category'
    UNION ALL
    -- An assignment whose action has left the list entirely. It cannot be
    -- chosen any more, but it is still a row in the table and hiding it would
    -- make the screen disagree with the database.
    SELECT a.action, TRUE, a.assignee_kind, a.user_id, u.name, a.department, FALSE, 0
      FROM complaint_action_assignment a
      LEFT JOIN users u ON u.id = a.user_id
     WHERE NOT EXISTS (SELECT 1 FROM complaint_lookups l WHERE l.kind = 'action_category' AND l.value = a.action)
     ORDER BY 7 DESC, 1`);
  return rows;
}

/**
 * Anyone who could be the Krishna the requirement means. Matched on the name
 * and the email, the same two places migration 0108 looked and found nothing,
 * so the screen can offer the fix the moment the account exists instead of
 * waiting for somebody to notice.
 */
export async function loadKrishnaCandidates(): Promise<{ id: number; name: string }[]> {
  const { rows } = await risansiPool.query<{ id: number; name: string }>(
    `SELECT id, name FROM users
      WHERE is_active AND (lower(name) LIKE '%krishna%' OR lower(email) LIKE '%krishna%')
      ORDER BY name`);
  return rows;
}

// ── SLA thresholds ─────────────────────────────────────────────────────────

/**
 * Days per severity before an open complaint is overdue, as configured.
 *
 * The one reader of `complaint_sla_thresholds`: the row loader grades every
 * complaint it returns from these figures, the export names them in its header,
 * and the Admin editor below writes them. Two readers that fell back
 * differently is how a dashboard and an Admin screen end up disagreeing about
 * what the threshold is.
 *
 * Falls back to PROVISIONAL_SLA_DAYS for a severity with no row, which is what
 * overdueFor expects; a missing row would otherwise mean "no deadline at this
 * level" and quietly stop grading a whole severity.
 */
export async function loadSlaThresholds(): Promise<SlaThresholds> {
  const out: SlaThresholds = { ...PROVISIONAL_SLA_DAYS };
  try {
    const { rows } = await risansiPool.query<{ severity: string; days: number }>(
      'SELECT severity, days FROM complaint_sla_thresholds');
    for (const r of rows) {
      if ((SEVERITIES as readonly string[]).includes(r.severity)) out[r.severity as Severity] = Number(r.days);
    }
  } catch { /* table may not exist on an un-migrated copy */ }
  return out;
}

export interface SlaSeverityFacts {
  severity: Severity;
  days: number;
  /**
   * One entry per open complaint this threshold grades: how old it is, and
   * whether anything has been done about it yet. The second half is what splits
   * the dashboard's overdue tile into "no action taken" and "action taken".
   */
  open: { age: number; noAction: boolean }[];
}

/**
 * What each threshold is actually deciding right now: the age of every open
 * complaint it grades. The editor counts overdue from this as the number is
 * typed, so "S1 from 2 to 3" shows its consequence before it is saved rather
 * than after.
 *
 * Ungraded complaints are counted under S4, which is where overdueFor puts
 * them — an unanswered page 3 should not take a complaint out of the reckoning.
 */
export async function loadSlaFacts(thresholds: SlaThresholds): Promise<SlaSeverityFacts[]> {
  const { rows } = await risansiPool.query<{ severity: string; age: number; status: string }>(`
    SELECT COALESCE(severity, 'S4') AS severity,
           GREATEST(0, CURRENT_DATE - COALESCE(complaint_date, created_at::date))::int AS age,
           status
      FROM complaints
     WHERE status NOT IN ('Resolved', 'Feedback', 'Closed')`);
  return SEVERITIES.map(s => ({
    severity: s,
    days: thresholds[s] ?? PROVISIONAL_SLA_DAYS[s],
    open: rows
      .filter(r => r.severity === s)
      .map(r => ({ age: Number(r.age), noAction: headlineStatus(r.status) === 'Open' }))
      .sort((a, b) => b.age - a.age),
  }));
}
