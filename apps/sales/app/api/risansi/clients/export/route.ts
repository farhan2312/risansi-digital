import { NextResponse } from 'next/server';
import { probabilityPctSql } from '@/lib/risansi-probability-codes';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { OWNERS_SUBQUERY, REV_JOIN, buildClientFilter } from '@/lib/risansi-client-filter';
import { clientPrimaryRepSql, clientSecondaryNamesSql, clientManagerNamesSql } from '@/lib/risansi-client-rep';
import { resolveExportColumns, resolveOppColumns, XLSX_CELL_LIMIT } from '@/lib/risansi-client-export-columns';
import { getCurrentFY } from '@/lib/risansi-utils';
import { clientStatusLabel } from '@/lib/risansi-client-status';

// xlsx generation needs the Node runtime.
export const runtime = 'nodejs';

interface Row {
  code: string; legal_name: string; trade_name: string | null; group_name: string | null;
  industry: string | null; client_type: string | null; tier: string | null; status: string | null;
  market_type: string | null; is_sugar: boolean | null; is_tender: boolean | null; is_end_client: boolean | null;
  capacity_bracket: string | null; tcd: number | null; klpd: number | null; since_year: string | null;
  country: string | null; zone: string | null; state: string | null; city: string | null;
  address: string | null; google_maps_url: string | null;
  tour_name: string | null; reps: string | null;
  primary_rep: string | null; secondary_reps: string | null; managers: string | null;
  lifetime_rev: number; fy_rev: number; total_outstanding: number; outstanding_as_of: string | null;
  open_pipeline_inr: number; open_opps: number;
  last_visit_date: string | null; days_since_last_visit: number | null;
  total_visits: number; contacts_count: number;
  comments_count: number; last_comment_at: string | null;
  last_comment_by: string | null; last_comment: string | null;
  comments_all: string | null;
  created_by: string | null; created_at: string | null; updated_by: string | null; updated_at: string | null;
}

const yn = (v: boolean | null) => (v ? 'Yes' : 'No');

/** Excel rejects a cell over 32,767 characters and the whole file fails to open,
 *  so a long comment thread loses its tail rather than the workbook. */
const clip = (v: string | null): string => {
  const t = v ?? '';
  return t.length <= XLSX_CELL_LIMIT ? t : `${t.slice(0, XLSX_CELL_LIMIT)}
… truncated`;
};

// GET /api/risansi/clients/export?<same filter params as the list page>
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const { whereClause, params } = buildClientFilter(sp, user);

  const fy = getCurrentFY();
  const FY_START = fy.startDate;                                    // e.g. 2026-04-01
  const FY_END   = `${Number(FY_START.slice(0, 4)) + 1}-04-01`;     // 2027-04-01
  const fyStartIdx = params.length + 1;
  const fyEndIdx   = params.length + 2;
  const queryParams = [...params, FY_START, FY_END];

  let rows: Row[] = [];
  try {
    const res = await risansiPool.query<Row>(
      `SELECT
         c.code, c.legal_name, c.trade_name, c.group_name,
         c.industry, c.client_type, c.tier, c.status, c.market_type,
         c.is_sugar, c.is_tender, c.is_end_client,
         c.capacity_bracket, c.tcd, c.klpd, c.since_year,
         c.country, tr.zone AS zone, c.state, c.city, c.address, c.google_maps_url,
         tr.name AS tour_name,
         COALESCE(${OWNERS_SUBQUERY}, '') AS reps,
         -- The owner alone, and the cover alone. The reps column above joins them
         -- into one string, which cannot answer "whose account is this" — the
         -- question the other systems consuming this file actually ask.
         (SELECT u.name FROM users u WHERE u.id = ${clientPrimaryRepSql('c.id')}) AS primary_rep,
         ${clientSecondaryNamesSql('c.id')} AS secondary_reps,
         ${clientManagerNamesSql('c.id')} AS managers,
         COALESCE(rev.lifetime_rev, 0)::float8 AS lifetime_rev,
         (SELECT COALESCE(SUM(m.total_value), 0) FROM client_revenue_monthly m
            WHERE m.client_id = c.id AND m.month >= $${fyStartIdx} AND m.month < $${fyEndIdx})::float8 AS fy_rev,
         COALESCE(c.total_outstanding, 0)::float8 AS total_outstanding,
         c.outstanding_as_of::text AS outstanding_as_of,
         ((SELECT COALESCE(SUM(o.value_cr), 0) FROM opportunities o
            WHERE o.client_id = c.id AND o.stage NOT IN ('Won','Lost')) * 10000000)::float8 AS open_pipeline_inr,
         (SELECT COUNT(*) FROM opportunities o WHERE o.client_id = c.id AND o.stage NOT IN ('Won','Lost'))::int AS open_opps,
         c.last_visit_date::text AS last_visit_date,
         (CURRENT_DATE - c.last_visit_date) AS days_since_last_visit,
         (SELECT COUNT(*) FROM visits v WHERE v.client_id = c.id)::int AS total_visits,
         (SELECT COUNT(*) FROM contacts ct WHERE ct.client_id = c.id)::int AS contacts_count,
         -- The Comments box from Client 360. Four scalar subqueries rather than a
         -- join: joining a client to its comments multiplies the row, and this
         -- sheet is one row per client.
         (SELECT COUNT(*) FROM client_comments cm WHERE cm.client_id = c.id)::int AS comments_count,
         (SELECT cm.created_at::date::text FROM client_comments cm WHERE cm.client_id = c.id
           ORDER BY cm.created_at DESC, cm.id DESC LIMIT 1) AS last_comment_at,
         (SELECT COALESCE(NULLIF(cm.author_name,''), cm.author_email) FROM client_comments cm
           WHERE cm.client_id = c.id ORDER BY cm.created_at DESC, cm.id DESC LIMIT 1) AS last_comment_by,
         (SELECT cm.body FROM client_comments cm WHERE cm.client_id = c.id
           ORDER BY cm.created_at DESC, cm.id DESC LIMIT 1) AS last_comment,
         -- Newest first, each stamped with when and by whom, so the cell reads
         -- the same way the Comments box does.
         (SELECT string_agg(
                   cm.created_at::date::text || '  ' ||
                   COALESCE(NULLIF(cm.author_name,''), cm.author_email) || ': ' || cm.body,
                   E'

' ORDER BY cm.created_at DESC, cm.id DESC)
            FROM client_comments cm WHERE cm.client_id = c.id) AS comments_all,
         c.created_by, c.created_at::text AS created_at,
         c.updated_by, c.updated_at::text AS updated_at
       FROM clients c
       LEFT JOIN tour_routes tr ON tr.id = c.tour_id
       ${REV_JOIN}
       WHERE ${whereClause}
       ORDER BY c.legal_name ASC NULLS LAST`,
      queryParams as (string | number)[],
    );
    rows = res.rows;
  } catch (err) {
    console.error('[clients/export] query failed:', err);
    return new NextResponse('Export failed', { status: 500 });
  }

  // Value per column key. Order, labels and widths live in
  // lib/risansi-client-export-columns.ts, which the picker reads too — so a
  // ticked column can never come out holding a different column's values.
  const VALUE: Record<string, (r: Row) => string | number> = {
    code:              r => r.code,
    legal_name:        r => r.legal_name,
    trade_name:        r => r.trade_name ?? '',
    group_name:        r => r.group_name ?? '',
    industry:          r => r.industry ?? '',
    client_type:       r => r.client_type ?? '',
    tier:              r => r.tier ?? '',
    status:            r => (r.status ? clientStatusLabel(r.status) : ''),
    market_type:       r => r.market_type ?? '',
    is_sugar:          r => yn(r.is_sugar),
    is_tender:         r => yn(r.is_tender),
    is_end_client:     r => yn(r.is_end_client),
    capacity_bracket:  r => r.capacity_bracket ?? '',
    tcd:               r => r.tcd ?? '',
    klpd:              r => r.klpd ?? '',
    since_year:        r => r.since_year ?? '',
    country:           r => r.country ?? '',
    zone:              r => r.zone ?? '',
    state:             r => r.state ?? '',
    city:              r => r.city ?? '',
    address:           r => r.address ?? '',
    google_maps_url:   r => r.google_maps_url ?? '',
    tour_name:         r => r.tour_name ?? '',
    primary_rep:       r => r.primary_rep ?? '',
    secondary_reps:    r => r.secondary_reps ?? '',
    reps:              r => r.reps ?? '',
    managers:          r => r.managers ?? '',
    lifetime_rev:      r => Math.round(r.lifetime_rev),
    fy_rev:            r => Math.round(r.fy_rev),
    total_outstanding: r => Math.round(r.total_outstanding),
    outstanding_as_of: r => r.outstanding_as_of ?? '',
    open_pipeline_inr: r => Math.round(r.open_pipeline_inr),
    open_opps:         r => r.open_opps,
    last_visit_date:   r => r.last_visit_date ?? '',
    days_since:        r => r.days_since_last_visit ?? '',
    total_visits:      r => r.total_visits,
    contacts_count:    r => r.contacts_count,
    comments_count:    r => r.comments_count,
    last_comment_at:   r => r.last_comment_at ?? '',
    last_comment_by:   r => r.last_comment_by ?? '',
    last_comment:      r => clip(r.last_comment),
    comments_all:      r => clip(r.comments_all),
    created_by:        r => r.created_by ?? '',
    created_at:        r => (r.created_at ? r.created_at.slice(0, 10) : ''),
    updated_by:        r => r.updated_by ?? '',
    updated_at:        r => (r.updated_at ? r.updated_at.slice(0, 10) : ''),
  };

  const MONEY = '#,##0';
  const COLS = resolveExportColumns(new URL(req.url).searchParams.get('cols'))
    .map(c => ({ h: c.label, w: c.width, f: VALUE[c.key], fmt: c.money ? MONEY : undefined }))
    // A key in the catalogue with no accessor here would write undefined into
    // every row. Drop it rather than ship a column of blanks.
    .filter(c => typeof c.f === 'function');

  const stamp = new Date().toISOString().slice(0, 10);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Clients', { views: [{ state: 'frozen', ySplit: 3 }] });
  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });

  // Logo top-left (over A1:B2, aspect-preserved from 267×95).
  try {
    const logoId = wb.addImage({ filename: join(process.cwd(), 'public', 'logo.png'), extension: 'png' });
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 47 } });
  } catch { /* logo missing — export still works */ }
  ws.getRow(1).height = 26;
  ws.getRow(2).height = 16;

  // Title band (to the right of the logo).
  const title = ws.getCell('C1');
  title.value = 'Client 360 — Clients Export';
  title.font = { size: 14, bold: true, color: { argb: 'FF0A3D8F' } };
  const sub = ws.getCell('C2');
  sub.value = `${rows.length.toLocaleString('en-IN')} client${rows.length === 1 ? '' : 's'} · ${stamp}`;
  sub.font = { size: 10, color: { argb: 'FF64748B' } };

  // Header row (3) — navy band, white bold.
  const header = ws.getRow(3);
  COLS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A3D8F' } };
    cell.alignment = { vertical: 'middle', wrapText: false };
  });
  header.height = 18;

  // Data rows (from 4).
  const WRAPPED = new Set(['Latest Comment', 'All Comments']);
  rows.forEach((r, ri) => {
    const row = ws.getRow(4 + ri);
    COLS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = c.f(r);
      if (c.fmt) cell.numFmt = c.fmt;
      // Comment bodies carry newlines. Without wrapText Excel shows the first
      // line and silently hides the rest, which reads as data loss.
      if (WRAPPED.has(c.h)) cell.alignment = { wrapText: true, vertical: 'top' };
    });
  });

  // ── Sheet 2: Opportunities ──────────────────────────────────────
  //
  // One row per opportunity, for the same clients the first sheet holds. A
  // different grain, so it cannot be columns on the client row: a client with
  // nine opportunities is not a row. Included unless ?opps=0 — "also add
  // opportunity level data" means it should be there by default.
  if (new URL(req.url).searchParams.get('opps') !== '0') {
    const OPP_COLS = resolveOppColumns(new URL(req.url).searchParams.get('oppcols'));
    interface OppRow {
      client_code: string; client_name: string; primary_rep: string | null;
      opp_id: number; stage: string; opp_type: string | null; opp_source: string | null;
      opp_category: string | null; product_type: string | null; unit_project: string | null;
      enquiry_no: string | null; enquiry_date: string | null;
      quote_ref: string | null; quote_date: string | null; market: string | null;
      offer_value: number; probability: number | null; eta_text: string | null; docs: number;
      final_value: number; so_value: number; order_in_hand: number;
      po_number: string | null; po_date: string | null; po_received_date: string | null;
      lost_to: string | null; lost_reason: string | null; drop_reason: string | null; drop_reason_other: string | null;
      created_on: string | null;
    }

    let oppRows: OppRow[] = [];
    try {
      // Same client predicate as sheet one, so the two sheets can never describe
      // different sets of clients. The filter's own params are reused as-is.
      const res = await risansiPool.query<OppRow>(
        `SELECT c.code AS client_code, c.legal_name AS client_name,
                (SELECT u.name FROM users u WHERE u.id = ${clientPrimaryRepSql('c.id')}) AS primary_rep,
                o.id AS opp_id, o.stage,
                o.opportunity_type AS opp_type, o.opportunity_source AS opp_source,
                o.opportunity_category AS opp_category, o.product_type, o.unit_project,
                o.enquiry_no, o.enquiry_date::text AS enquiry_date,
                o.quote_ref, o.quote_date::text AS quote_date, o.market,
                COALESCE(o.offer_value_inr, o.value_cr * 10000000, 0)::float8 AS offer_value,
                ${probabilityPctSql('o')} AS probability, o.eta_text,
                (SELECT count(*) FROM opportunity_quotation_files f WHERE f.opportunity_id = o.id)::int AS docs,
                COALESCE(o.final_value_cr * 10000000, 0)::float8 AS final_value,
                COALESCE((SELECT sum(so.so_value_cr) * 10000000
                            FROM opportunity_sales_orders so WHERE so.opportunity_id = o.id), 0)::float8 AS so_value,
                GREATEST(COALESCE(o.final_value_cr * 10000000, o.value_cr * 10000000, 0)
                  - COALESCE((SELECT sum(so.so_value_cr) * 10000000
                                FROM opportunity_sales_orders so WHERE so.opportunity_id = o.id), 0), 0)::float8 AS order_in_hand,
                o.po_number, o.po_date::text AS po_date, o.po_received_date::text AS po_received_date,
                o.lost_to_competitor AS lost_to, o.lost_reason, o.drop_reason, o.drop_reason_other,
                o.created_at::date::text AS created_on
           FROM opportunities o
           JOIN clients c ON c.id = o.client_id
           ${REV_JOIN}
          WHERE ${whereClause}
          ORDER BY c.code, o.id`,
        params as (string | number)[],
      );
      oppRows = res.rows;
    } catch (e) {
      // A failure here must not cost the user the client sheet they asked for.
      console.error('[clients export] opportunities sheet failed', e);
    }

    const OPP_VALUE: Record<string, (r: OppRow) => string | number> = {
      client_code:   r => r.client_code,
      client_name:   r => r.client_name,
      primary_rep:   r => r.primary_rep ?? '',
      opp_id:        r => r.opp_id,
      stage:         r => r.stage,
      opp_type:      r => r.opp_type ?? '',
      opp_source:    r => r.opp_source ?? '',
      opp_category:  r => r.opp_category ?? '',
      product_type:  r => r.product_type ?? '',
      unit_project:  r => r.unit_project ?? '',
      enquiry_no:    r => r.enquiry_no ?? '',
      enquiry_date:  r => r.enquiry_date ?? '',
      quote_ref:     r => r.quote_ref ?? '',
      quote_date:    r => r.quote_date ?? '',
      market:        r => r.market ?? '',
      offer_value:   r => Math.round(r.offer_value),
      probability:   r => r.probability ?? '',
      eta_text:      r => r.eta_text ?? '',
      docs:          r => r.docs,
      final_value:   r => Math.round(r.final_value),
      so_value:      r => Math.round(r.so_value),
      order_in_hand: r => (r.stage === 'Won' ? Math.round(r.order_in_hand) : ''),
      po_number:     r => r.po_number ?? '',
      po_date:       r => r.po_date ?? '',
      po_received_date: r => r.po_received_date ?? '',
      lost_to:       r => r.lost_to ?? '',
      lost_reason:   r => r.lost_reason ?? '',
      drop_reason:   r => r.drop_reason ?? '',
      drop_reason_other: r => r.drop_reason_other ?? '',
      created_on:    r => r.created_on ?? '',
    };

    const OC = OPP_COLS
      .map(c => ({ h: c.label, w: c.width, f: OPP_VALUE[c.key], fmt: c.money ? MONEY : undefined }))
      .filter(c => typeof c.f === 'function');

    const ows = wb.addWorksheet('Opportunities', { views: [{ state: 'frozen', ySplit: 3 }] });
    OC.forEach((c, i) => { ows.getColumn(i + 1).width = c.w; });
    ows.getRow(1).height = 26;
    ows.getRow(2).height = 16;
    const otitle = ows.getCell('A1');
    otitle.value = 'Client 360 — Opportunities';
    otitle.font = { size: 14, bold: true, color: { argb: 'FF0A3D8F' } };
    const osub = ows.getCell('A2');
    osub.value = `${oppRows.length.toLocaleString('en-IN')} opportunit${oppRows.length === 1 ? 'y' : 'ies'} across the same clients · ${stamp}`;
    osub.font = { size: 10, color: { argb: 'FF64748B' } };

    const oheader = ows.getRow(3);
    OC.forEach((c, i) => {
      const cell = oheader.getCell(i + 1);
      cell.value = c.h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A3D8F' } };
      cell.alignment = { vertical: 'middle', wrapText: false };
    });
    oheader.height = 18;

    oppRows.forEach((r, ri) => {
      const row = ows.getRow(4 + ri);
      OC.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.value = c.f(r);
        if (c.fmt) cell.numFmt = c.fmt;
      });
    });
  }

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="clients-export-${stamp}.xlsx"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
