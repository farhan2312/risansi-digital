import { NextResponse } from 'next/server';
import { join } from 'path';
import ExcelJS from 'exceljs';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, canViewClient } from '@/lib/risansi-auth';
import { appLink, absoluteLink } from '@/lib/risansi-app-url';
import { parseQuotationLink, quotationRecordLabel } from '@/lib/risansi-quotation-link';

// The quotation as label/value rows: the document the portal holds first, then
// every legacy address on its own row, then any document name that came with
// them. A name-only record still gets a row, because there is no address to give
// and a blank cell would lose the fact that a quotation was issued at all.
//
// docCount decides which is primary. syncQuotationLink never overwrites a legacy
// url, so an opportunity can hold PDFs and still store the SharePoint link it had
// before them; reading the link alone would send the reader to OneDrive past a
// document that is right here.
function quotationLinkRows(
  stored: string | null | undefined, oppId: number | string, docCount: number,
): [string, string][] {
  const q = parseQuotationLink(stored);
  const rows: [string, string][] = [];

  if (docCount > 0) rows.push(['Quotation Link', appLink(`/api/risansi/opportunities/${oppId}/quotation`)]);
  else if (q.kind === 'upload') rows.push(['Quotation Link', absoluteLink(q.appPath!)]);

  if (q.kind === 'legacy-link') {
    const label = docCount > 0 || q.urls.length > 1 ? 'Legacy Quotation Link' : 'Quotation Link';
    q.urls.forEach((u, i) => rows.push([
      q.urls.length > 1 ? `${label} ${i + 1}` : label, u,
    ]));
  }
  if (q.label && (q.kind === 'legacy-link' || q.kind === 'legacy-name')) {
    rows.push(['Quotation Document', q.kind === 'legacy-name' ? `${q.label} (no file)` : q.label]);
  }
  return rows;
}

export const runtime = 'nodejs';

// Everything the portal holds about ONE opportunity, as a workbook.
//
// One sheet per kind of record, because they have nothing in common column-wise:
// a quote line item and a stage-change entry share no fields, and stacking them
// on one sheet would mean a page of mostly-empty cells. The Summary sheet is
// label/value pairs rather than a header row, since a single record read across
// 49 columns is unreadable.
//
// Sister of the bulk export at /api/risansi/opportunities/export, and it follows
// the same conventions: logo, navy header band, rupees from crores, absolute
// links, XLSX attachment.

const CR = 10_000_000;
const NAVY = 'FF0A3D8F';
const GREY = 'FF64748B';

const rupees = (cr: unknown) => (cr != null && cr !== '' ? Math.round(Number(cr) * CR) : '');
const day    = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '');
const txt    = (v: unknown) => (v == null ? '' : String(v));

type Row = Record<string, unknown>;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const oppId = parseInt(id, 10);
  if (!Number.isInteger(oppId)) return new NextResponse('Bad id', { status: 400 });

  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  const q = async (sql: string, vals: unknown[] = []): Promise<Row[]> =>
    (await risansiPool.query(sql, vals as never[])).rows as Row[];

  const opp = (await q(
    `SELECT o.*,
            -- o.* hands back a date column as a JS Date, and in IST that is
            -- the previous day in UTC — so every date on this sheet came out
            -- blank. Re-selected as text after the star, which wins.
            o.quote_date::text AS quote_date, o.enquiry_date::text AS enquiry_date,
            o.revised_offer_date::text AS revised_offer_date,
            o.po_date::text AS po_date, o.po_received_date::text AS po_received_date,
            o.created_at::date::text AS created_at, o.updated_at::date::text AS updated_at,
            c.code AS client_code, c.legal_name, c.trade_name, c.group_name,
            c.client_type, c.industry, c.is_sugar, c.tcd, c.klpd, c.status AS client_status,
            c.tier, c.city AS client_city, c.state AS client_state, c.country AS client_country,
            c.zone, c.address, c.market_type, c.is_tender, c.since_year,
            c.total_outstanding, c.last_visit_date::text AS last_visit_date,
            tr.name AS tour_name,
            COALESCE(rep.name, 'Unassigned') AS rep_name, rep.email AS rep_email,
            tsm.name AS tsm_name
       FROM opportunities o
       JOIN clients c        ON c.id = o.client_id
       LEFT JOIN tour_routes tr ON tr.id = c.tour_id
       -- The rep on the sheet is the client's owner, the same name the board
       -- and every figure now carry (lib/risansi-attribution.ts). It was
       -- o.rep_id, so an exported quotation could name a different person
       -- from the pipeline row it was exported from.
       LEFT JOIN users rep   ON rep.id = COALESCE(o.credited_rep_id, c.primary_rep_id)
       LEFT JOIN users tsm   ON tsm.id = o.tsm_user_id
      WHERE o.id = $1`, [oppId]))[0];

  if (!opp) return new NextResponse('Opportunity not found', { status: 404 });
  // Same gate as viewing the opportunity: an export must never widen access.
  if (!(await canViewClient(user, Number(opp.client_id)))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const [items, revisions, salesOrders, docs, stages, ordersRows, contacts] = await Promise.all([
    q(`SELECT sort_order, pump_model, pump_qty, pump_speed, geared_motor_detail,
              motor_price, gearbox_vbelt_price, offer_value_inr,
              detailed_specifications
         FROM opportunity_items WHERE opportunity_id = $1
        ORDER BY sort_order NULLS LAST, id`, [oppId]),
    q(`SELECT revised_on::text AS revised_on, value_inr, note, created_by,
              created_at::text AS created_at
         FROM opportunity_offer_revisions WHERE opportunity_id = $1
        ORDER BY revised_on, id`, [oppId]),
    q(`SELECT so_number, so_date::text AS so_date, so_value_cr, created_by,
              created_at::text AS created_at
         FROM opportunity_sales_orders WHERE opportunity_id = $1
        ORDER BY so_date NULLS LAST, id`, [oppId]),
    q(`SELECT id, file_name, mime, size, uploaded_at::text AS uploaded_at, uploaded_by_name
         FROM opportunity_quotation_files WHERE opportunity_id = $1
        ORDER BY uploaded_at, id`, [oppId]),
    q(`SELECT from_stage, to_stage, notes, changed_by, changed_at::text AS changed_at
         FROM opportunity_stage_log WHERE opportunity_id = $1
        ORDER BY changed_at, id`, [oppId]),
    q(`SELECT po_number, order_date::text AS order_date, invoice_date::text AS invoice_date,
              financial_year, product_category, product_desc, order_value_cr,
              is_confirmed, notes, entered_by
         FROM orders WHERE opportunity_id = $1 ORDER BY order_date NULLS LAST, id`, [oppId]),
    q(`SELECT name, designation, is_primary, phone, email, whatsapp, notes
         FROM contacts WHERE client_id = $1
        ORDER BY is_primary DESC NULLS LAST, name`, [opp.client_id]),
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Risansi Sales Portal';

  // ── Sheet 1 · Summary (label/value, grouped) ──────────────────

  const sum = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 4 }] });
  sum.getColumn(1).width = 30;
  sum.getColumn(2).width = 62;
  sum.getColumn(3).width = 30;
  sum.getColumn(4).width = 46;

  try {
    const logoId = wb.addImage({ filename: join(process.cwd(), 'public', 'logo.png'), extension: 'png' });
    sum.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 47 } });
  } catch { /* logo missing — export still works */ }
  sum.getRow(1).height = 26;
  sum.getRow(2).height = 16;

  const title = sum.getCell('C1');
  title.value = `Opportunity — ${txt(opp.quote_ref) || `#${oppId}`}`;
  title.font = { size: 14, bold: true, color: { argb: NAVY } };
  const sub = sum.getCell('C2');
  sub.value = `${txt(opp.legal_name)} · ${txt(opp.stage)} · exported ${stamp}`;
  sub.font = { size: 10, color: { argb: GREY } };

  let r = 4;
  const section = (label: string) => {
    const row = sum.getRow(r++);
    row.getCell(1).value = label;
    for (let ci = 1; ci <= 4; ci++) {
      const cell = row.getCell(ci);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    }
    row.height = 18;
  };
  // Two label/value pairs per row keeps the sheet compact without hiding anything.
  const pairs = (entries: [string, unknown][]) => {
    const live = entries.filter(([, v]) => v !== undefined);
    for (let i = 0; i < live.length; i += 2) {
      const row = sum.getRow(r++);
      const put = (col: number, e?: [string, unknown]) => {
        if (!e) return;
        const k = row.getCell(col);
        k.value = e[0];
        k.font = { bold: true, size: 10, color: { argb: GREY } };
        const v = row.getCell(col + 1);
        v.value = (e[1] ?? '') as string | number;
        v.alignment = { wrapText: true, vertical: 'top' };
      };
      put(1, live[i]); put(3, live[i + 1]);
    }
    r++;   // breathing room before the next section
  };

  section('Opportunity');
  pairs([
    ['Opportunity ID', oppId],
    ['Stage', txt(opp.stage)],
    ['Product', txt(opp.product)],
    ['Product Category', txt(opp.product_type)],
    ['Project Name / Unit', txt(opp.unit_project)],
    ['Location', txt(opp.location)],
    ['Value (₹)', rupees(opp.value_cr)],
    ['Probability', opp.probability ?? ''],
    ['Probability Code', txt(opp.probability_code)],
    ['ETA', txt(opp.eta_text)],
    ['Quarter', txt(opp.qtr)],
    ['Market', txt(opp.market)],
    ['Auto-created', opp.auto_created ? `Yes — ${txt(opp.auto_source)}` : 'No'],
  ]);

  section('Quotation');
  pairs([
    ['Quote No.', txt(opp.quote_ref)],
    ['Quote Date', day(opp.quote_date)],
    ['Enquiry No.', txt(opp.enquiry_no)],
    ['Enquiry Date', day(opp.enquiry_date)],
    ['Offer Value (₹)', opp.offer_value_inr ?? ''],
    ['Revised Offer (₹)', opp.revised_offer_value_inr ?? ''],
    ['Revised Offer Date', day(opp.revised_offer_date)],
    ['Quotation Prepared By', txt(opp.qtn_prepared_by)],
    ['Client Status at Quote', txt(opp.client_status_at_quote)],
    ['Pump Model', txt(opp.pump_model)],
    ['Pump Qty', opp.pump_qty ?? ''],
    ['Documents Attached', docs.length],
    ['Quotation Record', quotationRecordLabel(txt(opp.quotation_link), { docCount: docs.length })],
    // One row per url. This sheet is the full account of a single opportunity,
    // so a second SharePoint link is listed rather than folded into the first —
    // 39 opportunities carry one, and until now none of them showed it anywhere.
    ...quotationLinkRows(txt(opp.quotation_link), oppId, docs.length),
  ]);

  section('Outcome');
  pairs([
    ['Final Value (₹)', rupees(opp.final_value_cr)],
    ['PO Number', txt(opp.po_number)],
    ['PO Date', day(opp.po_date)],
    ['PO Received Date', day(opp.po_received_date)],
    ['Sales Orders', salesOrders.length],
    ['Orders (Order in Hand)', ordersRows.length],
    ['Lost To Competitor', txt(opp.lost_to_competitor)],
    ['Lost Reason', txt(opp.lost_reason)],
    ['Drop Reason', txt(opp.drop_reason)],
    ['Drop Reason (Other)', txt(opp.drop_reason_other)],
    ['Negotiation Notes', txt(opp.negotiation_notes)],
    ['Notes', txt(opp.notes)],
  ]);

  section('Ownership');
  pairs([
    ['Rep', txt(opp.rep_name)],
    ['Rep Email', txt(opp.rep_email)],
    ['RIL Rep', txt(opp.ril_rep)],
    ['TSM', txt(opp.tsm_name) || txt(opp.tsm_external)],
    ['TSM Email', txt(opp.tsm_external_email)],
    ['Created By', txt(opp.created_by)],
    ['Created On', day(opp.created_at)],
    ['Last Updated', day(opp.updated_at)],
    ['Opportunity Page', appLink('/risansi/pipeline')],
  ]);

  section('Client');
  pairs([
    ['Client Code', txt(opp.client_code)],
    ['Legal Name', txt(opp.legal_name)],
    ['Trade Name', txt(opp.trade_name)],
    ['Group', txt(opp.group_name)],
    ['Client Type', txt(opp.client_type)],
    ['Industry', txt(opp.industry)],
    ['Sugar Client', opp.is_sugar ? 'Yes' : 'No'],
    ['TCD', opp.tcd ?? ''],
    ['KLPD', opp.klpd ?? ''],
    ['Client Status', txt(opp.client_status)],
    ['Tier', txt(opp.tier)],
    ['Tender Client', opp.is_tender ? 'Yes' : 'No'],
    ['Market Type', txt(opp.market_type)],
    ['Customer Since', txt(opp.since_year)],
    ['Tour', txt(opp.tour_name)],
    ['Zone', txt(opp.zone)],
    ['City', txt(opp.client_city)],
    ['State', txt(opp.client_state)],
    ['Country', txt(opp.client_country)],
    ['Address', txt(opp.address)],
    ['Total Outstanding (₹)', opp.total_outstanding ?? ''],
    ['Last Visit', day(opp.last_visit_date)],
    ['Client 360', appLink(`/risansi/clients/${opp.client_id}`)],
  ]);

  // ── Table sheets ──────────────────────────────────────────────

  interface Col { h: string; w: number; f: (x: Row) => string | number | { text: string; hyperlink: string }; fmt?: string }

  const sheet = (name: string, cols: Col[], rows: Row[], emptyNote: string) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 2 }] });
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });

    const head = ws.getRow(1);
    head.getCell(1).value = `${name} — ${txt(opp.quote_ref) || `#${oppId}`} · ${txt(opp.legal_name)}`;
    head.getCell(1).font = { size: 11, bold: true, color: { argb: NAVY } };
    head.height = 18;

    const hdr = ws.getRow(2);
    cols.forEach((c, i) => {
      const cell = hdr.getCell(i + 1);
      cell.value = c.h;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    hdr.height = 18;

    if (!rows.length) {
      const cell = ws.getRow(3).getCell(1);
      cell.value = emptyNote;
      cell.font = { italic: true, color: { argb: GREY }, size: 10 };
      return;
    }
    rows.forEach((x, ri) => {
      const row = ws.getRow(3 + ri);
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        const v = c.f(x);
        cell.value = v as string | number;
        if (v && typeof v === 'object' && 'hyperlink' in v) {
          cell.font = { color: { argb: 'FF1A5CB8' }, underline: true };
        }
        if (c.fmt) cell.numFmt = c.fmt;
        cell.alignment = { vertical: 'top', wrapText: true };
      });
    });
  };

  sheet('Quote Line Items', [
    { h: '#', w: 6,  f: x => (x.sort_order as number) ?? '' },
    { h: 'Pump Model', w: 26, f: x => txt(x.pump_model) },
    { h: 'Qty', w: 7, f: x => (x.pump_qty as number) ?? '' },
    { h: 'Speed', w: 12, f: x => txt(x.pump_speed) },
    { h: 'Geared Motor Detail', w: 30, f: x => txt(x.geared_motor_detail) },
    { h: 'Motor Price (₹)', w: 16, f: x => (x.motor_price as number) ?? '', fmt: '#,##0' },
    { h: 'Gearbox / V-belt (₹)', w: 18, f: x => (x.gearbox_vbelt_price as number) ?? '', fmt: '#,##0' },
    { h: 'Offer Value (₹)', w: 16, f: x => (x.offer_value_inr as number) ?? '', fmt: '#,##0' },
    { h: 'Detailed Specifications', w: 60, f: x => txt(x.detailed_specifications) },
  ], items, 'No line items were captured on this quotation.');

  sheet('Offer Revisions', [
    { h: 'Revised On', w: 14, f: x => day(x.revised_on) },
    { h: 'Value (₹)', w: 18, f: x => (x.value_inr as number) ?? '', fmt: '#,##0' },
    { h: 'Note', w: 60, f: x => txt(x.note) },
    { h: 'Recorded By', w: 24, f: x => txt(x.created_by) },
    { h: 'Recorded On', w: 14, f: x => day(x.created_at) },
  ], revisions, 'The offer was never revised.');

  sheet('Sales Orders', [
    { h: 'SO Number', w: 22, f: x => txt(x.so_number) },
    { h: 'SO Date', w: 14, f: x => day(x.so_date) },
    { h: 'SO Value (₹)', w: 18, f: x => rupees(x.so_value_cr), fmt: '#,##0' },
    { h: 'Entered By', w: 24, f: x => txt(x.created_by) },
    { h: 'Entered On', w: 14, f: x => day(x.created_at) },
  ], salesOrders, 'No sales orders are linked to this opportunity.');

  sheet('Orders', [
    { h: 'PO Number', w: 22, f: x => txt(x.po_number) },
    { h: 'Order Date', w: 14, f: x => day(x.order_date) },
    { h: 'Invoice Date', w: 14, f: x => day(x.invoice_date) },
    { h: 'FY', w: 10, f: x => txt(x.financial_year) },
    { h: 'Category', w: 18, f: x => txt(x.product_category) },
    { h: 'Description', w: 40, f: x => txt(x.product_desc) },
    { h: 'Value (₹)', w: 18, f: x => rupees(x.order_value_cr), fmt: '#,##0' },
    { h: 'Confirmed', w: 12, f: x => (x.is_confirmed ? 'Yes' : 'No') },
    { h: 'Notes', w: 40, f: x => txt(x.notes) },
    { h: 'Entered By', w: 22, f: x => txt(x.entered_by) },
  ], ordersRows, 'No order-in-hand rows are linked to this opportunity.');

  sheet('Documents', [
    { h: 'File', w: 52, f: x => txt(x.file_name) },
    { h: 'Size (KB)', w: 12, f: x => (x.size ? Math.max(1, Math.round(Number(x.size) / 1024)) : ''), fmt: '#,##0' },
    { h: 'Uploaded', w: 14, f: x => day(x.uploaded_at) },
    { h: 'Uploaded By', w: 24, f: x => txt(x.uploaded_by_name) },
    // Clickable and absolute, so the document opens straight from the sheet.
    { h: 'Link', w: 60, f: x => {
      const url = appLink(`/api/risansi/opportunities/${oppId}/quotation/${x.id}`);
      return { text: url, hyperlink: url };
    } },
  // A flat "nothing attached" contradicts the Summary sheet whenever the
  // Quotation Link three rows up is populated, which it is on 689 opportunities.
  // Say which of the two situations this is.
  ], docs, (() => {
    const q = parseQuotationLink(txt(opp.quotation_link));
    if (q.kind === 'legacy-link') {
      return `No documents are held in the portal. This quotation is recorded as ${
        q.urls.length > 1 ? `${q.urls.length} legacy links` : 'a legacy link'
      } — see Quotation Link on the Summary sheet.`;
    }
    if (q.kind === 'legacy-name') {
      return `No documents are held in the portal. A quotation is on record as “${q.label}”, with no file and no address.`;
    }
    return 'No quotation documents are attached.';
  })());

  sheet('Stage History', [
    { h: 'When', w: 20, f: x => txt(x.changed_at).slice(0, 16).replace('T', ' ') },
    { h: 'From', w: 16, f: x => txt(x.from_stage) },
    { h: 'To', w: 16, f: x => txt(x.to_stage) },
    { h: 'By', w: 24, f: x => txt(x.changed_by) },
    { h: 'Notes', w: 60, f: x => txt(x.notes) },
  ], stages, 'No stage changes were logged. (Stage logging began mid-2026, so older opportunities have no history.)');

  sheet('Client Contacts', [
    { h: 'Name', w: 26, f: x => txt(x.name) },
    { h: 'Designation', w: 26, f: x => txt(x.designation) },
    { h: 'Primary', w: 10, f: x => (x.is_primary ? 'Yes' : '') },
    { h: 'Phone', w: 18, f: x => txt(x.phone) },
    { h: 'WhatsApp', w: 18, f: x => txt(x.whatsapp) },
    { h: 'Email', w: 30, f: x => txt(x.email) },
    { h: 'Notes', w: 40, f: x => txt(x.notes) },
  ], contacts, 'No contacts are on file for this client.');

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const slug = (txt(opp.quote_ref) || `opportunity-${oppId}`).replace(/[^\w.\-]/g, '_').slice(0, 60);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${slug}-${stamp}.xlsx"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
