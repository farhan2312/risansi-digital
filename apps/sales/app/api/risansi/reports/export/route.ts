import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser } from '@/lib/risansi-auth';
import { getReport } from '@/app/actions/risansi-reports';
import { runVisual, type CrossFilter } from '@/lib/custom-analytics/engine';
import { buildScope } from '@/lib/custom-analytics/scope';
import { sheetFor, filterWords, type SheetData } from '@/lib/custom-analytics/sheet';
import { defaultTitle } from '@/lib/custom-analytics/fmt';
import type { PageFilters, Visual } from '@/lib/custom-analytics/types';

// A report page, as a workbook. One sheet per card.
//
// ── Whose figures, and how many ────────────────────────────────
//
// The caller's, and all of them. The scope comes from the session here, the
// same as every other read in this feature, so exporting a report somebody
// shared with you gives you your own numbers and cannot be used to reach a
// row the screen would not have shown you either.
//
// Unlike the screen, the sheet is not folded or paged: `forExport` turns off
// the top-N "Other" bucket and the fifty-row table pages, so a treemap of
// four hundred clients exports four hundred rows. That is the point of
// wanting it in Excel.
//
// ── Why it re-runs the queries ─────────────────────────────────
//
// The Executive Review's export takes the figures the browser drew, because
// that page computes them in the browser. A report has one implementation of
// its figures — the engine — so there is nothing to disagree with: the route
// calls it again with the filters the reader had on screen.
//
// ── Why sequentially ───────────────────────────────────────────
//
// Twenty unpaged aggregations fired at once would take twenty of the fifteen
// connections in the pool, and everybody else on the portal would wait for a
// spreadsheet nobody else asked for. A click that takes three seconds is a
// better trade.

export const dynamic = 'force-dynamic';

const MAX_SHEETS = 25;
const MAX_ROWS = 50_000;

// Farhan's house style for every workbook this portal writes.
const FONT = { name: 'Aptos', size: 11 };
const HEAD_FILL = 'FFBDD7EE';   // Blue, Accent 1, Lighter 60%
const HEAD_TEXT = 'FF002060';   // dark navy
const THICK = { style: 'thick' as const, color: { argb: 'FF000000' } };
const THIN = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };

/** Excel forbids : \ / ? * [ ] in a sheet name and caps it at 31 characters. */
function sheetName(raw: string, i: number, taken: Set<string>): string {
  const base = (raw.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31))
    || `Card ${i + 1}`;
  let name = base;
  // Two cards called "Revenue" is normal and Excel will not have it.
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    name = `${base.slice(0, 28)} ${n}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  let body: {
    id?: number; pageId?: string; visualId?: string;
    filters?: PageFilters; cross?: CrossFilter | null;
  };
  try {
    body = await req.json();
  } catch {
    return new NextResponse('Expected JSON.', { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id)) return new NextResponse('Which report?', { status: 400 });

  // The access check is getReport's, in its own WHERE clause. Nothing here
  // decides who may read what.
  const report = await getReport(id);
  if (!report.ok) return new NextResponse(report.error, { status: 403 });

  const doc = report.data.doc;
  const page = (body.pageId ? doc.pages.find(p => p.id === body.pageId) : doc.pages[0]) ?? doc.pages[0];
  if (!page) return new NextResponse('That report has no pages.', { status: 400 });

  const all: Visual[] = body.visualId
    ? page.visuals.filter(v => v.id === body.visualId)
    : page.visuals;
  if (!all.length) return new NextResponse('There is nothing on this page to export.', { status: 400 });
  const visuals = all.slice(0, MAX_SHEETS);

  const filters = body.filters ?? page.filters ?? {};
  const cross = body.cross ?? undefined;
  const scope = buildScope(user);

  // Rep ids are on the filter; rep names are what belongs on the sheet.
  const repNames = new Map<number, string>();
  if (filters.reps?.length) {
    const { rows } = await risansiPool.query(
      `SELECT id, name FROM users WHERE id = ANY($1::int[])`, [filters.reps]);
    for (const r of rows) repNames.set(Number(r.id), String(r.name ?? `#${r.id}`));
  }
  const provenance = filterWords(filters, repNames, cross);

  const sheets: (SheetData & { ignored?: string[] })[] = [];
  for (const v of visuals) {
    const result = await runVisual(scope, v, filters, cross, { forExport: true });
    const s = sheetFor(v, result, v.title || defaultTitle(v));
    sheets.push({ ...s, ignored: result.ignoredFilters });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Risansi Sales Portal';
  wb.created = new Date();

  const taken = new Set<string>();
  for (const [i, s] of sheets.entries()) {
    const ws = wb.addWorksheet(sheetName(s.name, i, taken));

    // Row 1 says what the card is; row 2 says what it was filtered to. A
    // spreadsheet that has been forwarded twice has lost the page it came
    // from, and a figure with no idea whose book or which months is a figure
    // nobody can use.
    ws.addRow([s.note]);
    ws.getRow(1).font = { ...FONT, bold: true, size: 12 };
    const sub = [
      `${report.data.title} · ${page.name}`,
      provenance,
      `Figures as ${user.email} can see them`,
    ].join(' — ');
    ws.addRow([sub]);
    ws.getRow(2).font = { ...FONT, size: 10, italic: true };
    if (s.ignored?.length) {
      ws.addRow([`Does not apply to this table: ${s.ignored.join(', ')}`]);
      ws.getRow(3).font = { ...FONT, size: 10, italic: true };
    }
    ws.addRow([]);

    if (s.skipped || !s.cols.length) {
      const r = ws.addRow([s.skipped ?? 'Nothing to show.']);
      r.font = { ...FONT, italic: true };
      ws.columns.forEach(c => { c.width = 48; });
      continue;
    }

    const headRowNo = ws.rowCount + 1;
    const head = ws.addRow(s.cols.map(c => c.label));
    head.font = { ...FONT, bold: true, color: { argb: HEAD_TEXT } };
    head.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    for (const row of s.rows.slice(0, MAX_ROWS)) {
      const r = ws.addRow(row);
      r.font = FONT;
      r.eachCell((cell, col) => {
        const c = s.cols[col - 1];
        if (!c) return;
        if (c.kind === 'number') {
          cell.numFmt = c.numFmt ?? '#,##0';
          cell.alignment = { horizontal: 'right' };
        }
      });
    }

    // A thick black box round the table, thin lines inside it.
    const lastRow = ws.rowCount;
    const lastCol = s.cols.length;
    for (let r = headRowNo; r <= lastRow; r++) {
      for (let c = 1; c <= lastCol; c++) {
        ws.getCell(r, c).border = {
          top: r === headRowNo ? THICK : THIN,
          bottom: r === lastRow ? THICK : THIN,
          left: c === 1 ? THICK : THIN,
          right: c === lastCol ? THICK : THIN,
        };
      }
    }

    // Wide enough to read, never wrapped: a wrapped column of dates or
    // figures is harder to read than a wide one.
    ws.columns.forEach((col, idx) => {
      let longest = s.cols[idx]?.label.length ?? 10;
      col.eachCell?.({ includeEmpty: false }, cell => {
        // Rows 1 to 3 are the provenance lines and are much longer than any
        // cell; sizing to them would make column A enormous.
        if (typeof cell.row === 'number' && cell.row < headRowNo) return;
        const len = String(cell.value ?? '').length;
        if (len > longest) longest = len;
      });
      col.width = Math.min(Math.max(longest + 2, 10), 46);
    });
    ws.views = [{ state: 'frozen', ySplit: headRowNo }];
  }

  const buf = await wb.xlsx.writeBuffer();
  const stem = `${report.data.title} ${visuals.length === 1 ? sheets[0].name : page.name}`
    .replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'report';
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${stem}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
