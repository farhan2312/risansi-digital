import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { MAX_LINKS_PER_DOC, docLinkKinds, docLinksOrNull, linkList, sharepointLinkProblem, type DocLinks } from "@/lib/doc-links";
import { workDenied } from "@/lib/enquiry-access";
import { REVIEW_CLEARED } from "@/lib/enquiry-filters-server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

// PUT /api/projects/[id]/doc-links {clientFormat, technical?, commercial?, techno?} (each a
// list of links, or one link; user, 2026-11-26) - the
// client's own format on / off for this enquiry version, and the SharePoint links of its
// documents (lib/doc-links.ts); a spare has commercial (its quotation) only. Off clears
// the links (the generated documents go). Only the keys sent change; "" or [] clears one. Whoever can work on
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

  if (typeof body.clientFormat !== "boolean") return error("'clientFormat' must be true or false", 400);
  const was = docLinksOrNull(p.links);
  if (!body.clientFormat) {
    if (was === null) return json({ links: null, changed: false });
    await db.update(projects).set({ docLinks: null, ...REVIEW_CLEARED, updatedAt: new Date() }).where(eq(projects.id, id));
    await logAudit(req, { action: "enquiry.doc_links", entity: "projects", entityId: id, detail: `${p.code}: client's own format off` });
    return json({ links: null, changed: true });
  }
  const next: DocLinks = { ...(was ?? {}) };
  for (const { key, label } of docLinkKinds(p.orderType)) {
    if (!(key in body)) continue;
    const urls = linkList(body[key]);
    if (urls.length === 0) {
      delete next[key];
      continue;
    }
    if (urls.length > MAX_LINKS_PER_DOC) return error(`The ${label} document can have at most ${MAX_LINKS_PER_DOC} links.`, 400);
    for (const [i, url] of urls.entries()) {
      const which = urls.length > 1 ? `${label} link ${i + 1}` : `${label} link`;
      if (url.length > 2000) return error(`The ${which} is too long.`, 400);
      const problem = sharepointLinkProblem(url);
      if (problem) return error(`The ${which} ${problem}.`, 400);
    }
    next[key] = urls;
  }

  const same = (a?: string[], b?: string[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  const changed = docLinkKinds(p.orderType).filter(({ key }) => !same(was?.[key], next[key]));
  if (was !== null && changed.length === 0) return json({ links: next, changed: false });

  await db
    .update(projects)
    .set({ docLinks: next, ...REVIEW_CLEARED, updatedAt: new Date() })
    .where(eq(projects.id, id));
  await logAudit(req, {
    action: "enquiry.doc_links",
    entity: "projects",
    entityId: id,
    detail: `${p.code}: client's own format${was === null ? " on" : ""}${changed.length ? ` - ${changed.map((k) => `${k.label} ${next[k.key] ? (was?.[k.key] ? "changed" : "added") : "removed"}`).join(", ")}` : ""}`,
  });
  return json({ links: next, changed: true });
}
