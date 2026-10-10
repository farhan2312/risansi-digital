#!/usr/bin/env node
// The complaint workflow's rules, exercised.
//
//   node scripts/complaint-flow-check.mjs      (runs as part of `npm run build`)
//
// severityOf against the sheet's truth table and the cases it does not cover;
// the gates that hold a complaint back and the ones that let it through; who
// holds it in each status; who may edit which page; the lifecycle arithmetic.
// Pure functions, so no database — a rule that changes here changes in the
// pages and the actions too, because they import the same module.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.cf-'));
const src = fs.readFileSync(path.join(ROOT, 'lib', 'risansi-complaint-flow.ts'), 'utf8').replace(/^import type .*$/gm, '');
fs.writeFileSync(path.join(tmp, 'flow.mjs'), ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText);
const F = await import('file:///' + path.join(tmp, 'flow.mjs').split(path.sep).join('/'));
fs.rmSync(tmp, { recursive: true, force: true });

let bad = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(66)} ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`);
};

console.log('Criticality - four questions, two answers:');
const no = { risk_safety: false, risk_shutdown: false, risk_penalty: false, risk_repeat_failure: false };
check('nothing answered yet: no criticality',   F.severityOf({}), null);
check('all four No: Low',                       F.severityOf(no), 'Low');
check('safety risk: High',                      F.severityOf({ ...no, risk_safety: true }), 'High');
check('customer shutdown: High',                F.severityOf({ ...no, risk_shutdown: true }), 'High');
check('contractual penalty: High',              F.severityOf({ ...no, risk_penalty: true }), 'High');
check('repeat: High',                           F.severityOf({ ...no, risk_repeat_failure: true }), 'High');
check('partly answered, none Yes: Low',         F.severityOf({ risk_safety: false }), 'Low');
// The seven retired questions keep their columns so an old grade is still
// legible, but they must no longer move the answer.
check('a retired question cannot raise it',     F.severityOf({ ...no, risk_major_perf: true, risk_qty_over_5: true }), 'Low');
check('only four questions are asked',          F.RISK_FIELDS.length, 4);
check('all four are required',                  F.RISK_FIELDS.every(f => f.required), true);
// High and immediate response are the same statement now, deliberately.
check('High and immediate response agree',      F.isImmediateResponse({ ...no, risk_shutdown: true }), true);
check('Low is not an immediate response',       F.isImmediateResponse(no), false);

console.log('\nGates:');
const full = {
  complaint_date: '2026-09-13', channel: 'Email', complaint_category: 'Performance',
  // complaint_type and defect_category are no longer asked for, but a complaint
  // filed before the category existed still carries them, and routingOwner has
  // to keep working for those. Left in the fixture on purpose.
  complaint_type: 'Technical', defect_category: 'Leakage', defect_reason: 'Leakage from gland',
  responsible_department: 'QC & Production', details: 'x', contact_person: 'y',
  so_no: 'SO1', ec_no: 'EC1', pump_serial_no: 'SN1', pump_model: 'M1',
  ...no, risk_safety: false, risk_shutdown: false, risk_pump_failure: false, risk_major_perf: false, risk_repeat_failure: false,
};
check('Open → Under Investigation with pages 1–3 complete: no gate', F.gateFor('Open', 'Under Investigation', { values: full, severity: 'Low', hasCapaDocument: false }), []);
// The serial is not always on the pump or the paperwork (decided 18 Sep), so
// its absence holds nothing back; a missing pump model still does.
check('Open → Under Investigation with no pump serial: not held',
  F.gateFor('Open', 'Under Investigation', { values: { ...full, pump_serial_no: '' }, severity: 'Low', hasCapaDocument: false }), []);
check('Open → Under Investigation with no pump model: named',
  F.gateFor('Open', 'Under Investigation', { values: { ...full, pump_model: '' }, severity: 'Low', hasCapaDocument: false }), ['Order & Pump: Model as per name plate']);
check('Open → Under Investigation with risk unanswered: asks for the risk page',
  F.gateFor('Open', 'Under Investigation', { values: full, severity: null, hasCapaDocument: false }),
  ['Risk & Criticality: answer the risk questions so the severity is known']);
check('High criticality may not skip the investigation',
  F.gateFor('Open', 'Action Pending', { values: full, severity: 'High', hasCapaDocument: false }).some(m => /investigated before anything else/.test(m)), true);
check('Low may go Open → Resolved with remarks',
  F.gateFor('Open', 'Resolved', { values: { ...full, status_remarks: 'sorted on the phone' }, severity: 'Low', hasCapaDocument: false }), []);
check('Low Open → Resolved with neither action nor remarks: asks for one',
  F.gateFor('Open', 'Resolved', { values: full, severity: 'Low', hasCapaDocument: false }), ['Corrective Action: action against complaint, or remarks for complaint status']);
const resolved = { ...full, root_cause: 'r', root_cause_category: 'Material', action_against: 'a', customer_confirmed: true,
  closure_summary: 's', customer_satisfied: true };
check('High Resolved → Closed without a CAPA document: refused',
  F.gateFor('Resolved', 'Closed', { values: resolved, severity: 'High', hasCapaDocument: false }), ['CAPA document attached (page 6)']);
check('High Resolved → Closed with a CAPA document: allowed',
  F.gateFor('Resolved', 'Closed', { values: resolved, severity: 'High', hasCapaDocument: true }), []);
check('Low Resolved → Closed needs no CAPA document',
  F.gateFor('Resolved', 'Closed', { values: resolved, severity: 'Low', hasCapaDocument: false }), []);
check('Closed blocked while a returnable is In Transit',
  F.gateFor('Resolved', 'Closed', { values: { ...resolved, material_returnable: true, returnable_status: 'In Transit' }, severity: 'Low', hasCapaDocument: false }),
  ['Returnable material is still In Transit']);
// The customer's yes is no longer a gate - the Complaint Team closes manually.
// Inverted rather than deleted, so anyone reinstating the gate is told it went
// on purpose and not by accident.
check('Customer Confirmation Pending to Resolved no longer waits on the customer',
  F.gateFor('Customer Confirmation Pending', 'Resolved', { values: { ...resolved, customer_confirmed: null }, severity: 'Low', hasCapaDocument: false }),
  []);
check('Replacement Pending needs a replacement action category',
  F.gateFor('Action Pending', 'Replacement Pending', { values: { ...resolved, action_category: 'Repair', action_assigned_to: 5, target_completion_date: '2026-10-01' }, severity: 'Low', hasCapaDocument: false }),
  ['Corrective Action: the action category must be a replacement']);
check('Reopen: Closed → Under Investigation is a legal move', F.NEXT.Closed.includes('Under Investigation'), true);
check('every status has somewhere to go', F.STATUSES.every(s => F.NEXT[s].length > 0), true);

console.log('\nHolders:');
check('Under Investigation, technical → QC', F.holderFor('Under Investigation', { complaint_type: 'Technical', investigation_assigned_to: 7 }), { department: 'QC', userId: 7 });
check('Under Investigation, non-technical → Complaint Team', F.holderFor('Under Investigation', { complaint_type: 'Non-technical' }), { department: 'Complaint Team', userId: null });
check('Action Pending, free replacement → Quotation Team', F.holderFor('Action Pending', { action_category: 'Free Replacement', action_assigned_to: 3 }), { department: 'Quotation Team', userId: 3 });
check('Action Pending, repair → Billing Team', F.holderFor('Action Pending', { action_category: 'Repair' }).department, 'Billing Team');
check('Customer Confirmation Pending → the customer', F.holderFor('Customer Confirmation Pending', {}).department, 'Customer');
check('Open → Complaint Team', F.holderFor('Open', {}).department, 'Complaint Team');

console.log('\nWho may edit:');
const p = (id) => F.pageById(id);
const live = { status: 'Open', schema_version: 2, complaint_type: 'Technical' };
const team  = { id: 1, role: 'staff', departments: ['Complaint Team'] };
const qc    = { id: 2, role: 'staff', departments: ['QC'] };
const quote = { id: 3, role: 'staff', departments: ['Quotation Team'] };
const rep   = { id: 4, role: 'rep', departments: [] };
const admin = { id: 5, role: 'admin', departments: [] };
const nobody = { id: 6, role: 'staff', departments: [] };
check('Complaint Team edits registration', F.canEditPage(team, live, p(1)), true);
check('a rep edits registration on a client they work', F.canEditPage(rep, { ...live, worksClient: true }, p(1)), true);
check('a rep does not edit registration on a stranger\'s client', F.canEditPage(rep, { ...live, worksClient: false }, p(1)), false);
check('QC edits investigation on a technical complaint', F.canEditPage(qc, live, p(4)), true);
check('Complaint Team does not edit investigation on a technical complaint', F.canEditPage(team, live, p(4)), false);
check('Complaint Team edits investigation on a non-technical one', F.canEditPage(team, { ...live, complaint_type: 'Non-technical' }, p(4)), true);
check('Quotation Team does not edit investigation…', F.canEditPage(quote, live, p(4)), false);
check('…but does when named as the action assignee, on page 5', F.canEditPage(quote, { ...live, action_assigned_to: 3 }, p(5)), true);
check('staff with no department edits nothing', F.PAGES.every(pg => !F.canEditPage(nobody, live, pg)), true);
check('admin edits everything', F.PAGES.every(pg => F.canEditPage(admin, live, pg)), true);
check('a legacy record is read-only for the team', F.canEditPage(team, { ...live, schema_version: 1 }, p(1)), false);
check('a closed record is read-only for the team', F.canEditPage(team, { ...live, status: 'Closed' }, p(8)), false);
check('Purchase edits CAPA & documents', F.canEditPage({ id: 9, role: 'staff', departments: ['Purchase'] }, live, p(6)), true);
check('Billing edits returnable', F.canEditPage({ id: 9, role: 'staff', departments: ['Billing Team'] }, live, p(7)), true);

console.log('\nLifecycle:');
const log = [
  { to_status: 'Open', holder_department: 'Complaint Team', holder_user_id: null, created_at: '2026-09-01T00:00:00Z' },
  { to_status: 'Under Investigation', holder_department: 'QC', holder_user_id: 2, holder_name: 'RK', created_at: '2026-09-03T00:00:00Z' },
  { to_status: 'Customer Confirmation Pending', holder_department: 'Customer', holder_user_id: null, created_at: '2026-09-10T00:00:00Z' },
  { to_status: 'Resolved', holder_department: 'Complaint Team', holder_user_id: null, created_at: '2026-09-12T00:00:00Z' },
];
const d = F.dwells(log, '2026-09-13T00:00:00Z');
check('four stretches', d.length, 4);
check('days per stretch', d.map(x => Math.round(x.days)), [2, 7, 2, 1]);
check('only an open final stretch is "current"', d.map(x => x.current), [false, false, false, false]);
const by = F.dwellByHolder(d);
check('QC · RK held it longest, and time after Resolved counts for nobody', by.map(x => `${x.key}:${Math.round(x.days)}`), ['QC · RK:7', 'Complaint Team:2', 'Customer:2']);
const open = F.dwells(log.slice(0, 2), '2026-09-13T00:00:00Z');
check('an open complaint\'s last stretch is current, 10 days and counting', [open[1].current, Math.round(open[1].days)], [true, 10]);


// ── The rules the October rebuild added ────────────────────────────────────
// Each replaced something the dashboard review found wrong, so they are pinned
// here rather than left to be rediscovered the same way.

console.log('\nHeadline status (five names over the eight sub-stages):');
check('Under Investigation reads as Open',         F.headlineStatus('Under Investigation'), 'Open');
check('Replacement Pending reads as Action Taken', F.headlineStatus('Replacement Pending'), 'Action Taken');
check('Feedback is its own headline',              F.headlineStatus('Feedback'), 'Feedback');
check('a legacy status still lands somewhere',     F.headlineStatus('Awaiting Client'), 'Action Taken');
check('an unknown status is not dropped',          F.headlineStatus('Nonsense'), 'Open');
// Four, not three: the legacy 'Awaiting Client' lands here too, which is what
// lets an old complaint and a new one appear under the same tile.
check('Action Taken covers its sub-stages and the legacy one',
  F.statusesUnderHeadline('Action Taken').sort(),
  ['Action Pending', 'Awaiting Client', 'Customer Confirmation Pending', 'Replacement Pending']);
check('Feedback is NOT open - the fix has landed', F.isOpenStatus('Feedback'), false);
check('Action Pending is still open',              F.isOpenStatus('Action Pending'), true);

console.log('\nImmediate response (a flag, not a severity grade):');
const noRisk = { risk_safety: false, risk_shutdown: false, risk_penalty: false, risk_repeat_failure: false };
check('all four no',                   F.isImmediateResponse(noRisk), false);
check('any one yes is immediate',      F.isImmediateResponse({ ...noRisk, risk_shutdown: true }), true);
check('a grading answer alone is not', F.isImmediateResponse({ ...noRisk, risk_qty_over_5: true }), false);
check('a retired question cannot grade it', F.severityOf({ ...noRisk, risk_qty_over_5: true }), 'Low');

console.log('\nOverdue (days since raised, per severity - not the target date):');
const SLA = { High: 2, Low: 7 };
const od = (status, severity, raised) => F.overdueFor({ status, severity, complaint_date: raised }, SLA, '2026-10-07');
check('High open 3 days: overdue',     od('Open', 'High', '2026-10-04').overdue, true);
check('High open 1 day: not yet',      od('Open', 'High', '2026-10-06').overdue, false);
check('Low open 3 days: well inside',  od('Open', 'Low', '2026-10-04').overdue, false);
check('overdue at Open is no-action',  od('Open', 'High', '2026-09-01').kind, 'no-action');
check('overdue after action is acted', od('Action Pending', 'High', '2026-09-01').kind, 'acted');
check('a closed complaint is never overdue', od('Closed', 'High', '2020-01-01').overdue, false);
check('Feedback is never overdue either',    od('Feedback', 'High', '2020-01-01').overdue, false);
// The 34-open-but-1-overdue bug: the old rule could only fire once a target
// date had been typed on page 5, so everything earlier than that was invisible.
check('an ungraded complaint is held to Low, not ignored', od('Open', null, '2020-01-01').overdue, true);

console.log('\nCost impact (the commercial flag, not the risk question):');
check('free replacement forces it', F.costImpactForced({ action_category: 'Free Replacement' }), true);
check('replace material forces it', F.costImpactForced({ action_category: 'Replace Material' }), true);
check('a visit does not',           F.costImpactForced({ action_category: 'Visit Planned' }), false);
check('an FR value forces it',      F.costImpactForced({ fr_material_value: 1200 }), true);
check('risk_cost_impact is a different question', F.costImpactForced({ risk_cost_impact: true }), false);

console.log('\nRouting (category decides; Type still answers for older rows):');
check('Performance goes to QC',        F.routingOwner({ complaint_category: 'Performance' }), 'QC');
check('Damage goes to QC',             F.routingOwner({ complaint_category: 'Damage' }), 'QC');
check('Supply Related stays in-house', F.routingOwner({ complaint_category: 'Supply Related' }), 'Complaint Team');
check('a pre-category row routes on its Type', F.routingOwner({ complaint_type: 'Technical' }), 'QC');
check('nothing known: Complaint Team', F.routingOwner({}), 'Complaint Team');

console.log('\nResponsible department, derived from the root cause:');
check('Wrong EC is the Quotation Team', F.responsibleDepartmentFor('Human Error', 'Wrong EC'), 'Quotation Team');
check('Design is the Drawing Team',     F.responsibleDepartmentFor('Design', null), 'Drawing Team');
// Null, not a guess: the Design and Process sub-lists are still pending, and a
// default here would read as a finding rather than as an absence.
check('an unknown sub stays unanswered', F.responsibleDepartmentFor('Human Error', 'Something else'), null);

console.log('\nCascading options:');
const casc = { complaint_subcategory: { 'Supply Related': ['Excess', 'Short'], 'Damage': ['Joint'] } };
const subField = { name: 'complaint_subcategory', label: 'Sub-category', type: 'select', lookup: 'complaint_subcategory', parentField: 'complaint_category' };
check('options follow the parent',            F.optionsFor(subField, { complaint_category: 'Supply Related' }, {}, casc), ['Excess', 'Short']);
check('a different parent, a different list', F.optionsFor(subField, { complaint_category: 'Damage' }, {}, casc), ['Joint']);
check('no parent answered yet: nothing',      F.optionsFor(subField, {}, {}, casc), []);
// Client Related has no sub-list seeded yet, so this must be empty rather than
// falling back to every sub-category there is.
check('a parent with nothing under it',       F.optionsFor(subField, { complaint_category: 'Client Related' }, {}, casc), []);

console.log('\nSaving page 2 moves an open complaint on:');
check('page 2 on an Open complaint',          F.statusAfterSavingPage(2, 'Open'), 'Under Investigation');
check('page 2 later in the flow does nothing', F.statusAfterSavingPage(2, 'Action Pending'), null);
check('another page does nothing',            F.statusAfterSavingPage(1, 'Open'), null);

console.log(bad ? `\n${bad} FAILURE(S)` : '\nevery rule behaves');
process.exit(bad ? 1 : 0);
