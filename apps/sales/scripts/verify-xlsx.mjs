#!/usr/bin/env node
// Will Excel open this file?
//
//   node scripts/verify-xlsx.mjs reports/whatever.xlsx
//
// Chart XML is hand-written, and Excel's response to a malformed part is to
// announce the whole workbook is corrupt without saying which tag it disliked.
// So the file is taken apart here instead: every part parsed, every declared
// relationship followed, every content type checked, and the workbook re-read.
//
// Not a schema validator. It catches the mistakes that are actually made when
// writing OOXML by hand — a part referenced but missing, a relationship id that
// points nowhere, a content type never declared, unbalanced tags — which is the
// whole of what has gone wrong here so far.
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import ExcelJS from 'exceljs';

const file = process.argv[2];
if (!file) { console.error('usage: verify-xlsx.mjs <file.xlsx>'); process.exit(1); }
const buf = fs.readFileSync(file);
const zip = await JSZip.loadAsync(buf);

let bad = 0;
const fail = (msg) => { bad++; console.log('  FAIL  ' + msg); };
const ok = (msg) => console.log('  ok    ' + msg);

// ── 1. every XML part parses ──────────────────────────────────────
const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
const xmlParts = names.filter(n => n.endsWith('.xml') || n.endsWith('.rels'));
for (const name of xmlParts) {
  const text = await zip.file(name).async('string');
  const parser = new SaxesParser();
  let err = null;
  parser.on('error', e => { err = e.message; });
  parser.write(text).close();
  if (err) fail(`${name} — ${err}`);
}
if (!bad) ok(`${xmlParts.length} XML parts all parse`);

// ── 2. relationships point at parts that exist ────────────────────
for (const name of names.filter(n => n.endsWith('.rels'))) {
  const text = await zip.file(name).async('string');
  const base = path.posix.dirname(path.posix.dirname(name));   // strip _rels
  for (const m of text.matchAll(/Target="([^"]+)"[^>]*?(TargetMode="External")?\/>/g)) {
    if (m[2]) continue;                                        // external, not ours
    const target = m[1];
    if (/^https?:/.test(target)) continue;
    const resolved = path.posix.normalize(path.posix.join(base, target));
    if (!zip.file(resolved)) fail(`${name} points at ${target} → ${resolved}, which is not in the file`);
  }
}
if (!bad) ok('every relationship target exists');

// ── 3. r:id references resolve, part by part ──────────────────────
for (const name of names.filter(n => /\.(xml)$/.test(n) && !n.includes('_rels'))) {
  const text = await zip.file(name).async('string');
  const ids = [...text.matchAll(/r:id="(rId\d+)"/g)].map(m => m[1]);
  if (!ids.length) continue;
  const relName = path.posix.join(path.posix.dirname(name), '_rels', path.posix.basename(name) + '.rels');
  const rels = zip.file(relName) ? await zip.file(relName).async('string') : '';
  for (const id of new Set(ids)) {
    if (!rels.includes(`Id="${id}"`)) fail(`${name} uses ${id}, but ${relName} does not define it`);
  }
}
if (!bad) ok('every r:id resolves in its own rels part');

// ── 4. content types declared for everything ──────────────────────
const ct = await zip.file('[Content_Types].xml').async('string');
const defaults = new Set([...ct.matchAll(/Extension="([^"]+)"/g)].map(m => m[1].toLowerCase()));
for (const name of names) {
  if (name === '[Content_Types].xml') continue;
  if (ct.includes(`PartName="/${name}"`)) continue;
  // path.extname('.rels') is '' — Node treats a dot-leading basename as having
  // no extension, so the package's own _rels/.rels looked undeclared when the
  // Default Extension="rels" covers it perfectly well.
  const base = path.basename(name);
  const ext = (base.startsWith('.') ? base.slice(1) : path.extname(base).slice(1)).toLowerCase();
  if (defaults.has(ext)) continue;
  fail(`${name} has neither an Override nor a Default content type`);
}
if (!bad) ok('every part has a content type');

// ── 5. charts, specifically ───────────────────────────────────────
const charts = names.filter(n => /^xl\/charts\/chart\d+\.xml$/.test(n));
if (charts.length) {
  for (const name of charts) {
    const t = await zip.file(name).async('string');
    for (const need of ['<c:chartSpace', '<c:plotArea', '<c:ser>', '<c:axId', '<c:plotVisOnly']) {
      if (!t.includes(need)) fail(`${name} is missing ${need}`);
    }
    // Two axis ids per chart, and the series must reference a real sheet.
    const axes = [...t.matchAll(/<c:axId val="(\d+)"\/>/g)].map(m => m[1]);
    if (new Set(axes).size !== 2) fail(`${name} declares ${new Set(axes).size} distinct axis ids, expected 2`);
    for (const m of t.matchAll(/<c:f>([^<]+)<\/c:f>/g)) {
      if (!m[1].includes('!')) fail(`${name} has a data reference with no sheet: ${m[1]}`);
    }
  }
  const drawing = zip.file('xl/drawings/drawing1.xml');
  if (!drawing) fail('charts exist but xl/drawings/drawing1.xml does not');
  else {
    const d = await drawing.async('string');
    const frames = (d.match(/<xdr:graphicFrame/g) || []).length;
    if (frames !== charts.length) fail(`${frames} graphic frames for ${charts.length} charts`);
  }
  const sheet1 = await zip.file('xl/worksheets/sheet1.xml').async('string');
  if (!sheet1.includes('<drawing ')) fail('sheet1 does not reference the drawing');

  // CT_Worksheet is a SEQUENCE, not a bag. An element in the wrong position is
  // exactly what Excel reports as "we found a problem with some content", naming
  // the file and nothing else — so the order is checked here rather than
  // discovered by opening it. This caught <drawing/> being appended after the
  // worksheet's extLst, which is one position too late.
  const ORDER = [
    'sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData',
    'sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter',
    'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr',
    'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions',
    'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
    'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing',
    'legacyDrawing', 'legacyDrawingHF', 'drawingHF', 'picture', 'oleObjects',
    'controls', 'webPublishItems', 'tableParts', 'extLst',
  ];
  // Top-level children only: everything at depth 1 inside <worksheet>.
  const seen = [];
  let depth = 0;
  for (const m of sheet1.matchAll(/<(\/?)([A-Za-z][\w:]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (name === 'worksheet') { depth += close ? -1 : 1; continue; }
    if (depth === 1 && !close) seen.push(name);
    if (!close && !self) depth += 1;
    else if (close) depth -= 1;
  }
  const positions = seen.map(n => ({ n, i: ORDER.indexOf(n) })).filter(x => x.i >= 0);
  for (let i = 1; i < positions.length; i++) {
    if (positions[i].i < positions[i - 1].i) {
      fail(`sheet1 has <${positions[i].n}> after <${positions[i - 1].n}> — CT_Worksheet requires the reverse, and Excel will call the file corrupt`);
    }
  }
  const unknown = seen.filter(n => !ORDER.includes(n));
  if (unknown.length) fail(`sheet1 has unrecognised top-level element(s): ${[...new Set(unknown)].join(', ')}`);
  if (!bad) ok(`${charts.length} charts, wired to a drawing that sheet1 references last`);
}

// ── 6. and it still reads as a workbook ───────────────────────────
try {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheets = wb.worksheets.map(w => `${w.name} (${w.rowCount}×${w.columnCount})`);
  ok(`re-reads as a workbook: ${sheets.join(', ')}`);
} catch (e) {
  fail(`will not re-read: ${e.message}`);
}

console.log(bad === 0
  ? `\n${path.basename(file)} is structurally sound — ${(buf.length / 1024).toFixed(0)} KB\n`
  : `\n${bad} problem(s). Excel would refuse this file.\n`);
process.exit(bad === 0 ? 0 : 1);
