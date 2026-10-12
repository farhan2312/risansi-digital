/**
 * Postgres connection, ported from azure-functions/shared/database.py — same
 * pattern as sales-portal-next/src/lib/db/index.ts, on the same DB_* env vars.
 *
 * The pool and Drizzle instance are created lazily on first query (via a Proxy)
 * rather than at module load, so `next build` importing every route module
 * doesn't fail when DB creds aren't present in the build environment.
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
  __testingPool?: Pool;
  __testingDb?: NodePgDatabase<typeof schema>;
};

function createPool(): Pool {
  const sslmode = process.env.DB_SSLMODE ?? "require";
  return new Pool({
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 5432),
    database: required("DB_NAME"),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    ssl: sslmode === "disable" ? false : { rejectUnauthorized: false },
  });
}

function initDb(): NodePgDatabase<typeof schema> {
  if (globalForDb.__testingDb) return globalForDb.__testingDb;
  const pool = globalForDb.__testingPool ?? createPool();
  const instance = drizzle(pool, { schema });
  globalForDb.__testingPool = pool;
  globalForDb.__testingDb = instance;
  return instance;
}

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
