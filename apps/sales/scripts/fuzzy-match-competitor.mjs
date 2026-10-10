// Fuzzy-match the competitor_installed_base rows that have no client_code yet
// (the manually-typed names that didn't match exactly) to clients.
//   node scripts/fuzzy-match-competitor.mjs           → DRY RUN (report + samples)
//   node scripts/fuzzy-match-competitor.mjs --apply   → set client_id/client_code on matches
//
// Conservative: a match needs a strong score AND a clear margin over the
// runner-up, so we don't link the wrong factory.

import { readFileSync } from 'node:fs';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const client = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT || 5432, database: env.RISANSI_DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false } });

// Corporate suffixes + industry-generic words that don't identify the factory.
// Stripping these leaves only the DISTINCTIVE part (the proper name / place /
// unit), so two different factories that merely share "SUGAR SAHAKARI SAKHAR
// KARKHANA LTD" don't look alike.
const STOP = new Set([
  'THE','LTD','LIMITED','PVT','PRIVATE','CO','COMPANY','AND','OF','UNIT','LEASE','LEASED','OPERATED','BY','FORMERLY','DIV','DIVISION',
  'INDUSTRIES','INDUSTRY','INDUSTRIAL','PROJECT','PROJECTS','SERVICES',
  'SUGAR','SUGARS','SAHAKARI','SAHKARI','SAKHAR','SHAKKAR','KARKHANA','SHETKARI','TALUKA',
  'MILLS','MILL','PAPER','DISTILLERY','DISTILLARY','DISTILLERIES','ENERGY','POWER','CANE',
  'BIOREFINERIES','BIOREFINERY','BIO','ORGANICS','BIOORGANICS','BIOFUELS','BIOENERGY','FUELS',
  'FOOD','PRODUCT','PRODUCTS','AGRO','STARCH','CEREALS','COMPLEX','FACTORY','COOPERATIVE','COOP',
  'REFINERY','REFINERIES','DUPLEX','PULPS','BOARDS','SSSK',
]);
// Spelling variants in the hand-typed sheet → canonical token (applied before split).
const CANON = { KARAKHANA: 'KARKHANA', KARKHANE: 'KARKHANA', SAKKHAR: 'SAKHAR', SAHKARI: 'SAHAKARI', SSK: 'SAHAKARI SAKHAR KARKHANA' };

const norm = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// Distinctive tokens: keep words ≥3 chars or numbers, drop the generic STOP set, dedupe.
function tokens(s) {
  const raw = norm(s).split(' ').map(t => CANON[t] ?? t).join(' ').split(' ');
  return [...new Set(raw.filter(t => (t.length >= 3 || /^\d+$/.test(t)) && !STOP.has(t)))];
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m || !n) return Math.max(m, n);
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[m][n];
}
const levRatio = (a, b) => { const M = Math.max(a.length, b.length); return M ? 1 - lev(a, b) / M : 1; };
// Dice coefficient over distinctive tokens, allowing per-token fuzzy equality
// (so VITHAL≈VITTHAL but RAMA≠BAHL). 1 token each, equal → 1.0.
function score(an, de, bn, dc) {
  // Containment: one full normalized name is a prefix of the other — catches
  // "(formerly X)", "(LOCATION)", "(4500 TCD)", "(Group)" suffixes on otherwise
  // identical names. Length guard avoids short/ambiguous prefixes.
  if (an.length >= 14 && (bn + ' ').startsWith(an + ' ')) return 0.95;
  if (bn.length >= 14 && (an + ' ').startsWith(bn + ' ')) return 0.95;
  if (!de.length || !dc.length) return 0;
  const used = new Array(dc.length).fill(false);
  let shared = 0;
  for (const a of de) {
    let bi = -1, bs = 0;
    dc.forEach((b, i) => { if (used[i]) return; const s = a === b ? 1 : levRatio(a, b); if (s > bs) { bs = s; bi = i; } });
    if (bi >= 0 && bs >= 0.86) { shared++; used[bi] = true; }
  }
  return (2 * shared) / (de.length + dc.length);
}

await client.connect();
try {
  const { rows: unmatched } = await client.query(
    "SELECT id, client_name FROM competitor_installed_base WHERE client_code IS NULL AND client_name IS NOT NULL");
  const { rows: clients } = await client.query('SELECT id, code, legal_name, trade_name FROM clients WHERE deleted_at IS NULL');
  // Pre-compute client normals/tokens (use both legal + trade)
  const cand = [];
  for (const c of clients) {
    for (const nm of [c.legal_name, c.trade_name]) {
      if (!nm) continue;
      cand.push({ id: c.id, code: c.code, label: nm, n: norm(nm), t: tokens(nm) });
    }
  }

  const ACCEPT = 0.70, MARGIN = 0.12;
  const matches = [], rejects = [];
  for (const u of unmatched) {
    const un = norm(u.client_name), ut = tokens(u.client_name);
    let best = null, second = 0;
    for (const c of cand) {
      const sc = score(un, ut, c.n, c.t);
      if (!best || sc > best.sc) { second = best ? best.sc : 0; best = { ...c, sc }; }
      else if (sc > second) second = sc;
    }
    if (best && best.sc >= ACCEPT && (best.sc - second) >= MARGIN) matches.push({ u, best });
    else rejects.push({ u, best });
  }

  // collapse multiple cib rows that map to the same client label (keep all; just report)
  console.log('=== FUZZY DRY RUN ===');
  console.log('unmatched cib rows:', unmatched.length);
  console.log('fuzzy-matched (high confidence):', matches.length);
  console.log('still unmatched:', rejects.length);
  console.log('\n--- sample accepted matches (excel → client · score) ---');
  matches.slice(0, 25).forEach(m => console.log(`  "${m.u.client_name}" → "${m.best.label}"  [${m.best.sc.toFixed(2)}]`));
  const band = (lo, hi) => rejects.filter(r => (r.best?.sc ?? 0) >= lo && (r.best?.sc ?? 0) < hi).length;
  console.log('\n--- still-unmatched by best score ---');
  console.log('  0.00 (no name overlap → almost certainly not a client):', band(0, 0.01));
  console.log('  0.01–0.49 (different factory, shares only generic words):', band(0.01, 0.5));
  console.log('  0.50–0.69 (near-miss worth a manual look):', band(0.5, 0.7));
  console.log('\n--- near-misses (0.50–0.69) ---');
  rejects.filter(r => (r.best?.sc ?? 0) >= 0.5 && (r.best?.sc ?? 0) < 0.7)
    .forEach(r => console.log(`  "${r.u.client_name}"  ~ "${r.best?.label}" [${r.best?.sc.toFixed(2)}]`));

  if (APPLY) {
    let n = 0;
    for (const m of matches) {
      await client.query('UPDATE competitor_installed_base SET client_id=$1, client_code=$2 WHERE id=$3',
        [m.best.id, m.best.code, m.u.id]);
      n++;
    }
    console.log(`\napplied ${n} fuzzy matches.`);
    const [{ still }] = (await client.query("SELECT COUNT(*)::int still FROM competitor_installed_base WHERE client_code IS NULL")).rows;
    console.log('cib rows still without a client_code:', still);
  } else {
    console.log('\nDRY RUN — re-run with --apply to write the matches.');
  }
} finally { await client.end(); }
