import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Points at the subset schema (not schema.ts) so drizzle-kit never sees
  // `users` at all — that table is owned/migrated by sales-portal-next.
  schema: "./src/lib/db/migration-schema.ts",
  out: "./drizzle",
  dbCredentials: {
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME!,
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    ssl: process.env.DB_SSLMODE === "disable" ? false : { rejectUnauthorized: false },
  },
});
