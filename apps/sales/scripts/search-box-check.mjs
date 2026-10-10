#!/usr/bin/env node
// A search box must not eat what is typed into it.
//
// Every box that debounces a navigation and then reads its value back from the
// server is racing: the round trip for "bal" lands while "bala" is on screen,
// the box adopts the older value, and a character vanishes under the cursor.
// It has been fixed twice — once with no guard, once with a guard that only
// compared against the most recent push and so mistook a *stale* echo for
// somebody else's change. lib/risansi-search-box.ts is the third attempt and
// the only one with a test behind it.
//
// This check does not re-test the hook. It stops a fourth hand-rolled copy of
// the pattern appearing: a component that keeps a text box in state, pushes to
// the URL on a timer, and syncs the value back from props must use the hook.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const HOOK = '@/lib/risansi-search-box';

const walk = (dir) => readdirSync(dir).flatMap(name => {
  const full = path.join(dir, name);
  if (name === 'node_modules' || name.startsWith('.')) return [];
  return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : [];
});

const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))];
const offenders = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (src.includes(HOOK)) continue;                       // already using it

  const hasTextBox   = /<input[^>]*\bvalue=\{/.test(src) || /<input\s+type="search"/.test(src);
  const debounces    = /setTimeout\(/.test(src);
  const navigates    = /router\.(push|replace)\(/.test(src);
  // The tell: state seeded from a prop or a search param, and an effect that
  // writes that same source back into the state.
  const syncsFromUrl = /useEffect\(\s*\(\)\s*=>\s*\{?\s*set[A-Z]\w*\(\s*(current|search|init\w*|q|value|fromUrl)\s*\)/.test(src);

  if (hasTextBox && debounces && navigates && syncsFromUrl) {
    offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'));
  }
}

if (offenders.length) {
  console.error('\n  A debounced URL search box is syncing its value back from the URL by hand.');
  console.error('  That is the race that deletes characters while somebody types (see');
  console.error(`  ${HOOK}). Use useSearchBox instead:\n`);
  for (const f of offenders) console.error(`    ${f}`);
  console.error('');
  process.exit(1);
}

const users = files.filter(f => readFileSync(f, 'utf8').includes(HOOK)).length;
console.log(`✓ search boxes: ${users} using useSearchBox, no hand-rolled URL sync`);
