import { and, eq, isNull, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { error, isUniqueViolation, json, projectToDict } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { AuthError, decodeToken, requireEnquiryManager, type TokenClaims } from "@/lib/auth";
import { db } from "@/lib/db";
import { enquiryTags, projects, quotation, quotationVersion, users } from "@/lib/db/schema";
import { clientDetailsFrom, orderSubtypeFrom, orderTypeFrom } from "@/lib/enquiry-fields";
import { ENQUIRY_STATUSES } from "@/lib/enquiry-filters";
import { enquiryStatusColumns } from "@/lib/enquiry-filters-server";
import { versionLocked, viewDenied } from "@/lib/enquiry-access";

const assignee = alias(users, "assignee");

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reading an enquiry: any signed-in user. Editing and deleting: the User-Master and system
// admins only (lib/roles.ts) - a worker cannot change an enquiry's details.
async function guard(
  req: Request,
  check: (req: Request) => Promise<TokenClaims>,
): Promise<{ claims: TokenClaims; denied: null } | { claims: null; denied: Response }> {
  try {
    return { claims: await check(req), denied: null };
  } catch (e) {
    if (e instanceof AuthError) return { claims: null, denied: error(e.message, e.statusCode) };
    throw e;
  }
}

// Nullable free-text/enum columns: "" clears them to NULL, anything else trims.
function textOrNull(v: unknown): string | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  return String(v).trim();
}

/** A status and date from the Edit form. They are stored only where they differ
 *  from the automatic ones, so a status left alone keeps updating by itself.
 *  An error message when it won't do. */
function statusChoice(
  label: string,
  value: unknown,
  day: unknown,
  autoStatus: string,
  autoDay: string | null,
): { override: string | null; date: string | null } | string {
  const s = textOrNull(value);
  if (s === null || !(ENQUIRY_STATUSES as readonly string[]).includes(s)) return `'${label}' must be ${ENQUIRY_STATUSES.join(", ")}`;
  const override = s === autoStatus ? null : s;
  if (s !== "Completed") return { override, date: null };
  const d = textOrNull(day);
  if (d === null || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) {
    return `Completed needs its date for '${label}' (YYYY-MM-DD)`;
  }
  return { override, date: d === autoDay ? null : d };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { denied } = await guard(req, decodeToken);
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);
  const notYours = await viewDenied(req, { projectId: id });
  if (notYours) return notYours;

  const [project] = await db
    .select({ project: projects, createdByName: users.name, assignedToName: assignee.name })
    .from(projects)
    .leftJoin(users, eq(projects.createdBy, users.id))
    .leftJoin(assignee, eq(projects.assignedTo, assignee.id))
    .where(eq(projects.id, id))
    .limit(1);
  if (!project) return error("Project not found", 404);

  return json(projectToDict(project.project, project.createdByName, project.assignedToName));
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { denied } = await guard(req, requireEnquiryManager);
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);
  const locked = await versionLocked({ projectId: id });
  if (locked) return locked;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const patch: Partial<typeof projects.$inferInsert> = {};

  // name is NOT NULL — reject a blank rather than nulling it.
  if ("name" in body) {
    const n = String(body.name ?? "").trim();
    if (!n) return error("'name' can't be empty", 400);
    patch.name = n;
  }
  // Enquiry no. (project_code) is also NOT NULL and unique per version —
  // accepted from either projectCode or project_code so client code doesn't
  // have to pick. Every version of the enquiry takes the new number.
  const rawCode = "projectCode" in body ? body.projectCode
    : "project_code" in body ? body.project_code
    : undefined;
  if (rawCode !== undefined) {
    const c = String(rawCode ?? "").trim();
    if (!c) return error("'project_code' (Enquiry no.) can't be empty", 400);
    patch.projectCode = c;
  }
  if ("customerName" in body) patch.customerName = textOrNull(body.customerName);
  if ("clientCode" in body) patch.clientCode = textOrNull(body.clientCode);
  if ("industry" in body) patch.industry = textOrNull(body.industry);
  if ("remarks" in body) patch.remarks = textOrNull(body.remarks);
  if ("enquiryDate" in body) {
    const d = textOrNull(body.enquiryDate);
    if (d !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)))) {
      return error("'enquiryDate' must be a date (YYYY-MM-DD)", 400);
    }
    patch.enquiryDate = d;
  }
  // Newly marked Technical Completed: a pump other than PCP takes its tags along, as only
  // PCP tags are worked and confirmed one by one.
  let completeTags = false;
  if ("technicalStatus" in body || "commercialStatus" in body) {
    const [auto] = await db
      .select({ ...enquiryStatusColumns, technicalOverride: projects.technicalStatusOverride })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (!auto) return error("Project not found", 404);
    if ("technicalStatus" in body) {
      const c = statusChoice("technicalStatus", body.technicalStatus, body.completedOn, auto.technicalAuto, auto.technicalDayAuto);
      if (typeof c === "string") return error(c, 400);
      patch.technicalStatusOverride = c.override;
      patch.completedOn = c.date;
      completeTags = textOrNull(body.technicalStatus) === "Completed" && (auto.technicalOverride ?? auto.technicalAuto) !== "Completed";
    }
    if ("commercialStatus" in body) {
      const c = statusChoice("commercialStatus", body.commercialStatus, body.commercialCompletedOn, auto.commercialAuto, auto.commercialDayAuto);
      if (typeof c === "string") return error(c, 400);
      patch.commercialStatusOverride = c.override;
      patch.commercialCompletedOn = c.date;
    }
  }
  if ("orderType" in body) {
    const t = orderTypeFrom(body.orderType);
    if (!t) return error("'orderType' must be pump or spare", 400);
    patch.orderType = t;
  }
  if ("orderType" in body || "orderSubtype" in body) {
    // The subtype has to belong to the (new or current) order type.
    let t = patch.orderType as "pump" | "spare" | undefined;
    if (!t) {
      const [cur] = await db.select({ orderType: projects.orderType }).from(projects).where(eq(projects.id, id)).limit(1);
      if (!cur) return error("Project not found", 404);
      t = cur.orderType === "spare" ? "spare" : "pump";
    }
    const s = orderSubtypeFrom(t, body.orderSubtype);
    if (!s) return error(`'orderSubtype' does not belong to a ${t} order`, 400);
    patch.orderSubtype = s;
  }
  Object.assign(patch, clientDetailsFrom(body));
  // A quotation is made for one kind of order, so the kind stays once there is one.
  let needsDefaultTag = false;
  if (patch.orderType) {
    const [cur] = await db.select({ orderType: projects.orderType }).from(projects).where(eq(projects.id, id)).limit(1);
    if (cur && cur.orderType !== patch.orderType) {
      const [quoted] = await db.select({ id: quotation.id }).from(quotation).where(eq(quotation.projectId, id)).limit(1);
      if (quoted) return error("The order type can't change once a quotation is generated.", 409);
      needsDefaultTag = patch.orderType === "pump";
    }
  }

  if (Object.keys(patch).length === 0) {
    return error("No editable fields provided", 400);
  }
  patch.updatedAt = new Date();

  let updated: typeof projects.$inferSelect | undefined;
  let tagsCompleted: string[] = [];
  try {
    updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(projects).set(patch).where(eq(projects.id, id)).returning();
      if (row && completeTags && row.orderType === "pump" && row.orderSubtype !== "pcp") {
        const done = await tx
          .update(enquiryTags)
          .set({ status: "Completed", updatedAt: new Date() })
          .where(and(eq(enquiryTags.projectId, id), ne(enquiryTags.status, "Completed")))
          .returning({ name: enquiryTags.name });
        tagsCompleted = done.map((t) => t.name);
      }
      if (row && patch.projectCode) {
        const root = row.rootProjectId ?? row.id;
        await tx
          .update(projects)
          .set({ projectCode: patch.projectCode })
          .where(or(eq(projects.id, root), eq(projects.rootProjectId, root)));
      }
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return error(`Enquiry no. "${patch.projectCode}" already exists`, 409);
    }
    throw e;
  }
  if (!updated) return error("Project not found", 404);
  if (tagsCompleted.length > 0) {
    await logAudit(req, {
      action: "enquiry.tags_completed",
      entity: "projects",
      entityId: id,
      detail: `${updated.projectCode}: marked Technical Completed, so ${tagsCompleted.length} tag(s) set to Completed: ${tagsCompleted.join(", ").slice(0, 300)}`,
    });
  }
  if (needsDefaultTag) {
    const [tag] = await db.select({ id: enquiryTags.id }).from(enquiryTags).where(eq(enquiryTags.projectId, id)).limit(1);
    if (!tag) await db.insert(enquiryTags).values({ projectId: id, name: "Default" });
  }

  const nameOf = async (userId: string | null) => {
    if (!userId) return null;
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.name ?? null;
  };

  return json(projectToDict(updated, await nameOf(updated.createdBy), await nameOf(updated.assignedTo)));
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { denied } = await guard(req, requireEnquiryManager);
  if (denied) return denied;

  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid project id", 400);

  // An older version stays as long as a newer one exists; deleting the latest
  // version makes the one before it the latest again.
  const locked = await versionLocked({ projectId: id });
  if (locked) return locked;

  // pump_selection_input rows for this project cascade-delete via its FK.
  const deleted = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ kind: projects.versionKind, version: projects.versionNo, root: projects.rootProjectId })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (before?.kind === "technical" && before.root) {
      const [previous] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.versionNo, before.version - 1), or(eq(projects.id, before.root), eq(projects.rootProjectId, before.root))))
        .limit(1);
      const quotes = await tx.select().from(quotation).where(eq(quotation.projectId, id));
      for (const q of quotes) {
        const [back] = previous
          ? await tx.select({ id: quotation.id }).from(quotation).where(and(eq(quotation.projectId, previous.id), eq(quotation.driveGroup, q.driveGroup))).limit(1)
          : [];
        if (!back) continue;
        const moved = await tx
          .update(quotationVersion)
          .set({ quotationId: back.id })
          .where(and(eq(quotationVersion.quotationId, q.id), eq(quotationVersion.track, "internal"), isNull(quotationVersion.frozenAt)))
          .returning({ version: quotationVersion.version });
        if (moved[0]) await tx.update(quotation).set({ internalVersion: moved[0].version }).where(eq(quotation.id, back.id));
      }
    }
    const [row] = await tx.delete(projects).where(eq(projects.id, id)).returning();
    if (row?.rootProjectId) {
      const root = row.rootProjectId;
      await tx
        .update(projects)
        .set({ isLatest: true })
        .where(and(eq(projects.versionNo, row.versionNo - 1), or(eq(projects.id, root), eq(projects.rootProjectId, root))));
    }
    return row;
  });
  if (!deleted) return error("Project not found", 404);

  return json({ id: deleted.id, deleted: true });
}
