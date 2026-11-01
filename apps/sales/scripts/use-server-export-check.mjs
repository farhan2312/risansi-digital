#!/usr/bin/env node
// A 'use server' module may export async functions and nothing else.
//
//   node scripts/use-server-export-check.mjs      (runs as part of `npm run build`)
//
// Next turns every export of a 'use server' file into a server reference at
// build time. A type declared and exported in the same file is erased first
// and costs nothing. A type IMPORTED from elsewhere and then re-exported is
// not: the transform emits a reference to a binding that no longer exists,
// and the module throws on evaluation —
//
//     ReferenceError: DrillRow is not defined ... at module evaluation
//
// — the first time anything calls an action in it. EVERY action in the file
// rejects before a line of its own code runs, so no try/catch inside those
// actions can see it and nothing they could record is recorded. All eleven
// drill-downs on the landing dashboard answered 500 for a day over one line
// (`export type { DrillRow };`), and the only trace anywhere was a digest in
// the platform's log.
//
// tsc is happy with it. The build is happy with it. It fails at runtime, in
// production, on a path no test exercises. So it is checked here.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const files = [];
for (const d of ['app', 'lib', 'components']) {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) continue;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) files.push(full);
    }
  })(abs);
}

let bad = 0;
let checked = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  // The directive has to be the first statement for Next to treat the file as
  // a server-action module, so only look at the head.
  if (!/^\s*(['"])use server\1/.test(src)) continue;
  checked++;
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  // Every name this file imports. A re-export is only dangerous when the name
  // came from somewhere else; `export type Foo = …` declared here is erased.
  const imported = new Set();
  for (const m of src.matchAll(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name) imported.add(name);
    }
  }

  for (const m of src.matchAll(/^export\s+(type\s+)?\{([^}]*)\}\s*(from\s+['"][^'"]+['"])?\s*;/gm)) {
    const line = src.slice(0, m.index).split('\n').length;
    const names = m[2].split(',').map(s => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const offenders = m[3] ? names : names.filter(n => imported.has(n));
    if (!offenders.length) continue;
    bad++;
    console.log(`  FAIL ${rel}:${line} re-exports ${offenders.join(', ')} from a 'use server' module`);
    console.log('       Every export here becomes a server reference, and a re-exported binding');
    console.log('       has none — the module dies on evaluation and every action in it rejects.');
    console.log('       Move the declaration to a plain module and import it from there.');
  }
}

console.log(bad
  ? `\n${bad} bad re-export(s) across ${checked} 'use server' file(s)`
  : `  ok   ${checked} 'use server' files export nothing they imported`);
process.exit(bad ? 1 : 0);
