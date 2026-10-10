// Import customer-wise RIL pump detail (design/client-pump-detail.xlsx) into
// client_pumps. Both sheets are merged. Each row is matched to a client by the
// REVERSED customer code (file code halves are swapped vs the client code:
// D02501AHMD -> AHMD01D025). client_id is null when no client matches.
//
//   node scripts/import-client-pumps.mjs            → DRY RUN (report only)
//   node scripts/import-client-pumps.mjs --apply    → replace source='import' rows
import { readFileSync } from 'node:fs';
import pg from 'pg';
import XLSX from 'xlsx';

const APPLY = process.argv.includes('--apply');
const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) { const m=l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if(m) env[m[1]]=m[2]; }
const client = new pg.Client({ host: env.DB_HOST, port: +env.DB_PORT||5432, database: env.RISANSI_DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, ssl:{rejectUnauthorized:false} });

const norm = s => String(s ?? '').trim();
const up = s => norm(s).toUpperCase();
const intQ = v => { const n = parseInt(String(v).replace(/[^\d-]/g,''),10); return Number.isFinite(n) && n>0 ? n : 1; };
const numV = v => { const n = Number(String(v).replace(/[^\d.\-]/g,'')); return Number.isFinite(n) ? n : null; };
function toDate(v) {
  if (v==null || v==='') return null;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) { const ser=Number(s); if (ser>20000 && ser<90000) return new Date(Math.round((ser-25569)*86400000)+Date.UTC(1970,0,1)).toISOString().slice(0,10); return null; }
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) { let a=+m[1],b=+m[2],y=+m[3]; if(y<100)y+=2000; let mo,da; if(a>12){da=a;mo=b;}else{mo=a;da=b;} if(mo<1||mo>12||da<1||da>31) return null; return `${y}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}`; }
  return null;
}
// reversed code: [seq4][01][city4] -> [city4][01][seq4]
const reverseCode = code => { const m = up(code).match(/^(.{4})(\d\d)(.{4})$/); return m ? m[3]+m[2]+m[1] : null; };

await client.connect();
try {
  const wb = XLSX.readFile(new URL('../design/client-pump-detail.xlsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const { rows: clients } = await client.query('SELECT id, code FROM clients WHERE deleted_at IS NULL');
  const idByCode = new Map(clients.map(c => [up(c.code), c.id]));

  const recs = [];
  for (const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header:1, raw:true, defval:'' });
    const hdr = rows[2].map(h => String(h).trim().toLowerCase());
    const H = pfx => hdr.findIndex(h => h.startsWith(pfx));
    const I = {
      code:H('customer code'), short:H('cust_code'), name:H('customer name'),
      consignee:H('consginee name'), city:H('consginee city'),
      so:H('so number'), soDate:H('so date'), soVal:H('so val'), po:H('cust po'),
      pcode:H('product code'), pname:H('product name'), qty:H('quantity'),
      ec:H('ec number'), ecDate:H('ec date'), sl:H('pump sl'), model:H('pump model'),
      internal:H('model no internal'), liquid:H('liquid'), cap:H('capacity'),
      head:H('head'), speed:H('pump speed'), drive:H('drive rating'),
    };
    for (const r of rows.slice(3)) {
      const code = up(r[I.code]);
      if (!code && !norm(r[I.name])) continue; // skip empty rows
      const cc = reverseCode(code);
      recs.push({
        client_id: cc ? (idByCode.get(cc) ?? null) : null,
        client_code: cc, customer_code: code || null,
        cust_code_short: I.short>=0 ? norm(r[I.short])||null : null,
        customer_name: norm(r[I.name])||null, consignee_name: norm(r[I.consignee])||null, consignee_city: norm(r[I.city])||null,
        so_number: norm(r[I.so])||null, so_date: toDate(r[I.soDate]), so_val: numV(r[I.soVal]), cust_po_number: norm(r[I.po])||null,
        product_code: norm(r[I.pcode])||null, product_name: norm(r[I.pname])||null, quantity: intQ(r[I.qty]),
        ec_number: norm(r[I.ec])||null, ec_date: toDate(r[I.ecDate]), pump_sl_no: norm(r[I.sl])||null,
        pump_model_plate: norm(r[I.model])||null, model_no_internal: norm(r[I.internal])||null,
        liquid: norm(r[I.liquid])||null, capacity: norm(r[I.cap])||null, head: norm(r[I.head])||null,
        pump_speed: norm(r[I.speed])||null, drive_rating: norm(r[I.drive])||null, source_period: sheet,
      });
    }
  }

  const matched = recs.filter(r => r.client_id).length;
  const qty = recs.reduce((s,r)=>s+r.quantity,0);
  const qtyMatched = recs.filter(r=>r.client_id).reduce((s,r)=>s+r.quantity,0);
  console.log('=== ' + (APPLY?'APPLY':'DRY RUN') + ' · client pumps ===');
  console.log('rows:', recs.length, '· pumps (sum qty):', qty);
  console.log('rows matched to a client (reversed code):', matched, `(${(matched/recs.length*100).toFixed(1)}%)`, '· pumps on matched clients:', qtyMatched);
  console.log('distinct clients with pump detail:', new Set(recs.filter(r=>r.client_id).map(r=>r.client_id)).size);
  console.log('sample:', JSON.stringify(recs[0]));

  if (!APPLY) { console.log('\nDRY RUN only — re-run with --apply.'); }
  else {
    const cols = ['client_id','client_code','customer_code','cust_code_short','customer_name','consignee_name','consignee_city','so_number','so_date','so_val','cust_po_number','product_code','product_name','quantity','ec_number','ec_date','pump_sl_no','pump_model_plate','model_no_internal','liquid','capacity','head','pump_speed','drive_rating','source_period','source'];
    await client.query('BEGIN');
    await client.query("DELETE FROM client_pumps WHERE source='import'");
    const CHUNK=300; let ins=0;
    for (let i=0;i<recs.length;i+=CHUNK) {
      const slice=recs.slice(i,i+CHUNK); const ph=[],vals=[];
      slice.forEach((r,j)=>{ const base=j*cols.length; ph.push('('+cols.map((_,k)=>`$${base+k+1}`).join(',')+')');
        vals.push(r.client_id,r.client_code,r.customer_code,r.cust_code_short,r.customer_name,r.consignee_name,r.consignee_city,r.so_number,r.so_date,r.so_val,r.cust_po_number,r.product_code,r.product_name,r.quantity,r.ec_number,r.ec_date,r.pump_sl_no,r.pump_model_plate,r.model_no_internal,r.liquid,r.capacity,r.head,r.pump_speed,r.drive_rating,r.source_period,'import'); });
      await client.query(`INSERT INTO client_pumps (${cols.join(',')}) VALUES ${ph.join(',')}`, vals);
      ins+=slice.length;
    }
    await client.query('COMMIT');
    console.log(`\ninserted ${ins} rows. client_pumps now:`, (await client.query('SELECT COUNT(*)::int n FROM client_pumps')).rows[0].n);
  }
} catch(e) { await client.query('ROLLBACK').catch(()=>{}); console.error('FAILED:', e.message); process.exitCode=1; }
finally { await client.end(); }
