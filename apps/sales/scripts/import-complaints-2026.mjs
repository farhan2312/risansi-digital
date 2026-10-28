#!/usr/bin/env node
// One-off: load the 2026 complaint register from the migration workbook.
//
//   node scripts/import-complaints-2026.mjs <file.xlsx>            dry run
//   node scripts/import-complaints-2026.mjs <file.xlsx> --apply    write
//
// Reads the "Complaints Year-2026" sheet only; the other twelve sheets in that
// workbook are legacy working papers, not a register.
//
// It does NOT delete anything. The pre-11-Oct complaints are removed by a
// separate step, after archive_*_20261028 has been taken.
//
// ── Fixing the sheet rather than rejecting it ───────────────────
//
// Thirty-eight rows do not match the portal's lists as typed. None of them
// gets a new lookup value invented for it — the portal's lists are the
// portal's — so each is mapped onto a value that already exists:
//
//   case only            WRONG -> Wrong, VIBRATION -> Vibration, supply Related
//   plain typo           Leakge -> Leakage
//   WRONG SUPPLY         -> Wrong, where the category is Supply Related
//   a part in the        PRV, Motor, Gearbox, Gland are part NAMES, not
//   sub-category column  sub-categories. They move to part_name (which is
//                        empty on every one of those rows) and the
//                        sub-category becomes Other, so the detail survives
//                        instead of being thrown away.
//   External             is a sub-category of Damage, not a category. The row
//                        that put it in the category column becomes
//                        Damage / External.
//   no list to match     Client Related has no sub-categories at all, so the
//                        four rows carrying one there are left blank.
//
// Every one of these is reported per row, so the mapping is auditable rather
// than quietly applied.

import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const file = process.argv[2];
const APPLY = process.argv.includes('--apply');
// --replace also removes the complaints this register supersedes, in the SAME
// transaction as the insert. Separately, a failed import after a successful
// delete would leave the portal with neither set; together, the only outcomes
// are "old set, no new" and "new set, no old".
const REPLACE = process.argv.includes('--replace');
const DOOMED = `complaint_date < DATE '2026-10-11' OR complaint_date IS NULL`;
if (!file) { console.error('usage: node scripts/import-complaints-2026.mjs <file.xlsx> [--apply]'); process.exit(1); }

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const g = k => (new RegExp('^\\s*' + k + '\\s*=\\s*"?([^"\\n\\r]*)"?', 'm').exec(env) || [])[1];
const pool = new pg.Pool({
  host: g('DB_HOST'), port: Number(g('DB_PORT') || 5432),
  database: g('RISANSI_DB_NAME') || g('DB_NAME'), user: g('DB_USER'), password: g('DB_PASSWORD'),
  ssl: (g('DB_SSL') || '').toLowerCase() === 'false' ? false : { rejectUnauthorized: false },
});

// Client codes in the sheet that are not in the portal. Two are the same
// company under a different code; MASH MAKES has no record at all and its
// rows are reported and skipped rather than inventing a client.
const CLIENT_REMAP = { SOLN01S085: 'MOHL01S130', WARA01S192: 'KOLH01S183' };
const SKIP_CODES = new Set(['BELG01M220']);

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const YES = v => { const s = norm(v); return s === 'yes' || s === 'y' || s === 'true' || s === '1'; };
const boolOf = v => (v == null || String(v).trim() === '' ? null : YES(v));

// ── read the sheet ────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.getWorksheet('Complaints Year-2026');
if (!ws) { console.error('no sheet named "Complaints Year-2026"'); process.exit(1); }

const hdr = ws.getRow(1).values.slice(1).map(v => String((v && v.text) ? v.text : (v ?? '')).replace(/\s+/g, ' ').trim());
const at = frag => { const i = hdr.findIndex(h => h.toLowerCase().startsWith(frag.toLowerCase())); if (i < 0) throw new Error('column not found: ' + frag); return i; };
const COL = {
  legacy: at('Old complaint no'), date: at('Complaint date'), code: at('Client code'), cname: at('Client name'),
  ctype: at('Client type'), oem: at('OEM client code'), source: at('Complaint Source'),
  cat: at('Complaint category'), sub: at('Sub-category'), details: at('Complaint description'),
  so: at('SO NO'), ec: at('EC no'), ecDate: at('EC DATE'), ecBy: at('EC MADE BY'),
  inv: at('INVOICE / CHALLAN NO'), invDate: at('INVOICE DT'), serial: at('PUMP SERIAL NO'),
  part: at('Part name'), qty: at('Quantity'), model: at('Model as per name plate'),
  series: at('MODEL SERIES'), version: at('Version'),
  rSafety: at('Safety Risk'), rShut: at('Customer shutdown'), rPen: at('Contractual penalty'), rRep: at('Repeat'),
  capa: at('CAPA required'), capaWith: at('CAPA with'),
  rcc: at('Root cause category'), rc: at('Root cause'), dept: at('Responsible department'),
  action: at('Action taken'), assigned: at('Action assigned to'), target: at('Target completion date'),
  cost: at('Cost impact'), status: at('Current status'), remarks: at('Remarks'),
};

const cell = (vals, i) => {
  if (i < 0) return null;
  const x = vals[i];
  if (x == null) return null;
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  const s = (x && x.text != null) ? String(x.text) : String(x);
  return s.trim() || null;
};
const dateOf = v => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

const raw = [];
ws.eachRow((r, i) => {
  if (i === 1) return;
  const vals = r.values.slice(1);
  const o = { excelRow: i };
  for (const [k, idx] of Object.entries(COL)) o[k] = cell(vals, idx);
  if (Object.values(o).some((v, n) => n > 0 && v)) raw.push(o);
});

// ── the portal's own lists ────────────────────────────────────
const lkRows = (await pool.query(`SELECT kind, parent_value, value FROM complaint_lookups`)).rows;
const valuesOf = kind => lkRows.filter(r => r.kind === kind).map(r => r.value);
const CATS = valuesOf('complaint_category');
const SUBS = lkRows.filter(r => r.kind === 'complaint_subcategory');
const PARTS = valuesOf('part_name');
const ACTIONS = valuesOf('action_category');
const DEPTS = valuesOf('responsible_department');
const RCCS = valuesOf('root_cause_category');
const STATUSES = (await pool.query(`SELECT DISTINCT status FROM complaints`)).rows.map(r => r.status);
const clients = new Map((await pool.query(`SELECT code, id FROM clients WHERE deleted_at IS NULL`)).rows.map(r => [r.code, r.id]));
const users = (await pool.query(`SELECT id, name FROM users WHERE is_active`)).rows;

const pick = (list, v) => {
  if (!v) return null;
  const direct = list.find(x => norm(x) === norm(v));
  if (direct) return direct;
  const fixed = TYPOS[norm(v)];
  return fixed && list.includes(fixed) ? fixed : null;
};
const subUnder = (cat, v) => {
  if (!cat || !v) return null;
  const want = TYPOS[norm(v)] ?? v;
  const m = SUBS.find(s => s.parent_value === cat && norm(s.value) === norm(want));
  return m ? m.value : null;
};
const userFor = v => { if (!v) return null; const m = users.find(u => norm(u.name) === norm(v)) ?? users.find(u => norm(u.name).startsWith(norm(v))); return m ? m.id : null; };

// Values that are a part name sitting in the sub-category column.
const PART_IN_SUB = { prv: 'PRV', motor: 'Motor', motortripping: 'Motor', motorbunnred: 'Motor', gearbox: 'Gear Box', gland: 'Gland Packing' };

// Spellings that differ from the portal's by more than case. Each is a word
// the list already has, so nothing new is created — "Closed on Discussion"
// against the list's "Close on Discussion" is one letter, and it is the only
// candidate; "Leakge" is a dropped vowel.
const TYPOS = { closedondiscussion: 'Close on Discussion', leakge: 'Leakage' };

const notes = [];
const rows = [];
const skipped = [];

for (const r of raw) {
  const note = m => notes.push(`  row ${String(r.excelRow).padStart(3)}  ${m}`);

  let code = r.code;
  if (code && CLIENT_REMAP[code]) { note(`client ${code} -> ${CLIENT_REMAP[code]}`); code = CLIENT_REMAP[code]; }
  if (code && SKIP_CODES.has(code)) { skipped.push(`row ${r.excelRow}: ${code} ${r.cname ?? ''} — no such client in the portal`); continue; }
  const clientId = code ? clients.get(code) ?? null : null;
  if (!clientId) { skipped.push(`row ${r.excelRow}: client code ${code ?? '(blank)'} not found`); continue; }

  // category
  let cat = pick(CATS, r.cat);
  if (!cat && norm(r.cat) === 'external') { cat = 'Damage'; note(`category "External" -> Damage (External is a Damage sub-category)`); }
  else if (!cat && r.cat) { note(`category "${r.cat}" not on the list — left blank`); }
  else if (cat && cat !== r.cat) note(`category "${r.cat}" -> "${cat}"`);

  // sub-category, and the part names hiding in that column
  let sub = subUnder(cat, r.sub);
  let part = pick(PARTS, r.part);
  if (!sub && r.sub) {
    if (norm(r.cat) === 'external' && norm(r.sub) === 'gland') {
      sub = subUnder('Damage', 'External'); part = part ?? 'Gland Packing';
      note(`sub "Gland" -> part_name "Gland Packing", sub-category "External"`);
    } else if (PART_IN_SUB[norm(r.sub)]) {
      part = part ?? PART_IN_SUB[norm(r.sub)];
      sub = subUnder(cat, 'Other');
      note(`sub "${r.sub}" is a part — part_name "${part}", sub-category "${sub ?? '(blank)'}"`);
    } else if (norm(r.sub) === 'wrongsupply') {
      sub = subUnder(cat, 'Wrong');
      note(sub ? `sub "${r.sub}" -> "Wrong"` : `sub "${r.sub}" — "${cat}" has no matching sub-category, left blank`);
    } else {
      // The value may be a real sub-category of a DIFFERENT category. Say so
      // rather than reporting it as unknown — and still leave it blank,
      // because moving the row to that other category would be re-filing the
      // complaint, which is the reader's call and not an importer's.
      const elsewhere = SUBS.filter(s => norm(s.value) === norm(TYPOS[norm(r.sub)] ?? r.sub)).map(s => s.parent_value);
      sub = null;
      note(elsewhere.length
        ? `sub "${r.sub}" belongs to ${elsewhere.join('/')}, not "${cat}" — left blank, category untouched`
        : `sub "${r.sub}" — not a sub-category of "${cat}", left blank`);
    }
  } else if (sub && sub !== r.sub) note(`sub "${r.sub}" -> "${sub}"`);

  const status = pick(STATUSES, r.status) ?? 'Open';
  if (r.status && status !== r.status) note(`status "${r.status}" -> "${status}"`);

  const actions = (r.action ?? '').split(/[,;/]+/).map(s => s.trim()).filter(Boolean)
    .map(a => pick(ACTIONS, a) ?? null).filter(Boolean);
  if (r.action && actions.length === 0) note(`action taken "${r.action}" not on the list — left blank`);

  const dept = pick(DEPTS, r.dept);
  if (r.dept && !dept) note(`responsible department "${r.dept}" not on the list — left blank`);
  const rcc = pick(RCCS, r.rcc);
  if (r.rcc && !rcc) note(`root cause category "${r.rcc}" not on the list — left blank`);
  const assigned = userFor(r.assigned);
  if (r.assigned && !assigned) note(`"Action assigned to" = "${r.assigned}" matches no active user — left blank`);

  const capaWith = (r.capaWith ?? '').split(/[,;/]+/).map(s => s.trim()).filter(Boolean)
    .map(d => (norm(d) === 'qc' ? 'QC' : norm(d) === 'purchase' ? 'Purchase' : null)).filter(Boolean);

  const risk = { safety: boolOf(r.rSafety), shut: boolOf(r.rShut), pen: boolOf(r.rPen), rep: boolOf(r.rRep) };
  const severity = [risk.safety, risk.shut, risk.pen, risk.rep].some(x => x === true) ? 'High'
    : [risk.safety, risk.shut, risk.pen, risk.rep].some(x => x !== null) ? 'Low' : null;

  rows.push({
    excelRow: r.excelRow, legacy_ref: r.legacy, complaint_date: dateOf(r.date),
    client_id: clientId, client_code: code, client_type: pick(['Direct', 'OEM'], r.ctype),
    oem_client_id: r.oem ? clients.get(r.oem) ?? null : null,
    channel: pick(['Email', 'Verbal', 'Call'], r.source) ?? r.source,
    complaint_category: cat, complaint_subcategory: sub, details: r.details,
    so_no: r.so, ec_no: r.ec, ec_date: dateOf(r.ecDate), ec_made_by: r.ecBy,
    invoice_no: r.inv, invoice_date: dateOf(r.invDate), pump_serial_no: r.serial,
    part_name: part, quantity: r.qty && /^\d+$/.test(r.qty) ? Number(r.qty) : null,
    pump_model: r.model, model_series: r.series, model_version: r.version,
    risk_safety: risk.safety, risk_shutdown: risk.shut, risk_penalty: risk.pen, repeat_complaint: risk.rep,
    severity, capa_needed: boolOf(r.capa), capa_departments: capaWith.length ? capaWith : null,
    root_cause_category: rcc, root_cause: r.rc, responsible_department: dept,
    action_categories: actions.length ? actions : null, action_assigned_to: assigned,
    target_completion_date: dateOf(r.target), cost_impact: boolOf(r.cost),
    status, status_remarks: r.remarks,
  });
}

rows.sort((a, b) => String(a.complaint_date).localeCompare(String(b.complaint_date)) || a.excelRow - b.excelRow);

console.log(`sheet rows read:        ${raw.length}`);
console.log(`will import:            ${rows.length}`);
console.log(`skipped:                ${skipped.length}`);
skipped.forEach(s => console.log('   ', s));
console.log(`\nvalues mapped onto the portal's lists: ${notes.length}`);
notes.forEach(n => console.log(n));

const COLS = Object.keys(rows[0]).filter(k => k !== 'excelRow');

if (!APPLY) {
  console.log('\nDry run. Nothing written. Re-run with --apply.');
  await pool.end();
  process.exit(0);
}

const c = await pool.connect();
try {
  await c.query('BEGIN');
  if (REPLACE) {
    const before = (await c.query(`SELECT count(*)::int n FROM complaints WHERE ${DOOMED}`)).rows[0].n;
    const arch = (await c.query(
      `SELECT count(*)::int n FROM information_schema.tables
        WHERE table_name = 'archive_complaints_20261028'`)).rows[0].n;
    if (!arch) throw new Error('archive_complaints_20261028 is missing — refusing to delete without the backup');
    const archN = (await c.query(`SELECT count(*)::int n FROM archive_complaints_20261028`)).rows[0].n;
    if (archN < before) throw new Error(`archive holds ${archN} rows but ${before} would be deleted — refusing`);
    const del = await c.query(`DELETE FROM complaints WHERE ${DOOMED}`);
    console.log(`
deleted ${del.rowCount} complaint(s) dated before 11 Oct (archived: ${archN})`);
  }
  const { rows: [m] } = await c.query(
    `SELECT COALESCE(MAX(n), 165) AS max_n FROM
       (SELECT NULLIF(regexp_replace(complaint_no, '[^0-9]', '', 'g'), '')::int AS n FROM complaints) t
      WHERE n < 10000`);
  let next = Number(m.max_n) + 1;
  const email = 'farhanmohammed2312@gmail.com';
  for (const r of rows) {
    const vals = COLS.map(k => r[k]);
    const ph = COLS.map((_, i) => `$${i + 1}`).join(', ');
    await c.query(
      `INSERT INTO complaints (${COLS.join(', ')}, complaint_no, source, created_by)
       VALUES (${ph}, $${COLS.length + 1}, 'import', $${COLS.length + 2})`,
      [...vals, `CMP-${String(next++).padStart(4, '0')}`, email]);
  }
  await c.query('COMMIT');
  console.log(`\nImported ${rows.length} complaints, CMP-${String(Number(m.max_n) + 1).padStart(4, '0')} to CMP-${String(next - 1).padStart(4, '0')}.`);
} catch (e) {
  await c.query('ROLLBACK');
  console.error('\nROLLED BACK:', e.message);
  process.exitCode = 1;
} finally { c.release(); await pool.end(); }
