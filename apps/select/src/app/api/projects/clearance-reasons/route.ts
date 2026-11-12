import { error, isUniqueViolation, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { clearanceReason } from "@/lib/db/schema";
import { isViewOnlyRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

// POST {label} — adds a Hold reason to the Other list, for everyone. Reps only view
// enquiries, so they can't. Audited.
export async function POST(req: Request) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  if (isViewOnlyRole(claims.role)) return error("Your role can view enquiries only.", 403);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";
  if (!label) return error("Type the reason.", 400);
  try {
    await db.insert(clearanceReason).values({ label, createdBy: claims.sub });
  } catch (e) {
    if (isUniqueViolation(e)) return error("That reason is already on the list.", 409);
    throw e;
  }
  await logAudit(req, { action: "enquiry.clearance_reason", entity: "clearance_reason", entityId: label, detail: `Added Hold reason: ${label}` });
  return json({ label }, 201);
}
