// The complaint workflow, as rules.
//
// Everything a page or an action needs to decide — which fields a page asks,
// who may edit it, what the risk answers make the severity, what a status may
// move to and what it needs first, who is holding the complaint while it sits
// in a status — lives here, pure and importable from both server and client.
// The pages render it; the actions enforce it; scripts test it. Nothing in
// here touches the database.
//
// Source: Complaint_Module_Final_Form_Structure.xlsx (11 Sep 2026) and the
// decisions of 12–13 Sep, then Complaint_Module_Change_Requirements (2 Oct
// 2026) and the twelve decisions taken on it, all recorded in the plan. Where
// a rule here contradicts the 2 Oct document, a numbered decision says why.
//
// A field leaving a page does not drop its column. The complaints filed under
// it keep their answers and keep reading; the page simply stops asking.

import type { Department, RisansiRole } from '@/lib/risansi-auth';

// Not hasRole from risansi-auth: that module pulls in next-auth and the pool,
// and this file is imported by client components. Admin and sysadmin are the
// only ranks that matter here.
const isAdminRole = (role: string) => role === 'admin' || role === 'sysadmin';

// ── Status ─────────────────────────────────────────────────────────────────

export const STATUSES = [
  'Open', 'Under Investigation', 'Action Pending', 'Replacement Pending',
  'Customer Confirmation Pending', 'Resolved', 'Feedback', 'Closed',
] as const;
export type ComplaintStatus = typeof STATUSES[number];

/** The legacy five, still legal on schema_version 1 rows. */
export const LEGACY_STATUSES = ['Open', 'In Progress', 'Awaiting Client', 'Resolved', 'Closed'] as const;

/**
 * Finished or not. Feedback sits with Resolved and Closed, not against them:
 * the fix has landed and all that remains is asking the client how it went, so
 * counting those rows as open would put them back into the open-age and
 * overdue figures the dashboard review was complaining about.
 *
 * `lib/risansi-complaint-rows.ts` repeats this predicate in SQL. The two have
 * to agree — change one and change the other.
 */
export const isOpenStatus = (s: string) => s !== 'Resolved' && s !== 'Feedback' && s !== 'Closed';

/**
 * The five words the business uses for where a complaint is: Open, Action
 * Taken, Resolved, Closed, Feedback (decision 1).
 *
 * These are a grouping over the eight statuses, not a replacement for them.
 * The sub-stage is what the team works with — "Replacement Pending" tells you
 * who to chase, "Action Taken" does not — so the sub-stage stays stored and
 * the headline is derived here. Nothing migrates, nothing is lost, and a
 * dashboard tile and a complaint page can disagree about granularity without
 * disagreeing about fact.
 */
export const HEADLINE_STATUSES = ['Open', 'Action Taken', 'Resolved', 'Feedback', 'Closed'] as const;
export type HeadlineStatus = typeof HEADLINE_STATUSES[number];

/**
 * Sub-stage → headline. The legacy two are mapped by what they were equivalent
 * to rather than by their wording, so a schema_version 1 row lands on the same
 * headline as the timeline step `statusStep` gives it.
 */
export const HEADLINE_OF: Record<string, HeadlineStatus> = {
  'Open': 'Open',
  'Under Investigation': 'Open',
  'Action Pending': 'Action Taken',
  'Replacement Pending': 'Action Taken',
  'Customer Confirmation Pending': 'Action Taken',
  'Resolved': 'Resolved',
  'Feedback': 'Feedback',
  'Closed': 'Closed',
  'In Progress': 'Open',              // ≡ Under Investigation
  'Awaiting Client': 'Action Taken',  // ≡ Customer Confirmation Pending
};

/** The headline a status rolls up to. An unknown status reads as Open rather than vanishing from a tile. */
export const headlineStatus = (s: string): HeadlineStatus => HEADLINE_OF[s] ?? 'Open';

/** The sub-stages behind one headline — what a tile has to filter on to drill down. */
export const statusesUnderHeadline = (h: HeadlineStatus): string[] =>
  Object.keys(HEADLINE_OF).filter(s => HEADLINE_OF[s] === h);

/**
 * How far along a complaint is, in three answers rather than two.
 *
 * - `open`    — untouched. Nobody has started on it.
 * - `partial` — started but not finished: under investigation, waiting on an
 *               action, a replacement or the customer. Work is happening.
 * - `closed`  — resolved, out for feedback, or closed.
 * - `live`    — open plus partial. Not offered as a choice; it is what the old
 *               single `status=open` roll-up meant, so a link written before
 *               the split still selects what it used to.
 *
 * "Open" used to mean anything unfinished, which put a complaint nobody had
 * looked at in the same bucket as one sitting with QC — the two need chasing
 * in completely different ways.
 */
export type ComplaintState = 'open' | 'partial' | 'closed' | 'live';

export const STATE_LABEL: Record<ComplaintState, string> = {
  open: 'Open', partial: 'Partially open', closed: 'Closed', live: 'Open + partially',
};

/**
 * The stages that belong to one state, legacy ones included; every stage when
 * no state is chosen. Keeps the Status dropdown honest about the toggle beside
 * it. Lives here rather than beside the filters because a client component
 * imports it, and the filter module pulls in the pool.
 */
export function statusesFor(state: string | undefined): string[] {
  const all = [...new Set<string>([...STATUSES, ...LEGACY_STATUSES])];
  if (state === 'open')    return all.filter(s => s === 'Open');
  if (state === 'partial') return all.filter(s => isOpenStatus(s) && s !== 'Open');
  if (state === 'closed')  return all.filter(s => !isOpenStatus(s));
  if (state === 'live')    return all.filter(isOpenStatus);
  return all;
}

/** The colour each status wears, in pills and on the timeline. Legacy statuses included. */
export const STATUS_TONE: Record<string, string> = {
  'Open': 'var(--neg)', 'Under Investigation': 'var(--accent)', 'Action Pending': 'var(--warn, #B45309)',
  'Replacement Pending': 'var(--warn, #B45309)', 'Customer Confirmation Pending': '#7C3AED',
  'Resolved': 'var(--pos)', 'Feedback': 'var(--pos)', 'Closed': 'var(--fg-3)',
  'In Progress': 'var(--accent)', 'Awaiting Client': '#7C3AED',
};

/** The five departments of the module, plus the customer, as holders a complaint can sit with. */
export const DEPARTMENTS_LIST = ['Complaint Team', 'QC', 'Quotation Team', 'Billing Team', 'Purchase', 'Customer'] as const;

/** Where the timeline puts a status, 0..7. Legacy statuses map to the nearest step. */
export function statusStep(s: string): number {
  const i = (STATUSES as readonly string[]).indexOf(s);
  if (i >= 0) return i;
  return s === 'In Progress' ? 1 : s === 'Awaiting Client' ? 4 : 0;
}

// ── Routing — which complaint belongs to whom ──────────────────────────────

/**
 * The department that owns the technical side of a complaint, by Complaint
 * Category (decision 6). Complaint Type used to answer this — Technical → QC,
 * anything else → the Complaint Team — but Type is gone from registration
 * because it was a second, vaguer way of saying what the category already
 * says. Performance, BOI Issue and Damage are pump problems and need QC to
 * look at the part; Supply Related and Client Related are paperwork and
 * conversation, which the Complaint Team does itself.
 */
export const CATEGORY_OWNER: Record<string, Department> = {
  'Supply Related': 'Complaint Team',
  'BOI Issue': 'QC',
  'Performance': 'QC',
  'Damage': 'QC',
  'Client Related': 'Complaint Team',
};

/** An unmapped or unanswered category stays with the Complaint Team, who can hand it on. */
export const ownerForCategory = (category?: string | null): Department =>
  CATEGORY_OWNER[String(category ?? '')] ?? 'Complaint Team';

/**
 * The owning department of one complaint, category first and Complaint Type
 * only as a fallback.
 *
 * The fallback is not dead code: complaints raised before the category existed
 * have a `complaint_type` and no `complaint_category` (decision 9 keeps them as
 * they are rather than guessing a category for them), and QC must still reach
 * the ones they were already working.
 */
export function routingOwner(c: { complaint_category?: string | null; complaint_type?: string | null }): Department {
  if (c.complaint_category) return ownerForCategory(c.complaint_category);
  if (c.complaint_type) return c.complaint_type === 'Technical' ? 'QC' : 'Complaint Team';
  return 'Complaint Team';
}

/**
 * Responsible Department, read off the root cause (decision 8).
 *
 * It used to be asked at registration, where nobody could honestly answer it:
 * naming the department at fault is the *conclusion* of an investigation, not
 * an intake field, and the pair of guesses (the Complaint Team's and the TSM's)
 * disagreed often enough that the figure meant nothing. So page 4 derives it
 * from the root cause, where the answer is actually known.
 *
 * The values are the `responsible_department` lookup's own, not `Department` —
 * the blame list has entries like Rubber Dept and Packing & Dispatch that are
 * not module departments and never had logins.
 *
 * `null` means no mapping yet, which is a real answer while the Complaint team
 * is still writing the Design and Process sub-cause lists: the UI should leave
 * the field for a human rather than fill it with a default that reads as fact.
 */
export const RESPONSIBLE_DEPARTMENT_BY_ROOT_CAUSE: Record<string, { fallback: string | null; bySub: Record<string, string> }> = {
  'Human Error': {
    fallback: null,
    bySub: {
      'Wrong EC': 'Quotation Team',          // the EC is prepared there
      'Wrong Packing': 'Packing & Dispatch',
      'Wrong Billing': 'Billing Team',
    },
  },
  'Design': { fallback: 'Drawing Team', bySub: {} },
  'Process': { fallback: 'QC & Production', bySub: {} },
};

export function responsibleDepartmentFor(rootCauseCategory?: string | null, rootCauseSub?: string | null): string | null {
  const m = RESPONSIBLE_DEPARTMENT_BY_ROOT_CAUSE[String(rootCauseCategory ?? '')];
  if (!m) return null;
  return m.bySub[String(rootCauseSub ?? '')] ?? m.fallback;
}

// ── Severity ───────────────────────────────────────────────────────────────

/**
 * Two levels, worst first.
 *
 * This was S1-S4 off a truth table of eleven questions. The Complaint Team
 * asked for four questions and two outcomes, and the grading questions went
 * with the grades: four Yes/No answers can say "this is bad" and not much
 * more, which is what High and Low now mean. The seven dropped questions keep
 * their columns and their recorded answers, so why a complaint used to read S2
 * is still legible; they are simply no longer asked.
 */
export const SEVERITIES = ['High', 'Low'] as const;
export type Severity = typeof SEVERITIES[number];

export interface RiskAnswers {
  risk_safety?: boolean | null; risk_shutdown?: boolean | null; risk_penalty?: boolean | null; risk_pump_failure?: boolean | null;
  risk_major_perf?: boolean | null; risk_head_mismatch?: boolean | null; risk_repeat_failure?: boolean | null;
  risk_repeat_mistake?: boolean | null; risk_cost_impact?: boolean | null;
  risk_workable?: boolean | null; risk_qty_over_5?: boolean | null;
}

/**
 * The four questions criticality is decided by. Every one of them is required:
 * with only four, an unanswered one is the difference between High and Low
 * rather than a detail.
 *
 * Repeat is `risk_repeat_failure` — the same complaint coming back — and not
 * `risk_repeat_mistake`, which was the internal variant and is one of the
 * seven no longer asked.
 */
export const RISK_FIELDS: { key: keyof RiskAnswers; label: string; required: boolean }[] = [
  { key: 'risk_safety',         label: 'Safety risk',          required: true },
  { key: 'risk_shutdown',       label: 'Customer shutdown',    required: true },
  { key: 'risk_penalty',        label: 'Contractual penalty',  required: true },
  { key: 'risk_repeat_failure', label: 'Repeat',               required: true },
];

/** All four of them, now that there is no second block to tell them from. */
export const IMMEDIATE_RISK_FIELDS = RISK_FIELDS;

/**
 * High criticality: any one of the four answered Yes.
 *
 * This used to be a flag separate from the S-grade, because a complaint could
 * want attention today without being critical by the grading matrix. With two
 * levels they are the same statement, so this is kept as the name the list
 * flag, the dashboard tile and the notification already call it rather than
 * made into a second way of asking the same question.
 */
export const isImmediateResponse = (a: RiskAnswers): boolean =>
  RISK_FIELDS.some(f => a[f.key] === true);

/** High if any of the four is Yes, Low if they were answered and none was, null until then. */
export function severityOf(a: RiskAnswers): Severity | null {
  if (RISK_FIELDS.some(f => a[f.key] === true)) return 'High';
  return RISK_FIELDS.some(f => a[f.key] != null) ? 'Low' : null;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  High: 'High criticality', Low: 'Low criticality',
};
/** What each level owes before it can be closed. */
export const SEVERITY_REQUIRES: Record<Severity, string> = {
  High: 'An investigation, a root cause, and a CAPA document before closure.',
  Low: 'A corrective action, or remarks saying what was done.',
};
export const SEVERITY_TONE: Record<Severity, string> = {
  High: 'var(--neg)', Low: 'var(--fg-3)',
};

// ── Pages and fields ───────────────────────────────────────────────────────

export type FieldType =
  | 'text' | 'long' | 'date' | 'number' | 'money' | 'bool' | 'select' | 'user' | 'yesno4' | 'paid'
  /** A dropdown you may also type into — the list suggests, it does not confine. */
  | 'select_free'
  /** A client with client_type = 'OEM', stored as the client's id. */
  | 'oem'
  /** Several answers from one list, stored as a text[]. */
  | 'multi'
  /** Another complaint, stored as its id. */
  | 'complaint';

export interface ComplaintField {
  name: string;
  label: string;
  type: FieldType;
  /** For type 'select' / 'select_free' / 'multi': the complaint_lookups kind. */
  lookup?: string;
  /** For type 'select' / 'multi': a fixed list, where the answers are not a lookup table. */
  options?: string[];
  required?: boolean;
  hint?: string;
  /** Shown only when another field holds one of these values. */
  showWhen?: { field: string; equals: (string | boolean)[] };
  /**
   * Cascading select: the field whose answer picks which sub-list this one
   * offers. Sub-category under Complaint Category, Part Name under Part Type,
   * Root Cause Sub under Root Cause Category — three places where the list is
   * only meaningful once the parent is answered.
   *
   * `showWhen` cannot express this. It compares a field to a literal list, so
   * it can hide a field until the parent has *an* answer but has no way to say
   * "and the options depend on which answer" — spelling that out as showWhen
   * would mean one field definition per parent value, five copies of
   * Sub-category that all write the same column.
   */
  parentField?: string;
  /** Pre-filled from the installed base when EC / serial is looked up. */
  fromPump?: boolean;
}

/**
 * The lists for one cascading kind, grouped by the parent value they hang
 * under: `{ 'Supply Related': ['Excess', 'Short', …], 'BOI Issue': [ … ] }`.
 *
 * `complaint_lookups` gained a `parent_value` column, so one kind now holds a
 * family of lists rather than a single list. A loader that already builds
 * `Record<kind, string[]>` for the flat kinds builds this alongside it:
 *
 *   SELECT kind, parent_value, value FROM complaint_lookups
 *    WHERE is_active AND parent_value IS NOT NULL
 *    ORDER BY kind, parent_value, sort_order, value
 *
 * grouped by kind then parent_value. Pass it to the form beside `lookups` and
 * let `optionsFor` choose; the flat map stays exactly as it was, so nothing
 * that does not cascade has to know this exists.
 */
export type CascadingLookup = Record<string, string[]>;
export type CascadingLookups = Record<string, CascadingLookup>;

/**
 * The cascading kinds and the kind each hangs under. The form reads
 * `parentField` off the field; Admin needs this instead, because it edits the
 * lookup table itself and has no form field to read.
 */
/**
 * The lists somebody filling the form may add to on the spot.
 *
 * The requirement asks for "+ Add On" against the source, the sub-categories,
 * EC made by and the part names, and it is asking for a reason: these are
 * lists nobody can finish in advance. A complaint arriving by a route not on
 * the list, or about a part nobody has filed before, must not stop at the
 * dropdown and wait for an admin — the person with the complaint in front of
 * them is the one who knows the value.
 *
 * Deliberately not every list. Category, status and action drive routing,
 * gates and the dashboard, so a new one of those is a decision about how the
 * module works rather than a word somebody is missing, and it stays in Admin.
 */
export const ADD_ON_LOOKUP_KINDS: readonly string[] = [
  'source', 'complaint_subcategory', 'ec_made_by', 'part_name', 'root_cause_sub',
];

export const CASCADING_LOOKUP_KINDS: Record<string, string> = {
  complaint_subcategory: 'complaint_category',
  part_name: 'part_type',
  root_cause_sub: 'root_cause_category',
};

export interface ComplaintPage {
  id: number;
  slug: string;
  title: string;
  owner: string;
  /** Departments that may edit this page. Reps and managers reach page 1 by role. */
  departments: Department[];
  repsMayEdit?: boolean;
  fields: ComplaintField[];
}

/**
 * The actions that mean material left the factory at our expense: a free
 * replacement, a material replacement, and Paid Replacement, the name the
 * second one used to carry on rows that already exist.
 *
 * One list, used three ways — which challan fields page 5 shows, when Cost
 * Impact forces itself to Yes, and what the FR figures sum over — so the three
 * can never drift into disagreeing about what an FR is.
 */
export const FR_ACTIONS = ['Free Replacement', 'Replace Material', 'Paid Replacement'] as const;

/**
 * The eight pages, in the order the Complaint Team works them: Investigation
 * now comes before Risk & Criticality, because the four criticality questions
 * are easier to answer once somebody has looked at the pump.
 *
 * `id` is NOT the position. It is the stable key every gate, edit permission
 * and status rule is written against, so the two are deliberately separate —
 * renumbering the ids to match this order would have silently repointed all of
 * them at the wrong page. `pageStep` gives the number a reader sees.
 */
export const PAGES: ComplaintPage[] = [
  {
    id: 1, slug: 'registration', title: 'Registration', owner: 'TSM / Complaint Team',
    departments: ['Complaint Team'], repsMayEdit: true,
    fields: [
      { name: 'complaint_date', label: 'Complaint date', type: 'date', required: true },
      { name: 'channel', label: 'Complaint source', type: 'select', lookup: 'source', required: true },
      // Defect Category renamed to Complaint Category and moved onto its own
      // column. The five answers are a different question from the old list of
      // symptoms — they say what kind of problem this is, which is what decides
      // who investigates it (see CATEGORY_OWNER). `defect_category` is left in
      // the table untouched so the complaints filed under it still read.
      { name: 'complaint_category', label: 'Complaint category', type: 'select', lookup: 'complaint_category', required: true, hint: 'Decides who investigates: Performance, BOI Issue and Damage go to QC.' },
      { name: 'complaint_subcategory', label: 'Complaint sub-category', type: 'select', lookup: 'complaint_subcategory', parentField: 'complaint_category', hint: 'The list follows the category above. Not required: Client Related has no sub-categories yet.' },
      { name: 'details', label: 'Complaint description', type: 'long', required: true },
      // A complaint that arrives through the OEM who supplied the pump is a
      // different conversation from one the client raises directly. Renamed
      // from Supply Through, which nobody read as a question about the client.
      { name: 'client_type', label: 'Client type', type: 'select', options: ['Direct', 'OEM'], hint: 'Did the pump reach this client directly, or through an OEM?' },
      { name: 'oem_client_id', label: 'OEM name', type: 'oem', showWhen: { field: 'client_type', equals: ['OEM'] }, hint: 'From the client master — the OEM account itself, so its complaints can be counted.' },
    ],
  },
  {
    id: 2, slug: 'order', title: 'Order & Pump', owner: 'Complaint Team / QC',
    departments: ['Complaint Team', 'QC'],
    fields: [
      { name: 'so_no', label: 'SO No.', type: 'text', required: true, fromPump: true },
      // A name off a list rather than nine spellings of Amit: EC Made By is
      // what the investigation follows when the EC itself is the root cause.
      { name: 'ec_made_by', label: 'EC made by', type: 'select', lookup: 'ec_made_by' },
      { name: 'invoice_no', label: 'Invoice / challan no.', type: 'text' },
      { name: 'invoice_date', label: 'Invoice date', type: 'date' },
      { name: 'client_po_no', label: 'Client PO no.', type: 'text' },
      { name: 'client_po_date', label: 'Client PO date', type: 'date' },
      { name: 'pump_serial_no', label: 'Pump serial no.', type: 'text', fromPump: true, hint: 'The traceability key when known — looks up the installed base too. Not always on the pump or the paperwork, so not mandatory.' },
      { name: 'pump_model', label: 'Model as per name plate', type: 'text', required: true, fromPump: true, hint: 'Copied off the plate on the pump, whatever it says.' },
      // The sortable half of the model. The name plate carries the full model
      // and cannot be ordered or filtered on ("H100 and above" is a dashboard
      // filter the review asked for); the series can. Free text by decision 12
      // — the H10..H120L range is still growing.
      { name: 'model_series', label: 'Model series', type: 'text', hint: 'H10 to H120L. What the dashboard sorts and filters pumps by.' },
      { name: 'internal_model_no', label: 'Internal model no.', type: 'text' },
      { name: 'model_version', label: 'Version', type: 'text' },
      // Everything after Version is gone from this page: one complaint had room
      // for exactly one part, one EC and one MOC, and a complaint about four
      // damaged joints had to be filed four times or lose three of them. The
      // columns stay on `complaints` for the rows already using them; new part
      // detail goes to `complaint_parts`, one row per part, as many as the
      // complaint needs. Which part fields are asked depends on the Complaint
      // Category, so the parts editor is its own control rather than a field
      // list here.
    ],
  },
  {
    id: 4, slug: 'investigation', title: 'Investigation & Root Cause', owner: 'QC for a pump problem · Complaint Team otherwise',
    departments: ['Complaint Team', 'QC'],
    fields: [
      // Analysis Required, Investigation Assigned To and the two dates are
      // gone. Whether an investigation happened is already answered by this
      // page having a root cause on it, and the dates were filled in once the
      // work was over, which is the one moment they tell nobody anything. The
      // columns stay; the assignment still governs who may edit this page.
      { name: 'root_cause_category', label: 'Root cause category', type: 'select', lookup: 'root_cause_category', required: true, hint: 'Human Error, Design or Process.' },
      { name: 'root_cause_sub', label: 'Root cause sub-cause', type: 'select', lookup: 'root_cause_sub', parentField: 'root_cause_category', hint: 'The list follows the category. Only the Human Error causes are seeded so far; the rest come from the Complaint team.' },
      { name: 'root_cause', label: 'Complaint root cause', type: 'long', required: true, hint: 'In words: what actually happened, beyond the two answers above.' },
      { name: 'internal_remarks', label: 'Internal discussion / analysis remarks', type: 'long' },
      { name: 'corrective_action_required', label: 'Corrective action', type: 'bool', hint: 'Yes opens page 5.' },
      // Derived from the root cause by responsibleDepartmentFor, not carried
      // from registration — registration no longer asks. Still a select, so a
      // mapping the investigation disagrees with can be overruled by the
      // person who did the investigating.
      { name: 'responsible_department', label: 'Responsible department', type: 'select', lookup: 'responsible_department', required: true, hint: 'Filled from the root cause above. Change it if the investigation says otherwise.' },
    ],
  },
  {
    id: 3, slug: 'risk', title: 'Risk & Criticality', owner: 'Complaint Team · QC for a pump problem',
    departments: ['Complaint Team', 'QC'],
    fields: [
      ...RISK_FIELDS.map(f => ({
        name: f.key as string, label: f.label, type: 'bool' as FieldType, required: f.required,
        hint: 'One Yes here makes the complaint High criticality.',
      })),
      { name: 'capa_needed', label: 'CAPA required', type: 'bool', hint: 'Does this need a corrective and preventive action raised? Yes routes it to the departments below.' },
      // Several may be ticked, and that is the point: a BOI failure is QC's to
      // investigate and Purchase's to take up with the vendor, and making one
      // of them the single owner is how the other one stops reading it.
      //
      // QC and Purchase only, as asked. They are also the two that can actually
      // be reached — Quotation and Billing have no members in user_departments,
      // so a CAPA sent there would have notified nobody.
      { name: 'capa_departments', label: 'CAPA with', type: 'multi', options: ['QC', 'Purchase'],
        showWhen: { field: 'capa_needed', equals: [true] },
        hint: 'Every department the CAPA belongs to. Not one owner.' },
    ],
  },
  {
    id: 5, slug: 'action', title: 'Corrective Action & Resolution', owner: 'Complaint Team · the assignee',
    departments: ['Complaint Team', 'QC', 'Quotation Team', 'Billing Team'], repsMayEdit: true,
    fields: [
      { name: 'action_against', label: 'Action against complaint', type: 'long', required: true },
      { name: 'action_category', label: 'Action taken', type: 'select', lookup: 'action_category', required: true },
      // No longer mandatory: the action is auto-assigned from the Action Taken
      // answer through the Admin map (complaint_action_assignment), and asking
      // for a name as well meant the page refused to save until someone typed
      // the answer the system already knew. Kept as an override.
      { name: 'action_assigned_to', label: 'Action assigned to', type: 'user' },
      { name: 'target_completion_date', label: 'Target completion date', type: 'date', required: true },
      { name: 'actual_completion_date', label: 'Action completion date', type: 'date' },
      // Cost Impact is the commercial question — did this complaint cost us
      // money — and it answers itself for a replacement, so costImpactForced
      // below decides it and the field is here to be read, not guessed at.
      // Nothing to do with risk_cost_impact on page 3, which grades severity.
      { name: 'cost_impact', label: 'Cost impact', type: 'bool', hint: 'Yes automatically for a free replacement, a material replacement, or any FR challan.' },
      { name: 'fr_ec_no', label: 'FR EC no.', type: 'text', showWhen: { field: 'action_category', equals: [...FR_ACTIONS] } },
      { name: 'fr_ec_date', label: 'FR EC date', type: 'date', showWhen: { field: 'action_category', equals: [...FR_ACTIONS] } },
      { name: 'challan_no', label: 'Challan no.', type: 'text', showWhen: { field: 'action_category', equals: [...FR_ACTIONS] } },
      { name: 'challan_date', label: 'Challan date', type: 'date', showWhen: { field: 'action_category', equals: [...FR_ACTIONS] } },
      { name: 'target_dispatch_date', label: 'Target dispatch date', type: 'date', showWhen: { field: 'action_category', equals: [...FR_ACTIONS] } },
      // challan_value and fr_freight used to sit here and are deliberately gone.
      // The requirement asks a free replacement for Transportation (Yes/No +
      // value) and Material (Yes/No + value), which is the same two figures
      // asked better — a form that asks for freight twice gets two answers and
      // believes the wrong one. Their columns are kept and were empty on every
      // complaint, so nothing was lost in retiring them.
      // The FR challan's two halves, each a Yes/No and a figure. Transport and
      // material were being added together into one challan value, which left
      // no way to answer what free replacements cost us in freight alone.
      { name: 'fr_transport_applicable', label: 'FR transport charged', type: 'bool', showWhen: { field: 'action_category', equals: [...FR_ACTIONS] } },
      { name: 'fr_transport_value', label: 'FR transport value (₹)', type: 'money', showWhen: { field: 'fr_transport_applicable', equals: [true] } },
      { name: 'fr_material_applicable', label: 'FR material charged', type: 'bool', showWhen: { field: 'action_category', equals: [...FR_ACTIONS] } },
      { name: 'fr_material_value', label: 'FR material value (₹)', type: 'money', showWhen: { field: 'fr_material_applicable', equals: [true] } },
      { name: 'status_remarks', label: 'Remarks for complaint status', type: 'long' },
      // Customer Confirmed is gone, and with it the gate it guarded (decision
      // 7). It was a field the client could not fill and the team filled on
      // their behalf, so it only ever stood between a finished complaint and
      // being marked finished. The Complaint Team closes manually instead.
    ],
  },
  {
    id: 6, slug: 'capa', title: 'Vendor CAPA & Documents', owner: 'Complaint Team · QC · Purchase',
    departments: ['Complaint Team', 'QC', 'Purchase'],
    fields: [
      { name: 'boi_involved', label: 'BOI involved', type: 'bool' },
      { name: 'vendor_name', label: 'Vendor name', type: 'text', showWhen: { field: 'boi_involved', equals: [true] } },
      { name: 'vendor_recovery', label: 'Vendor recovery', type: 'bool', showWhen: { field: 'boi_involved', equals: [true] } },
      // Still asked, no longer compulsory (decision 12). Most complaints never
      // reach a vendor at all, and a mandatory Yes/No about one was holding up
      // the page for a question that did not apply.
      { name: 'capa_required', label: 'CAPA required from vendor', type: 'bool' },
      { name: 'capa_received_date', label: 'CAPA received date', type: 'date', showWhen: { field: 'capa_required', equals: [true] } },
      // The two halves of a CAPA in words: what was done about this complaint,
      // and what stops the next one. Kept apart because they are written by
      // different people at different times, and a single Remarks box was
      // getting the first and never the second.
      { name: 'corrective_action_remarks', label: 'Corrective action remarks', type: 'long' },
      { name: 'preventive_action_remarks', label: 'Preventive action remarks', type: 'long' },
      { name: 'drive_link', label: 'Complaint folder / drive link', type: 'text' },
    ],
  },
  {
    id: 7, slug: 'returnable', title: 'Returnable Material & Follow-up', owner: 'Complaint Team · QC · Billing',
    departments: ['Complaint Team', 'QC', 'Billing Team'],
    fields: [
      { name: 'material_returnable', label: 'Material to be returned', type: 'bool', required: true },
      { name: 'returnable_owner', label: 'Responsible for returnable', type: 'user', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_slip_no', label: 'Returnable slip no.', type: 'text', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_slip_date', label: 'Returnable slip date', type: 'date', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'gr_no', label: 'GR no.', type: 'text', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'paid_to_pay', label: 'Paid / To pay', type: 'paid', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_amount', label: 'Amount (₹)', type: 'money', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_item_value', label: 'Returnable item value (₹)', type: 'money', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_status', label: 'Returnable status', type: 'select', lookup: 'returnable_status', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'returnable_action', label: 'Action on returnable material', type: 'long', showWhen: { field: 'material_returnable', equals: [true] } },
      { name: 'first_email_date', label: 'First email sent', type: 'date' },
      { name: 'last_reminder_date', label: 'Last email reminder sent', type: 'date' },
      { name: 'next_followup_date', label: 'Next follow-up date', type: 'date' },
      { name: 'followup_remarks', label: 'Calling follow-up remarks', type: 'long' },
      { name: 'accounts_action', label: 'Accounts action', type: 'select', lookup: 'accounts_action' },
      { name: 'mgmt_intervention', label: 'Management intervention required', type: 'bool' },
    ],
  },
  {
    id: 8, slug: 'closure', title: 'Closure & Management Review', owner: 'Complaint Team · QC',
    departments: ['Complaint Team', 'QC'],
    fields: [
      { name: 'closure_summary', label: 'Final resolution summary', type: 'long', required: true },
      { name: 'customer_satisfied', label: 'Customer satisfied', type: 'bool', required: true },
      // Moved off page 3. It was never part of the criticality score — a
      // warning letter is what the customer did about the complaint, not how
      // grave the complaint is — and once criticality became four questions it
      // was the only thing left on that page that answered a different one.
      // It belongs with the closing account of how the customer was left.
      { name: 'warning_letter', label: 'Warning letter', type: 'yesno4', hint: 'Did the customer issue one over this complaint?' },
      { name: 'repeat_complaint', label: 'Repeat complaint', type: 'bool', hint: 'Set automatically from the same client, model and category within twelve months; correct it if you know better.' },
      // A repeat is logged as its own complaint and pointed at the first one.
      // Re-opening the original would have hidden the second occurrence inside
      // the first's history, and the count of how often a problem comes back is
      // exactly what the dashboard is being asked for. The link is offered,
      // never forced (decision 4) — a wrong guess at the original is worse than
      // no link.
      { name: 'linked_complaint_id', label: 'Repeat of complaint', type: 'complaint', hint: 'The earlier complaint this one repeats. Leave it empty if you are not sure which.' },
      { name: 'action_effectiveness', label: 'Corrective action effectiveness', type: 'select', lookup: 'effectiveness' },
      { name: 'lessons_learned', label: 'Lessons learned', type: 'long' },
      { name: 'management_remarks', label: 'Management remarks', type: 'long' },
    ],
  },
];

export const pageBySlug = (slug: string) => PAGES.find(p => p.slug === slug) ?? null;
export const pageById = (id: number) => PAGES.find(p => p.id === id) ?? null;

/** Where a page sits in the run, 1-based — the number a reader sees, not its id. */
export const pageStep = (page: { id: number }): number =>
  PAGES.findIndex(p => p.id === page.id) + 1;

/** All field names the workflow writes, for the save action's allowlist. */
export const ALL_FIELD_NAMES = new Set(PAGES.flatMap(p => p.fields.map(f => f.name)));

export type ComplaintValues = Record<string, unknown>;

export function isFieldShown(f: ComplaintField, values: ComplaintValues): boolean {
  if (!f.showWhen) return true;
  const v = values[f.showWhen.field];
  return f.showWhen.equals.some(e => e === v || (typeof e === 'string' && String(v ?? '') === e));
}

/**
 * The answer the parent of a cascading field is currently holding, or null.
 * Null is the "nothing chosen upstream" case, which is a different state from
 * "chosen, and the list under it is empty".
 */
export function cascadeParent(f: ComplaintField, values: ComplaintValues): string | null {
  if (!f.parentField) return null;
  const v = values[f.parentField];
  return v == null || v === '' ? null : String(v);
}

/**
 * What a select may offer, whatever kind of select it is: a fixed `options`
 * list, a flat lookup kind, or — when the field names a `parentField` — the
 * slice of a cascading kind that hangs under the parent's current answer.
 *
 * An empty array is the honest answer in two cases: the parent is unanswered,
 * and the parent is answered but nothing is seeded under it (Client Related
 * has no sub-categories until the Complaint team sends the list). The control
 * should render disabled in the first case and allow a typed Add On in the
 * second rather than pretending the field does not exist.
 *
 * Changing the parent orphans the child's stored value. The form clears the
 * child when the parent changes — it cannot be left holding Vibration under
 * Supply Related.
 */
export function optionsFor(
  f: ComplaintField,
  values: ComplaintValues,
  lookups: Record<string, string[]>,
  cascades?: CascadingLookups,
): string[] {
  if (f.options) return f.options;
  const kind = f.lookup ?? '';
  if (!f.parentField) return lookups[kind] ?? [];
  const parent = cascadeParent(f, values);
  if (parent == null) return [];
  return cascades?.[kind]?.[parent] ?? [];
}

/** Required fields of a page that are still empty, as labels. */
export function missingOnPage(page: ComplaintPage, values: ComplaintValues): string[] {
  return page.fields
    .filter(f => f.required && isFieldShown(f, values))
    .filter(f => { const v = values[f.name]; return v == null || v === ''; })
    .map(f => f.label);
}

// ── Cost impact ────────────────────────────────────────────────────────────

/**
 * Whether this complaint's Cost Impact answers itself.
 *
 * A free replacement or a material replacement means we shipped material we
 * were not paid for, and an FR challan says so in rupees, so there is nothing
 * for a person to decide — and leaving it to a person is how a quarter of the
 * replacements ended up filed as costing nothing. The UI shows the Yes,
 * locked, with the reason; the save action sets the column so a row written by
 * an import or a script agrees with a row written by the form.
 *
 * Not `risk_cost_impact`, which asks whether the cost crossed ₹5,000 for the
 * purpose of grading severity and has nothing to say about this.
 */
export function costImpactForced(values: ComplaintValues): boolean {
  const action = String(values.action_category ?? '');
  if ((FR_ACTIONS as readonly string[]).includes(action)) return true;
  if (values.fr_transport_applicable === true || values.fr_material_applicable === true) return true;
  const num = (k: string) => Number(values[k] ?? 0);
  return num('fr_transport_value') > 0 || num('fr_material_value') > 0 || num('challan_value') > 0 || num('fr_freight') > 0;
}

/** Why it was forced, for the locked field's hint. Null when it was not. */
export function costImpactReason(values: ComplaintValues): string | null {
  if (!costImpactForced(values)) return null;
  const action = String(values.action_category ?? '');
  if ((FR_ACTIONS as readonly string[]).includes(action)) return `${action} is at our cost`;
  return 'An FR challan has been raised on this complaint';
}

// ── Who may edit ───────────────────────────────────────────────────────────

export interface Editor {
  id: number | null;
  role: RisansiRole | string;
  departments: readonly string[];
}

export interface ComplaintForAccess {
  status: string;
  schema_version: number;
  /** What page 3 and page 4 are routed by (decision 6). */
  complaint_category?: string | null;
  /** Historical only. Rows raised before the category existed are still routed by it. */
  complaint_type?: string | null;
  investigation_assigned_to?: number | null;
  action_assigned_to?: number | null;
  returnable_owner?: number | null;
  rep_user_id?: number | null;
  reported_by_user?: number | null;
  /** The viewer works this complaint's client (owner, cover, team). */
  worksClient?: boolean;
}

/**
 * May this person edit this page of this complaint?
 *
 * Department decides the default; a per-complaint assignment overrides it
 * (Investigation Assigned To edits page 4, Action Assigned To page 5,
 * Responsible for Returnable page 7); reps and managers reach page 1 and page 5
 * through the client they work; admins edit everything. A legacy record
 * (schema_version 1) is read-only for everyone but an admin.
 */
export function canEditPage(user: Editor, c: ComplaintForAccess, page: ComplaintPage): boolean {
  if (isAdminRole(user.role)) return true;
  if (c.schema_version < 2) return false;
  if (c.status === 'Closed') return false;
  const uid = user.id;
  if (uid != null) {
    if (page.id === 4 && c.investigation_assigned_to === uid) return true;
    if (page.id === 5 && c.action_assigned_to === uid) return true;
    if (page.id === 7 && c.returnable_owner === uid) return true;
  }
  if (page.repsMayEdit && (user.role === 'rep' || user.role === 'manager') && (c.worksClient || c.rep_user_id === uid || c.reported_by_user === uid)) return true;
  // Risk and Investigation belong to whoever owns the category: a pump problem
  // is QC's to judge and investigate, paperwork is the Complaint Team's. Read
  // off Complaint Category now that Complaint Type is gone from registration;
  // routingOwner still honours Type on the rows that only have that.
  if ((page.id === 3 || page.id === 4) && (c.complaint_category || c.complaint_type)) {
    const owner = routingOwner(c);
    if (user.departments.includes(owner)) return true;
    return user.departments.includes('Complaint Team') && page.id === 3;   // the team can always fill risk
  }
  return page.departments.some(d => user.departments.includes(d));
}

/** May this person move the complaint between statuses at all? */
export function canMove(user: Editor, c: ComplaintForAccess): boolean {
  if (isAdminRole(user.role)) return true;
  if (c.schema_version < 2) return false;
  return user.departments.includes('Complaint Team') || user.departments.includes('QC')
    || (user.id != null && (c.investigation_assigned_to === user.id || c.action_assigned_to === user.id));
}

// ── Transitions and gates ──────────────────────────────────────────────────

export const NEXT: Record<ComplaintStatus, ComplaintStatus[]> = {
  'Open':                          ['Under Investigation', 'Action Pending', 'Resolved'],
  'Under Investigation':           ['Action Pending', 'Customer Confirmation Pending', 'Resolved'],
  'Action Pending':                ['Replacement Pending', 'Customer Confirmation Pending', 'Resolved'],
  'Replacement Pending':           ['Customer Confirmation Pending', 'Resolved'],
  'Customer Confirmation Pending': ['Resolved', 'Action Pending'],
  // Feedback is optional on the way out: a complaint may close straight from
  // Resolved, or sit in Feedback while the client is asked how it went.
  'Resolved':                      ['Feedback', 'Closed', 'Under Investigation'],
  'Feedback':                      ['Closed', 'Under Investigation'],
  'Closed':                        ['Under Investigation'],
};

/**
 * The status a saved page drags the complaint to on its own, if any.
 *
 * Page 2 identifies the pump and the order, which is the work of starting on a
 * complaint — so a complaint still sitting at Open becomes Under Investigation
 * the moment page 2 is saved, without anyone pressing a button. Only ever a
 * step forward from Open: a complaint already past that point keeps the status
 * it has, and a saved page must not drag a Resolved complaint backwards.
 */
export function statusAfterSavingPage(pageId: number, current: string): ComplaintStatus | null {
  if (pageId === 2 && current === 'Open') return 'Under Investigation';
  return null;
}

export interface GateContext {
  values: ComplaintValues;
  severity: Severity | null;
  hasCapaDocument: boolean;
}

/**
 * What stands between this complaint and `to`. Empty means it may go.
 * Requirements belong to the transition, not the row: nothing here is asked of
 * a complaint that is not trying to move.
 */
export function gateFor(from: string, to: ComplaintStatus, ctx: GateContext): string[] {
  const v = ctx.values, sev = ctx.severity;
  const need: string[] = [];
  const page = (id: number) => pageById(id) as ComplaintPage;
  const missing = (id: number) => missingOnPage(page(id), v).map(l => `${page(id).title}: ${l}`);

  // Everything after Open needs registration complete, the pump identified, and the risk answered.
  if (from === 'Open' || to === 'Under Investigation' && from !== 'Resolved' && from !== 'Feedback' && from !== 'Closed') {
    need.push(...missing(1), ...missing(2));
    if (!sev) need.push('Risk & Criticality: answer the risk questions so the severity is known');
    else need.push(...missing(3));
  }
  // Skipping the investigation is allowed only when the severity allows it.
  if (from === 'Open' && to !== 'Under Investigation' && sev === 'High') {
    need.push('A High criticality complaint is investigated before anything else');
  }
  if (to === 'Action Pending' || to === 'Replacement Pending') {
    if (from !== 'Open') need.push(...missing(5).filter(m => !/completion date$/i.test(m) || /Target/.test(m)));
  }
  if (to === 'Replacement Pending' && !/Replacement/.test(String(v.action_category ?? ''))) {
    need.push('Corrective Action: the action category must be a replacement');
  }
  if (to === 'Customer Confirmation Pending') {
    if (!v.action_against) need.push('Corrective Action: action against complaint');
  }
  if (to === 'Resolved') {
    // The customer-confirmation gate is gone with the field (decision 7): the
    // Complaint Team decides when a complaint is resolved. What is still asked
    // for is evidence proportionate to the severity.
    if (sev === 'High') {
      if (!v.root_cause) need.push('Investigation: root cause');
      if (!v.root_cause_category) need.push('Investigation: root cause category');
    }
    // Low still owes an account of what was done — either the corrective
    // action or remarks. Two levels is not the same as one of them being free.
    if (sev === 'Low' && !v.action_against && !v.status_remarks) {
      need.push('Corrective Action: action against complaint, or remarks for complaint status');
    }
  }
  if (to === 'Closed') {
    need.push(...missing(8));
    if (sev === 'High' && !ctx.hasCapaDocument) need.push('CAPA document attached (page 6)');
    if (v.material_returnable === true && v.returnable_status && !['Received', 'Closed'].includes(String(v.returnable_status))) {
      need.push(`Returnable material is still ${v.returnable_status}`);
    }
  }
  return [...new Set(need)];
}

// ── Holders — who is accountable while it sits in a status ─────────────────

export interface Holder { department: Department | 'Customer'; userId: number | null }

export function holderFor(status: string, c: ComplaintValues): Holder {
  const num = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : c[k] ? Number(c[k]) : null);
  switch (status) {
    case 'Under Investigation':
      // Same rule as the edit rights on page 4: the category says whose
      // problem it is, Complaint Type answers only for historical rows.
      return {
        department: routingOwner({ complaint_category: c.complaint_category as string | null, complaint_type: c.complaint_type as string | null }),
        userId: num('investigation_assigned_to'),
      };
    case 'Action Pending': {
      // A default, not the rule. Decision 10 puts action assignment in an
      // editable Admin map (`complaint_action_assignment`), which this file
      // cannot read — it is pure and the map is a table. A caller that has
      // loaded the map should prefer it; this stands in until it does, and
      // keeps the holder sensible for the renamed actions in FR_ACTIONS.
      const cat = String(c.action_category ?? '');
      const dept: Department = (FR_ACTIONS as readonly string[]).includes(cat) || /Replacement/.test(cat) ? 'Quotation Team'
        : /Repair/.test(cat) ? 'Billing Team'
        : /Online/.test(cat) ? 'QC' : 'Complaint Team';
      return { department: dept, userId: num('action_assigned_to') };
    }
    case 'Replacement Pending':
      return { department: 'Quotation Team', userId: num('action_assigned_to') };
    case 'Customer Confirmation Pending':
      return { department: 'Customer', userId: null };
    default:
      return { department: 'Complaint Team', userId: null };
  }
}

// ── Overdue ────────────────────────────────────────────────────────────────

/**
 * How long each severity gets before it is late, in days since the complaint
 * was raised. Keyed by severity so it can be read straight out of
 * `complaint_sla_thresholds`, which is Admin-editable — these numbers are the
 * provisional ones from decision 2 and exist as a fallback for a caller that
 * has no row for a severity, not as the answer.
 */
export const PROVISIONAL_SLA_DAYS: Record<Severity, number> = { High: 2, Low: 7 };

export type SlaThresholds = Partial<Record<Severity, number>>;

/** Whether a late complaint has anything to show for itself. */
export type OverdueKind = 'ok' | 'no-action' | 'acted';

export interface Overdue {
  overdue: boolean;
  /** Days since it was raised, whatever the answer. Null when the raise date is missing. */
  days: number | null;
  /** The threshold applied, or null when none is configured for this severity. */
  threshold: number | null;
  kind: OverdueKind;
}

/** A calendar day difference, taken off the date parts so an IST-shifted `date` column cannot move it. */
function dayNumber(d: string | Date): number | null {
  if (typeof d === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (!m) { const t = Date.parse(d); return Number.isNaN(t) ? null : Math.floor(t / 86400000); }
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  }
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

/** Days from when it was raised to `now`, both read as calendar dates. */
export function daysSinceRaised(raisedAt: string | Date | null | undefined, now: string | Date): number | null {
  if (!raisedAt) return null;
  const a = dayNumber(raisedAt), b = dayNumber(now);
  if (a == null || b == null) return null;
  return Math.max(0, b - a);
}

/**
 * Is this complaint late, and does it have an action behind it?
 *
 * Age since it was raised, against the threshold its severity earns. The old
 * rule asked whether `target_completion_date` had passed, which could only
 * ever fire on a complaint that had reached page 5 and had a target typed on
 * it — so the complaints nobody had touched, the ones most worth chasing, were
 * never late. That is the 34-open-but-1-overdue figure the review queried.
 *
 * Thresholds are passed in. They live in `complaint_sla_thresholds` so Admin
 * can change them, and this file does not read the database; a caller with no
 * row for a severity can fall back to PROVISIONAL_SLA_DAYS. A severity that is
 * configured as nothing means "no deadline for this level", and the complaint
 * is never late rather than late by a guess.
 *
 * An ungraded complaint — risk questions unanswered, so no severity — is held
 * to the S4 threshold, the most forgiving one. Being late should be a fact
 * about age, not a side effect of a blank page 3.
 *
 * `kind` splits the late ones the way the dashboard asked: `no-action` is a
 * complaint still in an Open headline status, `acted` is one that has moved on
 * and is late anyway. The two need chasing by different people.
 */
export function overdueFor(
  c: { status: string; severity?: Severity | string | null; raised_at?: string | Date | null; complaint_date?: string | Date | null; created_at?: string | Date | null },
  thresholds: SlaThresholds,
  now: string | Date,
): Overdue {
  const days = daysSinceRaised(c.raised_at ?? c.complaint_date ?? c.created_at, now);
  // An ungraded complaint is held to the Low threshold: being late should be
  // a fact about age, not a side effect of a blank page 3.
  const sev = (SEVERITIES as readonly string[]).includes(String(c.severity)) ? (c.severity as Severity) : 'Low';
  const threshold = thresholds[sev] ?? null;
  if (!isOpenStatus(c.status) || days == null || threshold == null) {
    return { overdue: false, days, threshold, kind: 'ok' };
  }
  const overdue = days > threshold;
  return { overdue, days, threshold, kind: !overdue ? 'ok' : headlineStatus(c.status) === 'Open' ? 'no-action' : 'acted' };
}

// The target-date rule this replaces is not in this file and has not been
// deleted: it is the `overdue` column computed in SQL in
// lib/risansi-complaint-rows.ts, which the complaints table and the Client 360
// panel still read. Treat it as superseded — it goes when those callers move
// to overdueFor, and until then the two will disagree about which complaints
// are late. The SQL one undercounts.

// ── Lifecycle maths ────────────────────────────────────────────────────────

export interface StageLogRow {
  to_status: string;
  holder_department: string | null;
  holder_user_id: number | null;
  holder_name?: string | null;
  created_at: string;
}

export interface Dwell {
  status: string;
  department: string;
  userId: number | null;
  holderName: string | null;
  from: string;
  to: string | null;
  days: number;
  current: boolean;
}

/** Each stretch of the complaint's life: which status, who held it, for how many days. */
export function dwells(log: StageLogRow[], nowIso: string): Dwell[] {
  const rows = [...log].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: Dwell[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], next = rows[i + 1];
    const end = next ? next.created_at : nowIso;
    const days = Math.max(0, (Date.parse(end) - Date.parse(r.created_at)) / 86400000);
    out.push({
      status: r.to_status, department: r.holder_department ?? 'Complaint Team', userId: r.holder_user_id,
      holderName: r.holder_name ?? null, from: r.created_at, to: next ? next.created_at : null,
      days, current: !next && isOpenStatus(r.to_status),
    });
  }
  return out;
}

/** Days per holder, summed across the complaint's life. */
export function dwellByHolder(d: Dwell[]): { key: string; label: string; days: number; stretches: number }[] {
  const m = new Map<string, { key: string; label: string; days: number; stretches: number }>();
  for (const x of d) {
    if (!isOpenStatus(x.status)) continue;             // time after Resolved / Closed is nobody's
    const key = x.holderName ? `${x.department} · ${x.holderName}` : x.department;
    const cur = m.get(key) ?? { key, label: key, days: 0, stretches: 0 };
    cur.days += x.days; cur.stretches++; m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => b.days - a.days);
}
