// One definition of what an opportunity asks for, and when. The forms render
// from it and the server validates against it, so the two can never disagree.
//
// THE MODEL, after the Aug 2026 redesign:
//
//   An opportunity starts as a PROSPECT — an enquiry has arrived. That is the
//   only way in. From there it goes one of four ways:
//
//     Prospect ──quotation issued──────────────────────────────► Quoted
//              ──enquiry regretted──────────────────────────────► Dropped
//              ──Against Rate Contract / Repeat Order───────────► Won
//              ──not live yet, park it──────────────────────────► Suspect
//
//   SUSPECT is no longer the first rung of a ladder; it is a siding. Something
//   parked there is budgetary, or an expansion a year or more out, and it says
//   which. It rejoins the line when the enquiry becomes real.
//
//   The direct Prospect → Won jump exists because a rate-contract or repeat
//   order needs no quotation — the price is already agreed. Forcing those
//   through Quoted was making reps invent quote numbers.
//
// Each field declares the stage at which it is FIRST asked. That single fact
// drives the two-section form: everything asked at earlier stages is shown as
// context, and only the fields belonging to the stage being entered are new.

export const PRODUCT_TYPES = ['PCP', 'MMP', 'RBL', 'OLB', 'SPARE', 'SERVICE', 'OTHER'] as const;

/** Pump or Spare — a different axis from PRODUCT_TYPES. A spare for a PCP is still PCP. */
export const OPPORTUNITY_TYPES = ['Pump', 'Spare', 'OLB'] as const;

export const OPPORTUNITY_SOURCES = [
  'By Post', 'Email', 'WhatsApp', 'Tender Portal', 'India MART', 'Verbal',
] as const;

/**
 * Against Rate Contract and Repeat Order both mean the commercial terms already
 * exist, which is why either may go straight to Won without a quotation.
 */
export const OPPORTUNITY_CATEGORIES = [
  'Against Rate Contract', 'New Enquiry', 'Repeat Order',
] as const;

/** Why an enquiry is parked rather than live. Budgetary lives here now, not on category. */
export const SUSPECT_REASONS = [
  'Budgetary', 'Expansion within 1 year', 'Expansion more than 1 year',
] as const;

export const HOLD_REASONS = [
  'Awaiting client budget', 'Awaiting technical clearance', 'Project deferred',
  'Awaiting sample / trial', 'Commercial terms unresolved', 'Other',
] as const;

/** Categories that may close without a quotation ever being issued. */
export const DIRECT_WIN_CATEGORIES: readonly string[] = ['Against Rate Contract', 'Repeat Order'];

export const CREATE_STAGES = ['Prospect', 'Suspect', 'Quoted', 'Negotiating', 'Won', 'Lost'] as const;
export type CreateStage = typeof CREATE_STAGES[number];

/**
 * Every stage an opportunity can hold, including the two it can only be moved
 * into, IN FLOW ORDER — a suspect is an unqualified name, a prospect is one
 * that has been qualified, so Suspect comes first. The order is load-bearing
 * now that tables sort their Stage column by it; it used to read Prospect,
 * Suspect, which disagreed with OPEN_STAGES in lib/risansi-dashboard.ts and
 * would have sorted the pipeline into an order it never runs in. Nothing
 * indexes this list, so the sequence is free to say something true.
 */
export const ALL_STAGES = [
  'Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped',
] as const;
export type OppStage = typeof ALL_STAGES[number];

/**
 * How far along the line a stage sits.
 *
 * Suspect shares Prospect's rank rather than sitting below it. A parked enquiry
 * still arrived from somewhere, so it is asked the same questions — type,
 * source, category — plus the one that explains the parking. Ranking it lower
 * would have hidden exactly the fields Source was added to capture.
 */
export const STAGE_RANK: Record<OppStage, number> = {
  Suspect: 1, Prospect: 1, Quoted: 2, Negotiating: 3, 'On Hold': 3,
  Won: 4, Lost: 4, Dropped: 4,
};

// A stage's probability used to be written into new opportunities as a default.
// It is gone: the odds come from the probability code a rep enters, and nothing
// else. See lib/risansi-probability-codes.ts.

export const STAGE_HINT: Record<OppStage, string> = {
  Prospect:    'An enquiry has arrived. Capture where it came from and what it is for.',
  Suspect:     'Parked — budgetary, or an expansion some way off. Say which.',
  Quoted:      'A quotation has gone out. Capture the quote, the offer and its line items.',
  Negotiating: 'The quote is on the table and terms are moving.',
  'On Hold':   'Paused for a reason outside the deal itself.',
  Won:         'Order in hand. Capture the booked value and the PO behind it.',
  Lost:        'Lost to someone or something. Feeds win-rate and competitor analysis.',
  Dropped:     'The requirement went away, or the enquiry was regretted.',
};

/** Where a Prospect can go next, and what each move means. */
export const PROSPECT_EXITS = [
  { to: 'Quoted' as const,      label: 'Quotation issued',   hint: 'Capture the quote and its line items.' },
  { to: 'Won' as const,         label: 'Order received',     hint: 'Rate contract or repeat order — no quotation needed.', onlyCategories: DIRECT_WIN_CATEGORIES },
  { to: 'Suspect' as const,     label: 'Park it',            hint: 'Budgetary, or an expansion further out.' },
  { to: 'Dropped' as const,     label: 'Enquiry regretted',  hint: 'The enquiry will not proceed.' },
];

export type FieldKind =
  | 'text' | 'inr' | 'number' | 'date' | 'month' | 'select' | 'prob_code' | 'textarea';

export interface OppFieldDef {
  /** Form field name === db column (money fields take rupees and end _inr). */
  name: string;
  label: string;
  kind: FieldKind;
  /** The stage at which this is FIRST asked. Drives the two-section form. */
  asked: OppStage;
  /** Stages on which it must be filled. */
  requiredAt?: OppStage[];
  /**
   * Stages that ask for it AGAIN, in their own "fill this in now" section.
   *
   * A field is normally asked once and then carried as context. Some answers
   * go stale: the expected closure month set when the quote went out is the
   * one thing a negotiation changes, and leaving it read-only there meant the
   * forecast kept a date nobody had revisited since the quote.
   */
  reaskedAt?: OppStage[];
  /**
   * A sibling this field fills in while the sibling is still empty, and which
   * fills this one in return. For a pair that is usually, but not always, the
   * same: the date printed on a PO, and the day it reached us.
   */
  mirrors?: string;
  /** Shown ONLY on these stages, rather than from `asked` onward. */
  onlyStages?: OppStage[];
  options?: readonly string[];
  placeholder?: string;
  help?: string;
  full?: boolean;
  /** A date that cannot be in the future. Bounds the input and the server check. */
  noFuture?: boolean;
  /**
   * Shown only when another field on the same form holds one of these values.
   *
   * Data rather than a predicate so the server can read it too: a field that is
   * not showing must not be demanded, and a function in this catalogue would
   * have to be duplicated in the action to say the same thing.
   */
  showWhen?: { field: string; equals: readonly string[] };
}

const QUOTE_STAGES: OppStage[] = ['Quoted', 'Negotiating', 'On Hold'];

/**
 * The catalogue, in the order a form should render it.
 *
 * `product` (Product / Description) is gone. It duplicated Project Name / Unit
 * and Product Type between them, and reps were typing the same thing three times.
 */
export const OPP_FIELDS: OppFieldDef[] = [
  // ── Prospect · the enquiry ──────────────────────────────────
  { name: 'opportunity_type',     label: 'Type',              kind: 'select', asked: 'Prospect', requiredAt: [...ALL_STAGES], options: OPPORTUNITY_TYPES },
  { name: 'opportunity_source',   label: 'Source',            kind: 'select', asked: 'Prospect', requiredAt: [...ALL_STAGES], options: OPPORTUNITY_SOURCES },
  { name: 'opportunity_category', label: 'Category',          kind: 'select', asked: 'Prospect', requiredAt: [...ALL_STAGES], options: OPPORTUNITY_CATEGORIES, help: 'Rate contract and repeat orders can close without a quotation' },
  { name: 'client_reference',     label: 'Client Reference',  kind: 'text',   asked: 'Prospect', placeholder: 'Their PO, tender or email subject' },
  { name: 'enquiry_no',           label: 'Enquiry No.',       kind: 'text',   asked: 'Prospect', placeholder: 'RIL/EN/…' },
  { name: 'enquiry_date',         label: 'Enquiry Date',      kind: 'date',   asked: 'Prospect' },
  { name: 'unit_project',         label: 'Project Name / Unit', kind: 'text', asked: 'Prospect', full: true, placeholder: 'e.g. Balrampur Chini — Unit 2, Spent Wash' },
  { name: 'notes',                label: 'Notes',             kind: 'textarea', asked: 'Prospect', full: true },

  // ── Suspect · the siding ────────────────────────────────────
  { name: 'suspect_reason', label: 'Why parked', kind: 'select', asked: 'Suspect', onlyStages: ['Suspect'], requiredAt: ['Suspect'], options: SUSPECT_REASONS },

  // ── Quoted · the quotation ──────────────────────────────────
  { name: 'product_type',    label: 'Product Type',   kind: 'select', asked: 'Quoted', requiredAt: [...QUOTE_STAGES, 'Won', 'Lost'], options: PRODUCT_TYPES },
  { name: 'quote_ref',       label: 'Quote No.',      kind: 'text',   asked: 'Quoted', requiredAt: [...QUOTE_STAGES], placeholder: 'RIL/QT/…' },
  { name: 'quote_date',      label: 'Quote Date',     kind: 'date',   asked: 'Quoted', requiredAt: [...QUOTE_STAGES] },
  { name: 'market',          label: 'Market',         kind: 'select', asked: 'Quoted', requiredAt: [...QUOTE_STAGES], options: ['DOMESTIC', 'EXPORT'] },
  { name: 'offer_value_inr', label: 'Total Offer (₹)', kind: 'inr',   asked: 'Quoted', requiredAt: [...QUOTE_STAGES], help: 'Auto-sums the line items if left blank' },
  { name: 'probability_code', label: 'Probability',   kind: 'prob_code', asked: 'Quoted' },
  // Asked again while negotiating: the closure month is what moves when a deal
  // is being argued over, and Best-case and Probability-weighted are built from
  // Quoted plus Negotiating, so both halves need a date somebody stands behind.
  { name: 'eta_text',        label: 'Expected Close', kind: 'month',  asked: 'Quoted', reaskedAt: ['Negotiating'] },

  // ── On Hold ─────────────────────────────────────────────────
  { name: 'hold_reason', label: 'Hold Reason', kind: 'select', asked: 'On Hold', onlyStages: ['On Hold'], requiredAt: ['On Hold'], options: HOLD_REASONS },

  // ── Won ─────────────────────────────────────────────────────
  // The PO is what makes a deal Won, so its number and date are required. The
  // Sale Order is a later step and often days or weeks behind the PO — demanding
  // it at the same moment either blocked a real win or invited a placeholder
  // number that then had to be corrected. Left blank, every figure that reads it
  // falls back to the quoted value via COALESCE(final_value_cr, value_cr).
  { name: 'final_value_inr', label: 'Sale Order Value (₹)', kind: 'inr',  asked: 'Won', onlyStages: ['Won'],
    help: 'Optional — add it when the Sale Order comes through. Until then, Order in Hand uses the quoted value.' },
  { name: 'po_number',       label: 'PO Number',            kind: 'text', asked: 'Won', onlyStages: ['Won'], requiredAt: ['Won'], placeholder: 'e.g. PO-2024-0182' },
  // A PO that has not been raised yet cannot have a number, so a future PO date
  // is always either a typo or a placeholder. Only this date is bounded: a quote
  // date can legitimately be forward-dated, and an expected close is meant to be.
  { name: 'po_date',         label: 'PO Date',              kind: 'date', asked: 'Won', onlyStages: ['Won'], requiredAt: ['Won'], noFuture: true,
    mirrors: 'po_received_date' },
  // A customer dates a PO and sends it days later. The order is ours from the
  // day it arrives, which is what a turnaround is measured from — so the two
  // are separate dates that happen to agree most of the time. Enter either and
  // the other follows, until somebody edits it.
  { name: 'po_received_date', label: 'PO Received Date',     kind: 'date', asked: 'Won', onlyStages: ['Won'], noFuture: true,
    mirrors: 'po_date', help: 'The day the PO reached us. Follows the PO date until you change it.' },

  // ── Lost ────────────────────────────────────────────────────
  { name: 'lost_to_competitor', label: 'Lost To Competitor', kind: 'select', asked: 'Lost', onlyStages: ['Lost'], requiredAt: ['Lost'], options: [] },
  { name: 'lost_to_competitor_other', label: 'Name the competitor', kind: 'text',
    asked: 'Lost', onlyStages: ['Lost'],
    showWhen: { field: 'lost_to_competitor', equals: ['Others', 'Other'] },
    placeholder: 'Who took it? A name here is worth more than "Others".',
    help: 'Kept alongside Others so the deal is still countable, and the name is not lost.' },
  { name: 'lost_reason',        label: 'Lost Reason',        kind: 'select', asked: 'Lost', onlyStages: ['Lost'], requiredAt: ['Lost'], options: [
    'Price — Too expensive', 'Technical — Spec mismatch', 'OEM Tied — Forced preference',
    'Relationship — Existing supplier', 'Budget — Project cancelled', 'Delivery — Timeline mismatch',
    'No decision — Deferred', 'Other',
  ] },

  // ── Dropped ─────────────────────────────────────────────────
  { name: 'drop_reason', label: 'Drop Reason', kind: 'select', asked: 'Dropped', onlyStages: ['Dropped'], requiredAt: ['Dropped'], options: [] },
  // Not requiredAt: requiredFieldNames() has no form to read, so a conditional
  // field marked required would be demanded even when it is hidden. The move
  // into Dropped enforces it instead — see updateOpportunity.
  { name: 'drop_reason_other', label: 'Say why', kind: 'text',
    asked: 'Dropped', onlyStages: ['Dropped'],
    showWhen: { field: 'drop_reason', equals: ['Other'] },
    placeholder: 'In a line — what happened to this enquiry?',
    help: 'Required when the reason is Other. A review can act on a sentence; it cannot act on "Other".' },
];

// Answers that are not a competitor, appended after the master list.
//
// 'Other' used to sit here and duplicated 'Others' from the master list, one
// line apart in the same dropdown. 'Others' won because it is the value the
// competitor table holds and the one the free-text box hangs off; showWhen on
// lost_to_competitor_other still accepts both, so a record or a link carrying
// the old spelling keeps working.
export const LOST_COMPETITOR_TAIL = ['Price — No specific competitor', 'OEM Tied', 'Budget Cancelled'];

/**
 * Why an opportunity was Dropped. Distinct from lost_reason: Lost is "we
 * competed and did not win", Dropped is "the requirement went away".
 */
export const DROP_REASONS = [
  'Closed deferred to next season',
  'Repeat or duplicate offer',
  'Requirement closed',
  'Technically disqualified',
  'Closed no response from client',
  // The enquiry itself was declined — we chose not to pursue or quote it. The
  // Prospect → Dropped exit writes this one.
  'Inquiry Regret',
  // Housekeeping rather than a commercial outcome: the record should never have
  // existed (mis-keyed) or duplicates one that already does.
  'Incorrect entry / Duplicate',
  // The enquiry was only ever a price check — no project behind it to lose.
  'Budgetary Enquiry',
  // Last resort, and it asks for the reason in words (drop_reason_other). A
  // bare 'Other' on a dropped deal tells a review nothing.
  'Other',
] as const;
export type DropReason = typeof DROP_REASONS[number];
export const isDropReason = (v: unknown): v is DropReason =>
  typeof v === 'string' && (DROP_REASONS as readonly string[]).includes(v);

/** Stages that keep a free-text remark each time they are entered. */
export const REMARK_STAGES: OppStage[] = ['Suspect', 'Negotiating', 'On Hold', 'Lost', 'Dropped'];
export const REMARK_LABEL: Partial<Record<OppStage, string>> = {
  Negotiating: 'Follow-up Remarks',
  Suspect: 'Remarks', 'On Hold': 'Remarks', Lost: 'Remarks', Dropped: 'Remarks',
};

// ── Queries over the catalogue ────────────────────────────────

/**
 * @param values The form as it currently stands. Omit it and `showWhen` fields
 *               are treated as visible — which is what the required-field check
 *               wants when it has no form to look at, and harmless because no
 *               conditional field is required anywhere.
 */
export function isFieldVisible(
  f: OppFieldDef, stage: OppStage, values?: Record<string, string>,
): boolean {
  const stageOk = f.onlyStages ? f.onlyStages.includes(stage) : STAGE_RANK[stage] >= STAGE_RANK[f.asked];
  if (!stageOk) return false;
  if (f.showWhen && values) return f.showWhen.equals.includes(values[f.showWhen.field] ?? '');
  return true;
}

export function isFieldRequired(f: OppFieldDef, stage: OppStage, values?: Record<string, string>): boolean {
  return isFieldVisible(f, stage, values) && (f.requiredAt ?? []).includes(stage);
}

/** True when this stage puts the field in its own "fill this in now" section. */
const asksNow = (f: OppFieldDef, stage: OppStage) => f.asked === stage || !!f.reaskedAt?.includes(stage);

/** Fields this stage asks for — first time, or asked again (see `reaskedAt`). */
export function fieldsNewAt(stage: OppStage, values?: Record<string, string>): OppFieldDef[] {
  return OPP_FIELDS.filter(f => isFieldVisible(f, stage, values) && asksNow(f, stage));
}

/** Fields carried in from earlier stages — the "already recorded" section. */
export function fieldsCarriedInto(stage: OppStage, values?: Record<string, string>): OppFieldDef[] {
  return OPP_FIELDS.filter(f => isFieldVisible(f, stage, values) && !asksNow(f, stage));
}

/**
 * Apply one field's change to a form's values, including anything that follows
 * from it.
 *
 * Today that is only `mirrors`: a pair of fields that are usually the same, so
 * filling one fills the other while the other is still empty. Once somebody has
 * typed into both, neither pushes the other around again.
 *
 * Shared because the create wizard, the stage-move modal and the edit drawer
 * each keep their own values, and a rule implemented in one of them is a rule
 * the other two quietly do not have.
 */
export function applyFieldChange(
  values: Record<string, string>, name: string, value: string,
): Record<string, string> {
  const next = { ...values, [name]: value };
  const twin = OPP_FIELDS.find(f => f.name === name)?.mirrors;
  if (twin && value && !(values[twin] ?? '').trim()) next[twin] = value;
  return next;
}

export function requiredFieldNames(stage: OppStage): string[] {
  return OPP_FIELDS.filter(f => isFieldRequired(f, stage)).map(f => f.name);
}

export function labelsFor(names: string[]): string[] {
  return names.map(n => OPP_FIELDS.find(f => f.name === n)?.label ?? n);
}

/** Does this stage carry a quotation block (line items, revisions, documents)? */
export function stageHasQuote(stage: OppStage): boolean {
  return STAGE_RANK[stage] >= STAGE_RANK.Quoted && stage !== 'Suspect';
}

/** The moves available from a Prospect, given its category. */
export function prospectExits(category: string | null | undefined) {
  return PROSPECT_EXITS.filter(e => !e.onlyCategories || e.onlyCategories.includes(category ?? ''));
}
