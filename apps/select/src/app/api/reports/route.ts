import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { repScope } from "@/lib/rep-scope";
import { db } from "@/lib/db";
import { enquiryTags, projects, quotation, users } from "@/lib/db/schema";
import { enquiryStatusSql } from "@/lib/enquiry-filters-server";

export const dynamic = "force-dynamic";

// One row per TAG that has a saved final Selection Summary report (see
// enquiry_tags.report_document — set when the user clicks "Confirm Pump
// Selection" on the last wizard step). One enquiry can carry N tags, so one
// project can appear multiple times here (once per confirmed tag). Storing
// the report on the tag row itself makes "one tag, one report" automatic -
// there's nowhere else for a second one to live. No auth gate here - same
// convention as the other routes; the /selection-summary page itself is
// already gated by middleware.
// A Rep / Rep Manager sees only their own enquiries' reports (`rep` narrows a
// manager to one of their reps).
export async function GET(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  const rep = await repScope(claims, new URL(req.url).searchParams.get("rep"));
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
      // Who may work on it (a worker only views the documents of others), and
      // whether a quotation exists (the documents open once one does).
      assignedTo: projects.assignedTo,
      enquiryStatus: enquiryStatusSql,
      versionNo: projects.versionNo,
      rootProjectId: projects.rootProjectId,
      isLatest: projects.isLatest,
      quotationCount: sql<number>`(SELECT count(*)::int FROM ${quotation} q WHERE q.project_id = ${projects.id})`,
      documentFilename: enquiryTags.reportFilename,
      documentGeneratedAt: enquiryTags.reportGeneratedAt,
    })
    .from(enquiryTags)
    .innerJoin(projects, eq(enquiryTags.projectId, projects.id))
    .leftJoin(users, eq(projects.createdBy, users.id))
    .where(rep ? and(isNotNull(enquiryTags.reportDocument), rep) : isNotNull(enquiryTags.reportDocument))
    .orderBy(desc(enquiryTags.reportGeneratedAt));

  return json(
    rows.map((r) => ({
      tag_id: r.tagId,
      tag_name: r.tagName,
      project_id: r.projectId,
      project_code: r.projectCode,
      version_no: r.versionNo,
      is_latest: r.isLatest,
      enquiry_root_id: r.rootProjectId ?? r.projectId,
      project_name: r.projectName,
      client_code: r.clientCode,
      // Status is now the TAG's status - the value shown on the projects
      // page's nested tag row for the same tag.
      status: r.tagStatus,
      created_by_name: r.createdByName,
      assigned_to: r.assignedTo,
      enquiry_status: r.enquiryStatus,
      quotation_count: r.quotationCount,
      document_filename: r.documentFilename,
      document_generated_at: r.documentGeneratedAt,
    })),
  );
}
