import { Pool, type PoolClient } from "pg";

/**
 * Shared PostgreSQL connection pool.
 *
 * In development, Next.js hot-reloads modules on every change, which would
 * otherwise create a new pool (and leak connections) on each reload. We cache
 * the pool on `globalThis` to reuse a single instance.
 */
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill in your Azure PostgreSQL credentials."
    );
  }

  const pool = new Pool({
    connectionString,
    // Azure PostgreSQL requires TLS. `sslmode=require` in the connection string
    // enables it; this ensures the driver negotiates SSL even if the mode flag
    // is omitted. Azure presents a trusted cert, so verification stays on.
    ssl: { rejectUnauthorized: true },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Keep the TCP connection alive so Azure/network idle timeouts are less
    // likely to silently drop a pooled connection between requests.
    keepAlive: true,
  });

  // Azure can drop an idle connection at any time; pg surfaces that as an
  // 'error' event on the idle client. Without a listener it would crash the
  // process — log it and let the pool evict the broken client instead.
  pool.on("error", (err) => {
    console.error("Idle PostgreSQL client error (connection will be recycled):", err.message);
  });

  return pool;
}

export const pool: Pool = global.__pgPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  global.__pgPool = pool;
}

// A broken/stale pooled connection typically fails with one of these before
// any work is done; the query is safe to retry once on a fresh connection.
const RETRYABLE =
  /Connection terminated|terminated unexpectedly|ECONNRESET|connection error|server closed the connection|Client has encountered/i;

/**
 * Run a parameterized query against the pool.
 * Always pass user input via `params` ($1, $2, …) — never string-interpolate.
 *
 * Retries once when a pooled connection was dropped by the server (a transient
 * "Connection terminated unexpectedly" from Azure), which discards the broken
 * client and grabs a fresh one.
 */
export async function query<
  T extends Record<string, unknown> = Record<string, unknown>,
>(text: string, params?: unknown[]) {
  try {
    return await pool.query<T>(text, params);
  } catch (err) {
    if (err instanceof Error && RETRYABLE.test(err.message)) {
      return await pool.query<T>(text, params);
    }
    throw err;
  }
}

/**
 * Run several statements as one transaction on a single pooled client.
 *
 * Use it when two writes must not be able to drift apart — e.g. appending a
 * target-date revision and updating the denormalised current value on `orders`.
 * Rolls back on any throw. No retry: replaying half a transaction is worse than
 * surfacing the error.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already broken; the pool will discard it.
    }
    throw err;
  } finally {
    client.release();
  }
}
