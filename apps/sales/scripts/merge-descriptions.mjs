// Merge the documentation workflow's per-domain output into descriptions.json.
//
//   node scripts/merge-descriptions.mjs <workflow-journal.jsonl>
//
// Reads the journal rather than a pasted result: the payloads run to tens of
// thousands of characters and are truncated in the notification. Each agent was
// asked for strict JSON, but models wrap it in prose or a code fence often
// enough that extracting the outermost object is worth doing properly.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const journal = process.argv[2];
if (!journal || !existsSync(journal)) {
  console.error('usage: node scripts/merge-descriptions.mjs <journal.jsonl>');
  process.exit(1);
}

/** Pull the first balanced {...} out of a string, ignoring braces inside strings. */
function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

const tables = [];
const sections = [];
let parsed = 0, failed = 0;

for (const line of readFileSync(journal, 'utf8').trim().split(/\r?\n/)) {
  let rec;
  try { rec = JSON.parse(line); } catch { continue; }
  if (rec.type !== 'result' || typeof rec.result !== 'string') continue;

  const raw = extractJson(rec.result);
  if (!raw) { failed++; continue; }
  let obj;
  try { obj = JSON.parse(raw); } catch { failed++; continue; }
  parsed++;

  if (Array.isArray(obj.tables)) tables.push(...obj.tables);
  if (Array.isArray(obj.sections)) sections.push(...obj.sections);
}

// A table documented twice (a retry, or two groups overlapping) keeps the
// version with more columns rather than whichever landed last.
const byTable = new Map();
for (const t of tables) {
  const prev = byTable.get(t.table);
  if (!prev || (t.columns?.length ?? 0) > (prev.columns?.length ?? 0)) byTable.set(t.table, t);
}

const out = { tables: [...byTable.values()], sections };
writeFileSync(path.join(ROOT, 'descriptions.json'), JSON.stringify(out, null, 1));

const cols = out.tables.reduce((n, t) => n + (t.columns?.length ?? 0), 0);
console.log(`parsed ${parsed} agent result(s), ${failed} unparseable`);
console.log(`  ${out.tables.length} tables, ${cols} column descriptions, ${sections.length} guide sections`);

// Say plainly what the schema has that the documentation does not, rather than
// letting a gap show up as blank cells in the workbook.
if (existsSync(path.join(ROOT, 'schema.tmp.json'))) {
  const S = JSON.parse(readFileSync(path.join(ROOT, 'schema.tmp.json'), 'utf8'));
  const documented = new Set(out.tables.map(t => t.table));
  const missingTables = S.tables.map(t => t.table_name).filter(t => !documented.has(t));
  const have = new Set(out.tables.flatMap(t => (t.columns ?? []).map(c => `${t.table}.${c.column}`)));
  const missingCols = S.columns.filter(c => !have.has(`${c.table_name}.${c.column_name}`));
  console.log(`  coverage: ${S.columns.length - missingCols.length}/${S.columns.length} columns`
    + ` (${Math.round((S.columns.length - missingCols.length) / S.columns.length * 100)}%)`);
  if (missingTables.length) console.log(`  tables with no description: ${missingTables.join(', ')}`);
  if (missingCols.length && missingCols.length < 40) {
    console.log(`  columns with no description: ${missingCols.map(c => `${c.table_name}.${c.column_name}`).join(', ')}`);
  }
}
