import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getCurrentUser } from '@/lib/risansi-auth';

// The Executive Review, as a workbook.
//
// ── Why the client posts the figures ────────────────────────────
//
// It would be tidier for this route to rebuild the page's queries. It would
// also be wrong within a week: the page computes eight tables from a dozen
// scoped queries, and a second implementation of them is a second set of
// numbers that agree only until one of them is edited. The reader would then
// have a spreadsheet quietly disagreeing with the screen it came from, which
// is worse than having no spreadsheet.
//
// So the page hands over exactly what it drew. The export matches the screen
// by construction, including every filter — rep, financial year, account
// scope, tab — because it IS the screen.
//
// Nothing here is a privilege: this formats figures the caller is already
// looking at, and reads nothing. The session check is still required, so an
// unauthenticated POST cannot use it as a free spreadsheet generator.

export const dynamic = 'force-dynamic';

interface SheetIn {
  name: string;
  headers: string[];
  rows: { label: string; vals: (number | string | null)[]; strong?: boolean }[];
  /** Column index (into vals) from which figures are rupees. 99 = none. */
  moneyFrom?: number;
}

const MAX_SHEETS = 20;
const MAX_ROWS = 5_000;

/** Excel forbids : \ / ? * [ ] in a sheet name, and caps it at 31 characters. */
const safeSheetName = (s: string, i: number) =>
  (s.replace(/[:\/?*[\]]/g, ' ').trim().slice(0, 31) || `Sheet ${i + 1}`);

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user.email) return new NextResponse('Unauthorized', { status: 401 });

  let body: { title?: string; subtitle?: string; sheets?: SheetIn[] };
  try {
    body = await req.json();
  } catch {
    return new NextResponse('Expected JSON.', { status: 400 });
  }

  const sheets = Array.isArray(body.sheets) ? body.sheets.slice(0, MAX_SHEETS) : [];
  if (sheets.length === 0) return new NextResponse('Nothing to export.', { status: 400 });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Risansi Sales Portal';
  wb.created = new Date();

  for (const [i, s] of sheets.entries()) {
    const ws = wb.addWorksheet(safeSheetName(s.name ?? '', i));
    const headers = Array.isArray(s.headers) ? s.headers : [];
    const moneyFrom = Number.isInteger(s.moneyFrom) ? (s.moneyFrom as number) : 99;

    // Which sheet this is and what it was filtered to, on the sheet itself.
    // A spreadsheet that has been emailed on has lost the page it came from,
    // and "₹6.18 Cr" with no idea whose book or which year is a figure nobody
    // can use.
    ws.addRow([body.title ?? 'Executive Review']);
    ws.getRow(1).font = { bold: true, size: 13 };
    if (body.subtitle) {
      ws.addRow([body.subtitle]);
      ws.getRow(2).font = { italic: true, size: 10 };
    }
    ws.addRow([]);

    const headRow = ws.addRow(headers);
    headRow.font = { bold: true };
    headRow.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F8' } };
      c.border = { bottom: { style: 'thin', color: { argb: 'FFBFC9D4' } } };
    });

    for (const r of (s.rows ?? []).slice(0, MAX_ROWS)) {
      const cells: (string | number | null)[] = [r.label, ...(r.vals ?? [])];
      const row = ws.addRow(cells);
      if (r.strong) row.font = { bold: true };
      // Numbers are written as numbers, never as pre-formatted text: a column
      // of "₹1,23,54,288" cannot be summed, sorted or charted, which is most
      // of the reason for wanting a spreadsheet at all. The rupee format is
      // applied to the cell instead.
      row.eachCell((cell, col) => {
        if (col === 1) return;
        if (typeof cell.value === 'number') {
          cell.numFmt = (col - 2) >= moneyFrom ? '#,##0' : '#,##0';
          cell.alignment = { horizontal: 'right' };
        }
      });
    }

    ws.columns.forEach((col, idx) => {
      let longest = idx === 0 ? 26 : 14;
      col.eachCell?.({ includeEmpty: false }, c => {
        const len = String(c.value ?? '').length;
        if (len > longest) longest = len;
      });
      col.width = Math.min(longest + 2, 52);
    });
    // The header row, so the figures stay labelled when a long table scrolls.
    ws.views = [{ state: 'frozen', ySplit: 4 }];
  }

  const buf = await wb.xlsx.writeBuffer();
  const name = `${(body.title ?? 'Executive-Review').replace(/[^\w.-]+/g, '-')}.xlsx`;
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
