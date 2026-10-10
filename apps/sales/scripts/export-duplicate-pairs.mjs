/**
 * Export the order-in-hand / quotation duplicate pairs to Excel for client sign-off.
 *
 *   node scripts/export-duplicate-pairs.mjs [outfile.xlsx]
 *
 * Two tiers, both re-derived here so the sheet is always reproducible from live data:
 *
 *   TIER A (confirmed)       same client + the order value equals the quote value to
 *                            the rupee (on any of final_value_cr / value_cr /
 *                            offer_value_inr).
 *   TIER B (high confidence) same client, same product category, quote dated before
 *                            the order (0-180 days), and the order booked at a round
 *                            percentage discount off the quote (within 0.02% of a
 *                            0.5% grid point). Only clean 1:1 matches are kept — if an
 *                            order or a quote could pair with more than one partner it
 *                            is dropped rather than guessed.
 *
 * Layout: two rows per pair — the quotation record (KEEP) above the order record
 * (REMOVE) — so both sides can be read attribute by attribute. Pairs alternate shading
 * and each starts with a heavy top border.
 */
import fs from 'node:fs';
import pg from 'pg';
import ExcelJS from 'exceljs';

const OUT = process.argv[2] || 'duplicate-pairs.xlsx';

const env = fs.readFileSync('.env.local', 'utf8').replace(/^﻿/, '');
const g = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const pool = new pg.Pool({
  host: g('DB_HOST'), port: +(g('DB_PORT') || 5432), database: g('RISANSI_DB_NAME'),
  user: g('DB_USER'), password: g('DB_PASSWORD'), ssl: { rejectUnauthorized: false },
});

const GRID = 0.005, TOL = 0.0002;
const rupees = cr => (cr == null ? null : Math.round(Number(cr) * 1e7));

async function derivePairs() {
  const tierA = (await pool.query(`
    SELECT DISTINCT a.id oih, b.id twin FROM opportunities a JOIN opportunities b
      ON a.client_id = b.client_id AND a.auto_source = 'order-in-hand-jun26'
     AND COALESCE(b.auto_source,'x') <> 'order-in-hand-jun26'
   WHERE a.final_value_cr IS NOT NULL AND a.final_value_cr > 0
     AND (b.final_value_cr = a.final_value_cr OR b.value_cr = a.final_value_cr
       OR ROUND(b.offer_value_inr) = ROUND(a.final_value_cr * 10000000))`)).rows;

  const aOih = new Set(tierA.map(r => r.oih)), aTwin = new Set(tierA.map(r => r.twin));

  const edges = (await pool.query(`
    SELECT a.id oih, b.id twin, a.final_value_cr ov, b.value_cr qv
      FROM opportunities a
      JOIN orders o ON o.opportunity_id = a.id
      JOIN opportunities b ON b.client_id = a.client_id
     WHERE a.auto_source = 'order-in-hand-jun26'
       AND COALESCE(b.auto_source,'x') <> 'order-in-hand-jun26'
       AND b.stage = 'Won' AND b.quote_date IS NOT NULL
       AND a.final_value_cr > 0 AND b.value_cr > 0
       AND (o.order_date - b.quote_date) BETWEEN 0 AND 180
       -- 'SPARE' since migration 0061. Left as 'Spares' this matched nothing on
       -- the first branch and everything — spares included — on the second, so
       -- the pair list would still have looked plausible while being wrong.
       AND ( (o.product_category = 'SPARE' AND b.product_type =  'SPARE')
          OR (o.product_category = 'PUMP'  AND b.product_type <> 'SPARE') )`)).rows;

  const hits = edges.filter(e => {
    if (aOih.has(e.oih) || aTwin.has(e.twin)) return false;
    const r = Number(e.ov) / Number(e.qv);
    if (r < 0.5 || r > 1.1) return false;
    const grid = Math.round(r / GRID) * GRID;
    return grid > 0 && Math.abs(r - grid) / grid <= TOL;
  });
  const cO = {}, cT = {};
  hits.forEach(e => { cO[e.oih] = (cO[e.oih] || 0) + 1; cT[e.twin] = (cT[e.twin] || 0) + 1; });
  const tierB = hits.filter(e => cO[e.oih] === 1 && cT[e.twin] === 1);

  return [
    ...tierA.map(r => ({ ...r, tier: 'A' })),
    ...tierB.map(r => ({ oih: r.oih, twin: r.twin, tier: 'B' })),
  ];
}

async function loadDetail(ids) {
  const { rows } = await pool.query(`
    SELECT o.id, c.code client_code, c.legal_name client_name, o.stage, o.product,
           o.product_type, o.quote_ref, o.quote_date::text quote_date, o.enquiry_no,
           o.value_cr, o.final_value_cr, o.offer_value_inr, o.market, o.location,
           o.ril_rep, o.unit_project, o.pump_model, o.notes, o.created_by,
           u.name rep_name,
           ord.po_number so_number, ord.order_date::text order_date,
           ord.product_category, ord.order_value_cr, ord.financial_year
      FROM opportunities o
      JOIN clients c ON c.id = o.client_id
      LEFT JOIN users u ON u.id = o.rep_id
      LEFT JOIN orders ord ON ord.opportunity_id = o.id
     WHERE o.id = ANY($1)`, [ids]);
  return Object.fromEntries(rows.map(r => [r.id, r]));
}

const COLS = [
  { h: 'Pair #',              w: 8,  k: 'pair' },
  { h: 'Tier',                w: 6,  k: 'tier' },
  { h: 'Action',              w: 11, k: 'action' },
  { h: 'Record',              w: 20, k: 'record' },
  { h: 'Opp ID',              w: 8,  k: 'id' },
  { h: 'Client Code',         w: 13, k: 'client_code' },
  { h: 'Client Name',         w: 34, k: 'client_name' },
  { h: 'Stage',               w: 9,  k: 'stage' },
  { h: 'Product',             w: 20, k: 'product' },
  { h: 'Type / Category',     w: 14, k: 'cat' },
  { h: 'Quote Ref',           w: 26, k: 'quote_ref' },
  { h: 'Quote Date',          w: 12, k: 'quote_date' },
  { h: 'Enquiry No',          w: 22, k: 'enquiry_no' },
  { h: 'SO Number',           w: 14, k: 'so_number' },
  { h: 'Order Date',          w: 12, k: 'order_date' },
  { h: 'Quoted Value (Rs)',   w: 17, k: 'quoted_inr',  num: true },
  { h: 'Order / Final (Rs)',  w: 17, k: 'final_inr',   num: true },
  { h: 'Discount %',          w: 11, k: 'discount' },
  { h: 'Lag (days)',          w: 11, k: 'lag' },
  { h: 'Market',              w: 12, k: 'market' },
  { h: 'Location',            w: 16, k: 'location' },
  { h: 'RIL Rep',             w: 18, k: 'ril_rep' },
  { h: 'Owner (system)',      w: 18, k: 'rep_name' },
  { h: 'Unit / Project',      w: 18, k: 'unit_project' },
  { h: 'Pump Model',          w: 22, k: 'pump_model' },
  { h: 'Notes',               w: 40, k: 'notes' },
  { h: 'Client Decision',     w: 16, k: 'decision' },
];

const NAVY = 'FF0A3D8F', KEEP_BG = 'FFE8F5EC', DROP_BG = 'FFFDECEC';
const BAND = 'FFF4F7FC';

function styleHeader(ws) {
  const hr = ws.getRow(1);
  hr.values = COLS.map(c => c.h);
  hr.height = 26;
  hr.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: NAVY } } };
  });
  ws.columns = COLS.map(c => ({ width: c.w }));
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };
}

function addPairRows(ws, pairNo, tier, twin, oih, banded) {
  const qCr  = twin.value_cr ?? null;
  const oCr  = oih.final_value_cr ?? oih.order_value_cr ?? null;
  const disc = (qCr && oCr) ? (1 - Number(oCr) / Number(qCr)) : null;
  const lag  = (twin.quote_date && oih.order_date)
    ? Math.round((new Date(oih.order_date) - new Date(twin.quote_date)) / 86400000) : null;

  const base = { pair: pairNo, tier };
  const keepRow = {
    ...base, action: 'KEEP', record: 'Quotation record',
    id: twin.id, client_code: twin.client_code, client_name: twin.client_name,
    stage: twin.stage, product: twin.product, cat: twin.product_type,
    quote_ref: twin.quote_ref, quote_date: twin.quote_date, enquiry_no: twin.enquiry_no,
    so_number: '', order_date: '',
    quoted_inr: rupees(qCr), final_inr: rupees(twin.final_value_cr),
    discount: '', lag: '',
    market: twin.market, location: twin.location, ril_rep: twin.ril_rep,
    rep_name: twin.rep_name, unit_project: twin.unit_project, pump_model: twin.pump_model,
    notes: (twin.notes || '').replace(/\s+/g, ' ').slice(0, 240), decision: '',
  };
  const dropRow = {
    ...base, action: 'REMOVE', record: 'Order-in-hand record',
    id: oih.id, client_code: oih.client_code, client_name: oih.client_name,
    stage: oih.stage, product: oih.product, cat: oih.product_category,
    quote_ref: '', quote_date: '', enquiry_no: '',
    so_number: oih.so_number, order_date: oih.order_date,
    quoted_inr: '', final_inr: rupees(oCr),
    discount: disc == null ? '' : disc, lag,
    market: '', location: '', ril_rep: '', rep_name: oih.rep_name,
    unit_project: '', pump_model: '',
    notes: (oih.notes || '').replace(/\s+/g, ' ').slice(0, 240), decision: '',
  };

  [keepRow, dropRow].forEach((data, i) => {
    const r = ws.addRow(COLS.map(c => data[c.k] ?? ''));
    r.height = 17;
    r.eachCell({ includeEmpty: true }, (cell, col) => {
      const c = COLS[col - 1];
      cell.font = { size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: false };
      if (c.num) cell.numFmt = '#,##0';
      if (c.k === 'discount' && typeof data.discount === 'number') cell.numFmt = '0.0%';
      if (banded) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
      if (i === 0) cell.border = { top: { style: 'medium', color: { argb: 'FF9AA9C4' } } };
    });
    // Action cell colour-codes the row's fate.
    const ac = r.getCell(3);
    ac.font = { bold: true, size: 10, color: { argb: i === 0 ? 'FF0B6B3A' : 'FF9B1C1C' } };
    ac.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 0 ? KEEP_BG : DROP_BG } };
    ac.alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(27).border = { ...(r.getCell(27).border || {}), left: { style: 'thin', color: { argb: 'FF9AA9C4' } } };
  });
}

function buildSummary(wb, counts) {
  const ws = wb.addWorksheet('Summary', { properties: { defaultRowHeight: 18 } });
  ws.columns = [{ width: 4 }, { width: 46 }, { width: 62 }];
  const title = ws.addRow(['', 'Opportunity duplicates — for approval', '']);
  title.font = { bold: true, size: 16, color: { argb: NAVY } };
  ws.addRow([]);
  const lines = [
    ['What this is', 'Deals that exist twice in the Opportunities list: once from the order-in-hand register and once from the FY26-27 quote list.'],
    ['', ''],
    ['Tier A — confirmed', `${counts.a} pairs. The order value matches the quote to the rupee, for the same customer.`],
    ['Tier B — high confidence', `${counts.b} pairs. Same customer and product type, quote dated before the order, and the order booked at a round discount off the quote.`],
    ['Total pairs', `${counts.a + counts.b}`],
    ['', ''],
    ['What happens on approval', 'The quotation record is KEPT. The order record is REMOVED after its sales-order number, order date, order value and dispatch status are copied onto the kept record.'],
    ['Why keep the quotation record', 'It carries the quote reference, quote date, market, location, RIL rep, project and pump model. The order record only adds the SO number, value and dispatch status — all of which are carried over.'],
    ['', ''],
    ['How to read the sheet', 'Two rows per pair. Green KEEP = the record that survives. Red REMOVE = the record that is deleted. Both rows show the same deal.'],
    ['Your input', 'Use the last column (Client Decision) to mark Approve / Reject / Query against any pair.'],
    ['', ''],
    ['Nothing has been changed', 'This is a proposal. No records have been merged or deleted.'],
  ];
  lines.forEach(([k, v]) => {
    const r = ws.addRow(['', k, v]);
    r.getCell(2).font = { bold: true, size: 11 };
    r.getCell(2).alignment = { vertical: 'top' };
    r.getCell(3).font = { size: 11 };
    r.getCell(3).alignment = { vertical: 'top', wrapText: true };
    if (v && v.length > 90) r.height = 46;
  });
  return ws;
}

(async () => {
  const pairs = await derivePairs();
  const ids = [...new Set(pairs.flatMap(p => [p.oih, p.twin]))];
  const detail = await loadDetail(ids);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Risansi Sales Portal';
  wb.created = new Date();

  const counts = { a: pairs.filter(p => p.tier === 'A').length, b: pairs.filter(p => p.tier === 'B').length };
  buildSummary(wb, counts);

  for (const [tier, name] of [['A', `Tier A - Confirmed (${counts.a})`], ['B', `Tier B - High Confidence (${counts.b})`]]) {
    const ws = wb.addWorksheet(name, { properties: { defaultRowHeight: 17 } });
    styleHeader(ws);
    let n = 0;
    for (const p of pairs.filter(x => x.tier === tier)) {
      const twin = detail[p.twin], oih = detail[p.oih];
      if (!twin || !oih) continue;
      n += 1;
      addPairRows(ws, `${tier}${String(n).padStart(2, '0')}`, tier, twin, oih, n % 2 === 0);
    }
  }

  // One combined sheet so the whole set can be sorted/filtered in a single view.
  const all = wb.addWorksheet(`All pairs (${counts.a + counts.b})`, { properties: { defaultRowHeight: 17 } });
  styleHeader(all);
  let n = 0;
  for (const p of pairs) {
    const twin = detail[p.twin], oih = detail[p.oih];
    if (!twin || !oih) continue;
    n += 1;
    addPairRows(all, `${p.tier}${String(n).padStart(3, '0')}`, p.tier, twin, oih, n % 2 === 0);
  }

  await wb.xlsx.writeFile(OUT);
  console.log(`Tier A ${counts.a} + Tier B ${counts.b} = ${counts.a + counts.b} pairs -> ${OUT}`);
  await pool.end();
})();
