import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { periodChoices } from '@/lib/risansi-revenue-period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The revenue upload template, built on request.
//
//   GET /api/risansi/revenue/template
//
// It used to be a file checked into public/, and that file disagreed with the
// parser that reads it back. Column C carried
//
//   <dataValidation type="date" sqref="C1:C1048576">29221..72686</dataValidation>
//
// so Excel demanded a real date between 1980 and 2099 in the Month column —
// while the upload reads that column as the text "May-2026". Typing the format
// the page documents got you "The value you entered is not valid", and typing
// a date to satisfy Excel got you a cell the parser read as the serial 46157
// and threw away. Either way the Month column could not be filled correctly.
//
// Generated rather than static because the dropdown is a window around today.
// A list checked into the repo is right until it isn't, and the day it runs
// out is the day somebody types the month by hand and meets the old problem
// again.

/** Three years back and one forward, as the upload spells them. */
const CHOICES_SHEET = 'Periods';
/** How far down the dropdown and the typing format reach. */
const ROWS = 500;
const LAST_ROW_REF = `C${ROWS}`;

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.role, 'admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Risansi Sales Portal';
  wb.created = new Date();

  const ws = wb.addWorksheet('Revenue');
  ws.columns = [
    { header: 'Client Code',  key: 'code',  width: 18 },
    { header: 'Client Name',  key: 'name',  width: 38 },
    { header: 'Month',        key: 'month', width: 16 },
    { header: 'Pump Value',   key: 'pump',  width: 16 },
    { header: 'Spare Value',  key: 'spare', width: 16 },
  ];

  const header = ws.getRow(1);
  header.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FF002060' } };
  header.alignment = { horizontal: 'center', vertical: 'middle' };
  header.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };
    c.border = {
      top:    { style: 'medium', color: { argb: 'FF000000' } },
      left:   { style: 'medium', color: { argb: 'FF000000' } },
      right:  { style: 'medium', color: { argb: 'FF000000' } },
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
    };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // The choices live on their own sheet because an inline list in a
  // dataValidation formula is capped at 255 characters, and 196 periods is
  // several times that. Hidden, so the workbook still reads as one table.
  const choices = periodChoices();
  const lists = wb.addWorksheet(CHOICES_SHEET, { state: 'veryHidden' });
  choices.forEach((p, i) => { lists.getCell(i + 1, 1).value = p; });

  // Text, not General. Left to itself Excel reads "May-2026" as a date, stores
  // a serial and prints "May-26" — which is the same trap one step later.
  ws.getColumn('month').numFmt = '@';
  ws.getColumn('pump').numFmt  = '#,##0.00';
  ws.getColumn('spare').numFmt = '#,##0.00';

  // One range in one call. Assigning cell by cell makes ExcelJS emit several
  // overlapping <dataValidation> entries for the same column, which Excel can
  // read as damage and offer to repair.
  dataValidationsOf(ws).add(`C2:${LAST_ROW_REF}`, {
    type: 'list',
    allowBlank: true,
    formulae: [`=${CHOICES_SHEET}!$A$1:$A$${choices.length}`],
    // A dropdown that offers rather than refuses. The whole months and both
    // fortnights are all there, but a period outside the window — an old
    // sheet being re-imported — still goes in by hand instead of being
    // rejected by the same kind of rule this template was built to undo.
    showErrorMessage: false,
    showInputMessage: true,
    promptTitle: 'Month',
    prompt: 'Pick from the list, or type May-2026 for a whole month, May-2026 H1 (1-15) or May-2026 H2 (16 to month end).',
  });

  for (let r = 2; r <= ROWS; r++) {
    for (let c = 1; c <= 5; c++) ws.getCell(r, c).font = { name: 'Aptos', size: 11 };
  }

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="revenue_upload_template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * ExcelJS's worksheet carries a `dataValidations` collection at runtime but
 * does not declare it, and the per-cell `cell.dataValidation` setter that it
 * does declare emits several overlapping <dataValidation> entries for one
 * column. One range in one call is what Excel wants, so this reaches the real
 * object rather than working around the types with a worse file.
 */
function dataValidationsOf(ws: ExcelJS.Worksheet): { add(range: string, v: ExcelJS.DataValidation): void } {
  return (ws as unknown as { dataValidations: { add(range: string, v: ExcelJS.DataValidation): void } }).dataValidations;
}
