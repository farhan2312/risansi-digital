import { asc, eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { DRIVE_GROUPS, erpQuotationNumber, isDriveGroup, quotationNumber } from "@/lib/commercial";
import { normalizeOfferConfig, normalizeOfferConfigs, type CommercialOfferData } from "@/lib/commercial-offer";
import { projectDriveGroups } from "@/lib/commercial-server";
import { db } from "@/lib/db";
import { projects, quotation } from "@/lib/db/schema";
import { dotDate } from "@/lib/tech-doc";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/commercial-offer?projectId=… — header + saved sheet edits.
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!UUID.test(projectId)) return error("'projectId' query param is required", 400);
  const [[p], groups, quotes] = await Promise.all([
    db
      .select({
        code: projects.projectCode,
        name: projects.name,
        enquiryDate: projects.enquiryDate,
        config: projects.commercialOfferConfig,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
    projectDriveGroups(projectId),
    db.select().from(quotation).where(eq(quotation.projectId, projectId)).orderBy(asc(quotation.createdAt)),
  ]);
  if (!p) return error("Enquiry not found", 404);
  const mixed = groups.length > 1;
  const data: CommercialOfferData = {
    projectCode: p.code,
    clientName: p.name,
    enquiry: [p.code, p.enquiryDate ? `Dt. ${dotDate(p.enquiryDate)}` : ""].filter(Boolean).join(", "),
    mixed,
    quotations: Object.fromEntries(quotes.map((q) => [q.driveGroup, `${quotationNumber(q, mixed)}, Dt. ${dotDate(q.quoteDate)}`])),
    erpNumbers: Object.fromEntries(
      quotes.flatMap((q) => {
        const erp = erpQuotationNumber(q, mixed);
        return erp ? [[q.driveGroup, `${erp}, Dt. ${dotDate(q.quoteDate)}`]] : [];
      }),
    ),
    configs: normalizeOfferConfigs(p.config, [...DRIVE_GROUPS]),
  };
  return json(data);
}

// PUT /api/commercial-offer {projectId, group, config} — saves ONE drive
// group's sheet edits; the other groups' are kept. Document only.
export async function PUT(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const projectId = String(body.projectId ?? "");
  const group = String(body.group ?? "");
  if (!UUID.test(projectId)) return error("'projectId' is required", 400);
  if (!isDriveGroup(group)) return error("'group' must be GM, GB, VB or DD", 400);
  const config = normalizeOfferConfig(body.config);
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ config: projects.commercialOfferConfig })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (!row) return false;
    const all = normalizeOfferConfigs(row.config, [...DRIVE_GROUPS]);
    all[group] = config;
    await tx
      .update(projects)
      .set({ commercialOfferConfig: { groups: all } as unknown as Record<string, unknown> })
      .where(eq(projects.id, projectId));
    return true;
  });
  if (!saved) return error("Enquiry not found", 404);
  return json({ config });
}
