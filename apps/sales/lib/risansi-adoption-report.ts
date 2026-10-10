// The adoption report: who is using the portal, as a workbook.
//
// One implementation, used by the download button on the Audit Log page and by
// scripts/user-adoption-report.mjs. Two copies of a report is two answers to the
// same management question, and the one nobody regenerated is the one that gets
// quoted.
//
// EVERY ACTIVE USER APPEARS, including those with nothing against their name.
// Leaving them out would answer "how much do users use it" while hiding "who
// does not use it at all", which is usually the question behind the question.
//
// The numbers come from lib/risansi-person-metrics.ts, which also feeds the
// individual PDF; the caveats about how to read them are documented there.
// Admin and sysadmin figures are not comparable with a rep's, which is why the
// sheet groups them apart rather than ranking everybody in one list.
import ExcelJS from 'exceljs';
import type { Pool } from 'pg';
import { chartXml, injectCharts } from '@/lib/xlsx-charts';
import { loadPersonMetrics, type PersonRow } from '@/lib/risansi-person-metrics';

export interface AdoptionSummary {
  from: string; to: string;
  accounts: number; signedIn: number; neverIn: string[];
  sessions: number; hours: number; records: number;
}

export async function buildAdoptionReport(pool: Pool): Promise<{ buffer: Buffer; summary: AdoptionSummary }> {
  // ── the numbers ───────────────────────────────────────────────────
  // All-time, and from the same query the individual PDF reads
  // (lib/risansi-person-metrics.ts) so the workbook and the handout cannot drift
  // apart on the same person.
  const users = await loadPersonMetrics(pool);

  // Month by month, for the trend sheet and the trend chart.
  const { rows: monthly } = await pool.query(`
    SELECT u.id, u.name, to_char(p.occurred_at, 'YYYY-MM') AS ym,
           count(DISTINCT p.session_id)::int AS sessions,
           count(DISTINCT p.occurred_at::date)::int AS days,
           round(sum(p.active_seconds)/3600.0, 1) AS hours
      FROM page_activity p JOIN users u ON u.id = p.user_id
     GROUP BY u.id, u.name, ym ORDER BY ym, u.name`);

  const { rows: months } = await pool.query(`
    SELECT to_char(occurred_at,'YYYY-MM') AS ym,
           count(DISTINCT user_id)::int AS users,
           count(DISTINCT session_id)::int AS sessions,
           round(sum(active_seconds)/3600.0, 1) AS hours
      FROM page_activity GROUP BY 1 ORDER BY 1`);

  const { rows: [span] } = await pool.query(
    `SELECT min(occurred_at)::date::text AS from, max(occurred_at)::date::text AS to FROM page_activity`);


  const num = (v: unknown) => Number(v ?? 0);
  type Row = PersonRow;
  const field = (users as Row[]).filter(u => u.role === 'rep' || u.role === 'manager');
  const admin = (users as Row[]).filter(u => u.role !== 'rep' && u.role !== 'manager');
  const ordered = [...field, ...admin];
  const neverIn = (users as Row[]).filter(u => num(u.logins) === 0);
  const MODULE = (p: string | null) => {
    if (!p) return '—';
    const seg = p.replace(/^\/risansi\/?/, '').replace(/\/[0-9]+.*$/, '').split('/')[0];
    return seg ? seg.replace(/-/g, ' ').replace(/^\w/, ch => ch.toUpperCase()) : 'Dashboard';
  };

  /** 1-based column number → its A1 letter. */
  const L = (n: number): string => {
    let out = ''; while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = (n - m - 1) / 26; }
    return out;
  };

  // ── the workbook ──────────────────────────────────────────────────
  const NAVY = 'FF0A3D8F', GREY = 'FF64748B', LINE = 'FFE2E8F0';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Risansi Market Intelligence';
  wb.created = new Date();

  const ws = wb.addWorksheet('Adoption', {
    views: [{ state: 'frozen', ySplit: 9 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });

  // `fmt` and `bar` travel with the column rather than being applied by index
  // further down. Inserting a column used to mean remembering to shift a couple
  // of magic numbers and a hardcoded 'G', which is a silent way to put a decimal
  // format on the wrong figure.
  const COLS: { h: string; w: number; fmt?: string; bar?: string }[] = [
    { h: 'User', w: 24 }, { h: 'Role', w: 10 }, { h: 'Zone', w: 10 },
    { h: 'Clients owned', w: 13, bar: 'FF7C3AED' }, { h: 'Clients covered', w: 14 }, { h: 'Clients in view', w: 14 },
    { h: 'Logins', w: 9 }, { h: 'Days active', w: 12 }, { h: 'Sessions', w: 10 },
    { h: 'Active hours', w: 13, fmt: '0.0', bar: 'FF0A3D8F' }, { h: 'Pages viewed', w: 13 },
    { h: 'Avg min/session', w: 15, fmt: '0.0' },
    { h: 'Most used', w: 16 }, { h: 'Last login', w: 12 },
    { h: 'Visits owned', w: 12 }, { h: 'Visits done', w: 11 }, { h: 'Reports filed', w: 13 },
    { h: 'Opps created', w: 12 }, { h: 'Stage moves', w: 12 }, { h: 'Quotes uploaded', w: 15 },
    { h: 'Sales orders', w: 12 }, { h: 'Clients added', w: 13 },
    { h: 'Actions raised', w: 13 }, { h: 'Actions done', w: 12 },
    { h: 'Complaints', w: 11 }, { h: 'Exhib. meetings', w: 15 },
    { h: 'Recorded actions', w: 16, bar: 'FF16A34A' },
  ];
  COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.w; });

  // Title band
  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = 'Portal Adoption — who is using the application';
  ws.getCell('A1').font = { size: 15, bold: true, color: { argb: NAVY } };
  ws.mergeCells('A2:F2');
  ws.getCell('A2').value = `${span.from} to ${span.to} · ${users.length} active accounts · generated ${new Date().toISOString().slice(0, 10)}`;
  ws.getCell('A2').font = { size: 10, color: { argb: GREY } };
  ws.getRow(1).height = 22;

  // Headline figures
  const totals = {
    loggedIn: users.filter(u => num(u.logins) > 0).length,
    logins: users.reduce((s, u) => s + num(u.logins), 0),
    sessions: users.reduce((s, u) => s + num(u.sessions), 0),
    hours: users.reduce((s, u) => s + num(u.hours), 0),
    records: users.reduce((s, u) => s + num(u.audited_actions), 0),
  };
  const KPI = [
    ['Accounts that have signed in', `${totals.loggedIn} of ${users.length}`],
    ['Never signed in', String(neverIn.length)],
    ['Total sign-ins', totals.logins.toLocaleString('en-IN')],
    ['Sessions', totals.sessions.toLocaleString('en-IN')],
    ['Active hours in the app', Math.round(totals.hours).toLocaleString('en-IN')],
    ['Recorded actions', totals.records.toLocaleString('en-IN')],
  ];
  KPI.forEach(([label, value], i) => {
    const col = 1 + i * 2;
    const l = ws.getCell(4, col); l.value = label;
    l.font = { size: 9, bold: true, color: { argb: GREY } };
    const v = ws.getCell(5, col); v.value = value;
    v.font = { size: 14, bold: true, color: { argb: NAVY } };
  });
  ws.getRow(5).height = 20;

  // The table starts at row 9 so the charts have room above it.
  const HEAD_ROW = 9;
  const head = ws.getRow(HEAD_ROW);
  COLS.forEach((col, i) => {
    const cell = head.getCell(i + 1);
    cell.value = col.h;
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: i === 0 ? 'left' : 'center' };
  });
  head.height = 28;

  let r = HEAD_ROW;
  const sectionRows = [];
  const writeSection = (label: string, list: Row[]) => {
    if (!list.length) return;
    r += 1;
    sectionRows.push(r);
    const cell = ws.getCell(r, 1);
    cell.value = label;
    cell.font = { bold: true, size: 10, color: { argb: NAVY } };
    ws.getRow(r).eachCell({ includeEmpty: true }, (cl) => {
      cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    });
    for (const u of list) {
      r += 1;
      const avgMin = num(u.sessions) > 0 ? (num(u.hours) * 60) / num(u.sessions) : 0;
      const vals: (string | number)[] = [
        u.name, u.role, u.zone,
        num(u.clients_owned), num(u.clients_covered), num(u.clients_in_view),
        num(u.logins), num(u.days_active), num(u.sessions),
        num(u.hours), num(u.page_views), Number(avgMin.toFixed(1)),
        MODULE(u.top_path as string | null), (u.last_login as string | null) ?? '—',
        num(u.visits_owned), num(u.visits_done), num(u.reports_filed),
        num(u.opps_created), num(u.stage_moves), num(u.quotes_uploaded),
        num(u.sales_orders), num(u.clients_created),
        num(u.actions_raised), num(u.actions_done),
        num(u.complaints_raised), num(u.exhibition_meetings), num(u.audited_actions),
      ];
      const row = ws.getRow(r);
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v;
        cell.font = { size: 9 };
        if (i > 2) cell.alignment = { horizontal: 'center' };
        if (COLS[i]?.fmt) cell.numFmt = COLS[i].fmt!;
      });
      // Somebody who has never signed in is the finding, so it is marked rather
      // than left as a row of zeros the eye slides over.
      if (num(u.logins) === 0) {
        row.eachCell({ includeEmpty: true }, (cl) => {
          cl.font = { size: 9, italic: true, color: { argb: 'FFB91C1C' } };
        });
        row.getCell(1).value = `${u.name} — never signed in`;
      }
    }
  };
  writeSection('FIELD — reps and managers', field);
  writeSection('ADMIN — data administration, not comparable with the above', admin);
  const LAST_ROW = r;

  // Bars inside the hours and actions columns, so the table reads at a glance
  // without anybody having to sort it.
  for (const [colLetter, colour] of COLS
    .map((col, i) => [L(i + 1), col.bar] as const)
    .filter((x): x is readonly [string, string] => Boolean(x[1]))) {
    ws.addConditionalFormatting({
      ref: `${colLetter}${HEAD_ROW + 1}:${colLetter}${LAST_ROW}`,
      // `color` is honoured by the XML writer but missing from ExcelJS's typings.
    rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: colour } } as never],
    });
  }
  ws.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: LAST_ROW, column: COLS.length } };

  // ── sheet 2: month by month ───────────────────────────────────────
  const ms = wb.addWorksheet('Monthly', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  const ymList = months.map(m => m.ym);
  ms.getColumn(1).width = 26;
  ymList.forEach((_, i) => { ms.getColumn(2 + i).width = 13; });
  const mh = ms.getRow(1);
  mh.getCell(1).value = 'Active hours by user';
  ymList.forEach((ym, i) => { mh.getCell(2 + i).value = ym; });
  mh.eachCell(cl => {
    cl.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cl.alignment = { horizontal: 'center' };
  });
  const byUser = new Map();
  for (const m of monthly) {
    if (!byUser.has(m.id)) byUser.set(m.id, { name: m.name, months: new Map() });
    byUser.get(m.id).months.set(m.ym, Number(m.hours));
  }
  let mr = 1;
  for (const u of ordered) {
    const rec = byUser.get(u.id);
    mr += 1;
    const row = ms.getRow(mr);
    row.getCell(1).value = u.name;
    row.getCell(1).font = { size: 9 };
    ymList.forEach((ym, i) => {
      const cell = row.getCell(2 + i);
      cell.value = rec?.months.get(ym) ?? 0;
      cell.numFmt = '0.0';
      cell.font = { size: 9 };
      cell.alignment = { horizontal: 'center' };
    });
  }
  ms.addConditionalFormatting({
    ref: `B2:${String.fromCharCode(65 + ymList.length)}${mr}`,
    rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF0A3D8F' } } as never],
  });

  // The trend the line chart plots, parked to the right of the table it belongs to.
  const TREND_COL = COLS.length + 2;               // one blank column after the table
  const TREND_HEAD = LAST_ROW + 3;
  ws.getCell(TREND_HEAD, TREND_COL).value = 'Month';
  ws.getCell(TREND_HEAD, TREND_COL + 1).value = 'Active users';
  ws.getCell(TREND_HEAD, TREND_COL + 2).value = 'Active hours';
  months.forEach((m, i) => {
    ws.getCell(TREND_HEAD + 1 + i, TREND_COL).value = m.ym;
    ws.getCell(TREND_HEAD + 1 + i, TREND_COL + 1).value = Number(m.users);
    ws.getCell(TREND_HEAD + 1 + i, TREND_COL + 2).value = Number(m.hours);
  });

  // ── the charts ────────────────────────────────────────────────────
  // Charts read a contiguous range, so the top-15 lists get their own small block
  // beside the trend data rather than pointing at a sorted view of the main table
  // — which would go wrong the moment somebody used the autofilter.
  const topHours = [...ordered].sort((a, b) => num(b.hours) - num(a.hours)).slice(0, 15);
  const topWork = [...ordered].sort((a, b) => num(b.audited_actions) - num(a.audited_actions)).slice(0, 15);
  const CH_COL = TREND_COL + 4;
  ws.getCell(TREND_HEAD, CH_COL).value = 'User';
  ws.getCell(TREND_HEAD, CH_COL + 1).value = 'Active hours';
  topHours.forEach((u, i) => {
    ws.getCell(TREND_HEAD + 1 + i, CH_COL).value = u.name;
    ws.getCell(TREND_HEAD + 1 + i, CH_COL + 1).value = num(u.hours);
  });
  ws.getCell(TREND_HEAD, CH_COL + 3).value = 'User';
  ws.getCell(TREND_HEAD, CH_COL + 4).value = 'Recorded actions';
  topWork.forEach((u, i) => {
    ws.getCell(TREND_HEAD + 1 + i, CH_COL + 3).value = u.name;
    ws.getCell(TREND_HEAD + 1 + i, CH_COL + 4).value = num(u.audited_actions);
  });

  const first = TREND_HEAD + 1, lastTop = TREND_HEAD + topHours.length, lastM = TREND_HEAD + months.length;

  const charts = [
    {
      xml: chartXml({
        title: 'Active hours in the app — top 15',
        sheet: 'Adoption', seriesName: 'Active hours',
        cats: `$${L(CH_COL)}$${first}:$${L(CH_COL)}$${lastTop}`,
        vals: `$${L(CH_COL + 1)}$${first}:$${L(CH_COL + 1)}$${lastTop}`,
        type: 'bar', dir: 'bar', colour: '0A3D8F', numFmt: '0.0',
      }),
      anchor: { fromCol: 0, fromRow: 6, toCol: 8, toRow: 8 + 14 },
    },
    {
      xml: chartXml({
        title: 'Records created and edited — top 15',
        sheet: 'Adoption', seriesName: 'Recorded actions',
        cats: `$${L(CH_COL + 3)}$${first}:$${L(CH_COL + 3)}$${lastTop}`,
        vals: `$${L(CH_COL + 4)}$${first}:$${L(CH_COL + 4)}$${lastTop}`,
        type: 'bar', dir: 'bar', colour: '16A34A',
      }),
      anchor: { fromCol: 8, fromRow: 6, toCol: 16, toRow: 8 + 14 },
    },
    {
      xml: chartXml({
        title: 'Active users per month',
        sheet: 'Adoption', seriesName: 'Active users',
        cats: `$${L(TREND_COL)}$${first}:$${L(TREND_COL)}$${lastM}`,
        vals: `$${L(TREND_COL + 1)}$${first}:$${L(TREND_COL + 1)}$${lastM}`,
        type: 'line', colour: 'B45309',
      }),
      anchor: { fromCol: 16, fromRow: 6, toCol: 24, toRow: 8 + 14 },
    },
  ];

  // The charts sit above the table, so the table has to start below them.
  // Rows 6..22 are given over to the chart band; the header row is at 9, which
  // would collide — so the anchors are placed against a spacer instead.
  charts.forEach((ch: { anchor: { fromRow: number; toRow: number } }) => { ch.anchor.fromRow = LAST_ROW + 2; ch.anchor.toRow = LAST_ROW + 20; });


  const buffer = await wb.xlsx.writeBuffer();
  const withCharts = await injectCharts(Buffer.from(buffer), { sheetFile: 'sheet1.xml', charts });

  return {
    buffer: withCharts,
    summary: {
      from: span.from, to: span.to,
      accounts: users.length, signedIn: totals.loggedIn,
      neverIn: neverIn.map((u: { name: string }) => u.name),
      sessions: totals.sessions, hours: Math.round(totals.hours), records: totals.records,
    },
  };
}
