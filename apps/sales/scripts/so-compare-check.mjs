#!/usr/bin/env node
// Quoted against ordered: the matching rule holds.
//
// WHY THIS IS IN THE BUILD AND ec-order-check.mjs IS NOT
//
// This asks no database. lib/risansi-so-compare.ts is pure, and it is the one
// piece of this feature that can be quietly wrong: a comparison that silently
// stops matching does not throw, it just says "ordered and not quoted" about
// every line, and reads like a supply problem rather than a bug.
//
// The cases below are all real shapes out of the two systems:
//   · "RTOH 8190ABCN" and "RTOHAG8185ABCN" are the same SO, written two ways
//   · "RTOH AG8185 ABCN" has spaces INSIDE one model
//   · one quote line holds four models under a single quantity of 21
//
// A rule that splits on whitespace breaks the third; one that never splits
// breaks the fourth. Both failures look like missing stock.

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..');
const dir = mkdtempSync(path.join(tmpdir(), 'risansi-so-compare-'));

let failed = 0;
const bad = (msg) => { failed++; console.error(`  ✗ ${msg}`); };
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) return;
  bad(`${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

try {
  writeFileSync(path.join(dir, 'compare.mjs'), ts.transpileModule(
    readFileSync(path.join(ROOT, 'lib', 'risansi-so-compare.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: 'compare.ts' }).outputText);
  const C = await import(pathToFileURL(path.join(dir, 'compare.mjs')).href);

  // ── one model, however it is spaced ──
  eq('a space inside a model does not split it',
     C.splitModels('RTOH 8190ABCN'), ['RTOH 8190ABCN']);
  eq('two spaces inside a model do not split it either',
     C.splitModels('RTOH AG8185 ABCN'), ['RTOH AG8185 ABCN']);
  eq('and the same model written solid is one',
     C.splitModels('RTOHAG8185ABCN'), ['RTOHAG8185ABCN']);

  // ── several models on one quote line ──
  eq('models separated by a space are separated',
     C.splitModels('RTOH6160L6BBBE-GP RTOH8185L6AB1B1N-GP RTOH2140L6AB1B1N-GP').length, 3);
  eq('a newline separates them too',
     C.splitModels('RTOH2140ACCN-GP RTOH1120ACCN-GP\r\nRTOH2140ACCN-GP RTOH3150ACCN-GP').length, 4);
  eq('nothing is something nobody ordered', C.splitModels(''), []);
  eq('and null does not throw', C.splitModels(null), []);

  // ── the fold ──
  eq('spacing, hyphens and case fold away',
     [C.foldModel('RTOH 8190ABCN'), C.foldModel('rtoh-8190abcn')],
     ['RTOH8190ABCN', 'RTOH8190ABCN']);

  // ── the comparison ──
  {
    const r = C.compareQuotedToOrdered(
      [{ model: 'RTOH4150L6AB1B1N-GP', qty: 11 }],
      [{ soNo: 'SO26/1/1557', model: 'RTOH 4150 L6AB1B1N-GP', qty: 11 }],
    );
    eq('the same pump written two ways is one row', r.rows.length, 1);
    eq('and it agrees', [r.matches, r.rows[0].side, r.rows[0].diff], [true, 'both', 0]);
    eq('with the SO named', r.rows[0].soNos, ['SO26/1/1557']);
  }
  {
    // One quantity against several models cannot be divided between them, so
    // it is not divided at all. Giving each model 21 would turn a delivered
    // order into a 63-pump shortfall.
    const r = C.compareQuotedToOrdered(
      [{ model: 'RTOH6160L6BBBE-GP RTOH8185L6AB1B1N-GP', qty: 21 }],
      [{ soNo: 'SO1', model: 'RTOH6160L6BBBE-GP', qty: 3 }],
    );
    const bbbe = r.rows.find(x => x.model === 'RTOH6160L6BBBE-GP');
    eq('a grouped quote line claims no quantity',
       [bbbe.quotedQty, bbbe.quotedGrouped, bbbe.orderedQty], [null, true, 3]);
    eq('so it is not counted as a quantity difference', r.quantityDiffers, 0);
    eq('the model quoted and not ordered is still named', r.quotedOnly, 1);
  }
  {
    const r = C.compareQuotedToOrdered(
      [{ model: 'A100X', qty: 2 }],
      [{ soNo: 'SO1', model: 'A100X', qty: 5 }, { soNo: 'SO2', model: 'A100X', qty: 1 }],
    );
    eq('the same model across two SOs is summed, not paired',
       [r.rows.length, r.rows[0].orderedQty, r.rows[0].diff], [1, 6, 4]);
    eq('and both SOs are named', r.rows[0].soNos, ['SO1', 'SO2']);
    eq('a difference means it does not match', r.matches, false);
  }
  {
    const r = C.compareQuotedToOrdered([], [{ soNo: 'SO1', model: 'B200Y', qty: 1 }]);
    eq('ordered with nothing quoted is ordered-only, not a match',
       [r.rows[0].side, r.matches, r.orderedOnly], ['ordered-only', false, 1]);
  }
  {
    const r = C.compareQuotedToOrdered([], []);
    eq('nothing on either side does not claim to match', r.matches, false);
  }
  {
    // Differences first: a disagreement at the bottom of forty agreeing rows
    // is a disagreement nobody sees.
    const r = C.compareQuotedToOrdered(
      [{ model: 'Z900', qty: 1 }, { model: 'A100', qty: 1 }],
      [{ soNo: 'SO1', model: 'Z900', qty: 1 }, { soNo: 'SO1', model: 'A100', qty: 4 }],
    );
    eq('the row that disagrees comes first', r.rows[0].model, 'A100');
  }
  {
    const r = C.compareQuotedToOrdered(
      [{ model: 'C300', qty: 3 }],
      [{ soNo: 'SO1', model: 'C300', qty: 3, serials: '26-27/1/334,335, 336' }],
    );
    eq('serials are split and trimmed', r.rows[0].serials, ['26-27/1/334', '335', '336']);
  }
  // ── near misses ──
  eq('one edit apart is one edit apart', C.editDistance('RTOH6170L6AB', 'RTOH6170LAB'), 1);
  eq('three edits is past the cap, not counted up',
     C.editDistance('ABCDEF', 'UVWXYZ') > 2, true);
  {
    // The real pair off SO26/1/1557: a missing "6" in the middle.
    const r = C.compareQuotedToOrdered(
      [{ model: 'RTOH6170L6AB1B1N-GP', qty: 11 }],
      [{ soNo: 'SO1', model: 'RTOH6170LAB1B1N-GP', qty: 2 }],
    );
    eq('a one-character difference is paired, not reported as two pumps',
       [r.nearMatches, r.rows.find(x => x.side === 'quoted-only').nearMatch],
       [1, 'RTOH6170LAB1B1N-GP']);
    eq('and it is still not called a match', r.matches, false);
  }
  {
    // One edit apart, and a different pump: the size number is what makes a
    // pump that pump, so no "did you mean" may cross it.
    const r = C.compareQuotedToOrdered(
      [{ model: 'RTOH6170L6AB1B1N-GP', qty: 1 }],
      [{ soNo: 'SO1', model: 'RTOH8170L6AB1B1N-GP', qty: 1 }],
    );
    eq('a different size is never a near match, however close the spelling',
       r.nearMatches, 0);
    eq('and the size is read off the model', [C.sizeOf('RTOH6170L6AB1B1N-GP'), C.sizeOf('RTOH 8190ABCN')],
       ['6170', '8190']);
  }
  {
    // Two genuinely different pumps must not be paired.
    const r = C.compareQuotedToOrdered(
      [{ model: 'RTOH1130CCCN-GP', qty: 1 }],
      [{ soNo: 'SO1', model: 'RTOH8190ABCN-GP', qty: 1 }],
    );
    eq('models far apart are left alone', r.nearMatches, 0);
  }
  {
    // One ordered model must not be offered as the twin of two quoted ones.
    const r = C.compareQuotedToOrdered(
      [{ model: 'A1000X', qty: 1 }, { model: 'A1000Y', qty: 1 }],
      [{ soNo: 'SO1', model: 'A1000Z', qty: 1 }],
    );
    eq('each row is paired at most once', r.nearMatches, 1);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) {
  console.error(`\nso-compare-check: ${failed} problem${failed === 1 ? '' : 's'}.`);
  console.error('Quoted-against-ordered is matching differently. See lib/risansi-so-compare.ts.\n');
  process.exit(1);
}
console.log('✓ so-compare-check: quoted lines still line up with ordered ones');
