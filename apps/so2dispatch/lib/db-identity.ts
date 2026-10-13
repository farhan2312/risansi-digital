import "server-only";
import type { Queryable } from "@risansi/identity";
import { Pool } from "pg";

/**
 * A second pool, onto `risansi_identity` — Risansi Digital's shared login.
 *
 * Who a shared session belongs to, and (from step 4) what they may do here,
 * is read there. This app's own `users` table keeps everything else and stays
 * the key every order, message and audit row points at; `users.identity_user_id`
 * is the bridge, a bare uuid with no foreign key because this is a different
 * database on the same server.
 *
 * Small on purpose: one question per request, and the four portals share the
 * server's connections.
 */

declare global {
  var __identityPool: Pool | undefined;
}

/**
 * Built on the first query, never at import: `next build` imports every route
 * to collect page data, and a build that needs database credentials cannot run
 * in CI or on a laptop.
 *
 * A missing variable throws rather than defaulting. Read as "no grant", it
 * would refuse every signed-in person at once and look like an access problem
 * rather than a configuration one.
 */
function create(): Pool {
  const host = process.env.IDENTITY_DB_HOST;
  const database = process.env.IDENTITY_DB_NAME;
  const user = process.env.IDENTITY_DB_USER;
  const password = process.env.IDENTITY_DB_PASSWORD;
  if (!host || !database || !user || !password) {
    throw new Error(
      "Identity database is not configured. IDENTITY_DB_HOST, IDENTITY_DB_NAME, " +
        "IDENTITY_DB_USER and IDENTITY_DB_PASSWORD are all required."
    );
  }
  const pool = new Pool({
    host,
    database,
    user,
    password,
    port: Number(process.env.IDENTITY_DB_PORT) || 5432,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: true },
  });
  pool.on("error", (err) => {
    console.error("Idle identity DB client error (connection will be recycled):", err.message);
  });
  return pool;
}

function pool(): Pool {
  return (globalThis.__identityPool ??= create());
}

/** The one-method client `@risansi/identity` asks for, so the pool stays unbuilt until someone needs it. */
export const identityDb: Queryable = {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]) {
    return pool().query(sql, params) as unknown as Promise<{ rows: R[]; rowCount: number | null }>;
  },
};
