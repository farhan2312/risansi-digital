import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { isOperationRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/operation-docs/[id]/mailed — Operation confirms they mailed this version's
// documents to the client. It only records that (the portal sends no e-mail); everyone
// else just sees whether it was mailed. A Save Version clears it. Audited.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  if (!isOperationRole(claims.role)) return error("Only Operation can mark it as mailed.", 403);
  const { id } = await params;
  if (!UUID.test(id)) return error("Invalid project id", 400);

  const now = new Date();
  const [done] = await db
    .update(projects)
    .set({ mailedAt: now, mailedBy: UUID.test(claims.sub) ? claims.sub : null })
    .where(and(eq(projects.id, id), isNotNull(projects.releasedToOperationAt), isNull(projects.mailedAt)))
    .returning({ code: projects.projectCode });
  if (!done) return error("This version isn't sent to operation, or is already marked as mailed.", 409);

  await logAudit(req, {
    action: "enquiry.mailed",
    entity: "projects",
    entityId: id,
    detail: `${done.code}: mailed to the client`,
  });
  return json({ mailedAt: now.toISOString() });
}
