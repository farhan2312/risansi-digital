import { and, eq, isNotNull } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { canSeeOperationDocs } from "@/lib/roles";
import { loadSavedDocs } from "@/lib/saved-docs-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/operation-docs/[id] — one enquiry version's saved documents, only once it has
// been reviewed and sent to operation.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const claims = await decodeToken(req);
    if (!canSeeOperationDocs(claims.role)) return error("Not available for your role.", 403);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  const { id } = await params;
  if (!UUID.test(id)) return error("Invalid project id", 400);
  const [sent] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), isNotNull(projects.releasedToOperationAt)))
    .limit(1);
  if (!sent) return error("This version isn't sent to operation.", 404);
  const docs = await loadSavedDocs(id);
  if (!docs) return error("Enquiry not found", 404);
  return json(docs);
}
