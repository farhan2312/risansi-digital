/**
 * The identity database pool.
 *
 * Same shape as apps/sales/lib/db-risansi.ts, deliberately — including the
 * singleton on globalThis, which matters in development: every hot reload
 * re-evaluates this module, and without the global each one would open a
 * fresh pool and leak the previous one's connections until the server was
 * restarted.
 *
 * Its own variables (IDENTITY_DB_*) rather than the sales DB_* set, because
 * identity lives in its own database (MIGRATION_PLAN.md §2.6) and the two
 * should be independently rotatable. Nothing here foreign-keys across.
 *
 * Nothing in this app connects at build time. Every page and action that
 * queries also reads the session cookie first, which makes the route dynamic,
 * so `next build` never opens a connection.
 */

import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var _identityPool: Pool | undefined;
}

const identityPool: Pool =
  global._identityPool ??
  new Pool({
    host:     process.env.IDENTITY_DB_HOST,
    port:     Number(process.env.IDENTITY_DB_PORT) || 5432,
    database: process.env.IDENTITY_DB_NAME,
    user:     process.env.IDENTITY_DB_USER,
    password: process.env.IDENTITY_DB_PASSWORD,
    // Verify the server certificate. Azure Postgres chains to a publicly-trusted
    // root, so Node's default trust store validates it with no custom CA — tested
    // live before flipping this. Previously `rejectUnauthorized: false` accepted
    // ANY certificate, leaving the connection open to a man-in-the-middle on the
    // path to the DB. The DB_SSL_INSECURE=1 escape hatch exists only for a local
    // proxy with a self-signed cert; never set it in production.
    ssl:      { rejectUnauthorized: process.env.IDENTITY_DB_SSL_INSECURE !== '1' },
    // Keep connections warm between requests so we don't pay a TLS
    // handshake to a far-region DB on every page load.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis:       300_000, // 5 min — hold idle connections open
    max:                     10,
  });

if (process.env.NODE_ENV !== 'production') {
  global._identityPool = identityPool;
}

export default identityPool;
