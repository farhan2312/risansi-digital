/**
 * READ-ONLY connection to the Risansi Market Intell database (DATABASE_URL_EXT).
 *
 * This app must NEVER write to Market Intell — it is another system's database
 * and we only borrow its client master for lookup/prefill. Read-only is
 * enforced in depth, not just by convention:
 *   1. every connection from this pool starts with
 *      `default_transaction_read_only = on` (sent in the startup packet), so
 *      the SERVER rejects any INSERT / UPDATE / DELETE / DDL issued through it
 *      with SQLSTATE 25006 — verified against the live DB;
 *   2. `miQuery()` is the only exported entry point and refuses anything that
 *      is not a SELECT / WITH statement.
 * Use `db` from ./index for everything this app actually owns.
 *
 * Pool creation is lazy (first query) and cached on globalThis, matching
 * ./index — `next build` imports route modules for metadata and must not need
 * these credentials, and a warm serverless instance should reuse one pool.
 */
import { Pool, type QueryResultRow } from "pg";

const globalForMi = globalThis as unknown as { __miPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL_EXT;
  if (!connectionString) {
    throw new Error("Missing required environment variable: DATABASE_URL_EXT");
  }
  const pool = new Pool({
    connectionString,
    // Azure Postgres presents a chain Node ships no root for (same as ./index).
    ssl: { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 30_000,
    // Belt and braces: ask the SERVER to refuse writes on every connection from
    // this pool, so even a mistaken query in future code cannot mutate Market
    // Intell. Sent in the startup packet, so it is in force before the first
    // query rather than racing it.
    options: "-c default_transaction_read_only=on",
  });
  pool.on("error", (err) => {
    console.error("Market Intell pool error:", err.message);
  });
  return pool;
}

function miPool(): Pool {
  if (!globalForMi.__miPool) globalForMi.__miPool = createPool();
  return globalForMi.__miPool;
}

/** True when the app is configured to talk to Market Intell at all. Lets a
 * route degrade to "no results" instead of throwing when the env var is unset
 * (e.g. a local checkout without the external DB). */
export function isMarketIntellConfigured(): boolean {
  return (process.env.DATABASE_URL_EXT ?? "").trim() !== "";
}

const READ_ONLY_SQL = /^\s*(select|with)\b/i;

/** Runs one read-only, parameterised query against Market Intell. Anything
 * that isn't a SELECT/WITH is rejected before it reaches the server. */
export async function miQuery<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!READ_ONLY_SQL.test(sql)) {
    throw new Error("Market Intell access is read-only: only SELECT is allowed");
  }
  const { rows } = await miPool().query<T>(sql, params);
  return rows;
}
