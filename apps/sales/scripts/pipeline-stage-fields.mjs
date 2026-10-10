// One sheet: each pipeline stage, and the attributes recorded at it.
//
//   node scripts/pipeline-stage-fields.mjs
//
// Read straight from lib/risansi-opportunity-fields.ts, which is what the forms
// themselves use, so the sheet cannot drift from the app. Fields are cumulative
// up the linear pipeline — a field that appears at Quoted is present at
// Negotiating and Won too — plus the ones pinned to a single stage.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const src = readFileSync(path.join(ROOT, 'lib/risansi-opportunity-fields.ts'), 'utf8');

const STAGES = ['Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold', 'Won', 'Lost', 'Dropped'];
// On Hold and Dropped are not create stages; they sit alongside the linear rank
// they were moved from, so they carry the full quotation block.
const RANK = { Suspect: 0, Prospect: 1, Quoted: 2, Negotiating: 3, 'On Hold': 3, Won: 4, Lost: 4, Dropped: 3 };

// Parse the field catalogue out of the source rather than importing it — the
// module is TypeScript and pulls in other TS files.
const fields = [];
for (const m of src.matchAll(/\{\s*name:\s*'([a-z_]+)',\s*label:\s*'([^']+)'[\s\S]*?\},?\n/g)) {
  const block = m[0];
  if (!/step:\s*[12]/.test(block)) continue;
  const num = k => { const x = block.match(new RegExp(`${k}:\\s*(\\d+)`)); return x ? Number(x[1]) : null; };
  const list = k => {
    const x = block.match(new RegExp(`${k}:\\s*\\[([^\\]]*)\\]`));
    return x ? x[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean) : null;
  };
  const named = k => {
    const x = block.match(new RegExp(`${k}:\\s*([A-Z_]+)`));
    if (!x) return null;
    const c = src.match(new RegExp(`const ${x[1]}[^=]*=\\s*\\[([^\\]]*)\\]`));
    return c ? c[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean) : null;
  };
  fields.push({
    name: m[1], label: m[2], step: num('step'),
    visibleFrom: num('visibleFrom') ?? 0,
    onlyStages: list('onlyStages'),
    requiredAt: list('requiredAt') ?? named('requiredAt'),
  });
}
if (fields.length < 15) { console.error(`only parsed ${fields.length} fields — the catalogue shape changed`); process.exit(1); }

const appliesTo = (f, stage) =>
  f.onlyStages ? f.onlyStages.includes(stage) : RANK[stage] >= f.visibleFrom;

// Attributes that are not form fields but are recorded at a stage all the same.
const EXTRAS = {
  ALL: [
    ['Client', 'always'], ['Rep / owner', 'always'], ['Stage', 'always'],
    ['Created by', 'always'], ['Created on', 'always'], ['Last updated', 'always'],
  ],
  Quoted: [['Quote line items', 'list'], ['Offer revisions', 'list'], ['Quotation documents', 'files']],
  Won: [['Sales orders', 'list'], ['Purchase orders', 'list'], ['Order-in-hand rows', 'linked']],
  Dropped: [['Drop reason', 'required']],
};
const extrasFor = stage => [
  ...EXTRAS.ALL,
  ...(RANK[stage] >= 2 ? EXTRAS.Quoted : []),
  ...(stage === 'Won' ? EXTRAS.Won : []),
  ...(stage === 'Dropped' ? EXTRAS.Dropped : []),
];

const NAVY = 'FF0A3D8F', GREY = 'FF64748B', SOFT = 'FFEFF3FA', WARN = 'FF92400E';
const wb = new ExcelJS.Workbook();
wb.creator = 'Risansi Sales Portal';

const ws = wb.addWorksheet('Stage attributes', { views: [{ state: 'frozen', ySplit: 3 }] });
STAGES.forEach((_, i) => { ws.getColumn(i + 1).width = 26; });

ws.getCell('A1').value = 'Opportunity pipeline — attributes recorded at each stage';
ws.getCell('A1').font = { size: 14, bold: true, color: { argb: NAVY } };
ws.getCell('A2').value =
  'Fields are cumulative up the pipeline: anything listed at Quoted is also recorded at Negotiating, Won and Lost. '
  + 'Bold = mandatory at that stage.';
ws.getCell('A2').font = { size: 10, color: { argb: GREY } };

const head = ws.getRow(3);
STAGES.forEach((s, i) => {
  const cell = head.getCell(i + 1);
  cell.value = s;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
});
head.height = 20;

const perStage = STAGES.map(stage => {
  const own = fields.filter(f => appliesTo(f, stage))
    .map(f => ({ label: f.label, required: (f.requiredAt ?? []).includes(stage) }));
  const extra = extrasFor(stage).map(([label, kind]) => ({ label, required: kind === 'required', extra: true }));
  return [...extra, ...own];
});

const tallest = Math.max(...perStage.map(c => c.length));
for (let r = 0; r < tallest; r++) {
  const row = ws.getRow(4 + r);
  perStage.forEach((col, i) => {
    const item = col[r];
    if (!item) return;
    const cell = row.getCell(i + 1);
    cell.value = item.label;
    cell.font = { size: 10, bold: item.required, color: { argb: item.extra ? GREY : 'FF0F172A' } };
    cell.alignment = { vertical: 'top', wrapText: true };
    if (item.extra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
  });
}

const foot = ws.getRow(5 + tallest);
foot.getCell(1).value = 'Grey = recorded automatically or as a linked list, not typed on the form.';
foot.getCell(1).font = { size: 9.5, italic: true, color: { argb: WARN } };

STAGES.forEach((s, i) => {
  const cell = ws.getRow(4 + tallest).getCell(i + 1);
  cell.value = `${perStage[i].length} attributes`;
  cell.font = { size: 9.5, italic: true, color: { argb: GREY } };
  cell.border = { top: { style: 'thin', color: { argb: NAVY } } };
});

const out = path.join(ROOT, process.argv[2] || 'Risansi-Pipeline-Stage-Attributes.xlsx');
await wb.xlsx.writeFile(out);
console.log(`wrote ${path.basename(out)}`);
console.log(`  ${fields.length} form fields parsed from the catalogue`);
STAGES.forEach((s, i) => console.log(`  ${s.padEnd(13)} ${perStage[i].length} attributes`));
