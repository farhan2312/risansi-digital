import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var _risansiPool: Pool | undefined;
}

const risansiPool: Pool =
  global._risansiPool ??
  new Pool({
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT) || 5432,
    database: process.env.RISANSI_DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // Verify the server certificate. Azure Postgres chains to a publicly-trusted
    // root, so Node's default trust store validates it with no custom CA — tested
    // live before flipping this. Previously `rejectUnauthorized: false` accepted
    // ANY certificate, leaving the connection open to a man-in-the-middle on the
    // path to the DB. The DB_SSL_INSECURE=1 escape hatch exists only for a local
    // proxy with a self-signed cert; never set it in production.
    ssl:      { rejectUnauthorized: process.env.DB_SSL_INSECURE !== '1' },
    // Keep connections warm between requests so we don't pay a TLS
    // handshake to a far-region DB on every page load. A larger pool
    // lets multi-query pages (e.g. 6 parallel queries) run in one wave.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis:       300_000, // 5 min — hold idle connections open
    max:                     15,
  });

if (process.env.NODE_ENV !== 'production') {
  global._risansiPool = risansiPool;
}

export default risansiPool;
