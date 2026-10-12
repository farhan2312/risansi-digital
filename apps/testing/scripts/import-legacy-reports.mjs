// Bulk-import legacy observation-sheet workbooks (one folder per pump model, one sheet per test) into
// pump_test_reports / pump_test_report_points, so they show up in Report Archive.
//
//   dry run (default, writes nothing):
//     npx dotenv -e .env.local -- node scripts/import-legacy-reports.mjs --dir <folder> --xlsx <folder with node_modules/xlsx>
//   really import (one transaction, all-or-nothing):
//     ... --apply
//   undo an import of this batch (deletes only rows tagged with the batch label):
//     ... --rollback
//
//   --label <name>      batch label used in every report's remarks tag (default: folder name)
//   --category <text>   category written into remarks (default: "EC Based")
//
// Every imported report is tagged "[Imported from <label>/<file>.xlsx / <sheet>] ..." in remarks and has
// prepared_by = 'Legacy Import'. The tag makes the import idempotent (already-imported sheets are skipped) and
// makes rollback exact. The DB is shared and LIVE: --apply changes it immediately, whatever git branch you are on.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import pg from "pg";
import { parseSheet } from "./lib/legacy-sheet-parser.mjs";

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf("--" + name);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
};
const flag = (name) => process.argv.includes("--" + name);

const rootDir = arg("dir");
const xlsxDir = arg("xlsx");
if (!rootDir || !xlsxDir) {
  console.error("Usage: node scripts/import-legacy-reports.mjs --dir <folder of model folders> --xlsx <folder with node_modules/xlsx> [--label X] [--category Y] [--apply | --rollback]");
  process.exit(1);
}
const label = arg("label", path.basename(rootDir.replace(/[\\/]+$/, "")));
const category = arg("category", "EC Based");
const TAG_PREFIX = `[Imported from ${label}/`;
const XLSX = createRequire(path.join(xlsxDir, "x.js"))("xlsx");

const pool = new pg.Pool({ host: process.env.DB_HOST, port: +process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: false } });
const likeEscape = (s) => s.replace(/[\\%_]/g, "\\$&");

// ---------------------------------------------------------------- rollback
if (flag("rollback")) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const ids = (await client.query(`select id from pump_test_reports where prepared_by = 'Legacy Import' and remarks like $1`, [likeEscape(TAG_PREFIX) + "%"])).rows.map((r) => r.id);
    const pts = await client.query(`delete from pump_test_report_points where report_id = any($1)`, [ids]);
    const rep = await client.query(`delete from pump_test_reports where id = any($1)`, [ids]);
    await client.query("commit");
    console.log(`Rolled back batch "${label}": deleted ${rep.rowCount} reports and ${pts.rowCount} points.`);
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  process.exit(0);
}

// ---------------------------------------------------------------- parse everything
const iso2dmy = (s) => (s ? s.split("-").reverse().join("-") : s);
const candidates = [];
const parseProblems = [];
for (const dir of fs.readdirSync(rootDir).sort()) {
  const full = path.join(rootDir, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  for (const file of fs.readdirSync(full).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith("~$")).sort()) {
    const wb = XLSX.readFile(path.join(full, file));
    for (const sheet of wb.SheetNames) {
      const { report, points, warnings, meta } = parseSheet(wb.Sheets[sheet], { model: dir });
      const tag = `${TAG_PREFIX}${file} / ${sheet}]`;
      if (!points.length || !report.test_date) {
        parseProblems.push(`${dir}/${file}/${sheet}: ${warnings.join(", ") || "unusable"}`);
        continue;
      }
      // Keep the sheet's own observation date. When the sheet says its date differs from the reference
      // test date, note that in the remarks so nothing is lost.
      const dateNote = /DIFFER/i.test(meta.refFlag ?? "") && meta.refDate ? ` Sheet date ${iso2dmy(report.test_date)} differs from reference test date ${iso2dmy(meta.refDate)}.` : "";
      candidates.push({ dir, file, sheet, tag, report, points, remarks: `${tag}${dateNote} Category: ${category}`, dateConflict: Boolean(dateNote) });
    }
  }
}

// ---------------------------------------------------------------- duplicate detection
const num = (v) => (v === null || v === undefined ? "" : Number(v).toFixed(2));
const signature = (model, ecNo, date, pts) =>
  [model, (ecNo ?? "").trim().toLowerCase(), date, ...pts.map((p) => [p.rpm, p.head_kgcm2, p.capacity_calculated_m3hr, p.volts, p.amps, p.power_calculated_kw].map(num).join("/")).sort()].join("|");

const existing = (await pool.query(`select id, report_no, model, ec_no, to_char(test_date,'YYYY-MM-DD') d, remarks from pump_test_reports`)).rows;
const existingPts = (await pool.query(`select report_id, rpm, head_kgcm2, capacity_calculated_m3hr, volts, amps, power_calculated_kw from pump_test_report_points`)).rows;
const ptsByReport = new Map();
for (const p of existingPts) (ptsByReport.get(p.report_id) ?? ptsByReport.set(p.report_id, []).get(p.report_id)).push(p);
const existingTags = new Set(existing.map((r) => r.remarks && /^(\[Imported from [^\]]*\])/.exec(r.remarks)?.[1]).filter(Boolean));
const existingSig = new Map(existing.filter((r) => !(r.remarks ?? "").startsWith(TAG_PREFIX)).map((r) => [signature(r.model, r.ec_no, r.d, ptsByReport.get(r.id) ?? []), r.report_no]));

const toInsert = [], skipped = { alreadyImported: [], duplicateOfExisting: [], duplicateInBatch: [] };
const seenSig = new Map();
for (const c of candidates) {
  const sig = signature(c.dir, c.report.ec_no, c.report.test_date, c.points);
  // Inside one batch two sheets only count as copies when EVERY parsed field matches (header, footer, points), not just the readings.
  const batchSig = JSON.stringify([c.report, c.points]);
  if (existingTags.has(c.tag)) {
    skipped.alreadyImported.push(c.tag);
    if (!seenSig.has(batchSig)) seenSig.set(batchSig, c.tag); // an earlier run of this batch is the reference for copies
  }
  else if (existingSig.has(sig)) skipped.duplicateOfExisting.push(`${c.tag} == ${existingSig.get(sig)}`);
  else if (seenSig.has(batchSig)) skipped.duplicateInBatch.push(`${c.tag} == ${seenSig.get(batchSig)}`);
  else { seenSig.set(batchSig, c.tag); toInsert.push(c); }
}

// ---------------------------------------------------------------- summary
const known = new Set((await pool.query(`select model from pump_models`)).rows.map((r) => r.model));
const perModel = {};
for (const c of toInsert) perModel[c.dir] = (perModel[c.dir] ?? 0) + 1;
console.log(`Batch "${label}" from ${rootDir}`);
console.log(`  sheets parsed with data : ${candidates.length}`);
console.log(`  unusable (not imported) : ${parseProblems.length}`);
parseProblems.forEach((p) => console.log("     - " + p));
console.log(`  already imported (skip) : ${skipped.alreadyImported.length}`);
console.log(`  duplicate of existing   : ${skipped.duplicateOfExisting.length}`);
skipped.duplicateOfExisting.forEach((p) => console.log("     - " + p));
console.log(`  duplicate inside batch  : ${skipped.duplicateInBatch.length}`);
skipped.duplicateInBatch.forEach((p) => console.log("     - " + p));
console.log(`  TO IMPORT               : ${toInsert.length} reports, ${toInsert.reduce((n, c) => n + c.points.length, 0)} points`);
console.log(`  with date-conflict note : ${toInsert.filter((c) => c.dateConflict).length}`);
console.log(`  models: ${JSON.stringify(perModel)}`);
const unknownModels = Object.keys(perModel).filter((m) => !known.has(m));
if (unknownModels.length) console.log(`  (models not in the requisition quick-pick list, left as is: ${unknownModels.join(", ")})`);

if (!flag("apply")) {
  console.log("\nDRY RUN - nothing was written. Re-run with --apply to import.");
  await pool.end();
  process.exit(0);
}

// ---------------------------------------------------------------- apply (single transaction)
const REPORT_COLUMNS = Object.keys(toInsert[0]?.report ?? {});
const POINT_COLUMNS = Object.keys(toInsert[0]?.points[0] ?? {});
const client = await pool.connect();
try {
  await client.query("begin");
  let reports = 0, points = 0;
  for (const c of toInsert) {
    const { rows } = await client.query(`select 'TR-' || lpad(nextval('pump_test_reports_report_no_seq')::text, 6, '0') as no`);
    const cols = ["id", "report_no", ...REPORT_COLUMNS, "prepared_by", "remarks", "created_at"];
    const values = ["gen_random_uuid()", "$1", ...REPORT_COLUMNS.map((_, i) => `$${i + 2}`), "'Legacy Import'", `$${REPORT_COLUMNS.length + 2}`, "now()"];
    const ins = await client.query(`insert into pump_test_reports (${cols.join(", ")}) values (${values.join(", ")}) returning id`, [rows[0].no, ...REPORT_COLUMNS.map((k) => c.report[k]), c.remarks]);
    reports++;
    for (const p of c.points) {
      await client.query(
        `insert into pump_test_report_points (id, report_id, ${POINT_COLUMNS.join(", ")}) values (gen_random_uuid(), $1, ${POINT_COLUMNS.map((_, i) => `$${i + 2}`).join(", ")})`,
        [ins.rows[0].id, ...POINT_COLUMNS.map((k) => p[k])],
      );
      points++;
    }
  }
  await client.query("commit");
  console.log(`\nIMPORTED ${reports} reports and ${points} points (batch "${label}"). To undo: re-run with --rollback.`);
} catch (e) {
  await client.query("rollback");
  console.error("\nImport FAILED - transaction rolled back, nothing was written.");
  throw e;
} finally {
  client.release();
  await pool.end();
}
