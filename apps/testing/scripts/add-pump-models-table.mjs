// Additive migration: pump_models table, seeded with the common models list
// used as quick-pick suggestions on the requisition Model dropdown. Grows
// over time as new models get added once a requisition using them closes.
import { Pool } from "pg";

const sslmode = process.env.DB_SSLMODE ?? "require";
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: sslmode === "disable" ? false : { rejectUnauthorized: false },
});

const SEED_MODELS = [
  "BarrelH10", "H90", "2H48", "H40L6", "H50", "2H60", "H80", "4H90", "H70L3",
  "H30", "H80L6", "H52", "2H70", "H70", "2H80", "H120", "H85L6", "H60L6",
  "H20", "H40", "2H110", "H15", "H100L6", "4H85", "4H48", "H50L6", "H60L4",
  "H70L6", "H105", "4H100", "4H70", "2H105", "4H30", "4H50", "4H15", "H30L6",
  "BarrelH20L", "4H20", "H60", "2H50", "2H20", "2H30", "4H60", "2H15", "2H40",
  "H100", "H90L6", "H110", "4H40", "H80L3", "4H80", "H48", "H85", "2H90", "2H100",
];

const client = await pool.connect();
try {
  const createSql = `
    CREATE TABLE IF NOT EXISTS pump_models (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      model varchar(100) NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await client.query(createSql);
  console.log("OK:", createSql.trim());

  let inserted = 0;
  for (const model of SEED_MODELS) {
    const result = await client.query(
      `INSERT INTO pump_models (model) VALUES ($1) ON CONFLICT (model) DO NOTHING`,
      [model]
    );
    inserted += result.rowCount;
  }
  console.log(`OK: seeded ${inserted} new model(s) (${SEED_MODELS.length - inserted} already present)`);
} finally {
  client.release();
  await pool.end();
}
console.log("Done.");
