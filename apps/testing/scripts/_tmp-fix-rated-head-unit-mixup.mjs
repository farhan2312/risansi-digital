import pg from "pg";

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSLMODE === "require" ? { rejectUnauthorized: false } : false,
});

// All 6 correct to 6.00 -- confirmed against each report's own max measured
// head_kgcm2 (also 6), which is exactly what a 10x KG/CM2<->MWC mixup would
// produce from a true rated_head of 6.
const ids = [
  "f7d93b9e-7d2a-45e6-8a54-8603a848345f", // TR-000326, H100, 60.00 -> 6
  "1d0c57ef-8385-47b9-a2a8-052db2f48fe4", // TR-000327, H100, 60.00 -> 6
  "6b52f66b-e3e0-4e8c-b009-afe7d5c08909", // TR-000338, H110, 60.00 -> 6
  "98299d1c-7002-45a8-a472-ca02c23b097d", // TR-000341, H120, 60.00 -> 6
  "e8d9c9c1-df65-49e7-a1e8-1508ad452d10", // TR-000506, H80, 0.60 -> 6
  "ff317deb-2fee-438d-81ff-d8ebe98d1bb1", // TR-000513, H85, 0.60 -> 6
];

const { rows } = await pool.query(
  `update pump_test_reports set rated_head = 6.00 where id = any($1::uuid[]) returning id, report_no, model, rated_head`,
  [ids]
);

console.log(`Updated ${rows.length} reports:`);
for (const row of rows) {
  console.log(`  ${row.id} | ${row.report_no} | ${row.model} | rated_head=${row.rated_head}`);
}

await pool.end();
