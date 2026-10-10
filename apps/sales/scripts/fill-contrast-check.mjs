// A filled surface that carries a light label must use a fill token.
//
// --title, --accent, --brand-blue and --neg are text-and-border tokens. They
// flip to a LIGHTER colour in dark mode, which is right for text on a dark page
// and wrong underneath white text:
//
//   white on dark --title (#4A8FE8)   3.29:1
//   white on dark --neg   (#F87171)   2.77:1
//
// Both fail WCAG AA. The literal #0A3D8F those replaced measured 10.11:1, so
// substituting the obvious token makes a filled button worse in dark mode than
// leaving it hardcoded — the opposite of what the tokens are for.
//
// --accent-fill and --neg-fill exist for this role. They stay dark enough in
// both themes for the label to survive (5.02:1 and 4.83:1) while still reading
// as a raised control against --bg-paper.
//
// Scope: a background and a light `color` on the SAME line, which is how inline
// CSSProperties in this codebase are written. A style object split over several
// lines is not caught — this is a floor, not a proof.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// The tokens that are wrong under a light label, and what to use instead.
const WRONG = {
  'title':       'accent-fill',
  'accent':      'accent-fill',
  'brand-blue':  'accent-fill',
  'neg':         'neg-fill',
};

const FILL   = /background:\s*'var\(--(title|accent|brand-blue|neg)\)'/;
const LIGHT  = /color:\s*'(?:#fff|#ffffff|#FFF|#FFFFFF|white)'/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.claude', 'dist', 'build']);

// Print views pin their own colours so a PDF is theme-independent; see the
// comment at the top of components/risansi/print-shared.tsx.
const isPrint = (rel) =>
  rel.startsWith('app/print/') || /print-shared|PortalOverallReport|PortalUsageReport/.test(rel);

const problems = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!e.name.endsWith('.tsx')) continue;
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (isPrint(rel)) continue;
    fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      const m = FILL.exec(line);
      if (m && LIGHT.test(line)) problems.push({ rel, line: i + 1, from: m[1], to: WRONG[m[1]] });
    });
  }
};
walk(ROOT);

for (const p of problems) {
  console.log(`\n  ${p.rel}:${p.line}`);
  console.log(`    background is var(--${p.from}) with a white label. In dark mode that`);
  console.log(`    fill lightens and the label stops being readable.`);
  console.log(`    Use var(--${p.to}) for the background and var(--on-accent) for the text.`);
}

console.log(problems.length
  ? `\n${problems.length} filled surface(s) carry a label their fill cannot support`
  : 'every filled surface with a light label uses a fill token');
process.exit(problems.length ? 1 : 0);
