#!/usr/bin/env node
// Find INSERT statements whose column list and placeholder list disagree.
//
//   node scripts/sql-placeholder-audit.mjs      (also runs as part of `npm run build`)
//
// This exists because `INSERT INTO opportunity_items (…10 columns…) VALUES
// ($1..$11)` shipped and stood for seven weeks. Nothing caught it: it type-checks,
// it builds, and it only fails at runtime on the row that reaches it — which for
// that one was every quotation save carrying a line item. Counting two lists is
// the whole check, so it may as well be automatic.
//
// It reads the statements with a paren scanner rather than a regex. The regex
// version required `)` immediately before VALUES, so writing a `-- ten columns,
// ten values` comment between them made both of the statements this was built to
// watch invisible, and the audit then reported clean with the bug present. A
// checker that goes quiet when you annotate the code is worse than none, because
// the clean result gets believed. Anything it cannot read is now reported and
// fails the run.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SELF = path.join(ROOT, 'scripts', 'sql-placeholder-audit.mjs');
const DIRS = ['app', 'lib', 'components', 'scripts', 'migrations'];
const EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.sql']);

const files = [];
for (const d of DIRS) {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) continue;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      // This file necessarily quotes the very shape it hunts for, in prose.
      else if (EXT.has(path.extname(e.name)) && full !== SELF) files.push(full);
    }
  })(abs);
}

/** Advance past whitespace and `-- …` line comments. */
function skipGap(s, i) {
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === '-' && s[i + 1] === '-') { while (i < s.length && s[i] !== '\n') i++; continue; }
    return i;
  }
}

/** Read a balanced (...) group starting at an open paren. Returns [inner, end]. */
function readParens(s, i) {
  if (s[i] !== '(') return null;
  let depth = 0, quote = null;
  const start = i;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return [s.slice(start + 1, i), i + 1]; }
  }
  return null;
}

/** Split a list on commas at depth zero, ignoring commas inside (...) or quotes. */
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '', quote = null;
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const HEAD = /INSERT\s+INTO\s+([A-Za-z_][\w.]*)/gi;

let problems = 0, checked = 0, interpolated = 0, fromSelect = 0, unreadable = 0;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lineAt = (idx) => src.slice(0, idx).split('\n').length;

  for (const m of src.matchAll(HEAD)) {
    const table = m[1];
    const at = m.index;
    // "Try full insert into opportunities table" is a sentence, not a statement.
    // Matches sitting inside a comment are skipped rather than reported as
    // unreadable SQL: a checker that cries wolf gets muted, and a muted checker
    // is the state this one was already in once.
    const before = src.slice(src.lastIndexOf('\n', at) + 1, at);
    if (/(^|\s)(\/\/|\*|--)/.test(before)) continue;

    const where = `${rel}:${lineAt(at)}  INSERT INTO ${table}`;

    let i = skipGap(src, at + m[0].length);
    const colsPart = readParens(src, i);
    if (!colsPart) { unreadable++; console.log(`\n  ${where}\n    no column list found — not checked`); continue; }
    const [colsRaw, afterCols] = colsPart;

    i = skipGap(src, afterCols);
    // INSERT … SELECT has no value list to compare against; the column count is
    // checked by Postgres against the SELECT at plan time, not by counting here.
    if (/^select/i.test(src.slice(i, i + 6))) { fromSelect++; continue; }
    if (!/^values/i.test(src.slice(i, i + 6))) {
      unreadable++; console.log(`\n  ${where}\n    no VALUES or SELECT after the column list — not checked`);
      continue;
    }

    i = skipGap(src, i + 6);
    // Two different things get conflated here, so they are told apart.
    //
    // No open paren after VALUES means there is no literal list in the source at
    // all — `VALUES ${ph.join(',')}` in the bulk importers, or a row built by
    // concatenating template literals. Nothing to count; not a fault.
    //
    // An open paren that will not close is a statement this script genuinely
    // cannot read, and that one has to be loud.
    if (src[i] !== '(') { interpolated++; continue; }
    const valsPart = readParens(src, i);
    if (!valsPart) { unreadable++; console.log(`\n  ${where}\n    could not read the VALUES list — not checked`); continue; }
    const [valsRaw] = valsPart;

    // A list built by interpolation cannot be counted from the source.
    if (colsRaw.includes('${') || valsRaw.includes('${')) { interpolated++; continue; }

    const strip = (t) => t.replace(/--[^\n]*/g, '');
    const cols = splitTop(strip(colsRaw)).filter(Boolean);
    const vals = splitTop(strip(valsRaw)).filter(Boolean);
    checked++;

    if (cols.length !== vals.length) {
      problems++;
      console.log(`\n  ${where}`);
      console.log(`    ${cols.length} columns but ${vals.length} values`);
      console.log(`    columns: ${cols.join(', ')}`);
      console.log(`    values:  ${vals.join(', ')}`);
      continue;
    }

    // Placeholders must run $1..$N with nothing missing. A gap binds the wrong
    // value into the wrong column and writes silently, which is worse than the
    // mismatch above: that one at least errors.
    const nums = [...`${colsRaw}${valsRaw}`.matchAll(/\$(\d+)/g)].map(x => Number(x[1]));
    if (nums.length) {
      const max = Math.max(...nums);
      const seen = new Set(nums);
      const missing = [];
      for (let n = 1; n <= max; n++) if (!seen.has(n)) missing.push(n);
      if (missing.length) {
        problems++;
        console.log(`\n  ${where}`);
        console.log(`    placeholders run to $${max} but $${missing.join(', $')} never appear`);
      }
    }
  }
}

console.log(`\n${checked} INSERT statements checked` +
  `, ${interpolated} built by interpolation` +
  `, ${fromSelect} INSERT…SELECT` +
  (unreadable ? `, ${unreadable} UNREADABLE` : ''));
if (unreadable) {
  console.log('An INSERT this script cannot read is one it cannot vouch for.');
  console.log('Either rewrite the statement or teach the scanner to read it.');
}
console.log(problems ? `${problems} problem(s)` : 'every column list matches its value list');
// Unreadable statements fail the run too: passing on partial coverage while
// printing a warning nobody reads is exactly how the false clean happened.
process.exit(problems || unreadable ? 1 : 0);
