import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { docLinkKinds, normalizeDocLinks, sharepointLinkProblem, type DocLinks } from "@/lib/doc-links";
import { workDenied } from "@/lib/enquiry-access";
import { REVIEW_CLEARED } from "@/lib/enquiry-filters-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// PUT /api/projects/[id]/doc-links {technical?, commercial?, techno?} - an enquiry
// version's SharePoint links, each opening instead of its generated document
// (lib/doc-links.ts); a spare has commercial (its quotation) only. Only the keys sent change; "" clears one. Whoever can work on
// the enquiry; not an older version. A change means what was reviewed changed, so it is
// reviewed and sent again (as after a Save Version). Audited.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  const { id } = await params;
  if (!UUID.test(id)) return error("Invalid project id", 400);
  const noWork = await workDenied(req, { projectId: id });
  if (noWork) return noWork;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const [p] = await db
    .select({ code: projects.projectCode, orderType: projects.orderType, links: projects.docLinks })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);
  if (!p) return error("Project not found", 404);

  const was = normalizeDocLinks(p.links);
  const next: DocLinks = { ...was };
  for (const { key, label } of docLinkKinds(p.orderType)) {
    if (!(key in body)) continue;
    const url = typeof body[key] === "string" ? (body[key] as string).trim() : "";
    if (!url) {
      delete next[key];
      continue;
    }
    if (url.length > 2000) return error(`The ${label} link is too long.`, 400);
    const problem = sharepointLinkProblem(url);
    if (problem) return error(`The ${label} link ${problem}.`, 400);
    next[key] = url;
  }

  const changed = docLinkKinds(p.orderType).filter(({ key }) => (was[key] ?? "") !== (next[key] ?? ""));
  if (changed.length === 0) return json({ links: next, changed: false });

  await db
    .update(projects)
    .set({ docLinks: next, ...REVIEW_CLEARED, updatedAt: new Date() })
    .where(eq(projects.id, id));
  await logAudit(req, {
    action: "enquiry.doc_links",
    entity: "projects",
    entityId: id,
    detail: `${p.code}: SharePoint links ${changed.map((k) => `${k.label} ${next[k.key] ? (was[k.key] ? "changed" : "added") : "removed"}`).join(", ")}`,
  });
  return json({ links: next, changed: true });
}
