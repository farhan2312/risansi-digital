#!/usr/bin/env node
// Every list or sum over opportunities on a commercial surface must exclude
// the opportunities of an archived client.
//
//   node scripts/opportunity-scope-check.mjs      (runs as part of `npm run build`)
//
// Archiving a client takes its opportunities with it — not by flagging them,
// but because every query that lists or totals opportunities asks whether the
// client still exists (lib/risansi-opportunity-scope). That holds only if every
// such query does ask, and a new tile written next month will not know to. So
// this reads the source: in each file on the list below, every SQL template
// that reads FROM opportunities must carry the guard — the literal
// `deleted_at IS NULL`, a call to LIVE_CLIENT / AND_LIVE_CLIENT, or an
// interpolated fragment whose own definition in that file carries one of those
// (that is how the board, the dashboard and the projection do it: one shared
// fragment, guarded once).
//
// Exempt, by shape rather than by name: a read of one record by id, a
// correlated subquery scoped to a client row that is itself already live
// (`client_id = c.id`), and activity counts by creator (`o.created_by`), which
// measure what a person did and must not shrink when a client is archived.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

// The surfaces where an archived client's opportunities would still show as
// money or as rows. Activity metrics (audit overall's output tile and funnel,
// person metrics) are deliberately not here — see the note above.
const FILES = [
  'app/risansi/page.tsx',
  'app/risansi/pipeline/page.tsx',
  'app/risansi/executive-review/page.tsx',
  'app/risansi/mobile/page.tsx',
  'app/risansi/compete/page.tsx',
  'app/actions/risansi-exec-drilldown.ts',
  'app/actions/risansi-dashboard-drilldown.ts',
  'app/actions/risansi-audit-drilldown.ts',
  'app/api/risansi/opportunities/export/route.ts',
  'lib/risansi-stage-rows.ts',
  'lib/risansi-sales-projection.ts',
  'lib/risansi-audit-overall.ts',
];

const GUARD = /deleted_at IS NULL|LIVE_CLIENT\(|AND_LIVE_CLIENT\(/;
const EXEMPT = /WHERE\s+(o\.)?id\s*=\s*\$1|client_id\s*=\s*c\.id|client_id\s*=\s*\$1\b|o\.created_by|opportunity_id\s*=\s*o\.id/;

// Modules that hand a guarded fragment to the surfaces above.
//
// A page and the drill-down behind it have to build their scope from one
// predicate or they drift apart, and that predicate then lives in a library
// rather than in either file — so the guard is no longer visible where the
// query is written. These modules are READ with the same machinery rather than
// trusted by name: deleting AND_LIVE_CLIENT from one of them un-guards every
// helper built on it and fails this check, instead of slipping past it.
const SHARED = ['lib/risansi-exec-review.ts', 'lib/risansi-dashboard.ts'];
const sharedGuarded = new Set();
for (const rel of SHARED) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  for (const name of guardedNames(fs.readFileSync(file, 'utf8'))) sharedGuarded.add(name);
}

let problems = 0, checked = 0;
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.log(`  ${rel}: missing — remove it from the list or restore it`); problems++; continue; }
  const src = fs.readFileSync(file, 'utf8');

  // Identifiers whose definition carries a guard, e.g.
  //   const oppOwnerAnd = (…) + AND_LIVE_CLIENT('o');
  //   const OPEN = `… AND ${LIVE_CLIENT('o')}`;
  //   const tourF = tsm ? `(… AND c.deleted_at IS NULL …)` : 'FALSE';
  // Guard carries through: a fragment built from a guarded fragment is guarded
  // (wonWhere is built from ownerVisAnd, which carries AND_LIVE_CLIENT), so the
  // set is grown to a fixed point.
  // Seeded with the shared modules' guarded helpers, then grown over this
  // file's own definitions — so a local fragment built from an imported one is
  // guarded too.
  const guarded = new Set(sharedGuarded);
  // execScopeSql carries the guard inside lib/risansi-exec-review.ts.
  if (/execScopeSql\(/.test(src)) guarded.add('scope');
  for (const name of guardedNames(src, guarded)) guarded.add(name);

  for (const t of templates(src)) {
    if (!/FROM\s+opportunities\b/.test(t.text)) continue;
    // A template may hold several statements (UNION ALL arms, or several
    // statements separated by semicolons); each is judged on its own.
    const parts = t.text.split(/;|\bUNION\s+ALL\b/i).filter(p => /FROM\s+opportunities\b/.test(p));
    for (const p of parts) {
      checked++;
      if (GUARD.test(p) || EXEMPT.test(p)) continue;
      const idents = [...p.matchAll(/\$\{\s*(\w+)/g)].map(m => m[1]);
      if (idents.some(i => guarded.has(i))) continue;
      problems++;
      const lineNo = src.slice(0, t.index).split('\n').length;
      console.log(`  ${rel}:${lineNo}`);
      console.log(`    reads FROM opportunities without excluding archived clients`);
      console.log(`    ${p.replace(/\s+/g, ' ').trim().slice(0, 140)}`);
    }
  }
}

console.log(`\n${checked} opportunity read(s) checked across ${FILES.length} files`);
console.log(problems ? `${problems} would still show an archived client's opportunities` : "every one excludes archived clients' opportunities");
process.exit(problems ? 1 : 0);

/**
 * The identifiers in one file whose value carries the archived-client guard.
 *
 * Guard carries through: a fragment built from a guarded fragment is guarded
 * (wonWhere is built from ownerVisAnd, which carries AND_LIVE_CLIENT), so the
 * set is grown to a fixed point. `seed` lets a file start from the helpers an
 * imported module already proved guarded.
 */
function guardedNames(src, seed = new Set()) {
  const defs = definitions(src);
  const guarded = new Set(seed);
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, body] of defs) {
      if (guarded.has(name)) continue;
      const refs = [...body.matchAll(/\b(\w+)\b/g)].map(m => m[1]);
      if (GUARD.test(body) || refs.some(r => guarded.has(r))) { guarded.add(name); grew = true; }
    }
  }
  return guarded;
}

/** Template literals in the source, with their start offsets. */
function templates(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === '`') {
      const start = i; i++;
      let depth = 0, text = '';
      while (i < src.length) {
        const ch = src[i];
        if (ch === '\\') { text += ch + src[i + 1]; i += 2; continue; }
        if (ch === '$' && src[i + 1] === '{') { depth++; text += '${'; i += 2; continue; }
        if (ch === '}' && depth > 0) { depth--; text += ch; i++; continue; }
        if (ch === '`' && depth === 0) { i++; break; }
        text += ch; i++;
      }
      out.push({ index: start, text });
      continue;
    }
    // skip line and block comments so a backtick in prose does not open a template
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    i++;
  }
  return out;
}

/**
 * Every `const x = …;` / `let x = …;` in the source as [name, body]. The body is
 * read by a scanner that respects (), [], {} and string / template literals,
 * so a definition whose value holds a semicolon inside a template, or that is
 * followed by more code on the same line, still ends where it actually ends. A
 * regex that stopped at the next ";\n" swallowed the definitions after it.
 */
function definitions(src) {
  const out = [];
  const re = /\b(?:const|let)\s+(\w+)\s*(?::[^=]*?)?=(?!=)/g;
  for (const m of src.matchAll(re)) {
    let i = m.index + m[0].length, depth = 0, body = '';
    while (i < src.length) {
      const ch = src[i];
      if (ch === "'" || ch === '"' || ch === '`') {
        // A literal is copied whole. Template ${…} is not descended into; the
        // identifiers inside still appear in the body text, which is enough.
        const q = ch; let j = i + 1;
        while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++; }
        body += src.slice(i, j + 1); i = j + 1; continue;
      }
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
      else if (ch === ';' && depth === 0) break;
      body += ch; i++;
    }
    out.push([m[1], body]);
  }
  return out;
}
