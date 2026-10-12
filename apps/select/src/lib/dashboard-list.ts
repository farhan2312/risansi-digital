import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { enquiryTags, generalInfoInput, projects, stepApproval, users } from "@/lib/db/schema";
import type { DashboardListPage, DashboardListQuery } from "@/lib/dashboard-shared";

// The lists behind the Dashboard's KPI cards (GET /api/dashboard/list). Same
// filters as getDashboardData, so a list always adds up to its card:
//   since / until : bound the enquiry's (or tag's) created_at
//   mineUserId    : only enquiries that user created
// Enquiry status is the same tag rollup as the dashboard and Enquiries list.

const LIMIT_MAX = 50;

export async function getDashboardList({
  kind,
  status,
  q,
  offset,
  limit,
  since,
  until,
  mineUserId,
}: DashboardListQuery & { since: Date | null; until: Date | null; mineUserId: string | null }): Promise<DashboardListPage> {
  const lim = Math.min(LIMIT_MAX, Math.max(1, limit || 20));
  const off = Math.max(0, offset || 0);
  const created = (col: typeof projects.createdAt | typeof enquiryTags.createdAt): SQL[] => [
    ...(since ? [sql`${col} >= ${since}`] : []),
    ...(until ? [sql`${col} <= ${until}`] : []),
  ];
  const scope: SQL[] = mineUserId ? [eq(projects.createdBy, mineUserId)] : [];
  // Every word must match somewhere (LIKE wildcards escaped).
  const words = (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => "\\" + c)}%`;

  // Written as projects.* on purpose - see the note in dashboard-data.ts.
  const rollup = sql<string>`(
    SELECT CASE
      WHEN COUNT(*) = 0 THEN coalesce(projects.status, 'Pending')
      WHEN COUNT(*) FILTER (WHERE t.status = 'Completed') = COUNT(*) THEN 'Completed'
      WHEN COUNT(*) FILTER (WHERE t.status = 'Pending') = COUNT(*) THEN 'Pending'
      ELSE 'In Progress'
    END
    FROM ${enquiryTags} t WHERE t.project_id = projects.id
  )`;

  if (kind === "enquiries") {
    const where = and(
      ...created(projects.createdAt),
      ...scope,
      ...(status && status !== "all" ? [sql`${rollup} = ${status}`] : []),
      ...words.map(
        (w) =>
          or(
            ilike(projects.projectCode, like(w)),
            ilike(projects.name, like(w)),
            ilike(projects.customerName, like(w)),
            ilike(users.name, like(w)),
          )!,
      ),
    );
    const [[{ total }], rows] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(projects)
        .leftJoin(users, eq(users.id, projects.createdBy))
        .where(where),
      db
        .select({
          project: projects,
          status: rollup,
          createdByName: users.name,
          tagCount: sql<number>`(select count(*)::int from ${enquiryTags} t where t.project_id = projects.id)`,
        })
        .from(projects)
        .leftJoin(users, eq(users.id, projects.createdBy))
        .where(where)
        .orderBy(desc(projects.createdAt), desc(projects.id))
        .limit(lim)
        .offset(off),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
        kind: "enquiry" as const,
        id: r.project.id,
        code: r.project.projectCode,
        client: r.project.name,
        customer: r.project.customerName,
        status: r.status,
        createdByName: r.createdByName,
        createdAt: r.project.createdAt ? new Date(r.project.createdAt).toISOString() : null,
        tagCount: r.tagCount,
      })),
    };
  }

  // Tags: by their own status, or "awaiting" = at least one step sent for approval.
  const awaitingSteps = sql<number>`(select count(*)::int from ${stepApproval} s
    where s.tag_id = ${enquiryTags.id} and s.status = 'Awaiting Approval')`;
  const where = and(
    ...created(enquiryTags.createdAt),
    ...scope,
    ...(status === "awaiting"
      ? [sql`${awaitingSteps} > 0`]
      : status && status !== "all"
        ? [eq(enquiryTags.status, status)]
        : []),
    ...words.map(
      (w) =>
        or(
          ilike(enquiryTags.name, like(w)),
          ilike(projects.projectCode, like(w)),
          ilike(projects.name, like(w)),
          ilike(generalInfoInput.media, like(w)),
          ilike(generalInfoInput.selectedModel, like(w)),
        )!,
    ),
  );
  const base = () =>
    db
      .select({
        tag: enquiryTags,
        project: projects,
        liquid: generalInfoInput.media,
        model: generalInfoInput.selectedModel,
        createdByName: users.name,
        awaiting: awaitingSteps,
      })
      .from(enquiryTags)
      .innerJoin(projects, eq(projects.id, enquiryTags.projectId))
      .leftJoin(generalInfoInput, eq(generalInfoInput.tagId, enquiryTags.id))
      .leftJoin(users, eq(users.id, projects.createdBy))
      .where(where);
  const [[{ total }], rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(enquiryTags)
      .innerJoin(projects, eq(projects.id, enquiryTags.projectId))
      .leftJoin(generalInfoInput, eq(generalInfoInput.tagId, enquiryTags.id))
      .where(where),
    base().orderBy(desc(enquiryTags.createdAt), desc(enquiryTags.id)).limit(lim).offset(off),
  ]);
  return {
    total,
    rows: rows.map((r) => ({
      kind: "tag" as const,
      id: r.tag.id,
      name: r.tag.name,
      status: r.tag.status,
      liquid: r.liquid,
      model: r.model,
      awaitingSteps: r.awaiting,
      reportGeneratedAt: r.tag.reportGeneratedAt ? new Date(r.tag.reportGeneratedAt).toISOString() : null,
      createdAt: r.tag.createdAt ? new Date(r.tag.createdAt).toISOString() : null,
      enquiry: {
        id: r.project.id,
        code: r.project.projectCode,
        client: r.project.name,
        customer: r.project.customerName,
        status: r.project.status,
        createdByName: r.createdByName,
      },
    })),
  };
}
