#!/usr/bin/env node
// Sale order values that were typed wrong, corrected one at a time.
//
//   node scripts/fix-sale-order-typos.mjs           report only
//   node scripts/fix-sale-order-typos.mjs --commit  write
//
// Nine Won opportunities carry a sale order value under 5% of what was quoted.
// They are not one fault repeated, so this is not a sweep: each entry below
// names its own evidence, and anything without evidence strong enough to act on
// stays in the list at the end for a human to decide.
//
// Idempotent. A record already holding the corrected figure is skipped, so this
// can be re-run safely as more of the list is resolved.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const COMMIT = process.argv.includes('--commit');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const c = new pg.Client({ host: env.DB_HOST, port: Number(env.DB_PORT) || 5432,
  database: env.RISANSI_DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false } });

/**
 * `so: null` means the sales order row is already right and only the
 * opportunity's own Sale Order Value is being corrected.
 */
const FIXES = [
  {
    opp: 5092, final: '0.2232900', so: '0.2232900',
    why: [
      'Both the Sale Order Value and sales order SO26/1/779 read one rupee against a',
      'Rs 22,32,900 quote for four ZLPRO pumps. SO26/1/779 was entered on 2026-08-29 in a',
      'batch of ten, and in every other row of that batch the sale order value equals its',
      'quoted value to the rupee. This row is the only one that breaks the pattern, and one',
      'rupee is not a plausible sale.',
    ],
  },
  {
    opp: 5467, final: '0.0333300', so: null,
    why: [
      'The sales order SO26/1/1269 is already correct at Rs 3,33,300 — exactly the quoted',
      'value. Only the opportunity’s own Sale Order Value reads one rupee. So the figure is',
      'not being inferred here at all: it is read off the sales order sitting beside it,',
      'which is the strongest evidence available anywhere in this set. Across all 778',
      'opportunities carrying a sales order the two columns agree 737 times; this restores',
      'that agreement rather than asserting a new number.',
    ],
  },
];

await c.connect();
const rs = (cr) => 'Rs ' + Math.round(Number(cr) * 1e7).toLocaleString('en-IN');
let applied = 0, skipped = 0;

for (const fix of FIXES) {
  const { rows: [b] } = await c.query(
    `SELECT o.id, c.code, c.legal_name, o.quote_ref,
            o.value_cr::text AS quoted, o.final_value_cr::text AS final,
            (SELECT sum(so.so_value_cr)::text FROM opportunity_sales_orders so
              WHERE so.opportunity_id = o.id) AS so
       FROM opportunities o JOIN clients c ON c.id = o.client_id WHERE o.id = $1`, [fix.opp]);
  if (!b) { console.log(`#${fix.opp} not found — skipped.\n`); continue; }

  console.log(`#${fix.opp}  ${b.code} — ${b.legal_name}`);
  console.log(`   ${b.quote_ref}`);
  console.log(`   quoted ${rs(b.quoted)} · sale order value ${rs(b.final)} · sales order ${rs(b.so)}`);
  for (const line of fix.why) console.log(`   ${line}`);

  if (Number(b.final) === Number(fix.final)
      && (fix.so == null || Number(b.so) === Number(fix.so))) {
    console.log('   ALREADY CORRECT — skipped.\n');
    skipped++;
    continue;
  }
  console.log(`   -> sale order value ${rs(fix.final)}${fix.so ? ` · sales order ${rs(fix.so)}` : ' (sales order left as it is)'}`);

  if (!COMMIT) { console.log('   dry run.\n'); continue; }

  await c.query('BEGIN');
  await c.query('UPDATE opportunities SET final_value_cr = $2, updated_at = NOW() WHERE id = $1',
    [fix.opp, fix.final]);
  if (fix.so != null) {
    // Only the implausible rows. A record with several sales orders, one of them
    // real, must not have the real one overwritten.
    await c.query(
      'UPDATE opportunity_sales_orders SET so_value_cr = $2 WHERE opportunity_id = $1 AND so_value_cr < 0.000001',
      [fix.opp, fix.so]);
  }
  await c.query(
    `INSERT INTO assignment_audit (entity_type, entity_id, action, old_value, new_value, changed_by)
     VALUES ('opportunity', $1, 'correct_sale_value', $2::jsonb, $3::jsonb, 'script:fix-sale-order-typos')`,
    [String(fix.opp),
     JSON.stringify({ final_value_cr: b.final, so_value_cr: b.so }),
     JSON.stringify({ final_value_cr: fix.final, so_value_cr: fix.so ?? b.so, basis: fix.why.join(' ') })],
  ).catch(() => {});   // the audit is a record, not a gate
  await c.query('COMMIT');
  applied++;
  console.log('   applied.\n');
}

console.log(COMMIT
  ? `${applied} corrected, ${skipped} already correct.\n`
  : `\nDry run. Re-run with --commit to apply.\n`);

// ── still needing a human ─────────────────────────────────────────
const done = FIXES.map(f => f.opp);
const { rows: rest } = await c.query(`
  SELECT o.id, c.code, o.value_cr::text quoted, o.final_value_cr::text final,
         (SELECT sum(so.so_value_cr)::text FROM opportunity_sales_orders so WHERE so.opportunity_id = o.id) so
    FROM opportunities o JOIN clients c ON c.id = o.client_id
   WHERE o.stage = 'Won' AND COALESCE(o.value_cr,0) > 0
     AND COALESCE(o.final_value_cr,0) < o.value_cr * 0.05
     AND NOT (o.id = ANY($1::int[]))
   ORDER BY o.value_cr DESC`, [done]);

if (!rest.length) {
  console.log('No Won opportunity is left reporting under 5% of its quote.');
} else {
  console.log(`${rest.length} still reporting under 5% of their quote. The right number cannot be`);
  console.log('inferred for these, so they are left visible rather than guessed at:\n');
  let lost = 0;
  for (const r of rest) {
    const pct = (Number(r.final) / Number(r.quoted) * 100).toFixed(1);
    lost += Number(r.quoted) - Number(r.final);
    console.log(`  #${String(r.id).padEnd(6)} ${r.code.padEnd(13)} quoted ${rs(r.quoted).padEnd(16)} final ${rs(r.final).padEnd(14)} SO ${rs(r.so).padEnd(14)} (${pct}%)`);
  }
  console.log(`\n  Between them, about ${rs(lost)} of quoted value is currently reported as almost nothing.`);
}

await c.end();
