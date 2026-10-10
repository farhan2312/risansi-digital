#!/usr/bin/env node
// Every action that returns a refusal must have its refusal read.
//
//   node scripts/action-result-check.mjs      (runs as part of `npm run build`)
//
// Converting an action from `throw` to `return { ok: false }` is only half the
// job. TypeScript is perfectly happy with a caller that ignores the return
// value, so a forgotten call site turns a refusal into a silent success — the
// save appears to work and nothing was written. That is worse than the redacted
// error this whole change exists to remove.
//
// So: find the actions whose return type is a result, find their callers, and
// insist each one looks at `.ok`.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const files = [];
for (const d of ['app', 'components', 'lib']) {
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

// Exported async functions whose declared return type is one of the result
// shapes. Read from the source so adding another one needs no edit here.
// The return type is read by skipping the parameter list with matched parens
// and then reading up to the body's opening brace — not with `[^{]+`. That
// shortcut stopped at the brace INSIDE `Result<{ id: number }>` and quietly
// dropped two pump actions from this list, which is the exact silent-success
// this script exists to catch.
const RESULT_TYPES = /Promise<\s*(SaveResult|CreateResult|Result\b)/;
const actions = new Map();                       // name -> declaring file
const declared = new Map();                      // every exported async fn name -> [files]
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  for (const m of src.matchAll(/export async function (\w+)\s*\(/g)) {
    declared.set(m[1], [...(declared.get(m[1]) ?? []), rel]);
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; i++; }
    const ret = src.slice(i, i + 400).match(/^\s*:\s*([\s\S]*?)\s*\{/);
    if (ret && RESULT_TYPES.test(ret[1])) actions.set(m[1], rel);
  }
}

// Call sites are matched by name, so two exported actions sharing one is a
// hole: a caller of the other one is either flagged wrongly or, worse, a
// caller of this one is excused because it looked like the other. That is not
// a warning; rename one of them. (checkInVisit was declared twice — the phone's
// create-and-check-in and the report's check-in — and the first was exactly this.)
for (const [name] of actions) {
  const where = declared.get(name) ?? [];
  if (where.length > 1) {
    console.log(`${name}() is exported from ${where.length} files — ${where.join(', ')}`);
    console.log('  the check tells callers apart by name, so it cannot tell these apart. Rename one.');
    process.exit(1);
  }
}

let problems = 0, checked = 0;
console.log(`${actions.size} action(s) return a result: ${[...actions.keys()].join(', ')}\n`);

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = src.split('\n');

  for (const [name] of actions) {
    // Call sites, excluding the declaration itself and import lines.
    const re = new RegExp(`(^|[^.\\w])${name}\\s*\\(`, 'g');
    for (const m of src.matchAll(re)) {
      const at = m.index;
      const lineNo = src.slice(0, at).split('\n').length;
      const line = lines[lineNo - 1];
      if (/^\s*(import|export async function|\*|\/\/)/.test(line)) continue;
      if (line.includes('from \'@/app/actions')) continue;
      checked++;

      // The result has to be captured and inspected. Accept either an assignment
      // whose variable is later tested for .ok, or an inline `.ok` test.
      const assigned = line.match(/(?:const|let)\s+(\w+)\s*=\s*await\s/);
      // Twelve lines, not six: a call whose argument is an object literal spans
      // several lines before the `.ok` test can appear, and a correct call site
      // must not be flagged for being well formatted.
      const window = lines.slice(lineNo - 1, lineNo + 12).join('\n');
      let readsOk = assigned
        ? new RegExp(`${assigned[1]}\\.ok`).test(window)
        : /\.ok\b/.test(window);

      // A call handed to a local helper as a thunk — `run(() => save(x), …)`.
      // The `.ok` test lives in the helper, not here, so look it up: the helper
      // has to be declared in this same file and its own body has to read .ok.
      // Narrow on purpose — it sees through one named wrapper, not a chain, so
      // it cannot be used to park a refusal behind a function that ignores it.
      if (!readsOk) {
        const thunk = line.match(new RegExp(String.raw`\b(\w+)\(\s*(?:async\s*)?\(\)\s*=>\s*` + name + String.raw`\(`));
        if (thunk && thunk[1] !== name) {
          const decl = src.search(new RegExp(String.raw`const ` + thunk[1] + String.raw`\s*=|function ` + thunk[1] + String.raw`\b`));
          if (decl >= 0) {
            const from = src.slice(0, decl).split('\n').length - 1;
            readsOk = /\.ok\b/.test(lines.slice(from, from + 20).join('\n'));
          }
        }
      }

      if (!readsOk) {
        problems++;
        console.log(`  ${rel}:${lineNo}`);
        console.log(`    calls ${name}() and never looks at .ok — a refusal here is silent`);
        console.log(`    ${line.trim()}`);
      }
    }
  }
}


// ── The other half: refusals that are still thrown ─────────────────────────
//
// An action that THROWS its refusal is worse than one that returns it badly,
// because the message never arrives at all: Next redacts a thrown
// server-action message in production, and the user is shown "An error
// occurred in the Server Components render". That has cost real time three
// times now — a client that would not save because its code belonged to an
// archived record, a meeting refused for a blank company name, a business
// card refused for its format. Each time somebody had written a careful
// sentence explaining exactly what to do, and the framework ate it.
//
// This started as a ratchet over thirty-six such actions, listing the known
// ones so the build failed only on a new one. The list is empty now: every
// action returns its refusals. The last three names on it — createOpportunity,
// submitOpportunity and updateClientTier — were endpoints nothing imported, and
// they were deleted rather than converted, because a refusal returned to no
// caller is not worth writing.
//
// Empty, this is a wall rather than a ratchet, which is the point: the next
// action to throw a refusal fails the build instead of joining a list.
//
// Not every throw counts. An auth or lock guard that throws is fine: it is not
// telling somebody how to fix what they typed, and it reads the same in every
// action. What is caught is a thrown SENTENCE — eighteen characters or more —
// in an action that does not return a result.

const THROWS_ITS_REFUSAL = new Set([]);

const throwers = new Map();                      // name -> the sentences it throws
for (const file of files) {
  if (!file.replace(/\\/g, '/').includes('/app/actions/')) continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/export async function (\w+)\s*\(/g)) {
    let i = m.index + m[0].length, d = 1;
    while (i < src.length && d > 0) { const c = src[i]; if (c === '(') d++; else if (c === ')') d--; i++; }
    const ret = (src.slice(i, i + 400).match(/^\s*:\s*([\s\S]*?)\s*\{/) || [])[1] || '';
    if (RESULT_TYPES.test(ret)) continue;        // this one already returns its refusals

    const start = src.indexOf('{', i);
    let j = start, depth = 0;
    do { const c = src[j]; if (c === '{') depth++; else if (c === '}') depth--; j++; } while (j < src.length && depth > 0);
    // Each quote style gets its own alternative, so the other two are allowed
    // inside it. The single character class this used to be made a template
    // literal invisible as soon as it interpolated anything containing a quote
    // — which hid `Cannot close yet — ${missing.join('; ')}.`, the one sentence
    // that lists everything still blocking a close.
    const said = [...src.slice(start, j).matchAll(
      /throw new Error\(\s*(?:'([^']{18,})'|"([^"]{18,})"|`([^`]{18,})`)/g)]
      .map(x => x[1] ?? x[2] ?? x[3])
      // "Upload log not found" is a guard that happens to be long: it tells
      // nobody how to fix anything and reads the same in every action. Length
      // alone already excludes 'Unauthorized' and 'Invalid user id'.
      .filter(s => !/\bnot found\.?$/i.test(s));
    if (said.length) throwers.set(m[1], said);
  }
}

// ── The third half: a private helper that throws on an action's behalf ─────
//
// An action can return every refusal it writes itself and still redact one, by
// calling a helper that throws. The exhibitions module did exactly that for a
// while: twelve actions returned their refusals, and all of them went through
// assertCanManage, which threw "You are not on this exhibition's team." Nothing
// above could see it, because the two checks over this file only ever looked at
// exported actions.
//
// A helper that throws is only a problem when a result-returning action calls
// it — that action's contract says refusals come back, and this one does not.
// A helper used only by code that throws anyway is left alone.
// Sentences that are assertions rather than advice. Length already excludes
// 'Unauthorized' and 'Invalid user id'; these are the longer ones that are
// still the same in every action and tell nobody how to proceed. "You do not
// have permission to change this task" is deliberately NOT here: that one
// names what was refused, and redacted it reaches somebody as "An error
// occurred" when it could have told them to ask the owner.
const IS_A_GUARD = /\bnot found\.?$|access required\.?$|^Unauthorized|^Not authenticated|^Invalid |^Not a \w+:/i;

const leakyHelpers = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (!rel.includes('app/actions/')) continue;
  const src = fs.readFileSync(file, 'utf8');

  const bodyOf = (declRe) => {
    const out = new Map();
    for (const m of src.matchAll(declRe)) {
      const start = src.indexOf('{', m.index + m[0].length - 1);
      if (start < 0) continue;
      let j = start, depth = 0;
      do { const c = src[j]; if (c === '{') depth++; else if (c === '}') depth--; j++; }
      while (j < src.length && depth > 0);
      out.set(m[1], { body: src.slice(start, j), line: src.slice(0, m.index).split('\n').length });
    }
    return out;
  };

  // Private: declared without `export` in front of it.
  const privates = bodyOf(/(?:^|\n)\s*(?:async )?function (\w+)\s*\(/g);
  const exported = bodyOf(/(?:^|\n)export async function (\w+)\s*\(/g);

  for (const [name, { body, line }] of privates) {
    if (exported.has(name)) continue;
    const said = [...body.matchAll(
      /throw new Error\(\s*(?:'([^']{18,})'|"([^"]{18,})"|`([^`]{18,})`)/g)]
      .map(x => x[1] ?? x[2] ?? x[3])
      .filter(s => !IS_A_GUARD.test(s));
    if (!said.length) continue;

    const callers = [...actions.keys()].filter(a => {
      const e = exported.get(a);
      return e && new RegExp(`(^|[^.\\w])${name}\\s*\\(`).test(e.body);
    });
    if (callers.length) leakyHelpers.push({ rel, line, name, said, callers });
  }
}

const newThrowers = [...throwers.keys()].filter(n => !THROWS_ITS_REFUSAL.has(n));
const nowReturning = [...THROWS_ITS_REFUSAL].filter(n => !throwers.has(n));

// Named, not just counted: the count alone sent the last reader grepping for
// which three they were.
console.log(`\n${throwers.size} action(s) still throw a refusal instead of returning it`
  + (throwers.size && throwers.size <= 8 ? `: ${[...throwers.keys()].join(', ')}` : ''));
if (nowReturning.length) {
  console.log(`  ${nowReturning.length} no longer do — delete from THROWS_ITS_REFUSAL: ${nowReturning.join(', ')}`);
}
for (const n of newThrowers) {
  console.log(`\n  ${n}() throws a message the user will never see:`);
  for (const t of throwers.get(n).slice(0, 3)) console.log(`      "${t.slice(0, 96)}"`);
}
if (newThrowers.length) {
  console.log('\n  Next redacts a thrown server-action message in production, so this reaches');
  console.log('  somebody as "An error occurred" and they try the same thing again.');
  console.log('  Return SaveResult or CreateResult and have the caller read .ok, the way the');
  console.log('  actions listed at the top of this check already do.');
}

for (const h of leakyHelpers) {
  console.log(`\n  ${h.rel}:${h.line}`);
  console.log(`    ${h.name}() throws a refusal on behalf of ${h.callers.length} action(s) that return theirs:`);
  console.log(`      ${h.callers.slice(0, 6).join(', ')}${h.callers.length > 6 ? ', …' : ''}`);
  for (const t of h.said.slice(0, 2)) console.log(`      "${t.slice(0, 96)}"`);
  console.log('    Have it return a result and let each caller return that, or keep the');
  console.log('    throw and make the sentence a guard rather than advice.');
}

// Counted separately. They used to share one number and one sentence, which
// read as "3 call sites ignore a refusal" when in fact no call site did and
// three actions had grown a new thrown one.
console.log(`\n${checked} call site(s) checked`);
console.log(problems ? `${problems} ignore a refusal` : 'every call site reads its result');
if (newThrowers.length) console.log(`${newThrowers.length} action(s) throw a refusal that is not on the known list`);
if (leakyHelpers.length) console.log(`${leakyHelpers.length} private helper(s) throw a refusal for an action that returns its own`);
process.exit(problems + newThrowers.length + leakyHelpers.length ? 1 : 0);
