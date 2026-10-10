// Append the PROPOSED stage-attribute table (and the changes behind it) beneath
// the current one in Risansi-Pipeline-Stage-Attributes.xlsx.
//
//   node scripts/pipeline-stage-fields.mjs   (writes the current table)
//   node scripts/pipeline-proposed.mjs       (appends the proposal)
//
// Planning artefact only. Nothing here changes the app.
//
// OUTCOME, Aug 2026. The proposal below was reviewed and mostly implemented, and
// three of its RETIRE counts turned out to be wrong once the columns were checked
// row by row. They are corrected in place so this file is not left claiming
// something the database contradicts:
//
//   secondary_rep_id        1 row, not 0 — and on it the secondary rep is the
//                           primary rep, so it still recorded nothing.
//   revised_offer_value_usd 6 rows, not 0.
//   tsm_*                   2 rows, and behind a built, working visit-form
//                           picker. Not retired: deleting it is a product
//                           decision, not a column cleanup.
//
// Migration 0062 dropped equipment_id, expected_close_date, secondary_rep_id,
// offer_value_usd (both tables) and revised_offer_value_usd. The revised_offer_*
// rupee pair was NOT dropped — it is a live denormalised cache the stage
// dashboard and both exports read instead of joining.
import path from 'node:path';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const FILE = path.join(ROOT, process.argv[2] || 'Risansi-Pipeline-Stage-Attributes.xlsx');

const NAVY = 'FF0A3D8F', GREY = 'FF64748B', SOFT = 'FFEFF3FA';
const NEWG = 'FF047857', NEWBG = 'FFECFDF5', WARN = 'FF92400E', WARNBG = 'FFFEF3C7';

const STAGES = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped'];
const RANK = { Suspect: 0, Prospect: 1, Quoted: 2, Negotiating: 3, 'On Hold': 3, Won: 4, Lost: 4, Dropped: 3 };

// kind: sys = recorded automatically · new = to be added · list = child records
const F = (label, from, kind = '', req = [], only = null) => ({ label, from, kind, req, only });

const PROPOSED = [
  // Always present, not typed.
  F('Client', 0, 'sys'), F('Rep / owner', 0, 'sys'), F('Stage', 0, 'sys'),
  F('Created by', 0, 'sys'), F('Created on', 0, 'sys'), F('Last updated', 0, 'sys'),

  // The new intake block — asked wherever an opportunity is started.
  F('Opportunity Type (Pump / Spare)', 0, 'new', STAGES),
  F('Opportunity Source', 0, 'new', STAGES),
  F('Opportunity Category', 0, 'new', STAGES),
  F('Reference (client’s own)', 0, 'new'),
  F('Enquiry No.', 0, 'moved'),
  F('Enquiry Date', 0, 'moved'),

  // The deal.
  F('Product / Description', 0, '', STAGES),
  F('Project Name / Unit', 0),
  F('Product Type', 0, '', STAGES),
  F('Value (₹)', 0, '', ['Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped']),
  F('Probability', 0, 'review'),
  F('Expected Close', 1),
  F('Notes', 0),

  // The quotation.
  F('Quote No.', 2, '', ['Quoted', 'Negotiating', 'Won']),
  F('Quote Date', 2, '', ['Quoted', 'Negotiating', 'Won']),
  F('Market', 2, '', ['Quoted', 'Negotiating', 'Won']),
  F('Total Offer (₹)', 2, '', ['Quoted', 'Negotiating', 'Won']),
  F('Quote line items', 2, 'list'),
  F('Offer revisions', 2, 'list'),
  F('Quotation documents (uploads only)', 2, 'list'),
  F('Legacy quotation link (read-only)', 2, 'legacy'),

  // Outcome.
  F('Final Value (₹)', 4, '', ['Won'], ['Won']),
  F('PO Number', 4, '', [], ['Won']),
  F('Sales orders', 4, 'list', [], ['Won']),
  F('Order-in-hand rows', 4, 'list', [], ['Won']),
  F('Lost To Competitor', 4, '', ['Lost'], ['Lost']),
  F('Lost Reason', 4, '', ['Lost'], ['Lost']),
  F('Drop reason', 3, '', ['Dropped'], ['Dropped']),
];

const applies = (f, s) => (f.only ? f.only.includes(s) : RANK[s] >= f.from);

// Each proposed change, with the evidence behind it.
const CHANGES = [
  ['NEW', 'Opportunity Type', 'Pump / Spare. A separate axis from Product Type — a spare for a PCP is still PCP — so both are kept.', 'Mandatory at creation'],
  ['NEW', 'Opportunity Source', 'By Post / Email / WhatsApp / Tender Portal / India MART / Verbal. Nothing records this today.', 'Mandatory at creation'],
  ['NEW', 'Opportunity Category', 'Against Rate Contract / New Enquiry / Repeat Order / Budgetary. Drives the opening stage.', 'Mandatory at creation'],
  ['NEW', 'Reference', 'The client’s own reference — their PO, tender or email subject. Distinct from our RIL/EN/ Enquiry No.', 'Optional'],
  ['MOVED', 'Enquiry No.', 'Exists but is only asked at the Quoted gateway. Moves to creation so it is captured when the enquiry arrives.', 'Optional at creation, required at Quoted as now'],
  ['MOVED', 'Enquiry Date', 'Same as above.', 'Optional at creation, required at Quoted as now'],
  ['RULE', 'Opening stage', 'Category = Budgetary opens the opportunity at Suspect. Every other category opens at Prospect.', 'Replaces the rep choosing a stage by hand'],
  ['CHANGE', 'Quotation document', 'No new external links. Uploads only. The 678 existing SharePoint links stay openable, marked legacy, and are excluded from any “has a document” count.', '229 uploads vs 678 links today'],
  ['FIX', 'Broken quotation links', '11 opportunities hold a bare filename (e.g. “For Panpat.pdf”) instead of a URL. They resolve to nothing and should be cleared.', '11 rows'],
  ['RETIRE', 'equipment_id', 'Never populated on any of the 1,801 opportunities.', '0 rows'],
  ['RETIRE', 'expected_close_date', 'Never populated — the free-text eta_text is used instead.', '0 rows'],
  ['RETIRE', 'secondary_rep_id', 'One row, on which the secondary rep is also the primary rep — so it records nothing rep_id does not.', '1 row'],
  ['KEEP', 'tsm_user_id, tsm_external, tsm_external_email, tsm_notified_at', 'Barely used, but the visit report has a working TSM picker behind these and the action writes it. Retiring them deletes a built feature rather than a dead column — a product call.', '2 rows'],
  ['RETIRE', 'revised_offer_date, revised_offer_value_inr, revised_offer_value_usd', 'The USD column is gone. The rupee pair is a live denormalised copy of the newest offer revision, read by the stage dashboard and both exports, so retiring it is a rewrite of every reader rather than a drop.', '42 and 46 rows; USD had 6'],
  ['RETIRE', 'offer_value_usd (opportunity and line item)', 'Never typed — every value divides its rupee twin by a conversion rate (80 mostly, some 90 and 92), so it held nothing the rupee column did not. Two line items had USD and no rupee value and were back-filled from their opportunity total before the drop.', '4% / 13%'],
  ['KEEP', 'negotiation_notes, client_status_at_quote, qtn_prepared_by, qtr, location', 'Retired from the forms in Aug 2026 but still hold historic values read by the export and the quotation summary. Keep read-only; do not drop the columns.', 'populated on older records'],
  ['REVIEW', 'Probability', 'The RIL likelihood code is filled on 4% of opportunities overall and 0% at Prospect and Won. Either make it matter or drop it — worth your call, not mine.', '4%'],
  ['REVIEW', 'PO Number', 'Only 13% of Won deals carry one, though it is the natural proof of an order.', '13% of Won'],
];

// Line-item attributes, since the quotation was called out specifically.
const ITEMS = [
  ['Pump model', '61%'], ['Qty', '61%'], ['Speed', '59%'], ['Geared motor detail', '57%'],
  ['Motor price (₹)', '43%'], ['Gearbox / V-belt price (₹)', '31%'],
  ['Offer value (₹)', '84%'], ['Offer value (USD)', '13% — propose retiring'],
  ['Detailed specifications', '99%'], ['Sort order', '100%'],
];

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(FILE);
const ws = wb.getWorksheet('Stage attributes');

let r = ws.rowCount + 3;

const band = (row, text, sub) => {
  const c1 = ws.getRow(row).getCell(1);
  c1.value = text;
  c1.font = { size: 13, bold: true, color: { argb: NAVY } };
  if (sub) {
    const c2 = ws.getRow(row + 1).getCell(1);
    c2.value = sub;
    c2.font = { size: 10, color: { argb: GREY } };
  }
};

band(r, 'PROPOSED', 'The same eight stages with the new intake block added. Green = new. Bold = mandatory at that stage. '
  + 'Grey = recorded automatically or as a linked list. Amber = kept only for history.');
r += 3;

const head = ws.getRow(r);
STAGES.forEach((s, i) => {
  const cell = head.getCell(i + 1);
  cell.value = s;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
});
head.height = 20;
r += 1;

const cols = STAGES.map(s => PROPOSED.filter(f => applies(f, s)));
const tallest = Math.max(...cols.map(c => c.length));
for (let i = 0; i < tallest; i++) {
  const row = ws.getRow(r + i);
  cols.forEach((col, ci) => {
    const f = col[i];
    if (!f) return;
    const cell = row.getCell(ci + 1);
    const isNew = f.kind === 'new' || f.kind === 'moved';
    cell.value = (isNew ? '+ ' : '') + f.label;
    cell.font = {
      size: 10,
      bold: f.req.includes(STAGES[ci]),
      color: { argb: isNew ? NEWG : f.kind === 'legacy' ? WARN : f.kind ? GREY : 'FF0F172A' },
    };
    cell.alignment = { vertical: 'top', wrapText: true };
    const bg = isNew ? NEWBG : f.kind === 'legacy' ? WARNBG : f.kind ? SOFT : null;
    if (bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  });
}
r += tallest;
STAGES.forEach((s, i) => {
  const cell = ws.getRow(r).getCell(i + 1);
  cell.value = `${cols[i].length} attributes`;
  cell.font = { size: 9.5, italic: true, color: { argb: GREY } };
  cell.border = { top: { style: 'thin', color: { argb: NAVY } } };
});
r += 3;

// ── Why ──
band(r, 'WHAT CHANGES, AND WHY', 'Nothing has been applied. Each row is a proposal with the evidence behind it.');
r += 3;
const CH = [['Change', 10], ['Field', 34], ['Why', 92], ['Effect / evidence', 34]];
const chHead = ws.getRow(r);
CH.forEach(([h], i) => {
  const cell = chHead.getCell(i + 1);
  cell.value = h;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
});
r += 1;
const TONE = { NEW: NEWG, MOVED: NEWG, RULE: NAVY, CHANGE: NAVY, FIX: WARN, RETIRE: WARN, KEEP: GREY, REVIEW: WARN };
CHANGES.forEach((row, i) => {
  const rw = ws.getRow(r + i);
  row.forEach((v, ci) => {
    const cell = rw.getCell(ci + 1);
    cell.value = v;
    cell.font = { size: 10, bold: ci === 0, color: { argb: ci === 0 ? (TONE[row[0]] ?? GREY) : 'FF0F172A' } };
    cell.alignment = { vertical: 'top', wrapText: true };
  });
});
r += CHANGES.length + 3;

// ── Line items ──
band(r, 'QUOTATION LINE ITEMS', 'The attributes on each line of a quotation, and how often they are actually filled across 950 line items.');
r += 3;
['Attribute', 'Filled'].forEach((h, i) => {
  const cell = ws.getRow(r).getCell(i + 1);
  cell.value = h;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
});
r += 1;
ITEMS.forEach(([a, p], i) => {
  const rw = ws.getRow(r + i);
  rw.getCell(1).value = a;
  rw.getCell(1).font = { size: 10 };
  rw.getCell(2).value = p;
  rw.getCell(2).font = { size: 10, color: { argb: /retir/.test(p) ? WARN : GREY } };
});

await wb.xlsx.writeFile(FILE);
console.log(`updated ${path.basename(FILE)}`);
console.log(`  proposed attributes per stage: ${STAGES.map((s, i) => `${s} ${cols[i].length}`).join(', ')}`);
console.log(`  ${CHANGES.length} proposed changes, ${ITEMS.length} line-item attributes`);
