import { NextResponse } from 'next/server';
import { join } from 'path';
import ExcelJS from 'exceljs';
import { getCurrentUser } from '@/lib/risansi-auth';
import { parseOppFilters } from '@/lib/risansi-opp-filters';
import {
  DASH_STAGES, STAGE_COLUMNS, STAGE_SLUG, DIM_LABEL, parseEtaMonth,
  type DashStage, type SelDim,
} from '@/lib/risansi-stage-dashboard';
import { loadStageRows, type StageDashRow } from '@/lib/risansi-stage-rows';

export const runtime = 'nodejs';

// The table under a stage dashboard, as a sheet.
//
//   GET /api/risansi/opportunities/stage-export?stage=Quoted&<board filters>&sel=age:61–90d&sel=rep:…
//
// Same columns as the table on the page, same rows: loadStageRows applies the
// board's filters, the viewer's scope and the bar selection, so what comes down
// is what was on screen. The other export (opportunities/export) is every
// field of every opportunity for ERP reconciliation; this one is the view.

type Cell = string | number | Date | null;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  const url = new URL(request.url);
  const stageParam = url.searchParams.get('stage') ?? '';
  const stage = (DASH_STAGES as readonly string[]).includes(stageParam) ? (stageParam as DashStage) : null;
  if (!stage) return new NextResponse('Unknown stage', { status: 400 });

  // The page's search params, as the page sees them.
  const sp: Record<string, string | string[]> = {};
  for (const k of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(k);
    sp[k] = all.length > 1 ? all : all[0];
  }
  const { rows, sel, todayIdx } = await loadStageRows(stage, sp);

  // What was applied, for the sheet header — the board filters in their own
  // words, then each clicked bar.
  const f = parseOppFilters({ ...sp, stage: undefined });
  const applied: [string, string][] = [];
  if (f.prodType.length) applied.push(['Product type', f.prodType.join(', ')]);
  if (f.rep.length)      applied.push(['Rep', f.rep.join(', ')]);
  if (f.industry.length) applied.push(['Industry', f.industry.join(', ')]);
  if (f.ctype.length)    applied.push(['Client type', f.ctype.join(', ')]);
  if (f.prob.length)     applied.push(['Probability', f.prob.join(', ')]);
  if (f.val.length)      applied.push(['Value band', f.val.join(', ')]);
  if (f.so)              applied.push(['SO coverage', f.so]);
  if (f.qname)           applied.push(['Search', f.qname]);
  if (f.qfrom || f.qto)  applied.push(['Quote date', `${f.qfrom || '…'} to ${f.qto || '…'}`]);
  if (f.efrom || f.eto)  applied.push(['Enquiry date', `${f.efrom || '…'} to ${f.eto || '…'}`]);
  for (const [d, v] of Object.entries(sel) as [SelDim, string][]) applied.push([`Bar · ${DIM_LABEL[d]}`, v]);

  // Rep is the client's owner throughout. The "Raised for" column that used to
  // close this sheet is gone with the second rep it reported.
  const cols = [
    { key: 'client_code', label: 'Client code', num: false, width: 110 },
    ...STAGE_COLUMNS[stage],
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(stage, { views: [{ state: 'frozen', ySplit: 4 }] });

  try {
    const logoId = wb.addImage({ filename: join(process.cwd(), 'public', 'logo.png'), extension: 'png' });
    ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 47 } });
  } catch { /* logo optional */ }
  ws.getRow(1).height = 26; ws.getRow(2).height = 16; ws.getRow(3).height = 6;
  const title = ws.getCell('C1'); title.value = `${stage} — opportunities`;
  title.font = { size: 14, bold: true, color: { argb: 'FF0A3D8F' } };
  const sub = ws.getCell('C2');
  sub.value = `${rows.length.toLocaleString('en-IN')} row${rows.length === 1 ? '' : 's'}`
    + (applied.length ? ` · ${applied.map(([k, v]) => `${k}: ${v}`).join(' · ')}` : ' · no filters')
    + ` · ${stamp}`;
  sub.font = { size: 10, color: { argb: 'FF64748B' } };

  // Header row.
  const HEAD = 4;
  cols.forEach((c, i) => {
    const cell = ws.getCell(HEAD, i + 1);
    cell.value = headerLabel(c.key, c.label);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A3D8F' } };
    cell.alignment = { vertical: 'middle', horizontal: c.num ? 'right' : 'left' };
    ws.getColumn(i + 1).width = Math.max(10, Math.round((c.width ?? 140) / 7));
  });
  ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: HEAD, column: cols.length } };

  rows.forEach((r, ri) => {
    const row = ws.getRow(HEAD + 1 + ri);
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const v = cellValue(r, c.key, todayIdx);
      cell.value = v;
      if (typeof v === 'number') cell.numFmt = NUM_FMT[c.key] ?? '#,##0';
      if (v instanceof Date) cell.numFmt = 'dd-mmm-yyyy';
      if (c.num) cell.alignment = { horizontal: 'right' };
    });
  });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${STAGE_SLUG[stage]}-${stamp}.xlsx"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}

// Money is written in rupees as numbers, not "₹0.34 Cr" as text, so it sums.
// The header says so.
const NUM_FMT: Record<string, string> = {
  value_cr: '#,##0', final_cr: '#,##0', so_sum_cr: '#,##0',
  offer_inr: '#,##0', revised_inr: '#,##0', age_days: '0', rev_count: '0',
};
const CR = 1e7;

function headerLabel(key: string, label: string): string {
  switch (key) {
    case 'value_cr': case 'final_cr': case 'so_sum_cr': case 'offer_inr': case 'revised_inr':
      return `${label} (₹)`;
    case 'age_days': return `${label} (days)`;
    default: return label;
  }
}

const asDate = (iso: string | null): Date | null => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) ? new Date(Date.UTC(y, m - 1, d)) : null;
};

function cellValue(r: StageDashRow, key: string, todayIdx: number): Cell {
  switch (key) {
    case 'value_cr':    return Math.round(r.value_cr * CR);
    case 'final_cr':    return r.final_cr == null ? null : Math.round(Number(r.final_cr) * CR);
    case 'so_sum_cr':   return r.so_sum_cr > 0 ? Math.round(r.so_sum_cr * CR) : null;
    case 'offer_inr':   return r.offer_inr == null ? null : Math.round(r.offer_inr);
    case 'revised_inr': return r.revised_inr == null ? null : Math.round(r.revised_inr);
    case 'age_days':    return r.age_days;
    case 'rev_count':   return r.rev_count || null;
    case 'quote_date':  return asDate(r.quote_date);
    case 'enquiry_date': return asDate(r.enquiry_date);
    case 'revised_on':  return asDate(r.revised_on);
    case 'so_status': {
      const base = r.final_cr != null ? Number(r.final_cr) : r.value_cr;
      return base > 0 && r.so_sum_cr >= base ? 'Closed' : 'Open';
    }
    case 'eta_text': {
      // As typed, with the same warning the table shows when the month has passed.
      const t = (r.eta_text ?? '').trim();
      if (!t) return null;
      const idx = parseEtaMonth(t);
      return idx != null && idx < todayIdx ? `${t} (overdue)` : t;
    }
    default: {
      const v = (r as unknown as Record<string, unknown>)[key];
      return v == null ? null : String(v);
    }
  }
}
