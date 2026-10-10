/**
 * A pool onto the identity database.
 *
 * Phase 3 step 3: sales authenticates from the shared session cookie and
 * authorises from `identity.app_grants`. The grant has to be read from where
 * it lives, and `identity` is its own database (§2.6) — Postgres cannot join
 * across one, which is why this is a second pool rather than a second schema.
 *
 * Same server, same credentials, different database name. If
 * IDENTITY_DB_NAME is unset this falls back to 'risansi_identity', which is
 * the name the migrations created.
 *
 * Read-only in this app, by convention rather than by grant: sales reads the
 * session and the grant and writes neither. Everything that changes a grant
 * happens at the hub, which is the point of having one.
 */

import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var _identityPool: Pool | undefined;
}

const identityPool: Pool =
  global._identityPool ??
  new Pool({
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT) || 5432,
    database: process.env.IDENTITY_DB_NAME || 'risansi_identity',
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // Verified, like db-risansi.ts — Azure Postgres chains to a publicly
    // trusted root. DB_SSL_INSECURE exists only for a local proxy with a
    // self-signed certificate and must never be set in production.
    ssl:      { rejectUnauthorized: process.env.DB_SSL_INSECURE !== '1' },
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis:       300_000,
    // Smaller than the sales pool: every request makes at most one query here,
    // and it is deduped per request by React's cache().
    max:                     6,
  });

if (process.env.NODE_ENV !== 'production') global._identityPool = identityPool;

export default identityPool;
