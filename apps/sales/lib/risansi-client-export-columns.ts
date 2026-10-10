// What the client export can contain, in the order it comes out.
//
// The picker and the exporter both read this. Kept apart from the accessors in
// the route because those need the Row type and a database round trip, while the
// picker only needs to know what exists and what it is called — but the KEYS and
// the ORDER have to be the same on both sides or a ticked column comes out
// holding somebody else's values.

export interface ClientExportColumn {
  /** Stable id. Sent in ?cols= — never change one, or saved links break. */
  key: string;
  label: string;
  width: number;
  /** Grouping for the picker only; it does not affect the sheet. */
  group: 'Identity' | 'Classification' | 'Location' | 'People' | 'Commercial' | 'Activity' | 'Comments' | 'Record';
  /** Money stays numeric in the sheet so it remains analysable in Excel. */
  money?: boolean;
}

export const CLIENT_EXPORT_COLUMNS: ClientExportColumn[] = [
  { key: 'code',              label: 'Client Code',            width: 14, group: 'Identity' },
  { key: 'legal_name',        label: 'Legal Name',             width: 30, group: 'Identity' },
  { key: 'trade_name',        label: 'Trade Name',             width: 22, group: 'Identity' },
  { key: 'group_name',        label: 'Group Name',             width: 22, group: 'Identity' },

  { key: 'industry',          label: 'Industry',               width: 16, group: 'Classification' },
  { key: 'client_type',       label: 'Client Type',            width: 14, group: 'Classification' },
  { key: 'tier',              label: 'Tier',                   width: 10, group: 'Classification' },
  { key: 'status',            label: 'Status',                 width: 16, group: 'Classification' },
  { key: 'market_type',       label: 'Market Type',            width: 12, group: 'Classification' },
  { key: 'is_sugar',          label: 'Sugar',                  width: 7,  group: 'Classification' },
  { key: 'is_tender',         label: 'Tender',                 width: 8,  group: 'Classification' },
  { key: 'is_end_client',     label: 'End Client',             width: 10, group: 'Classification' },
  { key: 'capacity_bracket',  label: 'Capacity Bracket',       width: 16, group: 'Classification' },
  { key: 'tcd',               label: 'TCD',                    width: 8,  group: 'Classification' },
  { key: 'klpd',              label: 'KLPD',                   width: 8,  group: 'Classification' },
  { key: 'since_year',        label: 'Customer Since',         width: 16, group: 'Classification' },

  { key: 'country',           label: 'Country',                width: 12, group: 'Location' },
  { key: 'zone',              label: 'Zone',                   width: 12, group: 'Location' },
  { key: 'state',             label: 'State',                  width: 14, group: 'Location' },
  { key: 'city',              label: 'City',                   width: 16, group: 'Location' },
  { key: 'address',           label: 'Address',                width: 34, group: 'Location' },
  { key: 'google_maps_url',   label: 'Google Maps URL',        width: 26, group: 'Location' },
  { key: 'tour_name',         label: 'Tour / Route',           width: 18, group: 'Location' },

  // Three rep columns, deliberately. `reps` is the joined list this export always
  // had — removing it would break whatever downstream sheet already keys on that
  // header — and the two beside it answer the question that list cannot: which of
  // these people OWNS the account.
  { key: 'primary_rep',       label: 'Primary Rep',            width: 20, group: 'People' },
  { key: 'secondary_reps',    label: 'Secondary Reps',         width: 24, group: 'People' },
  { key: 'reps',              label: 'Rep(s) — owner + cover', width: 24, group: 'People' },
  { key: 'managers',          label: 'Manager(s)',             width: 20, group: 'People' },

  { key: 'lifetime_rev',      label: 'Lifetime Revenue (₹)',   width: 18, group: 'Commercial', money: true },
  { key: 'fy_rev',            label: 'Current FY Revenue (₹)', width: 18, group: 'Commercial', money: true },
  { key: 'total_outstanding', label: 'Total Outstanding (₹)',  width: 18, group: 'Commercial', money: true },
  { key: 'outstanding_as_of', label: 'Outstanding As Of',      width: 16, group: 'Commercial' },
  { key: 'open_pipeline_inr', label: 'Open Pipeline (₹)',      width: 16, group: 'Commercial', money: true },
  { key: 'open_opps',         label: 'Open Opportunities',     width: 16, group: 'Commercial' },

  { key: 'last_visit_date',   label: 'Last Visit Date',        width: 14, group: 'Activity' },
  { key: 'days_since',        label: 'Days Since Last Visit',  width: 18, group: 'Activity' },
  { key: 'total_visits',      label: 'Total Visits',           width: 12, group: 'Activity' },
  { key: 'contacts_count',    label: 'Contacts',               width: 10, group: 'Activity' },

  { key: 'comments_count',    label: 'Comments',               width: 10, group: 'Comments' },
  { key: 'last_comment_at',   label: 'Latest Comment On',      width: 16, group: 'Comments' },
  { key: 'last_comment_by',   label: 'Latest Comment By',      width: 18, group: 'Comments' },
  { key: 'last_comment',      label: 'Latest Comment',         width: 46, group: 'Comments' },
  { key: 'comments_all',      label: 'All Comments',           width: 60, group: 'Comments' },

  { key: 'created_by',        label: 'Created By',             width: 16, group: 'Record' },
  { key: 'created_at',        label: 'Created On',             width: 12, group: 'Record' },
  { key: 'updated_by',        label: 'Updated By',             width: 16, group: 'Record' },
  { key: 'updated_at',        label: 'Updated On',             width: 12, group: 'Record' },
];

export const CLIENT_EXPORT_GROUPS = [
  'Identity', 'Classification', 'Location', 'People', 'Commercial', 'Activity', 'Comments', 'Record',
] as const;

/** Excel refuses a cell over 32,767 characters, so the joined comment column
 *  stops short of it and says that it did rather than losing the whole row. */
export const XLSX_CELL_LIMIT = 32_000;

/**
 * Which columns a `?cols=` value asks for.
 *
 * Absent or empty means every column — the export answered that way before the
 * picker existed, and a link saved from back then must keep working. An unknown
 * key is dropped rather than refused: a stale bookmark should lose a column, not
 * the whole download.
 */
export function resolveExportColumns(raw: string | null): ClientExportColumn[] {
  if (!raw || !raw.trim()) return CLIENT_EXPORT_COLUMNS;
  const want = new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  const picked = CLIENT_EXPORT_COLUMNS.filter(c => want.has(c.key));
  // Every key unknown means the caller and this file disagree entirely. Falling
  // back to all beats handing back a spreadsheet with no columns in it.
  return picked.length ? picked : CLIENT_EXPORT_COLUMNS;
}

// ── The Opportunities sheet ───────────────────────────────────────
//
// A second worksheet at a different grain: one row per opportunity, for the same
// clients the Clients sheet holds. Not extra columns on the client row, because
// a client with nine opportunities cannot be a row — the aggregate columns
// (Open Pipeline, Open Opportunities) are what a client-grain sheet can say, and
// they are already there. This is for when the aggregate is not enough.

export interface OppExportColumn {
  key: string;
  label: string;
  width: number;
  group: 'Client' | 'Opportunity' | 'Quotation' | 'Outcome';
  money?: boolean;
}

export const OPP_EXPORT_COLUMNS: OppExportColumn[] = [
  { key: 'client_code',   label: 'Client Code',        width: 14, group: 'Client' },
  { key: 'client_name',   label: 'Client Name',        width: 30, group: 'Client' },
  { key: 'primary_rep',   label: 'Primary Rep',        width: 20, group: 'Client' },

  { key: 'opp_id',        label: 'Opp ID',             width: 10, group: 'Opportunity' },
  { key: 'stage',         label: 'Stage',              width: 13, group: 'Opportunity' },
  { key: 'opp_type',      label: 'Type',               width: 10, group: 'Opportunity' },
  { key: 'opp_source',    label: 'Source',             width: 14, group: 'Opportunity' },
  { key: 'opp_category',  label: 'Category',           width: 18, group: 'Opportunity' },
  { key: 'product_type',  label: 'Product Type',       width: 13, group: 'Opportunity' },
  { key: 'unit_project',  label: 'Project / Unit',     width: 28, group: 'Opportunity' },
  { key: 'enquiry_no',    label: 'Enquiry No.',        width: 16, group: 'Opportunity' },
  { key: 'enquiry_date',  label: 'Enquiry Date',       width: 13, group: 'Opportunity' },

  { key: 'quote_ref',     label: 'Quote No.',          width: 18, group: 'Quotation' },
  { key: 'quote_date',    label: 'Quote Date',         width: 13, group: 'Quotation' },
  { key: 'market',        label: 'Market',             width: 11, group: 'Quotation' },
  { key: 'offer_value',   label: 'Total Offer (₹)',    width: 17, group: 'Quotation', money: true },
  { key: 'probability',   label: 'Probability %',      width: 13, group: 'Quotation' },
  { key: 'eta_text',      label: 'Expected Close',     width: 15, group: 'Quotation' },
  { key: 'docs',          label: 'Documents',          width: 11, group: 'Quotation' },

  { key: 'final_value',   label: 'Sale Order Value (₹)', width: 18, group: 'Outcome', money: true },
  { key: 'so_value',      label: 'Booked in SO (₹)',   width: 17, group: 'Outcome', money: true },
  { key: 'order_in_hand', label: 'Order in Hand (₹)',  width: 17, group: 'Outcome', money: true },
  { key: 'po_number',     label: 'PO Number',          width: 16, group: 'Outcome' },
  { key: 'po_date',       label: 'PO Date',            width: 13, group: 'Outcome' },
  { key: 'po_received_date', label: 'PO Received Date', width: 15, group: 'Outcome' },
  { key: 'lost_to',       label: 'Lost To Competitor', width: 20, group: 'Outcome' },
  { key: 'lost_reason',   label: 'Lost Reason',        width: 26, group: 'Outcome' },
  { key: 'drop_reason',   label: 'Drop Reason',        width: 22, group: 'Outcome' },
  { key: 'drop_reason_other', label: 'Drop Reason (Other)', width: 30, group: 'Outcome' },
  { key: 'created_on',    label: 'Raised On',          width: 12, group: 'Outcome' },
];

export const OPP_EXPORT_GROUPS = ['Client', 'Opportunity', 'Quotation', 'Outcome'] as const;

/** Same rules as resolveExportColumns — absent means all, unknown keys drop. */
export function resolveOppColumns(raw: string | null): OppExportColumn[] {
  if (!raw || !raw.trim()) return OPP_EXPORT_COLUMNS;
  const want = new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  const picked = OPP_EXPORT_COLUMNS.filter(c => want.has(c.key));
  return picked.length ? picked : OPP_EXPORT_COLUMNS;
}
