import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enquiryTags } from "@/lib/db/schema";
import { workDenied } from "@/lib/enquiry-access";
import { WIZARD_TABLES, copyTagRows } from "@/lib/tag-copy";

export const dynamic = "force-dynamic";

// Duplicates a tag — the tag row plus every one of its 9 wizard-step rows —
// into the same enquiry or into a different one. Used by the copy buttons on
// the Enquiries page: "copy this tag" (same enquiry) and "copy into another /
// new enquiry".

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
  const noWork = await workDenied(req, { projectId: targetProjectId });
  if (noWork) return noWork;

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
  const copiedTables = await copyTagRows(db, WIZARD_TABLES, sourceTagId, targetProjectId, created.id);

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
