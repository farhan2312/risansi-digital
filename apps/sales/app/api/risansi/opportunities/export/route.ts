import { NextResponse } from 'next/server';
import { probabilityPctSql } from '@/lib/risansi-probability-codes';
import { join } from 'path';
import ExcelJS from 'exceljs';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, clientScopeSql , OWN_OPEN } from '@/lib/risansi-auth';
import { DROP_REASONS, PRODUCT_TYPES as OPP_PRODUCT_TYPES } from '@/lib/risansi-opportunity-fields';
import { APP_URL } from '@/lib/risansi-app-url';
import { quotationExportLink, quotationRecordLabel } from '@/lib/risansi-quotation-link';
import { repBookSql } from '@/lib/risansi-opp-filters';
import { LIVE_CLIENT } from '@/lib/risansi-opportunity-scope';
import { clientStatusLabel } from '@/lib/risansi-client-status';

export const runtime = 'nodejs';

// Full opportunities export for ERP reconciliation and a one-time re-ingest.
// EVERY attribute gets a column regardless of stage (blank where not set), enum
// columns carry strict dropdown validation from a hidden Lists sheet, and each
// opportunity gets four Sales Order slots (No / Date / Value) to fill in.

const STAGES        = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped'];
// Imported, not re-listed: this drives the Excel dropdown, and a stale copy
// here offers a value the database now refuses on re-ingest.
const PRODUCT_TYPES = [...OPP_PRODUCT_TYPES];
const PROB_CODES    = ['1', '2', '3', '4'];
const MARKETS       = ['DOMESTIC', 'EXPORT'];
const CLIENT_STATUS = ['NEW', 'EXISTING'];
const QUARTERS      = ['Q1', 'Q2', 'Q3', 'Q4'];
const LOST_REASONS  = [
  'Price — Too expensive', 'Technical — Spec mismatch', 'OEM Tied — Forced preference',
  'Relationship — Existing supplier', 'Budget — Project cancelled', 'Delivery — Timeline mismatch',
  'No decision — Deferred', 'Other',
];

// One array behind the hidden Lists sheet: it decides the column letter, the
// header, the values written, and the validation range that points at them.
//
// The ranges used to be hand-written next to each column and they drift. This is
// the second time: PRODUCT_TYPES outgrew $B$2:$B$7 when a seventh type arrived
// and was patched into a computed range on its own, and DROP_REASONS then
// outgrew $H$2:$H$6 when the pipeline rework added 'Inquiry Regret' and
// 'Incorrect entry / Duplicate' — so the sheet wrote both values into column H
// and refused them in its own dropdown. Patching one range at a time clearly
// does not hold; deriving every range from the array it points at does.
const LIST_SOURCES = [
  { header: 'Stage',        values: STAGES },
  { header: 'ProductType',  values: PRODUCT_TYPES },
  { header: 'ProbCode',     values: PROB_CODES },
  { header: 'Market',       values: MARKETS },
  { header: 'ClientStatus', values: CLIENT_STATUS },
  { header: 'Quarter',      values: QUARTERS },
  { header: 'LostReason',   values: LOST_REASONS },
  { header: 'DropReason',   values: DROP_REASONS },
] as const satisfies readonly { header: string; values: readonly string[] }[];

const listRange = (values: readonly string[]) => {
  const i = LIST_SOURCES.findIndex(sr => sr.values === values);
  if (i < 0) throw new Error('listRange: that list is not in LIST_SOURCES');
  const col = String.fromCharCode(65 + i);
  return `Lists!$${col}$2:$${col}$${1 + values.length}`;
};

// Value buckets on value_cr (Crores) — same constants as the pipeline filter, so
// they inline safely (no params).
const VALUE_BUCKETS: { label: string; min: number; max: number | null }[] = [
  { label: '< ₹1L',    min: 0,    max: 0.01 },
  { label: '₹1–5L',    min: 0.01, max: 0.05 },
  { label: '₹5–10L',   min: 0.05, max: 0.10 },
  { label: '₹10–50L',  min: 0.10, max: 0.50 },
  { label: '₹50L–1Cr', min: 0.50, max: 1.0 },
  { label: '≥ ₹1Cr',   min: 1.0,  max: null },
];
const valueRangeSql = (col: string, labels: string[]): string => {
  const parts = labels
    .map(l => VALUE_BUCKETS.find(b => b.label === l))
    .filter((b): b is { label: string; min: number; max: number | null } => !!b)
    .map(b => (b.max == null ? `${col} >= ${b.min}` : `(${col} >= ${b.min} AND ${col} < ${b.max})`));
  return parts.length ? `(${parts.join(' OR ')})` : '';
};

interface Row {
  id: number; client_code: string | null; client_name: string | null;
  client_type: string | null; industry: string | null;
  tour_name: string | null; tour_people: string | null;
  stage: string | null; product: string | null; unit_project: string | null;
  product_type: string | null; value_cr: number | null; probability_code: string | null;
  probability: number | null; eta_text: string | null;
  quote_ref: string | null; quote_date: string | null; enquiry_no: string | null; enquiry_date: string | null;
  market: string | null; client_status_at_quote: string | null; qtn_prepared_by: string | null;
  qtr: string | null; location: string | null;
  offer_value_inr: number | null;
  revised_offer_value_inr: number | null; revised_offer_date: string | null;
  offer_revision_history: string | null;
  ril_rep: string | null; pump_model: string | null; pump_qty: number | null;
  negotiation_notes: string | null; notes: string | null;
  final_value_cr: number | null; po_number: string | null;
  po_date: string | null; po_received_date: string | null;
  lost_to_competitor: string | null; lost_reason: string | null; drop_reason: string | null;
  drop_reason_other: string | null; quotation_link: string | null;
  doc_count: number | null;
  created_by: string | null; created_at: string | null; updated_at: string | null;
}
interface So { opportunity_id: number; so_number: string; so_date: string; so_value_cr: number; }

const CR = 10_000_000;
const rupees = (cr: number | null) => (cr != null ? Math.round(Number(cr) * CR) : '');

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  // Mirror the Opportunities page filters (passed through on the export link) so
  // the export matches what's on screen. Same conditions, same aliases (o / c).
  const params = new URL(req.url).searchParams;
  const parseList = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
  const stageFilts    = parseList(params.get('stage'));
  const prodTypeFilts = parseList(params.get('product_type'));
  const repFilts      = params.get('rep') && params.get('rep') !== 'all' ? parseList(params.get('rep')) : [];
  const indFilts      = parseList(params.get('industry'));
  const ctypeFilts    = parseList(params.get('ctype'));
  // clients.status, a separate column from client_type — the two share one
  // dropdown on the board and AND here the same way they do there.
  const cstatFilts    = parseList(params.get('cstat'));
  const probFilts     = parseList(params.get('prob'));
  const valFilts      = parseList(params.get('val'));
  // Sales-Order coverage on a Won opportunity — set by clicking a Won bracket on
  // the Opportunities page. Validated to an enum so it can be inlined safely.
  const soRaw   = params.get('so');
  const soFilt  = soRaw === 'awaiting' || soRaw === 'created' ? soRaw : '';
  const qname = (params.get('qname') ?? '').trim();
  const qfrom = (params.get('qfrom') ?? '').trim();
  const qto   = (params.get('qto')   ?? '').trim();
  const efrom = (params.get('efrom') ?? '').trim();
  const eto   = (params.get('eto')   ?? '').trim();

  const conds: string[] = [];
  const vals: (string | number | string[])[] = [];
  let idx = 1;
  const scope = clientScopeSql(user, 'o.client_id', OWN_OPEN.opportunity('o'));   // per-user visibility (inlined; no param)
  if (scope) conds.push(scope);
  conds.push(LIVE_CLIENT('o'));   // an archived client's opportunities are not exported
  if (stageFilts.length)    { conds.push(`o.stage = ANY($${idx}::text[])`);            vals.push(stageFilts);    idx++; }
  if (prodTypeFilts.length) { conds.push(`o.product_type = ANY($${idx}::text[])`);     vals.push(prodTypeFilts); idx++; }
  if (repFilts.length)      { conds.push(repBookSql(`$${idx}::text[]`)); vals.push(repFilts); idx++; }
  if (indFilts.length)      { conds.push(`c.industry = ANY($${idx}::text[])`);          vals.push(indFilts);      idx++; }
  if (ctypeFilts.length)    { conds.push(`c.client_type = ANY($${idx}::text[])`);       vals.push(ctypeFilts);    idx++; }
  if (cstatFilts.length)    { conds.push(`c.status = ANY($${idx}::text[])`);             vals.push(cstatFilts);    idx++; }
  if (probFilts.length)     { conds.push(`o.probability_code = ANY($${idx}::text[])`);  vals.push(probFilts);     idx++; }
  if (valFilts.length)      { const v = valueRangeSql('o.value_cr', valFilts); if (v) conds.push(v); }
  if (soFilt) {
    // Mirrors soSql() on the Opportunities page — both branches pin stage='Won',
    // because SO coverage is only defined on a won deal.
    const soSum = `COALESCE((SELECT SUM(so.so_value_cr) FROM opportunity_sales_orders so WHERE so.opportunity_id = o.id), 0)`;
    conds.push(soFilt === 'awaiting'
      ? `(o.stage = 'Won' AND COALESCE(o.final_value_cr, o.value_cr, 0) - ${soSum} > 0)`
      : `(o.stage = 'Won' AND ${soSum} > 0)`);
  }
  if (qname) { conds.push(`(o.quote_ref ILIKE $${idx} OR c.legal_name ILIKE $${idx} OR o.product ILIKE $${idx})`); vals.push(`%${qname}%`); idx++; }
  if (qfrom) { conds.push(`o.quote_date >= $${idx}`); vals.push(qfrom); idx++; }
  if (qto)   { conds.push(`o.quote_date <= $${idx}`); vals.push(qto);   idx++; }
  if (efrom) { conds.push(`o.enquiry_date >= $${idx}`); vals.push(efrom); idx++; }
  if (eto)   { conds.push(`o.enquiry_date <= $${idx}`); vals.push(eto);   idx++; }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  // Human-readable list for the "Filters Applied" sheet.
  const appliedFilters: [string, string][] = [];
  if (stageFilts.length)    appliedFilters.push(['Stage', stageFilts.join(', ')]);
  if (prodTypeFilts.length) appliedFilters.push(['Product Type', prodTypeFilts.join(', ')]);
  if (repFilts.length)      appliedFilters.push(['Rep / Tour', repFilts.join(', ')]);
  if (indFilts.length)      appliedFilters.push(['Industry', indFilts.join(', ')]);
  if (ctypeFilts.length)    appliedFilters.push(['Client Type', ctypeFilts.join(', ')]);
  if (cstatFilts.length)    appliedFilters.push(['Client Status', cstatFilts.map(clientStatusLabel).join(', ')]);
  if (probFilts.length)     appliedFilters.push(['Probability code', probFilts.join(', ')]);
  if (valFilts.length)      appliedFilters.push(['Value bucket', valFilts.join(', ')]);
  if (soFilt)               appliedFilters.push(['Sales Order', soFilt === 'awaiting' ? 'Awaiting SO' : 'SO created']);
  if (qname) appliedFilters.push(['Quote no. / name search', qname]);
  if (qfrom) appliedFilters.push(['Quote date from', qfrom]);
  if (qto)   appliedFilters.push(['Quote date to', qto]);
  if (efrom) appliedFilters.push(['Enquiry date from', efrom]);
  if (eto)   appliedFilters.push(['Enquiry date to', eto]);

  let rows: Row[] = [];
  let sos: So[] = [];
  try {
    rows = (await risansiPool.query<Row>(
      `SELECT o.id,
              c.code AS client_code, c.legal_name AS client_name,
              c.client_type, c.industry,
              tr.name AS tour_name,
              -- The people who work the client: its owner, then anyone covering
              -- it. There IS a single owner now, and the column says which.
              (SELECT string_agg(u.name || CASE WHEN r.rank = 1 THEN ' (cover)' ELSE '' END, ', '
                                 ORDER BY r.rank, u.name)
                 FROM (SELECT c2.primary_rep_id AS user_id, 0 AS rank FROM clients c2
                        WHERE c2.id = c.id AND c2.primary_rep_id IS NOT NULL
                       UNION ALL
                       SELECT sr.rep_id, 1 FROM client_secondary_reps sr WHERE sr.client_id = c.id) r
                 JOIN users u ON u.id = r.user_id) AS tour_people,
              o.stage, o.product, o.unit_project, o.product_type,
              o.value_cr::float8 AS value_cr, o.probability_code,
              ${probabilityPctSql('o')} AS probability, o.eta_text,
              o.quote_ref, o.quote_date::text AS quote_date, o.enquiry_no, o.enquiry_date::text AS enquiry_date,
              o.market, o.client_status_at_quote, o.qtn_prepared_by, o.qtr, o.location,
              o.offer_value_inr::float8 AS offer_value_inr,
              o.revised_offer_value_inr::float8 AS revised_offer_value_inr,
              o.revised_offer_date::text AS revised_offer_date,
              -- The full re-pricing history, flattened to one cell. The three
              -- Revised Offer columns above stay as the LATEST revision, so
              -- existing re-ingest and pivots keep reading what they always did.
              (SELECT string_agg(to_char(r.revised_on, 'YYYY-MM-DD') || ': ' ||
                                 to_char(r.value_inr, 'FM9999999999990') ||
                                 CASE WHEN r.note IS NULL OR btrim(r.note) = '' THEN '' ELSE ' (' || r.note || ')' END,
                                 ' | ' ORDER BY r.revised_on, r.id)
                 FROM opportunity_offer_revisions r
                WHERE r.opportunity_id = o.id) AS offer_revision_history,
              o.ril_rep, o.pump_model, o.pump_qty,
              o.negotiation_notes, o.notes,
              o.final_value_cr::float8 AS final_value_cr, o.po_number,
              o.po_date::text AS po_date, o.po_received_date::text AS po_received_date,
              o.lost_to_competitor, o.lost_reason, o.drop_reason, o.drop_reason_other, o.quotation_link,
              (SELECT count(*) FROM opportunity_quotation_files qf
                WHERE qf.opportunity_id = o.id)::int AS doc_count,
              o.created_by, o.created_at::text AS created_at, o.updated_at::text AS updated_at
         FROM opportunities o
         JOIN clients c ON c.id = o.client_id
         LEFT JOIN tour_routes tr ON tr.id = c.tour_id
         ${where}
         ORDER BY c.legal_name ASC, o.id ASC`,
      vals as (string | number)[],
    )).rows;

    sos = (await risansiPool.query<So>(
      `SELECT so.opportunity_id, so.so_number, so.so_date::text AS so_date, so.so_value_cr::float8 AS so_value_cr
         FROM opportunity_sales_orders so
         JOIN opportunities o ON o.id = so.opportunity_id
         JOIN clients c ON c.id = o.client_id
         ${where}
         ORDER BY so.opportunity_id, so.so_date, so.id`,
      vals as (string | number)[],
    )).rows;
  } catch (err) {
    console.error('[opportunities/export] query failed:', err);
    return new NextResponse('Export failed', { status: 500 });
  }

  const soByOpp = new Map<number, So[]>();
  for (const s of sos) { const a = soByOpp.get(s.opportunity_id) ?? []; a.push(s); soByOpp.set(s.opportunity_id, a); }

  // Column catalogue. `list`/`date`/`num` drive the strict validation applied below.
  // `href` exists because the text of a link cell and its target are not always
  // the same string. An opportunity can carry two SharePoint urls in one field,
  // and a cell holds one hyperlink: the text shows both so neither is lost, the
  // hyperlink points at the first.
  type Col = {
    h: string; w: number; f: (r: Row) => string | number;
    fmt?: string; list?: string; date?: boolean; num?: boolean;
    link?: boolean; href?: (r: Row) => string | null;
  };
  const so = (r: Row, i: number, part: 'num' | 'date' | 'val') => {
    const s = (soByOpp.get(r.id) ?? [])[i];
    if (!s) return '';
    return part === 'num' ? s.so_number : part === 'date' ? s.so_date : rupees(s.so_value_cr);
  };
  const COLS: Col[] = [
    { h: 'Opp ID', w: 8,  f: r => r.id },
    { h: 'Client Code', w: 14, f: r => r.client_code ?? '' },
    { h: 'Client Name', w: 30, f: r => r.client_name ?? '' },
    // Client attributes, not opportunity ones — no dropdown validation, since
    // editing them here would not write back to the client record.
    { h: 'Client Type', w: 16, f: r => r.client_type ?? '' },
    { h: 'Industry', w: 16, f: r => r.industry ?? '' },
    { h: 'Tour', w: 16, f: r => r.tour_name ?? '' },
    { h: 'Owner / Covering reps', w: 30, f: r => r.tour_people ?? '' },
    { h: 'Stage', w: 13, f: r => r.stage ?? '', list: listRange(STAGES) },
    { h: 'Product / Description', w: 30, f: r => r.product ?? '' },
    { h: 'Project Name / Unit', w: 26, f: r => r.unit_project ?? '' },
    { h: 'Product Type', w: 13, f: r => r.product_type ?? '', list: listRange(PRODUCT_TYPES) },
    { h: 'Value (₹)', w: 14, f: r => rupees(r.value_cr), fmt: '#,##0', num: true },
    { h: 'Probability Code', w: 14, f: r => r.probability_code ?? '', list: listRange(PROB_CODES) },
    { h: 'Probability %', w: 11, f: r => (r.probability ?? ''), num: true },
    { h: 'Expected Close', w: 14, f: r => r.eta_text ?? '' },
    { h: 'Quote No.', w: 16, f: r => r.quote_ref ?? '' },
    { h: 'Quote Date', w: 13, f: r => r.quote_date ?? '', date: true },
    { h: 'Enquiry No.', w: 16, f: r => r.enquiry_no ?? '' },
    { h: 'Enquiry Date', w: 13, f: r => r.enquiry_date ?? '', date: true },
    { h: 'Market', w: 11, f: r => r.market ?? '', list: listRange(MARKETS) },
    { h: 'Client Status', w: 12, f: r => r.client_status_at_quote ?? '', list: listRange(CLIENT_STATUS) },
    { h: 'Qtn. Prepared By', w: 16, f: r => r.qtn_prepared_by ?? '' },
    { h: 'Quarter', w: 9,  f: r => r.qtr ?? '', list: listRange(QUARTERS) },
    { h: 'Location', w: 16, f: r => r.location ?? '' },
    { h: 'Total Offer (₹)', w: 15, f: r => (r.offer_value_inr ?? ''), fmt: '#,##0', num: true },
    { h: 'Revised Offer (₹)', w: 15, f: r => (r.revised_offer_value_inr ?? ''), fmt: '#,##0', num: true },
    { h: 'Revised Offer Date', w: 15, f: r => r.revised_offer_date ?? '', date: true },
    { h: 'Offer Revision History', w: 42, f: r => r.offer_revision_history ?? '' },
    { h: 'RIL Rep', w: 14, f: r => r.ril_rep ?? '' },
    { h: 'Pump Model', w: 22, f: r => r.pump_model ?? '' },
    { h: 'Pump Qty', w: 10, f: r => (r.pump_qty ?? ''), num: true },
    { h: 'Negotiation Notes', w: 30, f: r => r.negotiation_notes ?? '' },
    { h: 'Notes', w: 30, f: r => r.notes ?? '' },
    { h: 'Final Value (₹)', w: 15, f: r => rupees(r.final_value_cr), fmt: '#,##0', num: true },
    { h: 'PO Number', w: 16, f: r => r.po_number ?? '' },
    // The date on the PO and the day it reached us. Usually the same, and
    // worth telling apart when they are not.
    { h: 'PO Date', w: 13, f: r => r.po_date ?? '' },
    { h: 'PO Received Date', w: 15, f: r => r.po_received_date ?? '' },
    { h: 'Lost To Competitor', w: 18, f: r => r.lost_to_competitor ?? '' },
    { h: 'Lost Reason', w: 26, f: r => r.lost_reason ?? '', list: listRange(LOST_REASONS) },
    { h: 'Drop Reason', w: 28, f: r => r.drop_reason ?? '', list: listRange(DROP_REASONS) },
    // Separate column rather than folded into the one above: that one carries
    // the dropdown, and free text in it would fail the sheet's own validation.
    { h: 'Drop Reason (Other)', w: 34, f: r => r.drop_reason_other ?? '' },
    // Derived, so no edit validation: it is a readout of what is attached, not
    // a field anyone fills in on the reconciliation pass.
    { h: 'Documents', w: 11, f: r => r.doc_count ?? 0 },
    // Absolute, and a real Excel hyperlink. The stored value is an in-app path
    // What kind of record it is, as its own column, because "has a quotation"
    // and "this portal holds the PDF" are different facts and Power BI cannot
    // tell them apart from a url. Documents (above) already counts uploads only,
    // and doc_count is what decides both of these columns too — a row can hold
    // PDFs and still carry the SharePoint url it had before them.
    { h: 'Quotation Record', w: 18, f: r => quotationRecordLabel(r.quotation_link, { docCount: r.doc_count ?? 0 }) },
    {
      h: 'Quotation Link', w: 34, link: true,
      // Absolute, because a relative path is dead the moment the sheet leaves
      // the browser. Every address on its own line — the attached document
      // first, then any legacy url — so the 39 opportunities carrying a second
      // quotation do not silently export as though they carried one, and a row
      // that has both does not lose either.
      f: r => quotationExportLink(r.quotation_link, { docCount: r.doc_count ?? 0, oppId: r.id, origin: APP_URL }).text,
      href: r => quotationExportLink(r.quotation_link, { docCount: r.doc_count ?? 0, oppId: r.id, origin: APP_URL }).href,
    },
    { h: 'Created By', w: 16, f: r => r.created_by ?? '' },
    { h: 'Created On', w: 12, f: r => (r.created_at ? r.created_at.slice(0, 10) : '') },
    { h: 'Updated On', w: 12, f: r => (r.updated_at ? r.updated_at.slice(0, 10) : '') },
    // Four Sales Order slots.
    { h: 'SO1 Number', w: 14, f: r => so(r, 0, 'num') },
    { h: 'SO1 Date',   w: 13, f: r => so(r, 0, 'date'), date: true },
    { h: 'SO1 Value (₹)', w: 14, f: r => so(r, 0, 'val'), fmt: '#,##0', num: true },
    { h: 'SO2 Number', w: 14, f: r => so(r, 1, 'num') },
    { h: 'SO2 Date',   w: 13, f: r => so(r, 1, 'date'), date: true },
    { h: 'SO2 Value (₹)', w: 14, f: r => so(r, 1, 'val'), fmt: '#,##0', num: true },
    { h: 'SO3 Number', w: 14, f: r => so(r, 2, 'num') },
    { h: 'SO3 Date',   w: 13, f: r => so(r, 2, 'date'), date: true },
    { h: 'SO3 Value (₹)', w: 14, f: r => so(r, 2, 'val'), fmt: '#,##0', num: true },
    { h: 'SO4 Number', w: 14, f: r => so(r, 3, 'num') },
    { h: 'SO4 Date',   w: 13, f: r => so(r, 3, 'date'), date: true },
    { h: 'SO4 Value (₹)', w: 14, f: r => so(r, 3, 'val'), fmt: '#,##0', num: true },
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  const wb = new ExcelJS.Workbook();

  // Hidden sheet holding the dropdown option lists.
  const lists = wb.addWorksheet('Lists', { state: 'veryHidden' });
  LIST_SOURCES.forEach((src, ci) => {
    lists.getCell(1, ci + 1).value = src.header;
    src.values.forEach((v, ri) => { lists.getCell(ri + 2, ci + 1).value = v; });
  });

  const ws = wb.addWorksheet('Opportunities', { views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }] });
  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });

  try {
    const logoId = wb.addImage({ filename: join(process.cwd(), 'public', 'logo.png'), extension: 'png' });
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 47 } });
  } catch { /* logo optional */ }
  ws.getRow(1).height = 26; ws.getRow(2).height = 16;
  const title = ws.getCell('D1'); title.value = 'Opportunities Export';
  title.font = { size: 14, bold: true, color: { argb: 'FF0A3D8F' } };
  const sub = ws.getCell('D2');
  sub.value = `${rows.length.toLocaleString('en-IN')} opportunit${rows.length === 1 ? 'y' : 'ies'}${appliedFilters.length ? ` · ${appliedFilters.length} filter${appliedFilters.length === 1 ? '' : 's'} applied` : ''} · ${stamp}`;
  sub.font = { size: 10, color: { argb: 'FF64748B' } };

  const header = ws.getRow(3);
  COLS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A3D8F' } };
    cell.alignment = { vertical: 'middle', wrapText: false };
  });
  header.height = 18;

  rows.forEach((r, ri) => {
    const row = ws.getRow(4 + ri);
    COLS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = c.f(r);
      // A clickable hyperlink when there is really somewhere to go. The 10
      // legacy rows holding a document name rather than a url fall through to
      // plain text — better a visibly dead string than a link that pretends to
      // work. Testing the href rather than the text is what stops a two-url
      // value being handed to Excel whole, newlines and all.
      const href = c.href ? c.href(r) : (typeof v === 'string' ? v : '');
      if (c.link && href && /^https?:\/\//i.test(href) && typeof v === 'string') {
        cell.value = { text: v, hyperlink: href };
        cell.font = { color: { argb: 'FF1A5CB8' }, underline: true };
      } else {
        cell.value = v;
      }
      if (c.fmt) cell.numFmt = c.fmt;
    });
  });

  // Strict validation across the data rows PLUS a small buffer for adding new
  // rows. The old +200 built ~30 columns × 200 spare dataValidation objects into
  // the in-memory workbook on every export for rows nobody had entered.
  const firstRow = 4, lastRow = 4 + rows.length + 25;
  COLS.forEach((c, i) => {
    if (!c.list && !c.date && !c.num) return;
    for (let rr = firstRow; rr <= lastRow; rr++) {
      const cell = ws.getCell(rr, i + 1);
      if (c.list) {
        cell.dataValidation = { type: 'list', allowBlank: true, formulae: [c.list], showErrorMessage: true, errorStyle: 'error', errorTitle: 'Pick from the list', error: `Choose one of: ${c.h}` };
      } else if (c.date) {
        cell.dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(2000, 0, 1)], showErrorMessage: true, errorTitle: 'Date', error: 'Enter a valid date (YYYY-MM-DD).' };
      } else if (c.num) {
        cell.dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: 'Number', error: 'Enter a number of 0 or more.' };
      }
    }
  });

  // ── Filters Applied sheet — what was in effect for this export ──
  const fws = wb.addWorksheet('Filters Applied');
  fws.getColumn(1).width = 26; fws.getColumn(2).width = 52;
  const fTitle = fws.getCell('A1'); fTitle.value = 'Filters applied to this export';
  fTitle.font = { size: 13, bold: true, color: { argb: 'FF0A3D8F' } };
  const fSub = fws.getCell('A2');
  fSub.value = `Generated ${stamp} · ${rows.length.toLocaleString('en-IN')} row${rows.length === 1 ? '' : 's'}`;
  fSub.font = { size: 10, color: { argb: 'FF64748B' } };
  const fh = fws.getRow(4);
  ['Filter', 'Value'].forEach((h, i) => {
    const cell = fh.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A3D8F' } };
  });
  if (appliedFilters.length === 0) {
    const c = fws.getCell('A5');
    c.value = 'No filters applied — full export.';
    c.font = { italic: true, color: { argb: 'FF64748B' } };
  } else {
    appliedFilters.forEach(([label, value], i) => {
      const row = fws.getRow(5 + i);
      row.getCell(1).value = label; row.getCell(1).font = { bold: true };
      row.getCell(2).value = value; row.getCell(2).alignment = { wrapText: true };
    });
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="opportunities-export-${stamp}.xlsx"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
