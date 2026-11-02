// Copies a tag's saved rows onto another tag. Shared by the copy buttons on the
// Enquiries page and by creating a new version of an enquiry. Server-only.
//
// The tables are copied column-by-column off information_schema rather than a
// hand-written column list: they carry 60+ columns between them and gain more
// as the wizard grows, and a stale list would silently drop fields from the
// copy. Table names come from the fixed allowlists below and column names from
// the catalogue, so nothing user-supplied reaches the SQL.
import { sql } from "drizzle-orm";

import type { db } from "./db";

export const WIZARD_TABLES = [
  "general_info_input",
  "fluid_properties_input",
  "operating_conditions_input",
  "moc_sealing_input",
  "motor_drive_input",
  "drive_direct_input",
  "drive_vbelt_input",
  "drive_geared_input",
  "pump_model_qty_input",
] as const;

// Set per row, never copied.
const IDENTITY_COLUMNS = new Set(["id", "project_id", "tag_id"]);

// Generated artefacts of the SOURCE tag, deliberately not carried over: the
// copy is a fresh selection run and re-generates its own. The uploaded
// client-requirements file IS copied — that's an input, not an artefact.
const SKIP_COLUMNS: Record<string, Set<string>> = {
  moc_sealing_input: new Set(["document", "document_filename", "document_generated_at"]),
};

const quote = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

type Runner = Pick<typeof db, "execute">;

/** Copies each listed table's row for the source tag; returns how many had one. */
export async function copyTagRows(
  runner: Runner,
  tables: readonly string[],
  sourceTagId: string,
  targetProjectId: string,
  targetTagId: string,
): Promise<number> {
  let copied = 0;
  for (const table of tables) {
    const cols = await runner.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ${table}`,
    );
    const skip = SKIP_COLUMNS[table];
    const carried = cols.rows
      .map((c) => c.column_name)
      .filter((c) => !IDENTITY_COLUMNS.has(c) && !(skip && skip.has(c)));

    // Identifiers are interpolated (allowlisted table, catalogue columns);
    // the three values stay parameterised.
    const colList = carried.length ? ", " + carried.map(quote).join(", ") : "";

    const inserted = await runner.execute(
      sql`INSERT INTO ${sql.identifier(table)} (id, project_id, tag_id${sql.raw(colList)})
          SELECT gen_random_uuid(), ${targetProjectId}::uuid, ${targetTagId}::uuid${sql.raw(colList)}
            FROM ${sql.identifier(table)} WHERE tag_id = ${sourceTagId}::uuid`,
    );
    if ((inserted.rowCount ?? 0) > 0) copied += 1;
  }
  return copied;
}
