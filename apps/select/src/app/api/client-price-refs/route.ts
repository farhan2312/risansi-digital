import { and, desc, eq, ilike, sql, type SQL } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { db } from "@/lib/db";
import { clientPriceRef } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// GET /api/client-price-refs?clientCode=…&q=… — client pump price reference
// files (links to SharePoint; the files are never read or changed here).
//   clientCode  the files matched to that sales client
//   q           words in the file name (any client, incl. unmatched files)
// At least one is required. Newest file date first; undated names last.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const clientCode = (params.get("clientCode") ?? "").trim();
  const words = (params.get("q") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!clientCode && words.length === 0) return error("Give 'clientCode' or 'q'", 400);

  const filters: SQL[] = [];
  if (clientCode) filters.push(eq(clientPriceRef.clientCode, clientCode));
  for (const w of words) filters.push(ilike(clientPriceRef.fileName, `%${w.replace(/[\\%_]/g, (c) => "\\" + c)}%`));

  const rows = await db
    .select({
      id: clientPriceRef.id,
      clientCode: clientPriceRef.clientCode,
      clientName: clientPriceRef.clientName,
      fileName: clientPriceRef.fileName,
      url: clientPriceRef.url,
      fileDate: clientPriceRef.fileDate,
    })
    .from(clientPriceRef)
    .where(and(...filters))
    .orderBy(sql`${clientPriceRef.fileDate} desc nulls last`, desc(clientPriceRef.fileName))
    .limit(100);
  return json(rows);
}
