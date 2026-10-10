// Build the Risansi data dictionary workbook from schema.tmp.json (structure,
// dumped live) plus descriptions.json (meanings, written per domain).
//
//   node scripts/schema-dump.mjs > schema.tmp.json
//   node scripts/build-data-dictionary.mjs
//
// Structure only. No row data is read or written — the closest it gets is a
// per-column non-null COUNT, so a modeller can see which columns are actually
// populated before building a visual on an empty one.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { CLUSTERS, drawCluster } from './er-diagram.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const S = JSON.parse(readFileSync(path.join(ROOT, 'schema.tmp.json'), 'utf8'));
const DESC = existsSync(path.join(ROOT, 'descriptions.json'))
  ? JSON.parse(readFileSync(path.join(ROOT, 'descriptions.json'), 'utf8'))
  : { tables: [], sections: [] };

const NAVY = 'FF0A3D8F';
const GREY = 'FF64748B';
const SOFT = 'FFEFF3FA';
const WARN = 'FF92400E';

const descByTable = new Map(DESC.tables.map(t => [t.table, t]));
const descByCol = new Map();
for (const t of DESC.tables) for (const c of t.columns ?? []) descByCol.set(`${t.table}.${c.column}`, c);

// ── Index the constraint catalogue ────────────────────────────
const pkCols = new Map();      // table -> Set(col)
const fkByCol = new Map();     // table.col -> {refTable, refCol, onDelete, name}
const uniqueCols = new Map();  // table -> Set(col)
const checksByTable = new Map();
const CASCADE = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

for (const c of S.constraints) {
  if (c.contype === 'p') pkCols.set(c.table_name, new Set(c.columns));
  if (c.contype === 'u') {
    if (!uniqueCols.has(c.table_name)) uniqueCols.set(c.table_name, new Set());
    c.columns.forEach(col => uniqueCols.get(c.table_name).add(col));
  }
  if (c.contype === 'f') {
    c.columns.forEach((col, i) => fkByCol.set(`${c.table_name}.${col}`, {
      refTable: c.ref_table, refCol: c.ref_columns[i] ?? c.ref_columns[0],
      onDelete: CASCADE[c.confdeltype] ?? c.confdeltype, name: c.conname,
    }));
  }
  if (c.contype === 'c') {
    if (!checksByTable.has(c.table_name)) checksByTable.set(c.table_name, []);
    checksByTable.get(c.table_name).push(c);
  }
}

// Which tables point AT a given table — the "who depends on me" column.
const inbound = new Map();
for (const c of S.constraints.filter(x => x.contype === 'f')) {
  if (!inbound.has(c.ref_table)) inbound.set(c.ref_table, new Set());
  inbound.get(c.ref_table).add(c.table_name);
}

const indexedCols = new Map();
for (const ix of S.indexes) {
  const m = ix.indexdef.match(/\(([^)]+)\)/);
  if (!m) continue;
  if (!indexedCols.has(ix.table_name)) indexedCols.set(ix.table_name, new Set());
  m[1].split(',').forEach(c => indexedCols.get(ix.table_name).add(c.trim().replace(/"/g, '').split(' ')[0]));
}

const typeOf = c => {
  if (c.data_type === 'character varying') return c.character_maximum_length ? `varchar(${c.character_maximum_length})` : 'varchar';
  if (c.data_type === 'numeric' && c.numeric_precision) return `numeric(${c.numeric_precision},${c.numeric_scale})`;
  if (c.data_type === 'timestamp with time zone') return 'timestamptz';
  if (c.data_type === 'timestamp without time zone') return 'timestamp';
  if (c.data_type === 'USER-DEFINED') return c.udt_name;
  return c.data_type;
};

// A column's unit, inferred from the naming conventions this schema actually
// uses. Getting this wrong by 10^7 is the single most likely modelling error.
const unitOf = (table, col, type) => {
  if (/_cr$/.test(col)) return 'CRORES (×10,000,000 = ₹)';
  if (/_inr$/.test(col)) return 'Rupees (₹)';
  if (/_usd$/.test(col)) return 'US Dollars';
  if (/^tcd$/.test(col)) return 'Tonnes crushed / day';
  if (/^klpd$/.test(col)) return 'Kilolitres / day';
  if (/_m3h$/.test(col)) return 'm³/hour';
  if (/_m$/.test(col) && type.startsWith('numeric')) return 'metres';
  if (/^kw$/.test(col)) return 'kilowatts';
  if (/_bar$/.test(col)) return 'bar';
  if (/_days$/.test(col)) return 'days';
  if (/_pct$|percent/.test(col)) return 'percent';
  if (/^probability$/.test(col)) return 'percent';
  if (/byte_size|^size$/.test(col)) return 'bytes';
  return '';
};

const wb = new ExcelJS.Workbook();
wb.creator = 'Risansi Sales Portal';
wb.created = new Date(`${S.generated_at}T00:00:00Z`);

// ── Sheet helpers ─────────────────────────────────────────────
function sheet(name, cols, opts = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: opts.freeze ?? 2, xSplit: opts.xSplit ?? 0 }] });
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
  const hdr = ws.getRow(opts.freeze ?? 2);
  ws.getRow(1).getCell(1).value = opts.title ?? name;
  ws.getRow(1).getCell(1).font = { size: 13, bold: true, color: { argb: NAVY } };
  if (opts.subtitle) {
    ws.getRow(1).getCell(opts.subtitleCol ?? 4).value = opts.subtitle;
    ws.getRow(1).getCell(opts.subtitleCol ?? 4).font = { size: 10, color: { argb: GREY } };
  }
  cols.forEach((c, i) => {
    const cell = hdr.getCell(i + 1);
    cell.value = c.h;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  hdr.height = 26;
  return ws;
}
const put = (ws, r, cols, obj, zebra) => {
  const row = ws.getRow(r);
  cols.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.value = c.f(obj) ?? '';
    cell.alignment = { vertical: 'top', wrapText: c.wrap !== false };
    cell.font = { size: 10 };
    if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
  });
  return row;
};

// ══ 1 · Read Me ═══════════════════════════════════════════════
{
  const ws = wb.addWorksheet('Read Me');
  ws.getColumn(1).width = 26; ws.getColumn(2).width = 118;
  ws.getRow(1).getCell(1).value = 'Risansi Sales Portal — Database Guide';
  ws.getRow(1).getCell(1).font = { size: 16, bold: true, color: { argb: NAVY } };
  ws.getRow(2).getCell(1).value = `Schema as at ${S.generated_at} · ${S.tables.length} tables · ${S.columns.length} columns · ${S.constraints.filter(c => c.contype === 'f').length} foreign keys`;
  ws.getRow(2).getCell(1).font = { size: 10, color: { argb: GREY } };

  const blocks = [
    ['What this is', 'A guide to the Risansi Postgres database for anyone building reports or Power BI models against it. It describes the structure and the meaning of every table and column. It contains no customer data.'],
    ['Sheets', 'ER Diagram — the tables drawn as pictures, one per domain, with the keys that join them.\nTables — one row per table: what it holds, its grain, and whether it is a fact, a dimension or a log.\nColumns — one row per column: type, nullability, keys, unit, what it means, and how often it is actually populated.\nRelationships — every foreign key, with cardinality and delete behaviour, ready to recreate as Power BI relationships.\nKeys & Indexes — primary keys, unique constraints and indexes.\nAllowed Values — the real vocabulary of every low-cardinality column, i.e. what a slicer will show.\nModelling Guide — star schema, date handling, row-level security and the traps.'],
    ['READ THIS FIRST — money units', 'Money is stored in TWO different units and nothing in the column type tells you which.\n\n  • Columns ending _cr  are CRORES.  1 crore = 10,000,000 rupees.\n  • Columns ending _inr are RUPEES.\n\nAdding a _cr column to an _inr column, or charting them on one axis, is wrong by a factor of ten million. The Columns sheet names the unit for every numeric column; the Modelling Guide has a DAX pattern that normalises both to rupees.'],
    ['Populated %', 'The Columns sheet shows what proportion of rows actually hold a value. A column at 0% exists in the schema but has never been filled — building a visual on one produces an empty chart, not an error. Check this before you model.'],
    ['Do not import', 'Columns marked do-not-import hold file bytes (bytea) or credentials. They are large, useless in a report, and in the case of password hashes must never leave the database.'],
    ['Soft deletes', 'clients uses deleted_at. A row with a non-null deleted_at has been deleted in the app and should be filtered out of every model, or your counts will not match the portal.'],
    ['Regenerating this file', 'node scripts/schema-dump.mjs > schema.tmp.json\nnode scripts/build-data-dictionary.mjs\n\nThe first reads the live schema; the second rebuilds this workbook. Column meanings come from descriptions.json, which is written by hand and by the documentation workflow — re-run both after a migration.'],
  ];
  let r = 4;
  for (const [h, body] of blocks) {
    const row = ws.getRow(r++);
    row.getCell(1).value = h;
    row.getCell(1).font = { bold: true, size: 11, color: { argb: h.startsWith('READ THIS') ? WARN : NAVY } };
    row.getCell(1).alignment = { vertical: 'top' };
    row.getCell(2).value = body;
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(2).font = { size: 10 };
    row.height = Math.min(150, 15 * (body.split('\n').length + Math.ceil(body.length / 115)));
    r++;
  }
}

// ══ 1b · ER Diagram ═══════════════════════════════════════════
{
  const ws = wb.addWorksheet('ER Diagram');
  ws.getColumn(1).width = 3;
  ws.getRow(1).getCell(2).value = 'Entity relationships';
  ws.getRow(1).getCell(2).font = { size: 16, bold: true, color: { argb: NAVY } };
  ws.getRow(2).getCell(2).value =
    'One diagram per domain. All 53 tables in a single picture is a hairball, so each area is drawn on its own '
    + 'and a link leaving the area is shown on the box as an italic "→ table" stub rather than being dropped.';
  ws.getRow(2).getCell(2).font = { size: 10, color: { argb: GREY } };
  ws.getRow(3).getCell(2).value =
    'Reading it: a box lists the primary key and the foreign keys only — the Columns sheet has the rest. '
    + 'A line runs from the many side (three prongs) to the one side (dot), and its label is the joining column. '
    + 'An amber line means ON DELETE CASCADE: removing the parent row deletes these children with it.';
  ws.getRow(3).getCell(2).font = { size: 10, color: { argb: GREY } };

  let row = 5;
  for (const [title, tables] of CLUSTERS) {
    const known = tables.filter(t => S.tables.some(x => x.table_name === t));
    if (!known.length) continue;
    const { png, width, height } = await drawCluster(S, title, known);
    const id = wb.addImage({ buffer: png, extension: 'png' });
    // Placed at natural size; the PNG is rendered at 1.6x that, so it stays
    // sharp when someone zooms in to read a column name.
    ws.addImage(id, { tl: { col: 1, row: row - 1 }, ext: { width, height } });
    row += Math.ceil(height / 20) + 3;
  }
}

// ══ 2 · Tables ════════════════════════════════════════════════
{
  const cols = [
    { h: 'Table', w: 32, f: t => t.table_name, wrap: false },
    { h: 'Domain', w: 18, f: t => descByTable.get(t.table_name)?.domain ?? '' },
    { h: 'Power BI role', w: 14, f: t => descByTable.get(t.table_name)?.pbi_role ?? '' },
    { h: 'What it holds', w: 62, f: t => descByTable.get(t.table_name)?.purpose ?? '' },
    { h: 'Grain (one row =)', w: 32, f: t => descByTable.get(t.table_name)?.grain ?? '' },
    { h: 'Rows', w: 9, f: t => S.stats[t.table_name]?.rows ?? 0 },
    { h: 'Cols', w: 7, f: t => S.columns.filter(c => c.table_name === t.table_name).length },
    { h: 'Primary key', w: 22, f: t => [...(pkCols.get(t.table_name) ?? [])].join(', ') },
    { h: 'Points at', w: 34, f: t => [...new Set(S.constraints.filter(c => c.contype === 'f' && c.table_name === t.table_name).map(c => c.ref_table))].sort().join(', ') },
    { h: 'Depended on by', w: 34, f: t => [...(inbound.get(t.table_name) ?? [])].sort().join(', ') },
    { h: 'Size', w: 11, f: t => t.total_size },
    { h: 'Modelling note', w: 46, f: t => descByTable.get(t.table_name)?.pbi_note ?? '' },
  ];
  const ws = sheet('Tables', cols, { title: 'Tables', subtitle: `${S.tables.length} tables`, subtitleCol: 4 });
  S.tables.forEach((t, i) => {
    const row = put(ws, 3 + i, cols, t, i % 2 === 1);
    if ((S.stats[t.table_name]?.rows ?? 0) === 0) row.getCell(6).font = { size: 10, color: { argb: WARN }, bold: true };
  });
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };
}

// ══ 3 · Columns ═══════════════════════════════════════════════
{
  const cols = [
    { h: 'Table', w: 30, f: c => c.table_name, wrap: false },
    { h: 'Column', w: 30, f: c => c.column_name, wrap: false },
    { h: '#', w: 5, f: c => c.ordinal_position },
    { h: 'Type', w: 17, f: c => typeOf(c) },
    { h: 'Null?', w: 7, f: c => (c.is_nullable === 'YES' ? 'yes' : 'NO') },
    { h: 'Key', w: 9, f: c => {
      const k = [];
      if (pkCols.get(c.table_name)?.has(c.column_name)) k.push('PK');
      if (fkByCol.has(`${c.table_name}.${c.column_name}`)) k.push('FK');
      if (uniqueCols.get(c.table_name)?.has(c.column_name)) k.push('UQ');
      return k.join('+');
    } },
    { h: 'References', w: 30, f: c => {
      const fk = fkByCol.get(`${c.table_name}.${c.column_name}`);
      return fk ? `${fk.refTable}.${fk.refCol}` : '';
    } },
    { h: 'Unit', w: 22, f: c => unitOf(c.table_name, c.column_name, typeOf(c)) },
    { h: 'Meaning', w: 74, f: c => descByCol.get(`${c.table_name}.${c.column_name}`)?.meaning ?? '' },
    { h: 'Power BI', w: 14, f: c => descByCol.get(`${c.table_name}.${c.column_name}`)?.pbi
        ?? (c.udt_name === 'bytea' ? 'do-not-import' : '') },
    { h: 'Populated', w: 11, f: c => {
      const st = S.stats[c.table_name];
      if (!st || !st.rows) return '';
      const f = st.fill[c.column_name];
      return f == null ? '' : f / st.rows;
    }, fmt: '0%' },
    { h: 'Indexed', w: 9, f: c => (indexedCols.get(c.table_name)?.has(c.column_name) ? 'yes' : '') },
    { h: 'Default', w: 26, f: c => (c.column_default ?? '').slice(0, 60) },
  ];
  const ws = sheet('Columns', cols, { title: 'Columns', subtitle: `${S.columns.length} columns`, subtitleCol: 4, xSplit: 2 });
  S.columns.forEach((c, i) => {
    const row = put(ws, 3 + i, cols, c, i % 2 === 1);
    row.getCell(11).numFmt = '0%';
    const st = S.stats[c.table_name];
    const fill = st && st.rows ? st.fill[c.column_name] : null;
    if (st?.rows && fill === 0) {                      // never populated
      row.getCell(11).font = { size: 10, bold: true, color: { argb: WARN } };
    }
    if (c.udt_name === 'bytea') row.getCell(10).font = { size: 10, bold: true, color: { argb: WARN } };
    if (unitOf(c.table_name, c.column_name, typeOf(c)).startsWith('CRORES')) {
      row.getCell(8).font = { size: 10, bold: true, color: { argb: WARN } };
    }
  });
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };
}

// ══ 4 · Relationships ═════════════════════════════════════════
{
  const fks = S.constraints.filter(c => c.contype === 'f');
  const cols = [
    { h: 'From table', w: 30, f: c => c.table_name, wrap: false },
    { h: 'From column', w: 26, f: c => c.columns.join(', '), wrap: false },
    { h: '→', w: 4, f: () => '→' },
    { h: 'To table', w: 28, f: c => c.ref_table, wrap: false },
    { h: 'To column', w: 18, f: c => c.ref_columns.join(', '), wrap: false },
    { h: 'Cardinality', w: 14, f: c => {
      const uq = uniqueCols.get(c.table_name);
      const pk = pkCols.get(c.table_name);
      const single = c.columns.every(col => uq?.has(col) || (pk?.has(col) && pk.size === 1));
      return single ? '1 : 1' : 'many : 1';
    } },
    { h: 'From side optional?', w: 17, f: c => {
      const col = S.columns.find(x => x.table_name === c.table_name && x.column_name === c.columns[0]);
      return col?.is_nullable === 'YES' ? 'yes (nullable)' : 'no (required)';
    } },
    { h: 'On delete', w: 13, f: c => CASCADE[c.confdeltype] ?? c.confdeltype },
    { h: 'What it means', w: 74, f: c => {
      const child = descByTable.get(c.table_name)?.grain ?? c.table_name;
      const del = CASCADE[c.confdeltype];
      const tail = del === 'CASCADE' ? ` Deleting the ${c.ref_table} row deletes these too.`
        : del === 'SET NULL' ? ` Deleting the ${c.ref_table} row leaves these orphaned but intact.`
        : ` Deleting a ${c.ref_table} row is blocked while these exist.`;
      return `Each ${child} belongs to one ${c.ref_table} row.${tail}`;
    } },
    { h: 'Constraint', w: 42, f: c => c.conname, wrap: false },
  ];
  const ws = sheet('Relationships', cols, { title: 'Relationships', subtitle: `${fks.length} foreign keys`, subtitleCol: 4 });
  fks.sort((a, b) => a.table_name.localeCompare(b.table_name) || a.conname.localeCompare(b.conname))
     .forEach((c, i) => put(ws, 3 + i, cols, c, i % 2 === 1));
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };
}

// ══ 5 · Keys & Indexes ════════════════════════════════════════
{
  const rows = [];
  for (const c of S.constraints.filter(x => ['p', 'u'].includes(x.contype))) {
    rows.push({ table: c.table_name, kind: c.contype === 'p' ? 'PRIMARY KEY' : 'UNIQUE',
      name: c.conname, cols: c.columns.join(', '), def: c.definition });
  }
  for (const ix of S.indexes) {
    if (/_pkey$/.test(ix.indexname)) continue;
    rows.push({ table: ix.table_name, kind: /UNIQUE/.test(ix.indexdef) ? 'UNIQUE INDEX' : 'INDEX',
      name: ix.indexname, cols: (ix.indexdef.match(/\(([^)]+)\)/)?.[1] ?? ''), def: ix.indexdef });
  }
  const cols = [
    { h: 'Table', w: 30, f: r => r.table, wrap: false },
    { h: 'Kind', w: 15, f: r => r.kind },
    { h: 'Columns', w: 44, f: r => r.cols },
    { h: 'Name', w: 46, f: r => r.name, wrap: false },
    { h: 'Definition', w: 90, f: r => r.def },
  ];
  const ws = sheet('Keys & Indexes', cols, { title: 'Keys & Indexes', subtitle: `${rows.length} constraints and indexes`, subtitleCol: 3 });
  rows.sort((a, b) => a.table.localeCompare(b.table) || a.kind.localeCompare(b.kind))
      .forEach((r, i) => put(ws, 3 + i, cols, r, i % 2 === 1));
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };
}

// ══ 6 · Allowed Values ════════════════════════════════════════
{
  const rows = [];
  for (const [key, vals] of Object.entries(S.vocab)) {
    const [table, column] = key.split('.');
    const chk = (checksByTable.get(table) ?? []).find(c => c.columns.includes(column));
    rows.push({ table, column, count: vals.length, vals: vals.join(' | '),
      enforced: chk ? 'CHECK constraint' : 'convention only',
      def: chk ? chk.definition.replace(/\s+/g, ' ') : '' });
  }
  // Enum-ish columns with a CHECK but no rows yet still matter to a modeller.
  for (const [table, checks] of checksByTable) {
    for (const c of checks) {
      for (const col of c.columns) {
        if (rows.some(r => r.table === table && r.column === col)) continue;
        const m = c.definition.match(/ARRAY\[(.+)\]/);
        if (!m) continue;
        rows.push({ table, column: col, count: 0,
          vals: m[1].replace(/::text/g, '').replace(/'/g, '').split(',').map(s => s.trim()).join(' | '),
          enforced: 'CHECK constraint (no rows yet)', def: c.definition.replace(/\s+/g, ' ') });
      }
    }
  }
  const cols = [
    { h: 'Table', w: 30, f: r => r.table, wrap: false },
    { h: 'Column', w: 28, f: r => r.column, wrap: false },
    { h: 'Distinct', w: 9, f: r => r.count },
    { h: 'Values in use', w: 96, f: r => r.vals },
    { h: 'Enforced by', w: 24, f: r => r.enforced },
    { h: 'Constraint', w: 70, f: r => r.def },
  ];
  const ws = sheet('Allowed Values', cols, { title: 'Allowed Values', subtitle: 'what a slicer on this column will show', subtitleCol: 4 });
  rows.sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column))
      .forEach((r, i) => put(ws, 3 + i, cols, r, i % 2 === 1));
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: cols.length } };
}

// ══ 7 · Modelling Guide ═══════════════════════════════════════
{
  const ws = wb.addWorksheet('Modelling Guide');
  ws.getColumn(1).width = 30; ws.getColumn(2).width = 122;
  ws.getRow(1).getCell(1).value = 'Modelling Guide — building a Power BI model on this schema';
  ws.getRow(1).getCell(1).font = { size: 14, bold: true, color: { argb: NAVY } };
  let r = 3;
  for (const s of DESC.sections ?? []) {
    const row = ws.getRow(r++);
    row.getCell(1).value = s.heading;
    row.getCell(1).font = { bold: true, size: 11, color: { argb: NAVY } };
    row.getCell(1).alignment = { vertical: 'top', wrapText: true };
    row.getCell(2).value = s.body;
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(2).font = { size: 10 };
    row.height = Math.min(400, 14 * (s.body.split('\n').length + Math.ceil(s.body.length / 120)));
    r++;
  }
  if (!(DESC.sections ?? []).length) {
    ws.getRow(3).getCell(1).value = 'Not generated — run the documentation workflow.';
  }
}

const out = path.join(ROOT, `Risansi-Database-Guide-${S.generated_at}.xlsx`);
await wb.xlsx.writeFile(out);

const documented = S.columns.filter(c => descByCol.has(`${c.table_name}.${c.column_name}`)).length;
console.log(`wrote ${path.basename(out)}`);
console.log(`  ${wb.worksheets.length} sheets: ${wb.worksheets.map(w => w.name).join(', ')}`);
console.log(`  ${S.tables.length} tables, ${S.columns.length} columns`);
console.log(`  column meanings: ${documented}/${S.columns.length} (${Math.round(documented / S.columns.length * 100)}%)`);
console.log(`  modelling sections: ${(DESC.sections ?? []).length}`);
console.log(`  ER diagrams: ${CLUSTERS.length}`);
