import { asc, eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { enquiryTags, projects, quotation } from "@/lib/db/schema";
import { DRIVE_GROUPS, erpQuotationNumber, quotationNumber, type EnquiryQuotations } from "@/lib/commercial";
import { tagDriveGroups } from "@/lib/commercial-server";
import { suggestedTsm } from "@/lib/quotation-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/quotations/enquiry?projectId=… — the enquiry's Quotation step (the
// Enquiries list, between Technical and Commercial): each drive group in use
// with its tags and its quotation (null = not generated yet), the tags with no
// drive yet, and the client's rep in sales (the locked TSM; null if none).
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!UUID.test(projectId)) return error("'projectId' query param is required", 400);

  const [[p], tags, groupOf, quotes] = await Promise.all([
    db.select({ clientCode: projects.clientCode }).from(projects).where(eq(projects.id, projectId)).limit(1),
    db
      .select({ id: enquiryTags.id, name: enquiryTags.name })
      .from(enquiryTags)
      .where(eq(enquiryTags.projectId, projectId))
      .orderBy(asc(enquiryTags.createdAt)),
    tagDriveGroups(projectId),
    db.select().from(quotation).where(eq(quotation.projectId, projectId)),
  ]);
  if (!p) return error("Enquiry not found", 404);
  const clientTsm = await suggestedTsm(p.clientCode).catch(() => null);

  const used = DRIVE_GROUPS.filter((g) => tags.some((t) => groupOf.get(t.id) === g));
  const mixed = used.length > 1;
  const data: EnquiryQuotations = {
    groups: used.map((g) => {
      const q = quotes.find((x) => x.driveGroup === g);
      return {
        group: g,
        tags: tags.filter((t) => groupOf.get(t.id) === g).map((t) => t.name),
        quotation: q
          ? {
              id: q.id,
              number: quotationNumber(q, mixed),
              erpSerial: q.erpSerial,
              erpNumber: erpQuotationNumber(q, mixed),
              quoteDate: q.quoteDate,
              tsmName: q.tsmName,
            }
          : null,
      };
    }),
    noDriveTags: tags.filter((t) => !groupOf.get(t.id)).map((t) => t.name),
    clientTsm,
  };
  return json(data);
}
