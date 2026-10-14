import { Pool } from "pg";

/**
 * READ-ONLY connection to the Risansi Market Intell database.
 *
 * This app must NEVER write to Market Intell — it is owned by another system.
 * Three layers enforce that:
 *   1. A separate pool, so no app code can reach it through the normal `query`
 *      helper in lib/db.ts.
 *   2. Every new connection sets `default_transaction_read_only = on`, so
 *      Postgres itself rejects any INSERT/UPDATE/DELETE/DDL on this session —
 *      a bug or an injected statement still cannot mutate anything.
 *   3. Only the narrow, parameterised readers below are exported.
 */
declare global {
  // eslint-disable-next-line no-var
  var __marketIntellPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL_EXT;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL_EXT is not set — needed to read the Market Intell client list."
    );
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    // Applied by the server at connection startup — before any statement can
    // run — so every session is physically incapable of writing. Postgres
    // rejects INSERT/UPDATE/DELETE/DDL with "cannot execute ... in a read-only
    // transaction". Set here rather than via a `connect` handler so there is
    // no window where a query could run before the guard takes effect.
    options: "-c default_transaction_read_only=on",
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });

  pool.on("error", (err) => {
    console.error("market-intell idle client error:", err.message);
  });

  return pool;
}

function getPool(): Pool {
  if (process.env.NODE_ENV === "production") {
    return (globalThis.__marketIntellPool ??= createPool());
  }
  return (globalThis.__marketIntellPool ??= createPool());
}

/** One client as shown in the order-creation search results. */
export type MarketIntellClient = {
  code: string;
  legal_name: string | null;
  market_type: string | null;
  client_type: string | null;
  industry: string | null;
  /** Territory, from the client's tour route (clients.tour_id → tour_routes). */
  zone: string | null;
  /** Primary rep's display name (clients.primary_rep_id → users). */
  rep_name: string | null;
};

// Zone comes from the client's tour route, not from the rep — `users.zone` is
// the rep's own zone, and `clients.zone` is unpopulated upstream.
const SELECT_COLUMNS = `c.code,
        c.legal_name,
        c.market_type,
        c.client_type,
        c.industry,
        tr.zone      AS zone,
        u.name       AS rep_name`;

// Soft-deleted clients must never surface in this app. The predicate lives
// in the shared FROM clause — every reader below starts from `LIVE_CLIENTS`
// and appends its own `AND ...`, so a new query cannot forget it.
const LIVE_CLIENTS = `FROM public.clients c
       LEFT JOIN public.tour_routes tr ON tr.id = c.tour_id
       LEFT JOIN public.users u        ON u.id  = c.primary_rep_id
      WHERE c.deleted_at IS NULL`;

/**
 * Search live clients by code or legal name. Prefix matches rank first, then
 * "contains" matches. Soft-deleted rows are excluded.
 */
export async function searchClients(
  term: string,
  limit = 20
): Promise<MarketIntellClient[]> {
  const q = term.trim();
  if (q.length < 2) return [];

  const contains = `%${q}%`;
  const prefix = `${q}%`;

  const result = await getPool().query<MarketIntellClient>(
    `SELECT ${SELECT_COLUMNS}
       ${LIVE_CLIENTS}
        AND c.code IS NOT NULL
        AND (c.code ILIKE $1 OR c.legal_name ILIKE $1)
      ORDER BY
        CASE
          WHEN c.code ILIKE $2 THEN 0
          WHEN c.legal_name ILIKE $2 THEN 1
          ELSE 2
        END,
        c.legal_name NULLS LAST,
        c.code
      LIMIT $3`,
    [contains, prefix, limit]
  );
  return result.rows;
}

/** Fetch one client by its exact code — used when creating the order, so the
 *  stored details always come from Market Intell, never from the browser. */
export async function getClientByCode(
  code: string
): Promise<MarketIntellClient | null> {
  const c = code.trim();
  if (!c) return null;
  const result = await getPool().query<MarketIntellClient>(
    `SELECT ${SELECT_COLUMNS}
       ${LIVE_CLIENTS}
        AND c.code = $1
      LIMIT 1`,
    [c]
  );
  return result.rows[0] ?? null;
}

export type MarketIntellRep = { name: string; email: string | null };

/**
 * A rep's name and email as Market Intell has them, matched on the name the
 * orders carry (trimmed, case-insensitive). An active account wins over an
 * inactive one. Only name and email are read.
 */
export async function getRepContact(repName: string): Promise<MarketIntellRep | null> {
  const n = repName.trim();
  if (!n) return null;
  const result = await getPool().query<MarketIntellRep>(
    `SELECT trim(u.name) AS name, NULLIF(trim(u.email), '') AS email
       FROM public.users u
      WHERE lower(trim(u.name)) = lower($1)
      ORDER BY (u.is_active IS TRUE) DESC, (NULLIF(trim(u.email), '') IS NOT NULL) DESC, u.id
      LIMIT 1`,
    [n]
  );
  return result.rows[0] ?? null;
}

/**
 * The reps who report to a manager in the sales portal (manager_reps), by
 * the manager's email — their names as the orders carry them (orders.reps).
 * What a Rep Manager sees beyond their own SOs. A rep may report to more than
 * one manager; each of them sees that rep. Empty when the sales portal has
 * no such manager or nobody under them. Read live: a change to a team in the
 * sales portal shows here on the next request.
 */
export async function getTeamRepNames(managerEmail: string): Promise<string[]> {
  const e = managerEmail.trim().toLowerCase();
  if (!e) return [];
  const result = await getPool().query<{ name: string }>(
    `SELECT DISTINCT trim(r.name) AS name
       FROM public.manager_reps x
       JOIN public.users m ON m.id = x.manager_id
       JOIN public.users r ON r.id = x.rep_id
      WHERE lower(trim(m.email)) = $1 AND trim(coalesce(r.name, '')) <> ''
      ORDER BY 1`,
    [e]
  );
  return result.rows.map((r) => r.name);
}

/** Every manager in the sales portal with the reps under them, by manager email. For the Reps page. */
export async function listTeams(): Promise<Map<string, string[]>> {
  const result = await getPool().query<{ email: string; reps: string[] }>(
    `SELECT lower(trim(m.email)) AS email, array_agg(DISTINCT trim(r.name) ORDER BY trim(r.name)) AS reps
       FROM public.manager_reps x
       JOIN public.users m ON m.id = x.manager_id
       JOIN public.users r ON r.id = x.rep_id
      WHERE trim(coalesce(m.email, '')) <> '' AND trim(coalesce(r.name, '')) <> ''
      GROUP BY 1`
  );
  return new Map(result.rows.map((r) => [r.email, r.reps]));
}

/** Several reps at once, keyed by their lower-cased trimmed name. Same rules as getRepContact. */
export async function listRepContacts(repNames: string[]): Promise<Map<string, MarketIntellRep>> {
  const keys = [...new Set(repNames.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  if (!keys.length) return new Map();
  const result = await getPool().query<MarketIntellRep & { k: string }>(
    `SELECT DISTINCT ON (lower(trim(u.name)))
            lower(trim(u.name)) AS k, trim(u.name) AS name, NULLIF(trim(u.email), '') AS email
       FROM public.users u
      WHERE lower(trim(u.name)) = ANY($1::text[])
      ORDER BY lower(trim(u.name)), (u.is_active IS TRUE) DESC, (NULLIF(trim(u.email), '') IS NOT NULL) DESC, u.id`,
    [keys]
  );
  return new Map(result.rows.map((r) => [r.k, { name: r.name, email: r.email }]));
}
