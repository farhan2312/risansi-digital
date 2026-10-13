// Put back the Fully ready lot dates (and the ECs' readiness dates) that were
// cleared on 06 Oct 2026, from docs/fully-ready-lot-dates-before.json.
//
//   node scripts/restore-fully-ready-lot-dates.mjs          # dry run: says what it would do
//   node scripts/restore-fully-ready-lot-dates.mjs --apply  # writes
//
// Only rows still blank are filled, so a date entered since is never overwritten.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(root, file), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const apply = process.argv.includes("--apply");
const backup = JSON.parse(readFileSync(join(root, "docs/fully-ready-lot-dates-before.json"), "utf8"));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  let lots = 0;
  for (const l of backup.lots) {
    const r = await client.query(
      `UPDATE order_ready_lots SET ready_date = $2::date WHERE id = $1 AND ready_date IS NULL`,
      [l.id, l.ready_date]
    );
    lots += r.rowCount;
  }
  let ecs = 0;
  for (const p of backup.planning) {
    if (!p.planning_readiness_date) continue;
    const r = await client.query(
      `UPDATE order_planning SET planning_readiness_date = $2::date
        WHERE item_id = $1 AND planning_readiness_date IS NULL`,
      [p.item_id, p.planning_readiness_date]
    );
    ecs += r.rowCount;
  }
  await client.query(apply ? "COMMIT" : "ROLLBACK");
  console.log(`${apply ? "Restored" : "Would restore"} ${lots} lot date(s) and ${ecs} EC readiness date(s).`);
  if (!apply) console.log("Dry run — run with --apply to write.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
