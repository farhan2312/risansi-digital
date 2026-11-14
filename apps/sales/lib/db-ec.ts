import 'server-only';
import { Pool } from 'pg';

/**
 * A second pool, onto `ec_to_dispatch` — the SO-to-dispatch portal's database.
 *
 * WHY A SECOND POOL AND NOT A JOIN
 *
 * It is a different database on the same server, and Postgres cannot join
 * across databases without postgres_fdw or dblink — an extension and a schema
 * change on production, for one KPI. So the two halves of the question are
 * asked separately: which client codes may this reader count (here, in
 * `risansi`), and what do those codes add up to (there). The key holds up —
 * 398 of the 399 client codes in that database match `clients.code`.
 *
 * READ ONLY, AT THE SERVER
 *
 * `default_transaction_read_only` is set as a startup option, so every
 * connection this app opens to that database refuses to write before any SQL
 * is sent. The sales portal has no business changing the dispatch portal's
 * orders, and this is the version of that rule that survives somebody adding a
 * query to this file in two years' time without reading the comment.
 *
 * SMALL ON PURPOSE
 *
 * Four portals share this server's connections, and this one asks two
 * questions on one page. `max: 4` against the sales pool's 15.
 *
 * BUILT ON FIRST USE, NEVER AT IMPORT
 *
 * `next build` imports every route to collect page data, and a build that
 * needs database credentials cannot run in CI or on a laptop.
 */

declare global {
  var _ecPool: Pool | undefined;
}

/**
 * A missing variable throws rather than defaulting to the sales database.
 * Falling back would silently run these queries against `risansi`, where a
 * table called `orders` also exists and holds something else entirely — the
 * figures would be wrong rather than absent, which is the worse failure.
 */
function create(): Pool {
  const database = process.env.EC_DB_NAME;
  if (!database) {
    throw new Error('EC_DB_NAME is not set — the dispatch portal database cannot be reached.');
  }
  const pool = new Pool({
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT) || 5432,
    database,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:      { rejectUnauthorized: process.env.DB_SSL_INSECURE !== '1' },
    options:  '-c default_transaction_read_only=on',
    max:                     4,
    idleTimeoutMillis:       120_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle client that dies takes the process with it otherwise.
  pool.on('error', err => {
    console.error('Idle ec_to_dispatch client error (the connection is recycled):', err.message);
  });
  return pool;
}

/** The pool, built the first time somebody asks a question of it. */
export function ecPool(): Pool {
  return (global._ecPool ??= create());
}
