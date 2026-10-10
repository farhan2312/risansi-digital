// The SQL the Executive Review is built from, in one place.
//
// The page computes a number; the drill-down lists the rows behind it. If the
// two build their scope, their fiscal-year windows or their turnover bands
// separately, they will agree today and disagree after the next edit — and a
// drill-down that does not add up to the figure above it is worse than none,
// because it looks authoritative while being wrong. So both import from here.

/**
 * Client type, collapsed to the buckets the review reports on.
 *
 * The first bucket is End User, which is the word the rest of the portal uses
 * and the value actually stored on 1,239 clients. This page alone used to call
 * it "Direct Mill" — a name no record carries and nothing captures, invented at
 * the display layer — so the same accounts had two names depending on which
 * screen you were on. One word now, and it is the one in the data.
 *
 * Head Office folds in here too. The one client carrying it is the National
 * Sugar Institute, which runs its own plant and buys for it.
 *
 * EPC is gone: no client carries it, and it can no longer be chosen.
 */
export const CANON = `CASE
  WHEN upper(c.client_type) IN ('DIRECT MILL','END USER','HEAD OFFICE') THEN 'End User'
  WHEN upper(c.client_type) IN ('GROUP (MILLS)','GROUP')  THEN 'Group Mills'
  WHEN upper(c.client_type) IN ('TRADER','MERCHANT EXPORTER') THEN 'Trader'
  WHEN upper(c.client_type) = 'OEM' THEN 'OEM'
  WHEN upper(c.client_type) = 'CHANNEL PARTNER' THEN 'Channel Partner'
  ELSE 'Other' END`;

export const CATS = ['End User', 'Group Mills', 'Trader', 'OEM', 'Channel Partner'];

/**
 * CANON's catch-all, and what to call it on screen.
 *
 * It is almost entirely clients whose type was never filled in, so the label
 * says that rather than naming it as a category: the row exists to be chased
 * down to zero, not to be lived with. It also has to be rendered, because a
 * Grand Total built over every bucket while the rows show only CATS counts
 * clients that no row accounts for — 559 of 2,423 portal-wide when this was
 * found, and 174 of one rep's 271.
 */
export const CAT_OTHER = 'Other';
export const CAT_OTHER_LABEL = 'Unclassified / other';

/** The catch-all as a predicate, so a drill-down on it lists exactly its row. */
export const CAT_OTHER_SQL = `${CANON} NOT IN (${CATS.map(c => `'${c}'`).join(',')})`;

export const TURN_ORDER = [
  '15 Lac & above (Super Critical)', '5-15 Lacs p.a.', '3-5 Lacs p.a.', '1-3 Lacs p.a.',
  'Less than 1 Lac p.a.', 'New Business', 'Business Regained', 'End Client', 'No Business',
];

/**
 * Stage → the offer-status wording the review uses.
 *
 * Prospect and Suspect are in here. They used to be left out, and because the
 * panel aggregates by label and then totals the labels, their value appeared in
 * neither a row nor the Grand Total — ₹26.22 Cr of parked Suspect enquiries
 * missing from a table whose heading promises every offer. A status with no
 * wording is still a status.
 */
export const STAGE_TO_OFFER: Record<string, string> = {
  Prospect: 'Enquiry — not yet quoted', Suspect: 'Parked — budgetary or future',
  Quoted: 'Active', Negotiating: 'Active', 'On Hold': 'Hold-Active',
  Won: 'Order Received', Lost: 'Order Lost by RIL', Dropped: 'Requirement Closed',
};

/**
 * The offer-status rows in reading order: what has not been priced yet, what is
 * live, then the three ways it ends. Derived here rather than written out at the
 * call site so a stage added above cannot go unrendered.
 */
export const OFFER_STATUS_ORDER = (() => {
  const preferred = [
    'Enquiry — not yet quoted', 'Parked — budgetary or future', 'Active', 'Hold-Active',
    'Order Received', 'Order Lost by RIL', 'Requirement Closed',
  ];
  const all = [...new Set(Object.values(STAGE_TO_OFFER))];
  // A label the preferred order does not know about still gets a row, at the
  // end. Dropping it is how the panel lost Prospect and Suspect in the first place.
  return [...preferred.filter(l => all.includes(l)), ...all.filter(l => !preferred.includes(l))];
})();

/**
 * The date an opportunity is windowed on: the quotation's own date when there is
 * one, else the day the record was made. Written once because the page, the
 * drill-down and the out-of-window check must all window on the same column —
 * when they did not, a quote dated in February and entered in September was
 * inside one and outside another.
 */
export const OPP_WINDOW_DATE = 'COALESCE(o.quote_date, o.created_at::date)';

/**
 * Stages where the deal has not finished yet. Used to say how much of what the
 * FY window excludes is still live, because an old Won is history and an old
 * Quoted is work somebody is still waiting on.
 */
export const OPEN_STAGES = ['Prospect', 'Suspect', 'Quoted', 'Negotiating', 'On Hold'] as const;

/** Which of a TSM's accounts a figure is counted over. */
export type AccountScope = 'own' | 'all' | 'covered';

/**
 * Which of a TSM's clients the review counts.
 *
 * `own` is the book they are answerable for and the honest denominator for every
 * ratio on the page. `all` adds the accounts they cover, which is what the
 * Opportunities board counts — the two pages read nearly 4x apart on a manager
 * for exactly this reason. `covered` is the difference between them: accounts
 * they cover for somebody else and do not own, which is what the Book &
 * Coverage panel puts in its own labelled column rather than merging in silence.
 *
 * Either way the result is intersected with the VIEWER's own visibility
 * (`visAnd`): widening which of the subject's accounts to count must never
 * widen what the person looking may see.
 */
export function execScopeSql(
  tsmId: number, accountScope: AccountScope, visAnd: string,
): string {
  if (!tsmId) return 'FALSE';
  const owns = `c.primary_rep_id = ${tsmId}`;
  const covers = `c.id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = ${tsmId})`;
  // IS DISTINCT FROM, not NOT (=): an unassigned client has a null
  // primary_rep_id, and NOT (null = 5) is null, which would quietly drop a
  // covered account that nobody owns.
  const who = accountScope === 'all' ? `${owns} OR ${covers}`
    : accountScope === 'covered' ? `c.primary_rep_id IS DISTINCT FROM ${tsmId} AND ${covers}`
    : owns;
  // c.deleted_at IS NULL: an archived client's figures leave the review with it.
  return `((${who}) AND c.deleted_at IS NULL${visAnd})`;
}

export interface FyWindows {
  /** FY start year the review anchors on, e.g. 2026 for FY 26-27. */
  fy: number;
  /** Every month of the selected FY the review covers, as 'YYYY-MM'. */
  selMonths: string[];
  /** `col` bucketed into the selected months. */
  inMonths: (col: string) => string;
  /** `col` falling outside those months, or carrying no date at all. */
  outsideMonths: (col: string) => string;
  /** True when the selected FY is still running, so the window stops at this month. */
  toDate: boolean;
  /** 'YYYY-MM-01' for an FY start year. */
  d: (y: number, m?: number) => string;
  /** The five completed FYs before the anchor. */
  w5from: string;
  w5to: string;
}

/** The FY (April–March) a moment falls in, as its start year. */
export const fyOf = (now: Date) => (now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1);

/** FY start year → the app's label format: 2026 → '26-27'. */
export const fyLabel = (y: number) => `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`;

/** How many fiscal years back the selector offers. */
export const FY_CHOICES = 6;

/** The FY start years the selector offers, newest first. */
export const fyChoices = (now: Date, earliest?: number | null): number[] => {
  const cur = fyOf(now);
  const floor = Math.max(earliest ?? cur - (FY_CHOICES - 1), cur - (FY_CHOICES - 1));
  return Array.from({ length: cur - floor + 1 }, (_, i) => cur - i);
};

/** A `fy` search param, accepted only if it is one the selector offers. */
export const parseFy = (raw: unknown, now: Date, earliest?: number | null): number => {
  const v = Number(raw);
  const allowed = fyChoices(now, earliest);
  return Number.isInteger(v) && allowed.includes(v) ? v : fyOf(now);
};

/**
 * The review's fiscal windows. April–March.
 *
 * `now` is a parameter so the page and the drill-down can be handed the same
 * instant; two calls a second apart either side of midnight on 1 April would
 * otherwise anchor on different years. `selFy` picks a past year; the current
 * one still stops at this month, because a review of the year so far should not
 * promise months that have not happened, while a finished year is shown whole.
 */
export function fyWindows(now: Date, selFy?: number | null): FyWindows {
  const currentFy = fyOf(now);
  const fy = selFy == null ? currentFy : selFy;
  const last = fy < currentFy
    ? new Date(fy + 1, 2, 1)                                  // March of a completed FY
    : new Date(now.getFullYear(), now.getMonth(), 1);         // this month
  const selMonths: string[] = [];
  for (
    let cur = new Date(fy, 3, 1);
    cur <= last;
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  ) {
    selMonths.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
  }
  const d = (y: number, m = 4) => `${y}-${String(m).padStart(2, '0')}-01`;
  // Values are all YYYY-MM built above, so inlining them is safe.
  const qMonths = selMonths.map(m => `'${m}'`).join(',');
  const inMonths = (col: string) => `to_char(${col},'YYYY-MM') IN (${qMonths})`;
  return {
    fy, selMonths, d, inMonths, toDate: fy >= currentFy,
    // The IS NULL arm is not decoration: to_char(NULL) is NULL, so NOT(NULL IN
    // (...)) is NULL and a dateless row would be excluded from BOTH the window
    // and the out-of-window check — invisible on every view, which is the exact
    // failure this row exists to make impossible.
    outsideMonths: (col: string) => `(${col} IS NULL OR NOT (${inMonths(col)}))`,
    w5from: d(fy - 5), w5to: d(fy),
  };
}

/**
 * The turnover band each client falls in, as a CASE over a `rev` CTE.
 *
 * Order matters and is not alphabetical: End Client wins outright, then the two
 * movement bands (Regained, New) which describe a change rather than a level,
 * then No Business, and only then the five-year average brackets. A client who
 * started buying this year sits in New Business however much they spent.
 */
export const TURNOVER_BAND_CASE = (fy: number, d: FyWindows['d']) => `CASE
  WHEN is_end_client THEN 'End Client'
  WHEN rev_cur>0 AND rev5=0 AND rev_before>0 THEN 'Business Regained'
  WHEN first_rev IS NOT NULL AND first_rev >= '${d(fy)}' THEN 'New Business'
  WHEN rev5=0 AND rev_cur=0 THEN 'No Business'
  WHEN rev5/5.0 >= 1500000 THEN '15 Lac & above (Super Critical)'
  WHEN rev5/5.0 >= 500000  THEN '5-15 Lacs p.a.'
  WHEN rev5/5.0 >= 300000  THEN '3-5 Lacs p.a.'
  WHEN rev5/5.0 >= 100000  THEN '1-3 Lacs p.a.'
  ELSE 'Less than 1 Lac p.a.' END`;

/** The per-client revenue CTE both the summary and its drill-down sit on. */
export const TURNOVER_REV_CTE = (scope: string, w: FyWindows) => `
  SELECT c.id, c.code, c.legal_name, c.is_end_client,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.w5from}' AND r.month < '${w.w5to}'),0) rev5,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.w5to}'),0) rev_cur,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month <  '${w.w5from}'),0) rev_before,
    min(r.month) FILTER (WHERE r.total_value > 0) first_rev,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.d(w.fy)}'     AND r.month < '${w.d(w.fy + 1)}'),0) fyc,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.d(w.fy - 1)}' AND r.month < '${w.d(w.fy)}'),0)     f1,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.d(w.fy - 2)}' AND r.month < '${w.d(w.fy - 1)}'),0) f2,
    COALESCE(sum(r.total_value) FILTER (WHERE r.month >= '${w.d(w.fy - 3)}' AND r.month < '${w.d(w.fy - 2)}'),0) f3
  FROM clients c LEFT JOIN client_revenue_monthly r ON r.client_id = c.id
  WHERE ${scope} AND c.status='ACTIVE' AND c.deleted_at IS NULL
  GROUP BY c.id, c.code, c.legal_name, c.is_end_client`;

// ── Conversion ────────────────────────────────────────────────

/**
 * The stages that make up the quoted pipeline the conversion rate is measured
 * over, in the order the review lists them.
 *
 * Conversion answers "of the work we actually priced, how much came back as an
 * order", so the denominator has to be the enquiries a quotation really went
 * out on. Prospect and Suspect never reached one — a Suspect is parked, usually
 * because somebody wanted a number rather than a pump. Dropped is not a loss
 * either: the requirement went away, or the enquiry was regretted, and counting
 * it would punish the rate for work that was never competed for. On Hold does
 * carry a quotation, but a deal paused for a reason outside itself is neither
 * converting nor failing to, and leaving it in drags the rate down for as long
 * as the pause lasts.
 */
export const CONVERSION_STAGES = ['Quoted', 'Negotiating', 'Lost', 'Won'] as const;

/** The stages the conversion rate counts as converted. */
export const CONVERSION_WON_STAGES = ['Won'] as const;

/**
 * Reasons that mark an enquiry as a price check rather than a live requirement.
 *
 * Both survive a stage change — a Suspect parked as Budgetary that later gets a
 * real quotation keeps its suspect_reason — so the stage list above does not
 * catch them on its own, and three Quoted opportunities in the current FY are
 * budgetary for exactly that reason. See SUSPECT_REASONS and DROP_REASONS in
 * lib/risansi-opportunity-fields.ts.
 */
export const BUDGETARY_SUSPECT_REASONS = ['Budgetary'];
export const BUDGETARY_DROP_REASONS = ['Budgetary Enquiry'];

const quoted = (vs: readonly string[]) => vs.map(v => `'${v.replace(/'/g, "''")}'`).join(',');

/** An opportunity that is a real priced enquiry rather than a budgetary one. */
export const notBudgetarySql = (o = 'o') =>
  `COALESCE(${o}.suspect_reason,'') NOT IN (${quoted(BUDGETARY_SUSPECT_REASONS)})`
  + ` AND COALESCE(${o}.drop_reason,'') NOT IN (${quoted(BUDGETARY_DROP_REASONS)})`;

/**
 * The conversion predicate, for one bucket of stages or for the whole
 * denominator. The page's figure and the drill-down behind it both build their
 * WHERE from here, so a row that appears in one cannot be missing from the other.
 */
export const conversionWhereSql = (
  stages: readonly string[] = CONVERSION_STAGES, o = 'o',
) => `${o}.stage IN (${quoted(stages)}) AND ${notBudgetarySql(o)}`;

/** What the conversion figure counts, said the same way wherever it is shown. */
export const CONVERSION_INCLUDES =
  'Quoted, Negotiating, Lost and Won — every enquiry a quotation actually went out on.';
export const CONVERSION_EXCLUDES =
  'Suspect and Prospect (no quotation yet), Dropped (the requirement went away), On Hold (paused, moving neither way), '
  + 'and any opportunity marked budgetary by its suspect or drop reason, whatever stage it now sits at.';
