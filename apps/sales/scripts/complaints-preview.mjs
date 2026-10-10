#!/usr/bin/env node
// Render the complaints module to HTML files, with real data, and check that
// its numbers add up.
//
//   node scripts/complaints-preview.mjs [complaintId]
//
// The module is auth-gated, so this is how the dashboard, the list and a
// complaint's own page (timeline, lifecycle, the eight pages, the parts editor,
// the move bar, the files) get looked at without signing in. Writes two files
// under node_modules/ and prints their paths.
//
// The checks are the ones a dashboard must pass — open + closed = all, every
// open complaint sits with exactly one holder, dwell time on a complaint equals
// its open time, the funnel / severity / age buckets each sum to what they claim
// to partition — plus the ones the editable tables must pass, which is what the
// three Admin screens exist to keep true:
//
//   every cascading lookup value hangs under a parent that is still live
//   a flat read of the lookups holds no duplicate value per kind
//   every Action Taken on the list assigns to somebody
//   every severity has a threshold, and the severe levels are the tighter ones
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.cp-'));
const write = (name, code) => fs.writeFileSync(path.join(tmp, `${name}.mjs`), code);

// Stubs for what a server render outside Next cannot have.
write('next-link', `import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { href: typeof href === 'string' ? href : '#', ...rest }, children); }`);
write('next-navigation', `export const useRouter = () => ({ push() {}, refresh() {} }); export const notFound = () => { throw new Error('notFound'); };`);
write('actions', `const ok = async () => ({ ok: true });
export const saveComplaintPage = ok, moveComplaint = ok, deleteComplaintAttachment = ok, addComplaintNote = ok,
  deleteComplaint = ok, saveComplaintParts = ok,
  createComplaintV2 = async () => ({ ok: true, data: { id: 0, complaint_no: '' } }),
  lookupPump = async () => ({ ok: true, data: null }),
  listClientPumps = async () => ({ ok: true, data: [] }),
  searchComplaintsToLink = async () => ({ ok: true, data: [] }),
  complaintBriefById = async () => ({ ok: true, data: null }),
  addLookupFromForm = async () => ({ ok: true, data: { value: '' } }),
  listComplaintLookups = async () => ({});`);

const rewrite = (src) => src
  .replace(/from '@\/app\/actions\/risansi-complaints-v2'/g, "from './actions.mjs'")
  .replace(/from 'next\/link'/g, "from './next-link.mjs'")
  .replace(/from 'next\/navigation'/g, "from './next-navigation.mjs'")
  .replace(/from '@\/lib\/([^']+)'/g, "from './$1.mjs'")
  .replace(/from '@\/components\/risansi\/complaints\/([^']+)'/g, "from './$1.mjs'")
  .replace(/from '@\/components\/risansi\/([^']+)'/g, "from './$1.mjs'")
  // Everything lands in one flat directory, so a sibling and a parent import
  // resolve the same way. '../SortTH' is how ComplaintTableClient reaches the
  // sort header, and without this line the import simply is not found.
  .replace(/from '\.\.\/([A-Za-z-]+)'/g, "from './$1.mjs'")
  .replace(/from '\.\/([A-Za-z-]+)'/g, "from './$1.mjs'")
  .replace(/^'use client';\s*/m, '');

for (const rel of [
  'lib/risansi-complaint-flow.ts', 'lib/risansi-complaint-admin.ts',
  'lib/risansi-complaint-stats.ts', 'lib/risansi-stage-dashboard.ts', 'lib/risansi-table-sort.ts',
  'components/risansi/StageCharts.tsx', 'components/risansi/SortTH.tsx',
  'components/risansi/complaints/ComplaintStats.tsx', 'components/risansi/complaints/StatusChart.tsx',
  'components/risansi/complaints/ComplaintFilterBar.tsx',
  'components/risansi/complaints/ComplaintTable.tsx', 'components/risansi/complaints/ComplaintTableClient.tsx',
  'components/risansi/complaints/ComplaintTimeline.tsx',
  'components/risansi/complaints/ComplaintMoveBar.tsx', 'components/risansi/complaints/ComplaintPageForm.tsx',
  'components/risansi/complaints/ComplaintPartsEditor.tsx', 'components/risansi/complaints/ComplaintLinkPicker.tsx',
  'components/risansi/complaints/ComplaintAttachments.tsx', 'components/risansi/complaints/ComplaintNotes.tsx',
  'components/risansi/complaints/NewComplaintForm.tsx', 'components/risansi/ClientComplaints.tsx',
]) {
  const name = path.basename(rel).replace(/\.tsx?$/, '');
  write(name, ts.transpileModule(rewrite(fs.readFileSync(path.join(ROOT, rel), 'utf8')), {
    fileName: rel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'react' },
  }).outputText);
}
// The row loader talks to the pool through the app's module; give it a plain one here.
write('db-risansi', `import pg from 'pg'; export default globalThis.__pool;`);
write('risansi-auth', `export const complaintVisibilitySql = () => null;
export const DEPARTMENTS = ['Complaint Team', 'QC', 'Quotation Team', 'Billing Team', 'Purchase'];`);
{
  const rel = 'lib/risansi-complaint-rows.ts';
  write('risansi-complaint-rows', ts.transpileModule(rewrite(fs.readFileSync(path.join(ROOT, rel), 'utf8')), {
    fileName: rel, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
}

const env = {};
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const pool = new pg.Pool({ host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.RISANSI_DB_NAME,
  user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false } });
globalThis.__pool = pool;

const imp = (n) => import('file:///' + path.join(tmp, `${n}.mjs`).split(path.sep).join('/'));
const flow = await imp('risansi-complaint-flow');
const { loadComplaintRows, loadHolderDwells } = await imp('risansi-complaint-rows');
const { summariseComplaints } = await imp('risansi-complaint-stats');
const { loadSlaThresholds } = await imp('risansi-complaint-admin');
const { ComplaintStats } = await imp('ComplaintStats');
const { ComplaintFilterBar } = await imp('ComplaintFilterBar');
const { ComplaintTable } = await imp('ComplaintTable');
const { ComplaintTimeline, ComplaintLifecycle } = await imp('ComplaintTimeline');
const { ComplaintMoveBar } = await imp('ComplaintMoveBar');
const { ComplaintPageForm } = await imp('ComplaintPageForm');
const { ComplaintAttachments } = await imp('ComplaintAttachments');
const { ComplaintNotes } = await imp('ComplaintNotes');
const { NewComplaintForm } = await imp('NewComplaintForm');
const { ClientComplaints } = await imp('ClientComplaints');

const admin = { id: 1, role: 'admin', departments: [], email: 'preview@risansi.com' };
const rows = await loadComplaintRows(admin);
const dwells = await loadHolderDwells(admin);
const s = summariseComplaints(rows, dwells);

let bad = 0;
const check = (label, ok) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const openRows = rows.filter(r => flow.isOpenStatus(r.status));
check(`${s.total} complaints · open ${s.open} · overdue ${s.overdue} · closed ${s.closed}`, s.open + s.closed === s.total);
check('every open workflow complaint has one holder', openRows.filter(r => r.schema_version >= 2).every(r => r.holder_department));
check('holders by department sum to open workflow', s.byHolderDept.reduce((a, h) => a + h.open, 0) === openRows.filter(r => r.schema_version >= 2).length);
check('funnel counts partition the workflow statuses', s.funnel.reduce((a, x) => a + x.count, 0) === rows.filter(r => flow.STATUSES.includes(r.status)).length);
check('severity buckets partition open workflow', s.bySeverity.reduce((a, b) => a + b.count, 0) === openRows.filter(r => r.schema_version >= 2).length);
check('age buckets partition open', s.openByAge.reduce((a, b) => a + b.count, 0) === s.open);
check('no closure in the future', rows.every(r => !r.closed_at || Date.parse(r.closed_at) <= Date.now() + 60000));
check('no negative days', rows.every(r => r.days_in_status >= 0 && r.age_days >= -0.01));
// Overdue is the severity-graded age rule now, and its two halves are what the
// dashboard shows as separate tiles. If they stop adding up, one tile is lying.
check(`overdue splits into ${s.overdueNoAction} with no action + ${s.overdueActed} acted on`, s.overdueNoAction + s.overdueActed === s.overdue);
check('every overdue complaint is open', rows.filter(r => r.overdue).every(r => flow.isOpenStatus(r.status)));
check('an overdue complaint is older than its threshold', rows.filter(r => r.overdue).every(r => r.overdue_days > r.overdue_threshold));
{
  const by = new Map();
  for (const d of dwells) by.set(d.complaint_id, (by.get(d.complaint_id) ?? 0) + d.days);
  // How long the complaint has existed, which is not the same as its age.
  //
  // Age runs from the complaint date, and the stage log runs from registration.
  // Usually the complaint date is the earlier of the two — the problem happened
  // before anybody filed it — and comparing dwell against age was fine. But a
  // complaint can also be dated forward: CMP-0154 was registered on 15 Sep and
  // dated 17 Sep, so its log is two days longer than its age and the check
  // failed on a record that is perfectly consistent. The span the dwell has to
  // fit inside starts at whichever came first.
  const existed = (r) => {
    const a = Date.parse(r.complaint_date ?? r.created_at), b = Date.parse(r.created_at);
    return (Date.now() - Math.min(a, b)) / 86400000;
  };
  const off = openRows.filter(r => r.schema_version >= 2).filter(r => (by.get(r.id) ?? 0) - existed(r) > 0.5);
  check('no open complaint has been held for longer than it has existed', off.length === 0);
  if (off.length) console.log('       ' + off.map(r => `${r.complaint_no} held ${(by.get(r.id) ?? 0).toFixed(1)}d, existed ${existed(r).toFixed(1)}d`).join(', '));
}
console.log(`\n  avg open age ${s.avgOpenAge?.toFixed(1)}d · avg close ${s.avgTimeToClose?.toFixed(1)}d (median ${s.medianTimeToClose}) · 30d ${s.raised30}↑ ${s.closed30}↓`);
console.log('  holders: ' + s.byHolderDept.map(h => `${h.label} ${h.open} open / ${h.days.toFixed(0)}d now / ${h.totalDays.toFixed(0)}d ever`).join(' · '));

// ── The editable tables ──
//
// The three Admin screens (/risansi/admin/complaints) are the only way these
// rows change, so these checks say whether what the Complaint Team has done to
// them still hangs together.
const { rows: lookupRows } = await pool.query(
  'SELECT kind, value FROM complaint_lookups WHERE is_active AND parent_value IS NULL ORDER BY kind, sort_order, value');
const { rows: cascadeRows } = await pool.query(`
  SELECT kind, parent_value, value FROM complaint_lookups
   WHERE is_active AND parent_value IS NOT NULL
   ORDER BY kind, parent_value, sort_order, value`);
const lookups = {}; for (const r of lookupRows) (lookups[r.kind] ??= []).push(r.value);
const cascades = {}; for (const r of cascadeRows) ((cascades[r.kind] ??= {})[r.parent_value] ??= []).push(r.value);

console.log('\nEditable lists:');
{
  // A flat read must not hold a value twice per kind. Before the parent column
  // existed it could not; now `part_name` has Shaft under External and Shaft
  // under Child Parts of Joints, and a reader that forgot WHERE parent_value IS
  // NULL gets a dropdown with two identical options that write the same column.
  const dupes = Object.entries(lookups).flatMap(([kind, vals]) =>
    vals.filter((v, i) => vals.indexOf(v) !== i).map(v => `${kind}/${v}`));
  check(`${lookupRows.length} flat values across ${Object.keys(lookups).length} kinds, none twice`, dupes.length === 0);
  if (dupes.length) console.log('       ' + dupes.join(', '));

  const parentKinds = flow.CASCADING_LOOKUP_KINDS;
  const orphans = cascadeRows.filter(r => {
    const pk = parentKinds[r.kind];
    return !pk || !(lookups[pk] ?? []).includes(r.parent_value);
  });
  check(`${cascadeRows.length} cascading values, every one under a live parent`, orphans.length === 0);
  if (orphans.length) console.log('       ' + orphans.map(o => `${o.kind}/${o.value} under ${o.parent_value}`).join(', '));

  // A parent with nothing under it is legitimate — Client Related is exactly
  // that while its list is still with the Complaint Team — so this reports
  // rather than fails. It is the list the Add On control exists to fill.
  for (const [kind, pk] of Object.entries(parentKinds)) {
    const empty = (lookups[pk] ?? []).filter(p => !(cascades[kind]?.[p]?.length));
    if (empty.length) console.log(`  note ${kind}: nothing under ${empty.join(', ')} — Add On fills it`);
  }
}

console.log('\nAction assignment:');
{
  const { rows: assign } = await pool.query(`
    SELECT l.value AS action, a.assignee_kind, a.user_id, a.department, u.name
      FROM complaint_lookups l
      LEFT JOIN complaint_action_assignment a ON a.action = l.value
      LEFT JOIN users u ON u.id = a.user_id
     WHERE l.kind = 'action_category' AND l.is_active
     ORDER BY l.sort_order, l.value`);
  const unmapped = assign.filter(a => !a.assignee_kind);
  check(`${assign.length} actions offered, every one assigned`, unmapped.length === 0);
  if (unmapped.length) console.log('       ' + unmapped.map(a => a.action).join(', '));
  check('a named assignee is an account that exists', assign.filter(a => a.assignee_kind === 'user').every(a => a.name));
  for (const a of assign) {
    const who = a.assignee_kind === 'user' ? a.name : a.assignee_kind === 'department' ? a.department
      : a.assignee_kind === 'client_rep' ? "the client's own rep" : 'NOBODY';
    console.log(`       ${a.action.padEnd(30)} → ${who}`);
  }
  // The two rows migration 0108 could not point at a person. Reported, never
  // failed: there is nothing wrong with the data, only with the world.
  const prov = assign.filter(a => (a.action === 'Call Back Material' || a.action === 'Replace Material') && a.assignee_kind !== 'user');
  if (prov.length) console.log(`  note ${prov.length} provisional: ${prov.map(a => a.action).join(', ')} — Krishna has no login, Complaint Team holds them`);
}

console.log('\nOverdue thresholds:');
{
  const thresholds = await loadSlaThresholds();
  check('every severity has a threshold', flow.SEVERITIES.every(sv => Number.isInteger(thresholds[sv]) && thresholds[sv] > 0));

  // A complaint can be lodged with almost nothing, so any column that is NOT
  // NULL and has no default has to be one the lodge step actually supplies —
  // which is complaint_no and nothing else. `details` was NOT NULL when the
  // lodge window shipped, and every attempt to lodge failed on it with a
  // message that named neither the column nor the cause. Adding a NOT NULL
  // column here breaks lodging the same way, silently, so it is checked.
  const { rows: mustFill } = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'complaints' AND is_nullable = 'NO' AND column_default IS NULL
     ORDER BY column_name`);
  const unexpected = mustFill.map(r => r.column_name).filter(n => n !== 'complaint_no');
  check(`nothing beyond complaint_no is required at lodge time${unexpected.length ? ` — ${unexpected.join(', ')} would block it` : ''}`,
    unexpected.length === 0);
  const order = flow.SEVERITIES.map(sv => thresholds[sv]);
  check(`S1 ${order[0]}d ≤ S2 ${order[1]}d ≤ S3 ${order[2]}d ≤ S4 ${order[3]}d`, order.every((d, i) => i === 0 || d >= order[i - 1]));
  // The same rule the row loader applied, re-run here against the raw dates.
  // Two answers that differ mean the loader and the flow module have drifted.
  const now = new Date().toISOString().slice(0, 10);
  const mine = rows.filter(r => flow.overdueFor(r, thresholds, now).overdue).length;
  check(`${mine} overdue recomputed from the thresholds, matching the loader`, mine === s.overdue);
}

// ── The list page ──
const value = {};
const href = (k, v) => `?${k}=${encodeURIComponent(v)}`;
const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort();
// Built from the rows and not from the lookups, so a filter only offers a value
// some complaint actually carries — a dropdown of five categories where four
// match nothing is four dead ends.
const options = {
  categories: uniq(rows.map(r => r.complaint_category)),
  subcategories: uniq(rows.map(r => r.complaint_subcategory)),
  legacyCategories: uniq(rows.filter(r => !r.complaint_category).map(r => r.defect_category)),
  responsibles: uniq(rows.map(r => r.responsible_department)),
  rootCauses: uniq(rows.map(r => r.root_cause_category)),
  rootCauseSubs: uniq(rows.map(r => r.root_cause_sub)),
  partTypes: uniq([...rows.map(r => r.part_type), ...rows.flatMap(r => r.parts.map(p => p.part_type))]),
  partNames: uniq([...rows.map(r => r.part_name), ...rows.flatMap(r => r.parts.map(p => p.part_name))]),
  mocs: uniq(rows.flatMap(r => r.parts.map(p => p.moc))),
  industries: uniq(rows.map(r => r.industry)),
  clientTypes: uniq(rows.map(r => r.client_type)),
  actions: uniq(rows.map(r => r.action_category)),
  modelVersions: uniq(rows.map(r => r.model_version)),
  modelSeries: uniq(rows.map(r => r.model_series)),
  reps: [], holders: [], clients: [],
};
const listHtml = renderToStaticMarkup(React.createElement(React.Fragment, null,
  React.createElement(ComplaintStats, { s, href, sel: value }),
  React.createElement(ComplaintFilterBar, { value, options, basePath: '/risansi/complaints' }),
  React.createElement(ComplaintTable, { rows }),
));

// ── One complaint ──
const wanted = Number(process.argv[2]) || openRows.find(r => r.schema_version >= 2)?.id || rows[0].id;
// Every `date` column is cast ::text: SELECT c.* hands them back as JS Dates
// that render a day earlier in IST, and the eight pages are all date fields.
const { rows: [c] } = await pool.query(`
  SELECT c.*, cl.legal_name AS client_name, cl.code AS client_code, c.created_at::text AS created_at,
         c.complaint_date::text AS complaint_date, c.ec_date::text AS ec_date,
         c.invoice_date::text AS invoice_date, c.client_po_date::text AS client_po_date,
         c.target_completion_date::text AS target_completion_date,
         c.actual_completion_date::text AS actual_completion_date,
         c.fr_ec_date::text AS fr_ec_date, c.challan_date::text AS challan_date,
         c.target_dispatch_date::text AS target_dispatch_date,
         c.capa_received_date::text AS capa_received_date,
         c.returnable_slip_date::text AS returnable_slip_date,
         c.first_email_date::text AS first_email_date, c.last_reminder_date::text AS last_reminder_date,
         c.next_followup_date::text AS next_followup_date, c.mfg_date::text AS mfg_date
    FROM complaints c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = $1`, [wanted]);
const { rows: log } = await pool.query(`
  SELECT l.to_status, l.from_status, l.holder_department, l.holder_user_id, u.name AS holder_name, l.created_at::text AS created_at, l.note
    FROM complaint_stage_log l LEFT JOIN users u ON u.id = l.holder_user_id WHERE l.complaint_id = $1 ORDER BY l.created_at, l.id`, [wanted]);
const { rows: files } = await pool.query(`SELECT id, category, file_name, mime_type, byte_size, caption, uploaded_by, uploaded_at::text AS uploaded_at FROM complaint_attachments WHERE complaint_id = $1`, [wanted]);
const { rows: notes } = await pool.query(`SELECT body, created_by, created_at::text AS created_at FROM complaint_updates WHERE complaint_id = $1 AND body NOT LIKE 'Status changed to %' ORDER BY created_at DESC LIMIT 20`, [wanted]);
// The parts the complaint is about. numeric and date both cast to text, same reason.
const { rows: parts } = await pool.query(`
  SELECT id, sort_order, part_type, part_name, quantity::text AS quantity, moc, vendor_name,
         mfg_date::text AS mfg_date, part_code, ec_no, ec_date::text AS ec_date, liquid, head, capacity
    FROM complaint_parts WHERE complaint_id = $1 ORDER BY sort_order, id`, [wanted]);
const { rows: users } = await pool.query(`SELECT u.id, u.name, u.role, ARRAY(SELECT d.department FROM user_departments d WHERE d.user_id = u.id) AS departments FROM users u WHERE u.is_active ORDER BY u.name`);
const { rows: oems } = await pool.query(`SELECT id, legal_name AS name, code FROM clients WHERE client_type = 'OEM' AND deleted_at IS NULL ORDER BY legal_name`);
const life = flow.dwells(log, new Date().toISOString());
const holders = flow.dwellByHolder(life);
const legacy = c.schema_version < 2;
const gate = {};
for (const to of (flow.NEXT[c.status] ?? [])) gate[to] = flow.gateFor(c.status, to, { values: c, severity: c.severity, hasCapaDocument: files.some(f => f.category === 'capa') });
const panel = { background: 'var(--bg-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 12 };
const h = (title, node) => React.createElement('div', { style: panel }, React.createElement('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, title), node);
const detailHtml = renderToStaticMarkup(React.createElement(React.Fragment, null,
  React.createElement('h1', { style: { fontSize: 22, margin: '0 0 12px' } }, `${c.complaint_no} · ${c.status} · ${c.client_name ?? ''}`),
  h('Timeline', React.createElement(React.Fragment, null,
    React.createElement(ComplaintTimeline, { status: c.status, dwells: life, legacy }),
    !legacy && React.createElement('div', { style: { marginTop: 14 } }, React.createElement(ComplaintMoveBar, { complaintId: c.id, status: c.status, canMove: true, gate })))),
  ...flow.PAGES.map(p => h(`${p.id}. ${p.title}`, React.createElement(React.Fragment, null,
    p.id === 1 && React.createElement('div', { style: { marginBottom: 14 } }, React.createElement(ComplaintAttachments, { complaintId: c.id, files, canEdit: true, canEditCapa: true, only: ['complaint', 'photo'] })),
    React.createElement(ComplaintPageForm, { complaintId: c.id, clientId: c.client_id, page: p, initial: c, lookups, cascades, users, oems, parts, canEdit: !legacy && p.id !== 8, whyNot: p.id === 8 ? 'Closure is the Complaint Team\'s.' : null }),
    p.id === 6 && React.createElement('div', { style: { marginTop: 14 } }, React.createElement(ComplaintAttachments, { complaintId: c.id, files, canEdit: true, canEditCapa: true }))))),
  h('Lifecycle', React.createElement(ComplaintLifecycle, { dwells: life, byHolder: holders })),
  h('Notes', React.createElement(ComplaintNotes, { complaintId: c.id, notes, isAdmin: true })),
));

// ── Raise, and the Client 360 panel ──
const { rows: clients } = await pool.query(`SELECT id::int AS id, code, legal_name AS name FROM clients WHERE deleted_at IS NULL ORDER BY legal_name LIMIT 300`);
const newHtml = renderToStaticMarkup(React.createElement(NewComplaintForm, { clients, preselect: c.client_id }));
const c360Rows = await loadComplaintRows(admin, { clientId: c.client_id });
const c360Html = renderToStaticMarkup(React.createElement('div', { style: { maxWidth: 640 } }, React.createElement(ClientComplaints, { complaints: c360Rows, clientId: c.client_id })));

await pool.end();
fs.rmSync(tmp, { recursive: true, force: true });

const CSS = `<style>:root{--fg:#0D1B2E;--fg-2:#2D3E55;--fg-3:#6B7F96;--fg-4:#A8BAC8;--bg:#F4F6FB;--bg-paper:#fff;--bg-elev:#EDF1F7;--bg-sunk:#E2E8F3;--line:rgba(10,22,40,.08);--line-2:rgba(10,22,40,.05);--line-strong:rgba(10,22,40,.16);--accent:#1A5CB8;--accent-soft:rgba(26,92,184,.12);--accent-line:rgba(26,92,184,.30);--pos:#059669;--pos-soft:#D1FAE5;--pos-strong:#065F46;--neg:#DC2626;--neg-soft:#FEE2E2;--neg-strong:#991B1B;--warn:#D97706;--warn-soft:#FEF3C7;--warn-strong:#92400E;--info:#2563EB;--info-soft:#DBEAFE;--purple:#7C3AED;--purple-soft:rgba(124,58,237,.10);--radius:6px;--font-mono:ui-monospace,monospace;--brand-blue:#1A5CB8;--toggle-sel-fg:#fff}`
  + `body{margin:0;padding:22px;background:var(--bg);font:14px system-ui,sans-serif;color:var(--fg)}`
  + `.stage-grid-4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}h2{font-size:15px;margin:28px 0 10px;color:var(--fg-3)}</style>`;
const outList = path.join(ROOT, 'node_modules', '.cache-complaints-list.html');
const outDetail = path.join(ROOT, 'node_modules', '.cache-complaints-detail.html');
fs.writeFileSync(outList, `<!doctype html><meta charset="utf-8"><title>Complaints</title>${CSS}${listHtml}<h2>Client 360 panel</h2>${c360Html}`);
fs.writeFileSync(outDetail, `<!doctype html><meta charset="utf-8"><title>Complaint</title>${CSS}${detailHtml}<h2>Raise a complaint</h2>${newHtml}`);
console.log(`\n  ${outList}\n  ${outDetail}`);
process.exit(bad ? 1 : 0);
