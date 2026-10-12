/**
 * Subset of schema.ts containing ONLY the tables this app owns migrations
 * for. drizzle.config.ts points here (not schema.ts) so drizzle-kit never
 * introspects, diffs, or generates statements for `users` — that table is
 * migrated by sales-portal-next, and letting drizzle-kit see it here caused
 * it to treat it as missing (since tablesFilter excludes it from the DB-side
 * snapshot but not from a schema file that still declares it) and attempt to
 * CREATE TABLE users, colliding with the real one.
 */
export { testRequisitions, pumpTestReports, pumpTestReportPoints } from "./schema";
