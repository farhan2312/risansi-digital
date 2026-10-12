/**
 * A second pool, onto `risansi_identity`.
 *
 * Phase 4b. Who may open this portal, and as what, is decided there now — see
 * `src/lib/effective-role.ts`. This app's own `users_pump` table keeps everything else it
 * holds (the name on a quotation, the reviewer link) and stays the
 * primary key for all of it; only the answer to "may they, and as what" moves.
 *
 * Separate from `./db` rather than a second schema on the same connection,
 * because it is a different database on the same server and Postgres has no
 * cross-database query. That is also why `users_pump.identity_user_id` is a bare
 * uuid with no foreign key.
 *
 * Small on purpose. One question is asked of it per request, behind the
 * ten-second cache in `session-guard.ts`, so a large pool would sit idle holding
 * connections that the four portals share.
 */
import type { Queryable } from "@risansi/identity";
import { Pool } from "pg";

const globalForIdentity = globalThis as unknown as { __identityPool?: Pool };

/**
 * Built on the first query, never at import.
 *
 * `next build` imports every route to collect page data, so anything created
 * at module scope runs during the build — and a build that needs database
 * credentials to succeed is a build that cannot run in CI, or on a laptop, or
 * anywhere the production secrets are not. The first version of this file got
 * that wrong and failed the build with the very error below.
 */
function create(): Pool {
  const host = process.env.IDENTITY_DB_HOST;
  const database = process.env.IDENTITY_DB_NAME;
  const user = process.env.IDENTITY_DB_USER;
  const password = process.env.IDENTITY_DB_PASSWORD;

  // Thrown, not defaulted. A missing variable here is a deployment fault, and
  // if it read as "no grant" every signed-in person would be refused at once
  // and it would look like an access problem rather than a config one.
  if (!host || !database || !user || !password) {
    throw new Error(
      "Identity database is not configured. IDENTITY_DB_HOST, IDENTITY_DB_NAME, " +
        "IDENTITY_DB_USER and IDENTITY_DB_PASSWORD are all required.",
    );
  }

  return new Pool({
    host,
    database,
    user,
    password,
    port: Number(process.env.IDENTITY_DB_PORT) || 5432,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: process.env.IDENTITY_DB_SSL_INSECURE !== "1" },
  });
}

function pool(): Pool {
  return (globalForIdentity.__identityPool ??= create());
}

/**
 * Deliberately not a `Pool`. It is the `Queryable` that `@risansi/identity`
 * asks for — one method — so the pool behind it can stay unbuilt until
 * somebody actually signs in.
 */
export const identityDb: Queryable = {
  // Signature copied from `Queryable` rather than inferred from `pg`: the two
  // differ in their default type parameter, and inferring gives a `query`
  // that is not assignable to the interface.
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]) {
    return pool().query(sql, params) as unknown as Promise<{
      rows: R[];
      rowCount: number | null;
    }>;
  },
};
