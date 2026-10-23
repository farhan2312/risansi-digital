import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Every CLOSED exhibition, as one workbook.
//
//   GET /api/risansi/exhibitions/export
//
// The per-exhibition export at [id]/export answers "tell me about this
// event". This answers the other question — "what did a year of exhibitions
// actually get us" — so each sheet runs across events with an Exhibition
// column on every row, which is what makes them sortable and pivotable.
//
// Closed only, deliberately. An exhibition still running has half its
// meetings entered, its expenses unreconciled and no review; including it
// would put figures into a year-end workbook that are going to change, and
// the reader would have no way to tell which rows are settled.

type Cell = string | number | Date | null;
type Row = Record<string, unknown>;
const d = (v: unknown) => (typeof v === 'string' && v ? new Date(v.slice(0, 10)) : null);
const n = (x: unknown) => (x == null || x === '' ? null : Number(x));
const s = (v: unknown) => (v == null || v === '' ? null : String(v));
const NAVY = 'FF0A3D8F';

interface Col { label: string; width: number; get: (r: Row) => Cell; fmt?: string }

export async function GET() {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });
  // This spans every exhibition rather than one, so it is not scoped by team
  // membership the way [id]/export is. Admin and above only.
  if (!hasRole(user.role, 'admin')) {
    return new NextResponse('Only an admin can export every exhibition.', { status: 403 });
  }

  // "Only after it has been closed" — meaning the event is over, not the
  // narrower formal status.
  //
  // On 23 Oct exactly one exhibition held the status 'Closed' and it had no
  // meetings on it, while the six marked 'Completed' carry the actual record —
  // PALMEX Medan 2026 alone has 42 companies met. Exporting the literal status
  // would have produced an empty workbook and looked broken.
  //
  // So both statuses that mean the event has happened are included, and the
  // Exhibitions sheet carries a Status column so a reader can tell a settled
  // record from one still being reconciled. Draft, Shortlisted and Approved
  // stay out: those events have not taken place.
  const CLOSED = "e.status IN ('Closed','Completed')";
  const [ex, mt, ct, tm, xp, rv] = await Promise.all([
    risansiPool.query(`
      SELECT e.*, e.start_date::text AS s_date, e.end_date::text AS e_date,
             e.closed_at::text AS closed_t,
             (SELECT u.name FROM users u WHERE u.id = e.closed_by) AS closed_by_name,
             (SELECT count(*) FROM exhibition_meetings m WHERE m.exhibition_id = e.id)::int AS meetings,
             (SELECT count(*) FROM exhibition_meetings m WHERE m.exhibition_id = e.id AND m.client_id IS NOT NULL)::int AS known_clients,
             (SELECT COALESCE(SUM(m.potential_value_inr),0) FROM exhibition_meetings m WHERE m.exhibition_id = e.id) AS potential_inr,
             (SELECT COALESCE(SUM(x.actual_inr),0) FROM exhibition_expenses x WHERE x.exhibition_id = e.id) AS actual_inr,
             (SELECT COALESCE(SUM(x.paid_inr),0)   FROM exhibition_expenses x WHERE x.exhibition_id = e.id) AS paid_inr
        FROM exhibitions e WHERE ${CLOSED} ORDER BY e.start_date DESC NULLS LAST, e.id`),
    risansiPool.query(`
      SELECT e.name AS exhibition, m.*, m.met_on::text AS met_t, m.follow_up_date::text AS fu_t,
             u.name AS met_by_name, c.code AS client_code
        FROM exhibition_meetings m
        JOIN exhibitions e ON e.id = m.exhibition_id
        LEFT JOIN users u   ON u.id = m.met_by
        LEFT JOIN clients c ON c.id = m.client_id
       WHERE ${CLOSED} ORDER BY e.start_date DESC NULLS LAST, m.met_on NULLS LAST, m.id`),
    risansiPool.query(`
      SELECT e.name AS exhibition, m.company_name, ct.name, ct.designation, ct.phone, ct.email
        FROM exhibition_meeting_contacts ct
        JOIN exhibition_meetings m ON m.id = ct.meeting_id
        JOIN exhibitions e ON e.id = m.exhibition_id
       WHERE ${CLOSED} ORDER BY e.name, m.company_name, ct.id`),
    risansiPool.query(`
      SELECT e.name AS exhibition, u.name, t.team_role, u.role AS user_role
        FROM exhibition_team t
        JOIN exhibitions e ON e.id = t.exhibition_id
        JOIN users u ON u.id = t.user_id
       WHERE ${CLOSED} ORDER BY e.name, t.team_role, u.name`),
    risansiPool.query(`
      SELECT e.name AS exhibition, x.*, x.paid_on::text AS paid_t
        FROM exhibition_expenses x
        JOIN exhibitions e ON e.id = x.exhibition_id
       WHERE ${CLOSED} ORDER BY e.name, x.category, x.id`),
    risansiPool.query(`
      SELECT e.name AS exhibition, r.*, r.reviewed_at::text AS reviewed_t
        FROM exhibition_reviews r
        JOIN exhibitions e ON e.id = r.exhibition_id
       WHERE ${CLOSED} ORDER BY e.name`),
  ]);

  if (ex.rows.length === 0) {
    return new NextResponse('No completed or closed exhibitions to export yet.', { status: 404 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Risansi Sales Portal';
  wb.created = new Date();

  const sheet = (name: string, cols: Col[], rows: Row[], subtitle: string) => {
    const ws = wb.addWorksheet(name);
    const t = ws.getCell('A1');
    t.value = name + ' · closed exhibitions';
    t.font = { size: 13, bold: true, color: { argb: NAVY } };
    const sub = ws.getCell('A2');
    sub.value = subtitle;
    sub.font = { size: 10, color: { argb: 'FF64748B' } };

    const HEAD = 4;
    cols.forEach((c, i) => {
      const cell = ws.getCell(HEAD, i + 1);
      cell.value = c.label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      ws.getColumn(i + 1).width = c.width;
    });
    ws.getRow(HEAD).height = 20;
    if (rows.length) ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD, column: cols.length } };
    rows.forEach((r, ri) => {
      const row = ws.getRow(HEAD + 1 + ri);
      cols.forEach((c, ci) => {
        const cell = row.getCell(ci + 1);
        const v = c.get(r);
        cell.value = v;
        if (v instanceof Date) cell.numFmt = 'dd-mmm-yyyy';
        else if (typeof v === 'number') cell.numFmt = c.fmt ?? '#,##0';
        if (typeof v === 'string' && v.length > 60) cell.alignment = { wrapText: true, vertical: 'top' };
      });
    });
    ws.views = [{ state: 'frozen', ySplit: HEAD }];
  };

  const where = (r: Row) => [r.venue, r.city, r.country].map(s).filter(Boolean).join(', ') || null;

  sheet('Exhibitions', [
    { label: 'Exhibition', width: 34, get: r => s(r.name) },
    { label: 'Status', width: 13, get: r => s(r.status) },
    { label: 'Organizer', width: 22, get: r => s(r.organizer) },
    { label: 'Where', width: 30, get: where },
    { label: 'Industry', width: 18, get: r => s(r.industry) },
    { label: 'From', width: 13, get: r => d(r.s_date) },
    { label: 'To', width: 13, get: r => d(r.e_date) },
    { label: 'Budget', width: 15, get: r => n(r.estimated_cost_inr) },
    { label: 'Actual spend', width: 15, get: r => n(r.actual_inr) },
    { label: 'Paid', width: 15, get: r => n(r.paid_inr) },
    { label: 'Companies met', width: 14, get: r => n(r.meetings) },
    { label: 'Already clients', width: 14, get: r => n(r.known_clients) },
    { label: 'Potential', width: 16, get: r => n(r.potential_inr) },
    { label: 'Closed on', width: 14, get: r => d(r.closed_t) },
    { label: 'Closed by', width: 20, get: r => s(r.closed_by_name) },
  ], ex.rows, ex.rows.length + ' exhibition(s) that have taken place, one row each. Figures in rupees.');

  sheet('Meetings', [
    { label: 'Exhibition', width: 30, get: r => s(r.exhibition) },
    { label: 'Company', width: 30, get: r => s(r.company_name) },
    { label: 'Existing client', width: 14, get: r => s(r.client_code) },
    { label: 'Contact', width: 20, get: r => s(r.contact_person) },
    { label: 'Designation', width: 20, get: r => s(r.designation) },
    { label: 'Phone', width: 16, get: r => s(r.phone) },
    { label: 'Email', width: 26, get: r => s(r.email) },
    { label: 'Met on', width: 13, get: r => d(r.met_t) },
    { label: 'Met by', width: 20, get: r => s(r.met_by_name) },
    { label: 'Interest', width: 12, get: r => s(r.interest) },
    { label: 'Potential', width: 15, get: r => n(r.potential_value_inr) },
    { label: 'Requirement', width: 40, get: r => s(r.requirement) },
    { label: 'Discussion', width: 50, get: r => s(r.discussion) },
    { label: 'Outcome', width: 30, get: r => s(r.outcome) },
    { label: 'Next action', width: 30, get: r => s(r.next_action) },
    { label: 'Follow up by', width: 14, get: r => d(r.fu_t) },
  ], mt.rows, mt.rows.length + ' meeting(s) across every closed exhibition');

  sheet('Contacts', [
    { label: 'Exhibition', width: 30, get: r => s(r.exhibition) },
    { label: 'Company', width: 30, get: r => s(r.company_name) },
    { label: 'Name', width: 22, get: r => s(r.name) },
    { label: 'Designation', width: 22, get: r => s(r.designation) },
    { label: 'Phone', width: 18, get: r => s(r.phone) },
    { label: 'Email', width: 28, get: r => s(r.email) },
  ], ct.rows, 'Everybody met, as a list to call or mail');

  sheet('Team', [
    { label: 'Exhibition', width: 30, get: r => s(r.exhibition) },
    { label: 'Name', width: 24, get: r => s(r.name) },
    { label: 'On the stand as', width: 20, get: r => s(r.team_role) },
    { label: 'Portal role', width: 16, get: r => s(r.user_role) },
  ], tm.rows, 'Who attended which event');

  sheet('Expenses', [
    { label: 'Exhibition', width: 30, get: r => s(r.exhibition) },
    { label: 'Category', width: 20, get: r => s(r.category) },
    { label: 'Description', width: 38, get: r => s(r.description) },
    { label: 'Vendor', width: 24, get: r => s(r.vendor) },
    { label: 'Estimated', width: 15, get: r => n(r.estimated_inr) },
    { label: 'Actual', width: 15, get: r => n(r.actual_inr) },
    { label: 'Paid', width: 15, get: r => n(r.paid_inr) },
    { label: 'Paid on', width: 13, get: r => d(r.paid_t) },
  ], xp.rows, 'Estimated against actual against paid');

  sheet('Reviews', [
    { label: 'Exhibition', width: 30, get: r => s(r.exhibition) },
    { label: 'New leads', width: 12, get: r => n(r.new_leads) },
    { label: 'Opportunities', width: 13, get: r => n(r.opportunities) },
    { label: 'Potential', width: 16, get: r => n(r.potential_value_inr) },
    { label: 'Business won', width: 16, get: r => n(r.business_won_inr) },
    { label: 'Footfall', width: 11, get: r => n(r.footfall) },
    { label: 'What worked', width: 44, get: r => s(r.what_worked) },
    { label: 'What did not', width: 44, get: r => s(r.what_did_not) },
    { label: 'Key learnings', width: 44, get: r => s(r.key_learnings) },
    { label: 'Competitors', width: 36, get: r => s(r.competitor_notes) },
    { label: 'Attend next year', width: 16, get: r => s(r.attend_next_year) },
  ], rv.rows, 'The post-event review, one row per exhibition');

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="Risansi-Exhibitions-Closed-' + stamp + '.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
