import { eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enquiryTags } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// Duplicates a tag — the tag row plus every one of its 9 wizard-step rows —
// into the same enquiry or into a different one. Used by the copy buttons on
// the Enquiries page: "copy this tag" (same enquiry) and "copy into another /
// new enquiry".
//
// The wizard tables are copied column-by-column off information_schema rather
// than a hand-written column list: those tables carry 60+ columns between them
// and gain more as the wizard grows, and a stale list would silently drop
// fields from the copy. Table names come from the fixed allowlist below and
// column names from the catalogue, so nothing user-supplied reaches the SQL.
const WIZARD_TABLES = [
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

/** "Tag A" -> "Tag A (copy)", then "(copy 2)", … so the new tag never collides
 * with an existing name in the destination enquiry. */
function uniqueName(base: string, taken: Set<string>): string {
  const first = `${base} (copy)`;
  if (!taken.has(first)) return first.slice(0, 100);
  for (let n = 2; n < 500; n++) {
    const candidate = `${base} (copy ${n})`;
    if (!taken.has(candidate)) return candidate.slice(0, 100);
  }
  return `${base} ${Date.now()}`.slice(0, 100);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sourceTagId } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional — an empty POST copies into the same enquiry.
  }

  const [source] = await db
    .select()
    .from(enquiryTags)
    .where(eq(enquiryTags.id, sourceTagId))
    .limit(1);
  if (!source) return error("Tag not found", 404);

  const targetProjectId =
    typeof body.targetProjectId === "string" && body.targetProjectId.trim()
      ? body.targetProjectId.trim()
      : source.projectId;

  const requestedName =
    typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;

  // Names are unique-ish per enquiry by convention, so dedupe against the
  // destination's existing tags.
  const existing = await db
    .select({ name: enquiryTags.name })
    .from(enquiryTags)
    .where(eq(enquiryTags.projectId, targetProjectId));
  if (existing.length === 0 && targetProjectId !== source.projectId) {
    return error("Destination enquiry not found", 404);
  }
  const taken = new Set(existing.map((t) => t.name));
  const name = requestedName && !taken.has(requestedName)
    ? requestedName.slice(0, 100)
    : uniqueName(requestedName ?? source.name, taken);

  // The copy has the inputs but no report, so it can never be "Completed";
  // an untouched source stays "Pending", anything else starts "In Progress".
  const status = source.status === "Pending" ? "Pending" : "In Progress";

  const [created] = await db
    .insert(enquiryTags)
    .values({ projectId: targetProjectId, name, status })
    .returning();

  // Copy each wizard row that exists for the source tag.
  let copiedTables = 0;
  for (const table of WIZARD_TABLES) {
    const cols = await db.execute<{ column_name: string }>(
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

    const inserted = await db.execute(
      sql`INSERT INTO ${sql.identifier(table)} (id, project_id, tag_id${sql.raw(colList)})
          SELECT gen_random_uuid(), ${targetProjectId}::uuid, ${created.id}::uuid${sql.raw(colList)}
            FROM ${sql.identifier(table)} WHERE tag_id = ${sourceTagId}::uuid`,
    );
    if ((inserted.rowCount ?? 0) > 0) copiedTables += 1;
  }

  await logAudit(req, {
    action: "tag.copy",
    entity: "enquiry_tags",
    entityId: created.id,
    detail: `Copied tag ${source.name} to ${name}${
      targetProjectId !== source.projectId ? " in another enquiry" : ""
    }`,
  });

  return json(
    {
      id: created.id,
      project_id: created.projectId,
      name: created.name,
      status: created.status,
      copied_steps: copiedTables,
    },
    201,
  );
}
