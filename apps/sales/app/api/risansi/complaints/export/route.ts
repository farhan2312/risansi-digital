import { NextResponse } from 'next/server';
import { join } from 'path';
import ExcelJS from 'exceljs';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { loadComplaintRows, parseComplaintFilters, parseComplaintSort, FILTER_KEYS, type ComplaintListRow } from '@/lib/risansi-complaint-rows';
import { loadSlaThresholds } from '@/lib/risansi-complaint-admin';
import {
  PAGES, SEVERITY_LABEL, headlineStatus, isOpenStatus, isImmediateResponse,
  routingOwner, FR_ACTIONS,
  type ComplaintField, type RiskAnswers, type Severity,
} from '@/lib/risansi-complaint-flow';

export const runtime = 'nodejs';

// The complaints table, as a workbook the Complaint Team can work from.
//
//   GET /api/risansi/complaints/export?<the list page's search params>
//
// Same rows as the page: loadComplaintRows applies the viewer's scope and the
// same filters, including the bars clicked on the dashboard.
//
// Three sheets, because one flat grid cannot answer what the review asked of
// this export:
//
//   Complaints  identity, where it stands, then every field of the eight pages
//               in form order, labelled "<page>: <field>".
//   Parts       one row per part, which is the drill-down the dashboard asks
//               for in words — Damage → Joint → Bush / Shaft Head → the MOC of
//               each. A complaint about four damaged joints is four rows here
//               and one row on the first sheet, and no column on the first
//               sheet could have held them.
//   Historical  the fields the form stopped asking, for the complaints that
//               answered them. The sheet is only added when some exported row
//               actually carries one, so a normal export is not padded with
//               twelve empty columns.
//
// The page columns are read from the same catalogue the forms render from, so a
// field added to the form is in the export the same day. The columns in front
// of them are not: status, severity, overdue and the FR total are computed, and
// each of them is a question somebody asks of this file.

type Cell = string | number | Date | null;
const NAVY = 'FF0A3D8F';
const GREY = 'FF64748B';
const BAND = 'FFE8EEF8';

const dateOf = (s: unknown) => (s ? new Date(String(s).slice(0, 10)) : null);
const yesNo = (v: unknown) => (v === true || v === 't' ? 'Yes' : v === false || v === 'f' ? 'No' : null);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

interface PartRow {
  complaint_id: number; sort_order: number;
  part_type: string | null; part_name: string | null; quantity: string | null; moc: string | null;
  vendor_name: string | null; mfg_date: string | null; part_code: string | null;
  ec_no: string | null; ec_date: string | null;
  liquid: string | null; head: string | null; capacity: string | null;
}

/** Everything the columns need that is not on the row itself. */
interface Ctx {
  names: Map<number, string>;
  oemNames: Map<number, string>;
  /** Complaint id → its number, for the "repeat of" link. */
  complaintNos: Map<number, string>;
  parts: Map<number, PartRow[]>;
  today: string;
}

interface Col {
  key: string; label: string; width: number; group: string;
  get: (r: ComplaintListRow, full: Record<string, unknown>, ctx: Ctx) => Cell;
}

/** One line naming the parts a complaint is about, grouped by type. */
function partsSummary(rows: PartRow[]): string | null {
  if (rows.length === 0) return null;
  const byType = new Map<string, string[]>();
  for (const p of rows) {
    const type = p.part_type ?? 'Part';
    const qty = p.quantity != null && p.quantity !== '' ? ` ×${p.quantity}` : '';
    const moc = p.moc ? ` (${p.moc})` : '';
    byType.set(type, [...(byType.get(type) ?? []), `${p.part_name ?? '—'}${qty}${moc}`]);
  }
  return [...byType.entries()].map(([t, list]) => `${t}: ${list.join(', ')}`).join(' | ');
}

const HEAD_COLS: Col[] = [
  { key: 'complaint_no', label: 'Complaint no.', width: 14, group: 'Record', get: r => r.complaint_no },
  { key: 'legacy_ref', label: 'Legacy ref', width: 10, group: 'Record', get: r => r.legacy_ref },
  { key: 'client_code', label: 'Client code', width: 14, group: 'Record', get: r => r.client_code },
  { key: 'client_name', label: 'Client', width: 34, group: 'Record', get: r => r.client_name },
  { key: 'rep', label: 'Rep', width: 18, group: 'Record', get: r => r.rep_name },
  { key: 'raised_by', label: 'Raised by', width: 18, group: 'Record', get: (_r, full, ctx) => (full.reported_by_user ? ctx.names.get(Number(full.reported_by_user)) ?? null : (full.reported_by_raw as string | null) ?? null) },
  { key: 'created_at', label: 'Registered on', width: 12, group: 'Record', get: r => dateOf(r.created_at) },

  // Headline before stage. The five names are what the dashboard counts and
  // what a status filter means to the people reading this; the eight-stage
  // status beside it says where in the workflow the complaint actually sits.
  { key: 'headline', label: 'Status (headline)', width: 15, group: 'Where it stands', get: r => r.headline ?? headlineStatus(r.status) },
  { key: 'status', label: 'Stage', width: 26, group: 'Where it stands', get: r => r.status },
  { key: 'severity', label: 'Severity', width: 14, group: 'Where it stands', get: r => (r.severity ? SEVERITY_LABEL[r.severity as Severity] : null) },
  // Severe is not S1. One Yes among Safety / Shutdown / Penalty / Repeat, and
  // the complaint wants somebody's attention today whatever it grades.
  { key: 'severe', label: 'Severe (immediate)', width: 11, group: 'Where it stands', get: (r, full) => ((r.severe ?? isImmediateResponse(full as RiskAnswers)) ? 'Yes' : null) },
  { key: 'owner', label: 'Investigated by', width: 15, group: 'Where it stands', get: (_r, full) => routingOwner({ complaint_category: full.complaint_category as string | null, complaint_type: full.complaint_type as string | null }) },
  { key: 'holder', label: 'Sitting with', width: 24, group: 'Where it stands', get: r => (!isOpenStatus(r.status) || r.schema_version < 2) ? null : (r.holder_name ? `${r.holder_name} · ${r.holder_department}` : r.holder_department) },
  { key: 'since', label: 'In this status since', width: 14, group: 'Where it stands', get: r => (isOpenStatus(r.status) && r.schema_version >= 2 ? dateOf(r.since) : null) },
  { key: 'days_in_status', label: 'Days in status', width: 11, group: 'Where it stands', get: r => (isOpenStatus(r.status) ? Math.round(r.days_in_status * 10) / 10 : null) },
  { key: 'age_days', label: 'Age (days)', width: 10, group: 'Where it stands', get: r => Math.round(r.age_days * 10) / 10 },

  // Overdue, the way it is now decided: age since raised against the days the
  // severity allows, both spelled out so the verdict can be checked rather than
  // argued with. The old column read a target date only page 5 asks for.
  //
  // The verdict is the loader's, not computed again here. loadComplaintRows
  // calls overdueFor once per row with the thresholds out of
  // complaint_sla_thresholds, and a second call in this file would be a second
  // place to keep in step every time the rule moves.
  { key: 'overdue', label: 'Overdue', width: 9, group: 'Overdue', get: r => (r.overdue ? 'Yes' : null) },
  { key: 'overdue_kind', label: 'Overdue — action?', width: 16, group: 'Overdue', get: r => (r.overdue_kind === 'no-action' ? 'No action taken' : r.overdue_kind === 'acted' ? 'Action taken, still late' : null) },
  { key: 'overdue_by', label: 'Overdue by (days)', width: 12, group: 'Overdue', get: r => (r.overdue && r.overdue_days != null && r.overdue_threshold != null ? r.overdue_days - r.overdue_threshold : null) },
  { key: 'allowed', label: 'Days allowed', width: 11, group: 'Overdue', get: r => r.overdue_threshold },

  { key: 'resolved_at', label: 'Resolved on', width: 12, group: 'Closure', get: r => dateOf(r.resolved_at) },
  { key: 'closed_at', label: 'Closed on', width: 12, group: 'Closure', get: r => dateOf(r.closed_at) },
  { key: 'reopen_count', label: 'Reopened (times)', width: 10, group: 'Closure', get: r => r.reopen_count || null },
  { key: 'linked', label: 'Repeat of', width: 14, group: 'Closure', get: (r, full, ctx) => r.linked_complaint_no ?? (full.linked_complaint_id ? ctx.complaintNos.get(Number(full.linked_complaint_id)) ?? `#${full.linked_complaint_id}` : null) },

  // The commercial half, in one place rather than six columns apart. An FR's
  // transport and material figures were being added together into one challan
  // value, so what free replacements cost in freight alone could not be asked.
  { key: 'cost_impact', label: 'Cost impact', width: 11, group: 'Cost', get: (_r, full) => yesNo(full.cost_impact) },
  { key: 'is_fr', label: 'Free replacement', width: 11, group: 'Cost', get: (_r, full) => ((FR_ACTIONS as readonly string[]).includes(String(full.action_category)) ? 'Yes' : null) },
  { key: 'fr_total', label: 'FR total (₹)', width: 14, group: 'Cost', get: (_r, full) => { const t = (num(full.fr_transport_value) ?? 0) + (num(full.fr_material_value) ?? 0); return t > 0 ? t : null; } },

  { key: 'parts_count', label: 'Parts', width: 7, group: 'Parts', get: (r, _f, ctx) => (ctx.parts.get(r.id)?.length ?? 0) || null },
  { key: 'parts_summary', label: 'Parts (summary)', width: 46, group: 'Parts', get: (r, _f, ctx) => partsSummary(ctx.parts.get(r.id) ?? []) },
];

/** One column per form field, valued the way the form shows it. */
function fieldCol(pageTitle: string, f: ComplaintField): Col {
  const width = f.type === 'long' ? 50
    : f.type === 'date' ? 12
      : f.type === 'bool' || f.type === 'yesno4' || f.type === 'paid' ? 10
        : f.type === 'money' || f.type === 'number' ? 14
          : f.type === 'user' ? 18
            : f.type === 'multi' ? 28
              : 20;
  return {
    key: f.name, label: f.label, width, group: pageTitle,
    get: (_r, full, ctx) => {
      const v = full[f.name];
      if (v == null || v === '') return null;
      switch (f.type) {
        case 'date': return dateOf(v);
        case 'money': case 'number': return num(v);
        case 'bool': return yesNo(v) ?? String(v);
        case 'user': return ctx.names.get(Number(v)) ?? String(v);
        case 'oem': return ctx.oemNames.get(Number(v)) ?? `OEM #${v}`;
        // A text[] reaching a cell as "QC,Purchase" is not a reading of it.
        case 'multi': return Array.isArray(v) ? (v.length ? v.join(', ') : null) : String(v);
        // Stored as an id, useless as one. The number is what a person chases.
        case 'complaint': return ctx.complaintNos.get(Number(v)) ?? `#${v}`;
        default: return String(v);
      }
    },
  };
}

/**
 * The fields the form has stopped asking, with the column each lives in.
 *
 * They are not dead: 219 complaints are on file and the older ones answered
 * these and nothing else, so an export that dropped them would lose the only
 * description some records have. They are also not worth twelve empty columns
 * on an export of this month's complaints, so they go on their own sheet and
 * only when a row in this export actually carries one.
 */
const HISTORICAL: { col: string; label: string; width: number; kind?: 'date' | 'money' | 'bool' | 'user' }[] = [
  { col: 'complaint_type', label: 'Complaint type (retired)', width: 16 },
  { col: 'defect_category', label: 'Defect category (retired)', width: 30 },
  { col: 'defect_reason', label: 'Defect reason (retired)', width: 30 },
  { col: 'contact_person', label: 'Contact person (retired)', width: 20 },
  { col: 'contact_detail', label: 'Contact number (retired)', width: 16 },
  { col: 'tsm_responsible_department', label: 'Responsible TSM dept (retired)', width: 20 },
  { col: 'customer_confirmed', label: 'Customer confirmed (retired)', width: 12, kind: 'bool' },
  { col: 'analysis_required', label: 'Analysis required (retired)', width: 12, kind: 'bool' },
  { col: 'investigation_assigned_to', label: 'Investigation assigned to (retired)', width: 20, kind: 'user' },
  { col: 'investigation_start', label: 'Investigation start (retired)', width: 13, kind: 'date' },
  { col: 'investigation_end', label: 'Investigation end (retired)', width: 13, kind: 'date' },
  { col: 'basic_value', label: 'Basic value (retired)', width: 14, kind: 'money' },
  // The single part slot page 2 used to hold, before complaint_parts.
  { col: 'part_type', label: 'Part type (single-slot)', width: 16 },
  { col: 'part_name', label: 'Part name (single-slot)', width: 20 },
  { col: 'quantity', label: 'Quantity (single-slot)', width: 10, kind: 'money' },
  { col: 'rubber_moc', label: 'Rubber MOC (single-slot)', width: 16 },
  { col: 'stator_code', label: 'Stator code (single-slot)', width: 16 },
  { col: 'mfg_date', label: 'MFG date (single-slot)', width: 12, kind: 'date' },
  { col: 'liquid', label: 'Liquid (single-slot)', width: 16 },
  { col: 'head_pressure', label: 'Head / pressure (single-slot)', width: 16 },
];

const PART_COLS: { label: string; width: number; get: (p: PartRow) => Cell }[] = [
  { label: 'Part type', width: 20, get: p => p.part_type },
  { label: 'Part name', width: 22, get: p => p.part_name },
  { label: 'Qty', width: 8, get: p => num(p.quantity) },
  { label: 'MOC', width: 18, get: p => p.moc },
  { label: 'Vendor', width: 22, get: p => p.vendor_name },
  { label: 'MFG date', width: 12, get: p => dateOf(p.mfg_date) },
  { label: 'Part code', width: 16, get: p => p.part_code },
  { label: 'EC no.', width: 16, get: p => p.ec_no },
  { label: 'EC date', width: 12, get: p => dateOf(p.ec_date) },
  { label: 'Liquid', width: 18, get: p => p.liquid },
  { label: 'Head', width: 12, get: p => p.head },
  { label: 'Capacity', width: 12, get: p => p.capacity },
];

function headerCell(ws: ExcelJS.Worksheet, row: number, colIx: number, label: string, width: number) {
  const cell = ws.getCell(row, colIx);
  cell.value = label;
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  cell.alignment = { vertical: 'middle', wrapText: true };
  ws.getColumn(colIx).width = width;
}

function writeCell(cell: ExcelJS.Cell, v: Cell) {
  cell.value = v;
  if (v instanceof Date) cell.numFmt = 'dd-mmm-yyyy';
  else if (typeof v === 'number') cell.numFmt = Number.isInteger(v) ? '#,##0' : '#,##0.0';
  if (typeof v === 'string' && v.length > 60) cell.alignment = { wrapText: true, vertical: 'top' };
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  const url = new URL(request.url);
  const sp: Record<string, string> = {};
  for (const k of url.searchParams.keys()) sp[k] = url.searchParams.get(k) ?? '';
  const filters = parseComplaintFilters(sp);
  const rows = await loadComplaintRows(user, { filters, sort: parseComplaintSort(sp) });
  const applied = FILTER_KEYS.filter(k => filters[k]).map(k => `${k}: ${filters[k]}`);

  const ids = rows.map(r => r.id);
  const [
    { rows: fullRows }, { rows: userRows }, { rows: oemRows }, { rows: noRows }, { rows: partRows }, thresholds,
  ] = await Promise.all([
    // Date columns are cast ::text here as well as on the row loader: SELECT *
    // hands a `date` back as a JS Date that an IST render moves a day, and the
    // export's own date cells are built off these values.
    ids.length
      ? risansiPool.query<Record<string, unknown> & { id: number }>(
        `SELECT c.*, c.complaint_date::text AS complaint_date, c.ec_date::text AS ec_date,
                c.invoice_date::text AS invoice_date, c.client_po_date::text AS client_po_date,
                c.mfg_date::text AS mfg_date, c.target_completion_date::text AS target_completion_date,
                c.actual_completion_date::text AS actual_completion_date, c.fr_ec_date::text AS fr_ec_date,
                c.challan_date::text AS challan_date, c.target_dispatch_date::text AS target_dispatch_date,
                c.capa_received_date::text AS capa_received_date,
                c.returnable_slip_date::text AS returnable_slip_date,
                c.first_email_date::text AS first_email_date, c.last_reminder_date::text AS last_reminder_date,
                c.next_followup_date::text AS next_followup_date,
                c.investigation_start::text AS investigation_start, c.investigation_end::text AS investigation_end
           FROM complaints c WHERE c.id = ANY($1::int[])`, [ids])
      : Promise.resolve({ rows: [] as (Record<string, unknown> & { id: number })[] }),
    risansiPool.query<{ id: number; name: string }>('SELECT id, name FROM users'),
    risansiPool.query<{ id: number; legal_name: string }>(
      `SELECT id, legal_name FROM clients WHERE client_type = 'OEM' AND deleted_at IS NULL`),
    // Every complaint number, not only the exported ones: the complaint a
    // repeat points back at is usually outside the filter that produced this
    // export, and "#182" in the cell would make the link useless.
    risansiPool.query<{ id: number; complaint_no: string }>('SELECT id, complaint_no FROM complaints'),
    ids.length
      ? risansiPool.query<PartRow>(
        `SELECT complaint_id, sort_order, part_type, part_name, quantity::text AS quantity, moc,
                vendor_name, mfg_date::text AS mfg_date, part_code,
                ec_no, ec_date::text AS ec_date, liquid, head, capacity
           FROM complaint_parts WHERE complaint_id = ANY($1::int[])
          ORDER BY complaint_id, sort_order, id`, [ids])
      : Promise.resolve({ rows: [] as PartRow[] }),
    loadSlaThresholds(),
  ]);

  const parts = new Map<number, PartRow[]>();
  for (const p of partRows) parts.set(p.complaint_id, [...(parts.get(p.complaint_id) ?? []), p]);

  const ctx: Ctx = {
    names: new Map(userRows.map(u => [u.id, u.name])),
    oemNames: new Map(oemRows.map(o => [o.id, o.legal_name])),
    complaintNos: new Map(noRows.map(c => [c.id, c.complaint_no])),
    parts,
    today: new Date().toISOString().slice(0, 10),
  };
  const full = new Map(fullRows.map(r => [r.id, r]));

  const cols: Col[] = [...HEAD_COLS];
  for (const p of PAGES) for (const f of p.fields) cols.push(fieldCol(`${p.id}. ${p.title}`, f));

  const stamp = ctx.today;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Risansi Sales Portal';

  // ── Sheet 1 · Complaints ───────────────────────────────────────────────

  const ws = wb.addWorksheet('Complaints', { views: [{ state: 'frozen', xSplit: 4, ySplit: 5 }] });
  try {
    const logoId = wb.addImage({ filename: join(process.cwd(), 'public', 'logo.png'), extension: 'png' });
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 47 } });
  } catch { /* logo optional */ }
  ws.getRow(1).height = 26; ws.getRow(2).height = 16; ws.getRow(3).height = 6;
  const title = ws.getCell('C1'); title.value = 'Complaints — every field of the form';
  title.font = { size: 14, bold: true, color: { argb: NAVY } };

  const overdueCount = rows.filter(r => r.overdue).length;
  const sub = ws.getCell('C2');
  sub.value = `${rows.length} row${rows.length === 1 ? '' : 's'} · ${rows.filter(r => isOpenStatus(r.status)).length} open · ${overdueCount} overdue `
    + `(High ${thresholds.High ?? '—'}d / Low ${thresholds.Low ?? '—'}d) · `
    + `${applied.length ? applied.join(' · ') : 'no filters'} · ${stamp}`;
  sub.font = { size: 10, color: { argb: GREY } };

  // Row 4 names the run of columns each group belongs to; row 5 is the header.
  const GROUP = 4, HEAD = 5;
  let start = 1;
  for (let i = 1; i <= cols.length; i++) {
    if (i === cols.length || cols[i].group !== cols[start - 1].group) {
      const cell = ws.getCell(GROUP, start);
      cell.value = cols[start - 1].group;
      cell.font = { bold: true, color: { argb: NAVY }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
      if (i > start) ws.mergeCells(GROUP, start, GROUP, i);
      start = i + 1;
    }
  }
  ws.getRow(GROUP).height = 18;
  cols.forEach((c, i) => headerCell(ws, HEAD, i + 1, c.label, c.width));
  ws.getRow(HEAD).height = 30;
  ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD, column: cols.length } };

  rows.forEach((r, ri) => {
    const row = ws.getRow(HEAD + 1 + ri);
    const f = full.get(r.id) ?? {};
    cols.forEach((c, ci) => writeCell(row.getCell(ci + 1), c.get(r, f, ctx)));
  });

  // ── Sheet 2 · Parts ────────────────────────────────────────────────────
  //
  // Always added, even with nothing in it: an empty Parts sheet says the
  // complaints in this export are not about a named part, which is an answer.
  // A missing sheet reads as the export having forgotten to ask.

  const wp = wb.addWorksheet('Parts', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
  const pHead = ['Complaint no.', 'Client', 'Complaint category', 'Sub-category', '#', ...PART_COLS.map(c => c.label)];
  const pWidth = [14, 30, 20, 20, 5, ...PART_COLS.map(c => c.width)];
  const pTitle = wp.getCell('A1');
  pTitle.value = `Parts — one row per part, ${partRows.length} across ${parts.size} complaint${parts.size === 1 ? '' : 's'}`;
  pTitle.font = { size: 11, bold: true, color: { argb: NAVY } };
  pHead.forEach((h, i) => headerCell(wp, 2, i + 1, h, pWidth[i]));
  wp.getRow(2).height = 26;
  wp.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: pHead.length } };

  let pr = 3;
  for (const r of rows) {
    const mine = parts.get(r.id) ?? [];
    const f: Record<string, unknown> = full.get(r.id) ?? {};
    for (const p of mine) {
      const row = wp.getRow(pr++);
      writeCell(row.getCell(1), r.complaint_no);
      writeCell(row.getCell(2), r.client_name);
      writeCell(row.getCell(3), (f.complaint_category as string | null) ?? null);
      writeCell(row.getCell(4), (f.complaint_subcategory as string | null) ?? null);
      writeCell(row.getCell(5), p.sort_order + 1);
      PART_COLS.forEach((c, i) => writeCell(row.getCell(6 + i), c.get(p)));
    }
  }

  // ── Sheet 3 · Historical ───────────────────────────────────────────────

  const histCols = HISTORICAL.filter(h => fullRows.some(r => r[h.col] != null && r[h.col] !== ''));
  if (histCols.length > 0) {
    const wh = wb.addWorksheet('Historical', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
    const hTitle = wh.getCell('A1');
    hTitle.value = 'Fields the form no longer asks — shown for the complaints that answered them';
    hTitle.font = { size: 11, bold: true, color: { argb: NAVY } };
    const hHead = ['Complaint no.', 'Client', ...histCols.map(h => h.label)];
    const hWidth = [14, 30, ...histCols.map(h => h.width)];
    hHead.forEach((h, i) => headerCell(wh, 2, i + 1, h, hWidth[i]));
    wh.getRow(2).height = 30;
    wh.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: hHead.length } };

    let hr = 3;
    for (const r of rows) {
      const f = full.get(r.id);
      if (!f || !histCols.some(h => f[h.col] != null && f[h.col] !== '')) continue;
      const row = wh.getRow(hr++);
      writeCell(row.getCell(1), r.complaint_no);
      writeCell(row.getCell(2), r.client_name);
      histCols.forEach((h, i) => {
        const v = f[h.col];
        const cell = v == null || v === '' ? null
          : h.kind === 'date' ? dateOf(v)
            : h.kind === 'money' ? num(v)
              : h.kind === 'bool' ? yesNo(v)
                : h.kind === 'user' ? ctx.names.get(Number(v)) ?? String(v)
                  : String(v);
        writeCell(row.getCell(3 + i), cell);
      });
    }
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="complaints-${stamp}.xlsx"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
