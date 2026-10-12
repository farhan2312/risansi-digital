import { and, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { error, json } from "@/lib/api";
import type { ClientQuoteHit } from "@/lib/client-quotes";
import { db } from "@/lib/db";
import { clientPriceRef, quotation } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// GET /api/client-quotes/search?q=… — clients with a price history: quoted
// from the portal (quotation) and/or with SharePoint price reference files
// (client_price_ref). Every word must match the client's name or code. Up to
// 30, most history first.

const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => "\\" + c)}%`;

export async function GET(req: Request) {
  const words = (new URL(req.url).searchParams.get("q") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return error("Type a client name or code", 400);

  const match = (name: AnyPgColumn, code: AnyPgColumn): SQL =>
    and(...words.map((w) => or(ilike(name, like(w)), ilike(code, like(w)))!))!;

  const [quoted, files] = await Promise.all([
    db
      .select({ code: quotation.clientCode, name: quotation.clientName, n: sql<number>`count(*)::int` })
      .from(quotation)
      .where(match(quotation.clientName, quotation.clientCode))
      .groupBy(quotation.clientCode, quotation.clientName),
    db
      .select({ code: clientPriceRef.clientCode, name: clientPriceRef.clientName, n: sql<number>`count(*)::int` })
      .from(clientPriceRef)
      .where(and(isNotNull(clientPriceRef.clientCode), match(clientPriceRef.clientName, clientPriceRef.clientCode)))
      .groupBy(clientPriceRef.clientCode, clientPriceRef.clientName),
  ]);

  // One entry per client: by code, or by name for a quotation without a code.
  const byKey = new Map<string, ClientQuoteHit>();
  const keyOf = (code: string | null, name: string | null) => (code ? `c:${code}` : `n:${(name ?? "").toUpperCase()}`);
  for (const q of quoted) {
    const k = keyOf(q.code, q.name);
    const hit = byKey.get(k) ?? { clientCode: q.code, clientName: q.name ?? q.code ?? "—", quotations: 0, files: 0 };
    hit.quotations += q.n;
    byKey.set(k, hit);
  }
  for (const f of files) {
    const k = keyOf(f.code, f.name);
    const hit = byKey.get(k) ?? { clientCode: f.code, clientName: f.name ?? f.code ?? "—", quotations: 0, files: 0 };
    hit.files += f.n;
    byKey.set(k, hit);
  }
  const hits = [...byKey.values()]
    .sort((a, b) => b.quotations - a.quotations || b.files - a.files || a.clientName.localeCompare(b.clientName))
    .slice(0, 30);
  return json(hits);
}
