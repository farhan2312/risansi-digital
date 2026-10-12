import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import type { ClientQuoteHistory } from "@/lib/client-quotes";
import { db } from "@/lib/db";
import { clientPriceRef, projects, quotation } from "@/lib/db/schema";
import { loadQuotation } from "@/lib/quotation-server";

export const dynamic = "force-dynamic";

// GET /api/client-quotes?clientCode=… (or ?clientName=… for a client without
// a code) — the client's price history: every portal quotation (with all its
// versions and their frozen prices; the live internal version at the current
// saved prices) and the SharePoint price reference files. Read-only.

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const code = (params.get("clientCode") ?? "").trim();
  const name = (params.get("clientName") ?? "").trim();
  if (!code && !name) return error("Give 'clientCode' or 'clientName'", 400);

  const rows = await db
    .select({
      projectId: quotation.projectId,
      driveGroup: quotation.driveGroup,
      clientName: quotation.clientName,
      projectCode: projects.projectCode,
      enquiryName: projects.name,
    })
    .from(quotation)
    .innerJoin(projects, eq(projects.id, quotation.projectId))
    .where(code ? eq(quotation.clientCode, code) : and(isNull(quotation.clientCode), sql`upper(${quotation.clientName}) = upper(${name})`))
    .orderBy(desc(quotation.createdAt));

  const quotations = [];
  for (const r of rows) {
    const info = await loadQuotation(r.projectId, r.driveGroup);
    if (info) quotations.push({ projectId: r.projectId, projectCode: r.projectCode, enquiryName: r.enquiryName, info });
  }

  const files = code
    ? await db
        .select({ id: clientPriceRef.id, fileName: clientPriceRef.fileName, url: clientPriceRef.url, fileDate: clientPriceRef.fileDate })
        .from(clientPriceRef)
        .where(eq(clientPriceRef.clientCode, code))
        .orderBy(sql`${clientPriceRef.fileDate} desc nulls last`, asc(clientPriceRef.fileName))
    : [];
  let clientName = rows[0]?.clientName ?? name;
  if (!clientName && code) {
    const [f] = await db.select({ n: clientPriceRef.clientName }).from(clientPriceRef).where(eq(clientPriceRef.clientCode, code)).limit(1);
    clientName = f?.n ?? code;
  }

  const data: ClientQuoteHistory = { client: { code: code || null, name: clientName || code }, quotations, files };
  return json(data);
}
