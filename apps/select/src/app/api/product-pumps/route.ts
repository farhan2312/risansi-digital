import { asc, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { productPump } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// GET /api/product-pumps — every ERP pump product code (PCP), A–Z. Small
// (~550 rows), so the Pump Model & Qty step loads it once and filters as the
// user types rather than searching server-side.
export async function GET() {
  const rows = await db
    .select({ productCode: productPump.productCode, pumpType: productPump.pumpType })
    .from(productPump)
    .orderBy(asc(productPump.productCode));
  return json(rows);
}

// Product codes are upper-case letters/digits with the odd - . / (e.g.
// RTOHV6OF8185AABN-MSA, RTOHV6OF1130AABN1.15). No spaces.
const CODE_RE = /^[A-Z0-9][A-Z0-9.\-/]{2,99}$/;

// POST /api/product-pumps {productCode} — adds a code that isn't in the
// master yet (the "+ Add" option on the Pump Model & Qty step), as PCP. Any
// signed-in user; audited. An existing code (any case) is returned as-is.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const productCode = String(body.productCode ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!CODE_RE.test(productCode)) {
    return error("Enter a valid product code (letters, digits, - . / only; 3-100 characters).", 400);
  }

  const [existing] = await db
    .select({ productCode: productPump.productCode, pumpType: productPump.pumpType })
    .from(productPump)
    .where(sql`upper(${productPump.productCode}) = ${productCode}`)
    .limit(1);
  if (existing) return json({ ...existing, added: false });

  const [row] = await db
    .insert(productPump)
    .values({ productCode, pumpType: "PCP" })
    .onConflictDoNothing()
    .returning({ productCode: productPump.productCode, pumpType: productPump.pumpType });
  if (!row) return json({ productCode, pumpType: "PCP", added: false }); // raced with another add

  await logAudit(req, {
    action: "product_pump.add",
    entity: "product_pump",
    entityId: productCode,
    detail: `Added pump product code ${productCode} (PCP)`,
  });
  return json({ ...row, added: true }, 201);
}
