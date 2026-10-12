/**
 * Postgres connection, ported from azure-functions/shared/database.py.
 * Reads the same DB_* env vars the Azure Functions app used.
 *
 * The pool and Drizzle instance are created lazily on first query (via a Proxy)
 * rather than at module load. That keeps `next build` — which imports every
 * route module to collect metadata — from failing when DB creds aren't present
 * in the build environment, and lets one pool be reused across Next's dev
 * hot-reload and serverless warm invocations.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const globalForDb = globalThis as unknown as {
  __pumpPool?: Pool;
  __pumpDb?: NodePgDatabase<typeof schema>;
};

function createPool(): Pool {
  const sslmode = process.env.DB_SSLMODE ?? "require";
  const pool = new Pool({
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 5432),
    database: required("DB_NAME"),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    // Azure Postgres requires SSL; it presents a chain Node doesn't ship a root
    // for, so disable strict verification (matches the Python side's sslmode).
    ssl: sslmode === "disable" ? false : { rejectUnauthorized: false },
    // Opening a connection to Azure (TCP + TLS + auth) costs ~0.5 s, so keep
    // idle ones for 3 min instead of pg's default 10 s — otherwise nearly every
    // page open reconnects. TCP keep-alive stops Azure's network dropping them
    // while idle.
    idleTimeoutMillis: 180_000,
    keepAlive: true,
  });
  // An idle connection the server closes must not crash the process; the
  // pool drops it and opens a fresh one on the next query.
  pool.on("error", (err) => console.error("[db] idle connection error:", err.message));
  return pool;
}

function initDb(): NodePgDatabase<typeof schema> {
  if (globalForDb.__pumpDb) return globalForDb.__pumpDb;
  const pool = globalForDb.__pumpPool ?? createPool();
  const instance = drizzle(pool, { schema });
  // Cache on globalThis in every environment: in dev it stops HMR from opening
  // a new pool on each reload, and on Vercel it lets a warm serverless instance
  // reuse one pool across invocations instead of leaking a pool per query.
  globalForDb.__pumpPool = pool;
  globalForDb.__pumpDb = instance;
  return instance;
}

// Proxy so that merely importing `db` never touches env or opens a pool — only
// actually calling a method (select/insert/update/…) initialises the connection.
export const db: NodePgDatabase<typeof schema> = new Proxy(
  {} as NodePgDatabase<typeof schema>,
  {
    get(_target, prop, receiver) {
      const real = initDb() as unknown as Record<string | symbol, unknown>;
      const value = Reflect.get(real, prop, receiver);
      return typeof value === "function" ? value.bind(real) : value;
    },
  },
);

export { schema };
