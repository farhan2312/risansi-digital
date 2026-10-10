import { NextResponse } from 'next/server';
import { join } from 'path';
import ExcelJS from 'exceljs';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { canViewExhibition } from '@/app/actions/risansi-exhibitions';

export const runtime = 'nodejs';

// Everything about one exhibition, as a workbook.
//
//   GET /api/risansi/exhibitions/[id]/export
//
// Six sheets: the event itself with its numbers, every meeting with the
// contact it produced and what was decided about it, the contacts alone (for
// a phone or a mailing list), the team and their days, the expenses as
// estimated / actual / paid, the review, and the approval history. Same
// visibility as the page: team, proposer, approver, admin.

type Cell = string | number | Date | null;
const d = (s: string | null | undefined) => (s ? new Date(s.slice(0, 10)) : null);
const n = (x: unknown) => (x == null || x === '' ? null : Number(x));
const NAVY = 'FF0A3D8F';

interface Col<T> { label: string; width: number; get: (r: T) => Cell; fmt?: string }

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) return new NextResponse('Bad id', { status: 400 });
  if (!(await canViewExhibition(id))) return new NextResponse('Not found', { status: 404 });

  const [{ rows: [e] }, { rows: team }, { rows: meetings }, { rows: expenses }, { rows: [review] }, { rows: approvals }] = await Promise.all([
    risansiPool.query(`
      SELECT e.*, ap.name AS approver_name, sb.name AS submitted_by_name, db.name AS decided_by_name, cb.name AS closed_by_name,
             xr.name AS expenses_reviewed_by_name, rb.name AS reopened_by_name,
             COALESCE(e.attend_from, e.start_date)::text AS attend_from_t, COALESCE(e.attend_to, e.end_date, e.start_date)::text AS attend_to_t,
             e.start_date::text AS start_t, e.end_date::text AS end_t, e.submitted_at::text AS submitted_t, e.decided_at::text AS decided_t,
             e.expenses_reviewed_at::text AS exp_rev_t, e.closed_at::text AS closed_t, e.created_at::text AS created_t, e.reopened_at::text AS reopened_t
        FROM exhibitions e
        LEFT JOIN users ap ON ap.id = e.approver_id LEFT JOIN users sb ON sb.id = e.submitted_by
        LEFT JOIN users db ON db.id = e.decided_by LEFT JOIN users cb ON cb.id = e.closed_by
        LEFT JOIN users xr ON xr.id = e.expenses_reviewed_by LEFT JOIN users rb ON rb.id = e.reopened_by
       WHERE e.id = $1`, [id]),
    risansiPool.query(`
      SELECT u.name, u.role, u.email, u.zone, t.team_role,
             COALESCE((SELECT string_agg(d.day::text, ', ' ORDER BY d.day) FROM exhibition_team_days d WHERE d.team_id = t.id), '') AS days,
             (SELECT count(*) FROM exhibition_team_days d WHERE d.team_id = t.id)::int AS day_count
        FROM exhibition_team t JOIN users u ON u.id = t.user_id
       WHERE t.exhibition_id = $1 ORDER BY (t.team_role <> 'Team Lead'), u.name`, [id]),
    risansiPool.query(`
      SELECT m.*, m.met_on::text AS met_on_t, m.follow_up_date::text AS follow_up_t, m.created_at::text AS created_t,
             c.code AS client_code, c.legal_name AS client_legal_name, c.status AS client_status,
             fo.name AS follow_up_owner_name, v.visit_date::text AS linked_visit_date, t.title AS linked_task_title,
             o.stage AS linked_opp_stage,
             (SELECT count(*) FROM exhibition_meeting_cards k WHERE k.meeting_id = m.id)::int AS cards
        FROM exhibition_meetings m
        LEFT JOIN clients c ON c.id = m.client_id
        LEFT JOIN users fo ON fo.id = m.follow_up_owner_id
        LEFT JOIN visits v ON v.id = m.linked_visit_id
        LEFT JOIN tasks t ON t.id = m.linked_task_id
        LEFT JOIN opportunities o ON o.id = m.linked_opportunity_id
       WHERE m.exhibition_id = $1 ORDER BY m.met_on NULLS LAST, m.id`, [id]),
    risansiPool.query(`
      SELECT x.*, x.paid_on::text AS paid_on_t, f.file_name
        FROM exhibition_expenses x LEFT JOIN exhibition_expense_files f ON f.expense_id = x.id
       WHERE x.exhibition_id = $1 ORDER BY x.category, x.id`, [id]),
    risansiPool.query(`SELECT r.*, r.reviewed_at::text AS reviewed_t FROM exhibition_reviews r WHERE r.exhibition_id = $1`, [id]),
    risansiPool.query(`SELECT decision, actor_name, comments, created_at::text AS created_t FROM exhibition_approvals WHERE exhibition_id = $1 ORDER BY created_at, id`, [id]),
  ]);
  if (!e) return new NextResponse('Not found', { status: 404 });

  const stamp = new Date().toISOString().slice(0, 10);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Risansi Sales Portal';

  const head = (ws: ExcelJS.Worksheet, title: string, sub: string) => {
    try {
      const logo = wb.addImage({ filename: join(process.cwd(), 'public', 'logo.png'), extension: 'png' });
      ws.addImage(logo, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 47 } });
    } catch { /* logo optional */ }
    ws.getRow(1).height = 26; ws.getRow(2).height = 16; ws.getRow(3).height = 6;
    const t = ws.getCell('C1'); t.value = title; t.font = { size: 14, bold: true, color: { argb: NAVY } };
    const s = ws.getCell('C2'); s.value = sub; s.font = { size: 10, color: { argb: 'FF64748B' } };
  };

  const table = <T,>(ws: ExcelJS.Worksheet, cols: Col<T>[], rows: T[], startRow = 4) => {
    cols.forEach((c, i) => {
      const cell = ws.getCell(startRow, i + 1);
      cell.value = c.label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      ws.getColumn(i + 1).width = c.width;
    });
    ws.getRow(startRow).height = 20;
    if (rows.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow, column: cols.length } };
    rows.forEach((r, ri) => {
      const row = ws.getRow(startRow + 1 + ri);
      cols.forEach((c, ci) => {
        const cell = row.getCell(ci + 1);
        const v = c.get(r); cell.value = v;
        if (v instanceof Date) cell.numFmt = 'dd-mmm-yyyy';
        else if (typeof v === 'number') cell.numFmt = c.fmt ?? '#,##0';
        if (typeof v === 'string' && v.length > 60) cell.alignment = { wrapText: true, vertical: 'top' };
      });
    });
    ws.views = [{ state: 'frozen', ySplit: startRow }];
  };

  const kv = (ws: ExcelJS.Worksheet, pairs: [string, Cell][], startRow: number, title?: string) => {
    let r = startRow;
    if (title) { const c = ws.getCell(r, 1); c.value = title; c.font = { bold: true, color: { argb: NAVY }, size: 11 }; r++; }
    for (const [k, v] of pairs) {
      const a = ws.getCell(r, 1), b = ws.getCell(r, 2);
      a.value = k; a.font = { bold: true, color: { argb: 'FF475569' } }; a.alignment = { vertical: 'top' };
      b.value = v; b.alignment = { wrapText: true, vertical: 'top' };
      if (v instanceof Date) b.numFmt = 'dd-mmm-yyyy';
      else if (typeof v === 'number') b.numFmt = '#,##0';
      r++;
    }
    return r + 1;
  };

  // ── 1. Exhibition ──
  const potential = meetings.reduce((a, m) => a + (n(m.potential_value_inr) ?? 0), 0);
  const est = expenses.reduce((a, x) => a + (n(x.estimated_inr) ?? 0), 0);
  const act = expenses.reduce((a, x) => a + (n(x.actual_inr) ?? 0), 0);
  const paid = expenses.reduce((a, x) => a + (n(x.paid_inr) ?? 0), 0);
  const ws1 = wb.addWorksheet('Exhibition');
  head(ws1, e.name, `${[e.venue, e.city, e.country].filter(Boolean).join(', ')} · exported ${stamp}`);
  ws1.getColumn(1).width = 28; ws1.getColumn(2).width = 70;
  let r = kv(ws1, [
    ['Name', e.name], ['Organizer', e.organizer], ['Website', e.website], ['Venue', e.venue],
    ['City / State / Country', [e.city, e.state, e.country].filter(Boolean).join(' / ')],
    ['Industry', e.industry], ['Source', e.source],
    ['Event dates', `${e.start_t ?? '—'} to ${e.end_t ?? '—'}`], ['Risansi attending', `${e.attend_from_t ?? '—'} to ${e.attend_to_t ?? '—'}`],
    ['Status', e.status], ['Participation', e.participation], ['Suggested by', e.suggested],
    ['Estimated cost (₹)', n(e.estimated_cost_inr)], ['Recommendation', e.recommendation],
  ], 4, 'Event');
  r = kv(ws1, [
    ['Proposed by', e.created_by_name], ['Submitted by', e.submitted_by_name], ['Submitted on', d(e.submitted_t)],
    ['Approver', e.approver_name], ['Decided by', e.decided_by_name], ['Decided on', d(e.decided_t)], ['Decision notes', e.decision_notes],
    ['Expenses signed off', e.exp_rev_t ? `${e.exp_rev_t.slice(0, 10)} by ${e.expenses_reviewed_by_name ?? '—'}` : null],
    ['Closed', e.closed_t ? `${e.closed_t.slice(0, 10)} by ${e.closed_by_name ?? '—'}` : 'Not closed'],
    ['Reopened', e.reopened_t ? `${e.reopened_t.slice(0, 10)} by ${e.reopened_by_name ?? '—'}` : null],
  ], r, 'Approval & closure');
  kv(ws1, [
    ['Team members', team.length], ['Meetings held', meetings.length],
    ['Contacts captured', meetings.filter(m => m.contact_person || m.email || m.phone).length],
    ['Matched to existing clients', meetings.filter(m => m.client_id != null).length],
    ['Potential value from meetings (₹)', potential],
    ['Follow-ups: visits / actions / opportunities', `${meetings.filter(m => m.follow_up_type === 'Visit').length} / ${meetings.filter(m => m.follow_up_type === 'Action').length} / ${meetings.filter(m => m.follow_up_type === 'Opportunity').length}`],
    ['Expenses estimated / actual / paid (₹)', `${est.toLocaleString('en-IN')} / ${act.toLocaleString('en-IN')} / ${paid.toLocaleString('en-IN')}`],
    ['New leads (review)', n(review?.new_leads)], ['Opportunities (review)', n(review?.opportunities)],
    ['Potential value (review, ₹)', n(review?.potential_value_inr)], ['Business won (₹)', n(review?.business_won_inr)],
    ['Footfall', n(review?.footfall)],
  ], r, 'In numbers');

  // ── 2. Meetings & contacts ──
  const ws2 = wb.addWorksheet('Meetings & Contacts');
  head(ws2, `${e.name} — meetings`, `${meetings.length} meeting${meetings.length === 1 ? '' : 's'} · one row each, with the contact it produced and what was decided`);
  type M = typeof meetings[number];
  table<M>(ws2, [
    { label: '#', width: 5, get: () => null },
    { label: 'Met on', width: 12, get: m => d(m.met_on_t) },
    { label: 'Met by', width: 18, get: m => m.met_by_name },
    { label: 'Company', width: 32, get: m => m.company_name },
    { label: 'Existing client code', width: 16, get: m => m.client_code },
    { label: 'Existing client', width: 32, get: m => m.client_legal_name },
    { label: 'Client status', width: 14, get: m => m.client_status },
    { label: 'Contact person', width: 22, get: m => m.contact_person },
    { label: 'Designation', width: 20, get: m => m.designation },
    { label: 'Phone', width: 16, get: m => m.phone },
    { label: 'Email', width: 28, get: m => m.email },
    { label: 'City', width: 14, get: m => m.city },
    { label: 'Interest', width: 10, get: m => m.interest },
    { label: 'Potential value (₹)', width: 16, get: m => n(m.potential_value_inr) },
    { label: 'Requirement', width: 40, get: m => m.requirement },
    { label: 'Discussion', width: 50, get: m => m.discussion },
    { label: 'Outcome', width: 30, get: m => m.outcome },
    { label: 'Next action', width: 30, get: m => m.next_action },
    { label: 'Follow-up date', width: 13, get: m => d(m.follow_up_t) },
    { label: 'Follow-up decided', width: 16, get: m => m.follow_up_type },
    { label: 'Follow-up owner', width: 18, get: m => m.follow_up_owner_name },
    { label: 'Follow-up note', width: 30, get: m => m.follow_up_note },
    { label: 'Linked visit', width: 14, get: m => m.linked_visit_id ? `#${m.linked_visit_id}${m.linked_visit_date ? ` · ${m.linked_visit_date}` : ''}` : null },
    { label: 'Linked action', width: 24, get: m => m.linked_task_id ? `#${m.linked_task_id}${m.linked_task_title ? ` · ${m.linked_task_title}` : ''}` : null },
    { label: 'Linked opportunity', width: 18, get: m => m.linked_opportunity_id ? `#${m.linked_opportunity_id}${m.linked_opp_stage ? ` · ${m.linked_opp_stage}` : ''}` : null },
    { label: 'Business cards', width: 10, get: m => n(m.cards) || null },
  ], meetings);
  meetings.forEach((_, i) => { ws2.getCell(5 + i, 1).value = i + 1; });

  // ── 3. Contacts ──
  const contacts = meetings.filter(m => m.contact_person || m.email || m.phone);
  const ws3 = wb.addWorksheet('Contacts');
  head(ws3, `${e.name} — contacts`, `${contacts.length} people met · for the phone book or a mailer`);
  table<M>(ws3, [
    { label: 'Name', width: 24, get: m => m.contact_person },
    { label: 'Designation', width: 22, get: m => m.designation },
    { label: 'Company', width: 34, get: m => m.company_name },
    { label: 'Phone', width: 16, get: m => m.phone },
    { label: 'Email', width: 30, get: m => m.email },
    { label: 'City', width: 14, get: m => m.city },
    { label: 'Existing client code', width: 16, get: m => m.client_code },
    { label: 'Met by', width: 18, get: m => m.met_by_name },
    { label: 'Met on', width: 12, get: m => d(m.met_on_t) },
    { label: 'Interest', width: 10, get: m => m.interest },
    { label: 'Follow-up', width: 14, get: m => m.follow_up_type },
  ], contacts);

  // ── 4. Team ──
  const ws4 = wb.addWorksheet('Team');
  head(ws4, `${e.name} — team`, `${team.length} on the stand`);
  type T = typeof team[number];
  table<T>(ws4, [
    { label: 'Name', width: 24, get: t => t.name }, { label: 'Role at the stand', width: 16, get: t => t.team_role },
    { label: 'Portal role', width: 12, get: t => t.role }, { label: 'Zone', width: 12, get: t => t.zone },
    { label: 'Email', width: 30, get: t => t.email }, { label: 'Days', width: 8, get: t => n(t.day_count) },
    { label: 'Dates', width: 44, get: t => t.days || null },
  ], team);

  // ── 5. Expenses ──
  const ws5 = wb.addWorksheet('Expenses');
  head(ws5, `${e.name} — expenses`, `estimated ₹${est.toLocaleString('en-IN')} · actual ₹${act.toLocaleString('en-IN')} · paid ₹${paid.toLocaleString('en-IN')}${e.exp_rev_t ? ` · signed off ${e.exp_rev_t.slice(0, 10)}` : ''}`);
  type X = typeof expenses[number];
  table<X>(ws5, [
    { label: 'Category', width: 18, get: x => x.category }, { label: 'Description', width: 40, get: x => x.description },
    { label: 'Vendor', width: 24, get: x => x.vendor },
    { label: 'Estimated (₹)', width: 15, get: x => n(x.estimated_inr) }, { label: 'Actual (₹)', width: 15, get: x => n(x.actual_inr) },
    { label: 'Paid (₹)', width: 15, get: x => n(x.paid_inr) }, { label: 'Paid on', width: 12, get: x => d(x.paid_on_t) },
    { label: 'Invoice on file', width: 28, get: x => x.file_name },
  ], expenses);
  if (expenses.length) {
    const tr = ws5.getRow(5 + expenses.length);
    tr.getCell(1).value = 'Total'; tr.getCell(1).font = { bold: true };
    [[4, est], [5, act], [6, paid]].forEach(([c, v]) => { const cell = tr.getCell(c as number); cell.value = v as number; cell.numFmt = '#,##0'; cell.font = { bold: true }; });
  }

  // ── 6. Review ──
  const ws6 = wb.addWorksheet('Review');
  head(ws6, `${e.name} — post-event review`, review ? `by ${review.reviewed_by_name ?? '—'}${review.reviewed_t ? ` on ${review.reviewed_t.slice(0, 10)}` : ''}` : 'not yet written');
  ws6.getColumn(1).width = 26; ws6.getColumn(2).width = 90;
  if (review) {
    kv(ws6, [
      ['New leads', n(review.new_leads)], ['Opportunities', n(review.opportunities)],
      ['Potential value (₹)', n(review.potential_value_inr)], ['Business won (₹)', n(review.business_won_inr)], ['Footfall', n(review.footfall)],
      ['What worked', review.what_worked], ['What did not', review.what_did_not], ['Key learnings', review.key_learnings],
      ['Competitor notes', review.competitor_notes],
      ['Attend next year', review.attend_next_year == null ? null : review.attend_next_year ? 'Yes' : 'No'], ['Next year notes', review.next_year_notes],
    ], 4);
  } else {
    ws6.getCell(4, 1).value = 'The review has not been written yet.';
  }

  // ── 7. History ──
  const ws7 = wb.addWorksheet('Approval History');
  head(ws7, `${e.name} — history`, `${approvals.length} entr${approvals.length === 1 ? 'y' : 'ies'}`);
  type A = typeof approvals[number];
  table<A>(ws7, [
    { label: 'When', width: 20, get: a => a.created_t ? a.created_t.slice(0, 16).replace('T', ' ') : null },
    { label: 'What', width: 22, get: a => a.decision }, { label: 'Who', width: 22, get: a => a.actor_name },
    { label: 'Comments', width: 70, get: a => a.comments },
  ], approvals);

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const safe = String(e.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'exhibition';
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="exhibition-${safe}-${stamp}.xlsx"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
