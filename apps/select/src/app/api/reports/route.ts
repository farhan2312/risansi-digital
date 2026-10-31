import { desc, eq, isNotNull } from "drizzle-orm";

import { json } from "@/lib/api";
import { db } from "@/lib/db";
import { enquiryTags, projects, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// One row per TAG that has a saved final Selection Summary report (see
// enquiry_tags.report_document — set when the user clicks "Confirm Pump
// Selection" on the last wizard step). One enquiry can carry N tags, so one
// project can appear multiple times here (once per confirmed tag). Storing
// the report on the tag row itself makes "one tag, one report" automatic -
// there's nowhere else for a second one to live. No auth gate here - same
// convention as the other routes; the /selection-summary page itself is
// already gated by middleware.
export async function GET() {
  const rows = await db
    .select({
      tagId: enquiryTags.id,
      tagName: enquiryTags.name,
      tagStatus: enquiryTags.status,
      projectId: projects.id,
      projectCode: projects.projectCode,
      projectName: projects.name,
      // Client code, not customer - customerName isn't collected at
      // creation (only clientCode is, via the Create Project form), so it's
      // almost always empty. clientCode is what's actually filled in.
      clientCode: projects.clientCode,
      createdByName: users.name,
      documentFilename: enquiryTags.reportFilename,
      documentGeneratedAt: enquiryTags.reportGeneratedAt,
    })
    .from(enquiryTags)
    .innerJoin(projects, eq(enquiryTags.projectId, projects.id))
    .leftJoin(users, eq(projects.createdBy, users.id))
    .where(isNotNull(enquiryTags.reportDocument))
    .orderBy(desc(enquiryTags.reportGeneratedAt));

  return json(
    rows.map((r) => ({
      tag_id: r.tagId,
      tag_name: r.tagName,
      project_id: r.projectId,
      project_code: r.projectCode,
      project_name: r.projectName,
      client_code: r.clientCode,
      // Status is now the TAG's status - the value shown on the projects
      // page's nested tag row for the same tag.
      status: r.tagStatus,
      created_by_name: r.createdByName,
      document_filename: r.documentFilename,
      document_generated_at: r.documentGeneratedAt,
    })),
  );
}
