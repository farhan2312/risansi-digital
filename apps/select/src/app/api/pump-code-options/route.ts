import { and, asc, eq, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { tryDecodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { pumpCodeOption } from "@/lib/db/schema";
import { CODE_SEGMENTS, SEGMENT_DB } from "@/lib/pump-code";

export const dynamic = "force-dynamic";

// GET  /api/pump-code-options — every active choice for the pump product-code
//      builder (Commercial → Pump & Qty), in display order.
// POST /api/pump-code-options {segment, code, label?} — "+ Add" a choice to an
//      addable part (series, sub-category, size, model, MOC, rubber). Audited.

const ADDABLE = new Set(CODE_SEGMENTS.filter((s) => s.addable).map((s) => SEGMENT_DB[s.key]));

export async function GET() {
  const rows = await db
    .select({ segment: pumpCodeOption.segment, code: pumpCodeOption.code, label: pumpCodeOption.label })
    .from(pumpCodeOption)
    .where(eq(pumpCodeOption.active, true))
    .orderBy(asc(pumpCodeOption.segment), asc(pumpCodeOption.sortOrder), asc(pumpCodeOption.code));
  return json(rows);
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const segment = String(body.segment ?? "");
  if (!ADDABLE.has(segment)) return error("This part's choices can't be added to.", 400);
  // Codes go into product codes: upper-case letters, digits and "." only.
  let code = String(body.code ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (segment === "model") code = code.replace(/^H/, ""); // typed "H95" → model code "95"
  if (!/^[A-Z0-9.]{1,30}$/.test(code)) return error("Use letters, digits or '.' only (max 30).", 400);
  const label =
    String(body.label ?? "").trim().slice(0, 100) || (segment === "model" ? `H${code}` : segment === "size" ? `${code}"` : code);

  const [existing] = await db
    .select({ segment: pumpCodeOption.segment, code: pumpCodeOption.code, label: pumpCodeOption.label })
    .from(pumpCodeOption)
    .where(and(eq(pumpCodeOption.segment, segment), eq(pumpCodeOption.code, code)))
    .limit(1);
  if (existing) return json(existing);

  const claims = tryDecodeToken(req);
  const createdBy = claims?.sub && /^[0-9a-f-]{36}$/i.test(claims.sub) ? claims.sub : null;
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${pumpCodeOption.sortOrder}), 0) + 1` })
    .from(pumpCodeOption)
    .where(eq(pumpCodeOption.segment, segment));
  const [created] = await db
    .insert(pumpCodeOption)
    .values({ segment, code, label, sortOrder: Number(next), createdBy })
    .onConflictDoNothing()
    .returning({ segment: pumpCodeOption.segment, code: pumpCodeOption.code, label: pumpCodeOption.label });
  const row = created ?? { segment, code, label };
  await logAudit(req, {
    action: "pump_code_option.add",
    entity: "pump_code_option",
    entityId: `${segment}:${code}`,
    detail: `Added pump code ${segment.replace("_", "-")} option ${code}${label !== code ? ` (${label})` : ""}`,
  });
  return json(row, 201);
}
