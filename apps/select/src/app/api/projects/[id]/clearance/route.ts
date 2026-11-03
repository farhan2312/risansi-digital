import { asc, desc, eq, or, sql } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AuthError, decodeToken } from "@/lib/auth";
import { CLEARANCE_STATUSES, HOLD_REASONS, OTHER_REASON_GROUP, holdReasonText, type ClearanceEntry, type ClearanceStatus } from "@/lib/clearance";
import { db } from "@/lib/db";
import { clearanceReason, enquiryClearance, projects, users } from "@/lib/db/schema";
import { viewDenied, workDenied } from "@/lib/enquiry-access";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The enquiry's whole history, across its versions, newest first. */
async function historyOf(id: string): Promise<ClearanceEntry[] | null> {
  const [me] = await db.select({ id: projects.id, root: projects.rootProjectId }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!me) return null;
  const root = me.root ?? me.id;
  const rows = await db
    .select({ c: enquiryClearance, byName: users.name, version: projects.versionNo })
    .from(enquiryClearance)
    .innerJoin(projects, eq(projects.id, enquiryClearance.projectId))
    .leftJoin(users, eq(users.id, enquiryClearance.createdBy))
    .where(or(eq(projects.id, root), eq(projects.rootProjectId, root)))
    .orderBy(desc(enquiryClearance.createdAt));
  return rows.map(({ c, byName, version }) => ({
    id: c.id,
    status: c.status as ClearanceStatus,
    group: c.reasonGroup,
    reason: c.reason,
    remarks: c.remarks,
    at: c.createdAt.toISOString(),
    byName: byName ?? null,
    version,
  }));
}

// GET — the history, and the reasons added by hand.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);
  const notYours = await viewDenied(req, { projectId: id });
  if (notYours) return notYours;
  const [history, reasons] = await Promise.all([
    historyOf(id),
    db.select({ label: clearanceReason.label }).from(clearanceReason).orderBy(asc(sql`lower(${clearanceReason.label})`)),
  ]);
  if (!history) return error("Project not found", 404);
  return json({ history, otherReasons: reasons.map((r) => r.label) });
}

// POST {status, group?, reason?, remarks?} — adds to the history, for whoever can
// work on the enquiry. Hold needs its reason. Audited.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let claims;
  try {
    claims = await decodeToken(req);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.statusCode);
    throw e;
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);
  const noWork = await workDenied(req, { projectId: id });
  if (noWork) return noWork;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }
  const status = String(body.status ?? "") as ClearanceStatus;
  if (!CLEARANCE_STATUSES.includes(status)) return error("Pick Clear or Hold.", 400);
  const remarks = typeof body.remarks === "string" ? body.remarks.trim().slice(0, 2000) : "";

  let group: string | null = null;
  let reason: string | null = null;
  if (status === "Hold") {
    group = String(body.group ?? "").trim();
    reason = String(body.reason ?? "").trim() || null;
    if (group === OTHER_REASON_GROUP) {
      const others = await db.select({ label: clearanceReason.label }).from(clearanceReason);
      if (!reason || !others.some((o) => o.label === reason)) return error("Pick the reason.", 400);
    } else {
      const known = HOLD_REASONS.find((r) => r.group === group);
      if (!known) return error("Pick the reason for the hold.", 400);
      if (known.reasons.length ? !reason || !known.reasons.includes(reason) : reason !== null) return error("Pick the reason for the hold.", 400);
    }
  }

  const [p] = await db.select({ code: projects.projectCode }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!p) return error("Project not found", 404);
  const [row] = await db
    .insert(enquiryClearance)
    .values({ projectId: id, status, reasonGroup: group, reason, remarks: remarks || null, createdBy: claims.sub })
    .returning();

  const text = holdReasonText(group, reason);
  await logAudit(req, {
    action: "enquiry.clearance",
    entity: "projects",
    entityId: id,
    detail: `${p.code}: ${status}${text ? ` - ${text}` : ""}${remarks ? ` (${remarks.slice(0, 300)})` : ""}`,
  });
  return json({
    now: { status, group, reason, remarks: remarks || null, at: row.createdAt.toISOString() },
    history: await historyOf(id),
  }, 201);
}
