// Import the historical complaints from design/complaints-data.xlsx into the
// complaints + complaint_updates tables.
//
//   node scripts/import-complaints.mjs            → DRY RUN (report only)
//   node scripts/import-complaints.mjs --apply    → insert (idempotent: clears
//                                                    prior source='import' rows first)
//
// The sheet has one row per complaint plus continuation rows (blank Complaint
// No.) that carry extra Remarks / Details lines. We fold continuations into the
// owning complaint. All historical complaints are imported as Closed; the
// Remarks become a dated complaint_updates log, and any "Root cause:" lines are
// also lifted into complaints.root_cause. Rows with no client code are skipped.

import { readFileSync } from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';

const APPLY = process.argv.includes('--apply');

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
}
const client = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT || 5432, database: env.RISANSI_DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, ssl: { rejectUnauthorized: false } });

// Column indices (verified against the row-0 header).
const C = { no: 0, code: 1, name: 2, rep: 3, channel: 4, date: 5, details: 6, part: 7,
  qty: 8, model: 9, inv_no: 10, inv_dt: 11, po_no: 12, po_dt: 13, remarks: 14 };

const norm = s => String(s ?? '').trim();
const intOrNull = v => { const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) ? n : null; };

// Excel serial OR common string date → 'YYYY-MM-DD' (or null). Sheet string
// dates are US m/d/y; values >12 in the first slot are read as day-first.
function toDate(v) {
  if (v == null || v === '') return null;
  const sNum = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(sNum)) {
    const serial = Number(sNum);
    if (serial > 20000 && serial < 90000) {
      const d = new Date(Math.round((serial - 25569) * 86400000) + Date.UTC(1970, 0, 1));
      return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const m = sNum.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    let mo, da;
    if (a > 12) { da = a; mo = b; } else { mo = a; da = b; }
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  }
  return null;
}

function channel(v) {
  const s = norm(v).toLowerCase();
  if (s.startsWith('verbal')) return 'Verbal';
  if (s.startsWith('e-mail') || s === 'email') return 'Email';
  if (s === 'mail') return 'Mail';
  return norm(v) || null;
}

// Split a complaint's collected remark blob into dated log lines.
function toUpdates(lines) {
  const out = [];
  for (const raw of lines) {
    const line = norm(raw);
    if (!line) continue;
    const m = line.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\s*[:\-]?\s*(.*)$/);
    let entry_date = null;
    if (m) entry_date = toDate(`${m[1]}-${m[2]}-${m[3]}`);
    out.push({ body: line, entry_date });
  }
  return out;
}

await client.connect();
try {
  const wb = XLSX.readFile(new URL('../design/complaints-data.xlsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, raw: true, defval: '' });
  const body = rows.slice(2); // skip header + sub-header

  // Group continuation rows into the complaint that owns them.
  const groups = [];
  for (const r of body) {
    if (norm(r[C.no])) {
      groups.push({ head: r, extraRemarks: [], extraDetails: [] });
    } else if (groups.length) {
      const g = groups[groups.length - 1];
      if (norm(r[C.remarks])) g.extraRemarks.push(norm(r[C.remarks]));
      if (norm(r[C.details])) g.extraDetails.push(norm(r[C.details]));
    }
  }

  // users for reporter-initials mapping
  const { rows: users } = await client.query('SELECT id, name, initials, rep_code FROM users');
  const byInitials = new Map();
  for (const u of users) {
    for (const k of [u.initials, u.rep_code]) {
      const key = norm(k).toUpperCase();
      if (key && !byInitials.has(key)) byInitials.set(key, u);
    }
  }
  const { rows: clients } = await client.query('SELECT id, code FROM clients WHERE deleted_at IS NULL');
  const idByCode = new Map(clients.map(c => [norm(c.code).toUpperCase(), c.id]));

  let skippedNoCode = 0, repMatched = 0, repUnmatched = new Set();
  const usedNos = new Set();
  let fallbackSeq = 0;
  const recs = [];
  for (const g of groups) {
    const r = g.head;
    const code = norm(r[C.code]);
    if (!code) { skippedNoCode++; continue; }
    const clientId = idByCode.get(code.toUpperCase()) ?? null;

    // Display number derived from the original ref — keeps letter suffixes
    // (118-B → CMP-0118B), zero-padded and de-duplicated. legacy_ref keeps raw.
    const origNo = norm(r[C.no]);
    const cleaned = origNo.toUpperCase().replace(/[^0-9A-Z]/g, '');
    const mm = cleaned.match(/^(\d+)([A-Z0-9]*)$/);
    const base = mm ? `CMP-${mm[1].padStart(4, '0')}${mm[2]}` : `CMP-${10000 + (fallbackSeq++)}`;
    let complaint_no = base, dd = 1;
    while (usedNos.has(complaint_no)) complaint_no = `${base}-${dd++}`;
    usedNos.add(complaint_no);

    const repRaw = norm(r[C.rep]) || null;
    const repUser = repRaw ? (byInitials.get(repRaw.toUpperCase()) ?? null) : null;
    if (repRaw) { if (repUser) repMatched++; else repUnmatched.add(repRaw); }

    const detailParts = [norm(r[C.details]), ...g.extraDetails].filter(Boolean);
    const details = detailParts.join('\n') || '(no details recorded)';

    const remarkLines = [norm(r[C.remarks]), ...g.extraRemarks].filter(Boolean)
      .flatMap(s => s.split(/\r?\n/));
    const updates = toUpdates(remarkLines);
    const rootCause = updates.filter(u => /root cause/i.test(u.body)).map(u => u.body).join('\n') || null;
    const cdate = toDate(r[C.date]);
    const closedAt = updates.map(u => u.entry_date).filter(Boolean).sort().pop() || cdate;

    recs.push({
      complaint_no, legacy_ref: origNo, client_id: clientId, client_code: code,
      channel: channel(r[C.channel]), complaint_date: cdate,
      details, part_name: norm(r[C.part]) || null, quantity: intOrNull(r[C.qty]),
      pump_model: norm(r[C.model]) || null,
      invoice_no: norm(r[C.inv_no]) || null, invoice_date: toDate(r[C.inv_dt]),
      client_po_no: norm(r[C.po_no]) || null, client_po_date: toDate(r[C.po_dt]),
      reported_by_raw: repRaw, reported_by_user: repUser?.id ?? null,
      root_cause: rootCause, complaint_date_ts: cdate, closed_at: closedAt,
      updates,
    });
  }

  console.log('=== ' + (APPLY ? 'APPLY' : 'DRY RUN') + ' · complaints ===');
  console.log('complaint groups:', groups.length, '· importing:', recs.length, '· skipped (no client code):', skippedNoCode);
  console.log('client links:', recs.filter(r => r.client_id).length, '/', recs.length);
  console.log('reporter initials matched to a user:', repMatched, '· unmatched initials:', JSON.stringify([...repUnmatched]));
  console.log('total update-log lines:', recs.reduce((s, r) => s + r.updates.length, 0),
    '· with root_cause:', recs.filter(r => r.root_cause).length);
  console.log('sample:', JSON.stringify({ ...recs[0], updates: recs[0]?.updates?.length }, null, 0).slice(0, 400));

  if (!APPLY) {
    console.log('\nDRY RUN only — re-run with --apply to insert.');
  } else {
    await client.query('BEGIN');
    // Idempotent: remove any prior import (cascades to updates).
    await client.query("DELETE FROM complaints WHERE source = 'import'");
    let ins = 0, upd = 0;
    for (const rec of recs) {
      const { rows: cr } = await client.query(
        `INSERT INTO complaints (
           complaint_no, legacy_ref, client_id, client_code, channel, complaint_date,
           details, part_name, quantity, pump_model, invoice_no, invoice_date,
           client_po_no, client_po_date, priority, status, reported_by_raw, reported_by_user,
           root_cause, source, created_by, closed_at, closed_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Medium','Closed',$15,$16,$17,
           'import','import',$18,'import', COALESCE($19::date, now()), now())
         RETURNING id`,
        [rec.complaint_no, rec.legacy_ref, rec.client_id, rec.client_code, rec.channel, rec.complaint_date,
         rec.details, rec.part_name, rec.quantity, rec.pump_model, rec.invoice_no, rec.invoice_date,
         rec.client_po_no, rec.client_po_date, rec.reported_by_raw, rec.reported_by_user,
         rec.root_cause, rec.closed_at, rec.complaint_date]);
      const cid = cr[0].id; ins++;
      for (const u of rec.updates) {
        await client.query(
          `INSERT INTO complaint_updates (complaint_id, body, entry_date, created_by, created_at)
           VALUES ($1,$2,$3,'import', COALESCE($3::date, now()))`,
          [cid, u.body, u.entry_date]);
        upd++;
      }
    }
    await client.query('COMMIT');
    console.log(`\ninserted ${ins} complaints · ${upd} update-log rows.`);
    const after = await client.query("SELECT COUNT(*)::int n FROM complaints");
    console.log('complaints table now:', after.rows[0].n);
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('FAILED:', e.message); process.exitCode = 1;
} finally { await client.end(); }
