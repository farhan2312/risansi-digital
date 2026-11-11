import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  enquiryTags,
  generalInfoInput,
  operatingConditionsInput,
  projects,
  stepApproval,
  users,
} from "@/lib/db/schema";
import { IST_OFFSET_MS } from "@/lib/ist";
import type { EnquiryFilters } from "@/lib/enquiry-filters";
import { enquiryFilterSql, enquiryStatusSql } from "@/lib/enquiry-filters-server";
import { filterKey } from "@/lib/enquiry-filters";
import type { DashboardData, DashboardEnquiry } from "@/lib/dashboard-shared";

// Everything the Dashboard shows, in one call (GET /api/dashboard).
//
//   since / until : bound the enquiry's (or tag's) created_at; either may be null
//   mineUserId    : only enquiries assigned to that user ("Assigned to me")
//
// Days are IST. Enquiry status is the Technical status, the same as GET
// /api/projects (lib/enquiry-filters-server.ts).

const RECENT_LIMIT = 8;
const MAX_DAYS = 92;

const istDay = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export async function getDashboardData({
  since,
  until,
  mineUserId,
  filters = {},
  extraScope = null,
}: {
  since: Date | null;
  until: Date | null;
  mineUserId: string | null;
  /** Client / reps / zone / market / industry / status (lib/enquiry-filters). */
  filters?: EnquiryFilters;
  /** A further condition on projects (a rep's own enquiries). */
  extraScope?: SQL | null;
}): Promise<DashboardData> {
  const mine = Boolean(mineUserId);

  const created = (col: typeof projects.createdAt | typeof enquiryTags.createdAt): SQL[] => [
    ...(since ? [sql`${col} >= ${since}`] : []),
    ...(until ? [sql`${col} <= ${until}`] : []),
  ];
  const scope: SQL[] = [...(mine && mineUserId ? [eq(projects.assignedTo, mineUserId)] : []), ...enquiryFilterSql(filters), ...(extraScope ? [extraScope] : [])];
  const projectWhere = and(...created(projects.createdAt), ...scope);
  const tagWhere = and(...created(enquiryTags.createdAt), ...scope);

  const rollup = enquiryStatusSql;

  const [
    [projectCounts],
    [tagCounts],
    [approvalCounts],
    statusRows,
    industryRows,
    mixRows,
    enquiryDays,
    tagDays,
    recentRows,
  ] = await Promise.all([
    db.select({ enquiries: sql<number>`count(*)::int` }).from(projects).where(projectWhere),

    db
      .select({
        tags: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${enquiryTags.status} = 'Pending')::int`,
        inProgress: sql<number>`count(*) filter (where ${enquiryTags.status} = 'In Progress')::int`,
        completed: sql<number>`count(*) filter (where ${enquiryTags.status} = 'Completed')::int`,
        reports: sql<number>`count(${enquiryTags.reportGeneratedAt})::int`,
      })
      .from(enquiryTags)
      .innerJoin(projects, eq(projects.id, enquiryTags.projectId))
      .where(tagWhere),

    db
      .select({
        awaiting: sql<number>`count(*) filter (where ${stepApproval.status} = 'Awaiting Approval')::int`,
        awaitingTags: sql<number>`count(distinct ${stepApproval.tagId}) filter (where ${stepApproval.status} = 'Awaiting Approval')::int`,
        approved: sql<number>`count(*) filter (where ${stepApproval.status} = 'Approved')::int`,
        rejected: sql<number>`count(*) filter (where ${stepApproval.status} = 'Rejected')::int`,
      })
      .from(stepApproval)
      .innerJoin(enquiryTags, eq(enquiryTags.id, stepApproval.tagId))
      .innerJoin(projects, eq(projects.id, enquiryTags.projectId))
      .where(tagWhere),

    // Per-enquiry rollup, counted below (grouping by the correlated subquery
    // itself isn't allowed).
    db.select({ status: rollup }).from(projects).where(projectWhere),

    db
      .select({
        label: sql<string>`coalesce(nullif(trim(${projects.industry}), ''), 'Not set')`,
        count: sql<number>`count(*)::int`,
      })
      .from(projects)
      .where(projectWhere)
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`)
      .limit(8),

    // One row per enquiry for the client-mix charts (aggregated below, so a
    // value spelt two ways counts once).
    db
      .select({
        market: projects.clientMarketType,
        zone: projects.clientZone,
        rep: projects.clientPrimaryRep,
        status: rollup,
      })
      .from(projects)
      .where(projectWhere),

    db
      .select({
        day: sql<string>`to_char(${projects.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(projects)
      .where(projectWhere)
      .groupBy(sql`1`),

    db
      .select({
        day: sql<string>`to_char(${enquiryTags.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${enquiryTags.status} = 'Completed')::int`,
      })
      .from(enquiryTags)
      .innerJoin(projects, eq(projects.id, enquiryTags.projectId))
      .where(tagWhere)
      .groupBy(sql`1`),

    db
      .select({
        project: projects,
        status: rollup,
        createdByName: users.name,
      })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.createdBy))
      .where(projectWhere)
      .orderBy(desc(projects.createdAt))
      .limit(RECENT_LIMIT),
  ]);

  // --- Tags for the recent enquiries ---------------------------------------
  const ids = recentRows.map((r) => r.project.id);
  const tagRows = ids.length
    ? await db
        .select({
          id: enquiryTags.id,
          projectId: enquiryTags.projectId,
          name: enquiryTags.name,
          status: enquiryTags.status,
          liquid: generalInfoInput.media,
          model: generalInfoInput.selectedModel,
          capacity: generalInfoInput.capacity,
          capacityUnit: generalInfoInput.capacityUnit,
          head: generalInfoInput.head,
          headUnit: generalInfoInput.headUnit,
          pumpType: operatingConditionsInput.pumpType,
          reportGeneratedAt: enquiryTags.reportGeneratedAt,
          createdAt: enquiryTags.createdAt,
          updatedAt: enquiryTags.updatedAt,
          awaiting: sql<number>`(select count(*)::int from ${stepApproval} s
            where s.tag_id = ${enquiryTags.id} and s.status = 'Awaiting Approval')`,
          approved: sql<number>`(select count(*)::int from ${stepApproval} s
            where s.tag_id = ${enquiryTags.id} and s.status = 'Approved')`,
          rejected: sql<number>`(select count(*)::int from ${stepApproval} s
            where s.tag_id = ${enquiryTags.id} and s.status = 'Rejected')`,
        })
        .from(enquiryTags)
        .leftJoin(generalInfoInput, eq(generalInfoInput.tagId, enquiryTags.id))
        .leftJoin(operatingConditionsInput, eq(operatingConditionsInput.tagId, enquiryTags.id))
        .where(inArray(enquiryTags.projectId, ids))
        .orderBy(enquiryTags.createdAt)
    : [];

  const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
  const part = (v: string | null, unit: string | null) => (v && v.trim() ? `${v}${unit ? ` ${unit}` : ""}` : null);

  const recent: DashboardEnquiry[] = recentRows.map((r) => ({
    id: r.project.id,
    code: r.project.projectCode,
    client: r.project.name,
    customer: r.project.customerName,
    clientCode: r.project.clientCode,
    industry: r.project.industry,
    status: r.status,
    createdByName: r.createdByName,
    createdAt: iso(r.project.createdAt),
    tags: tagRows
      .filter((t) => t.projectId === r.project.id)
      .map((t) => {
        const duty = [part(t.capacity, t.capacityUnit), part(t.head, t.headUnit)].filter(Boolean).join(" @ ");
        return {
          id: t.id,
          name: t.name,
          status: t.status,
          liquid: t.liquid,
          pumpType: t.pumpType,
          model: t.model,
          duty: duty || null,
          reportGeneratedAt: iso(t.reportGeneratedAt),
          approvals: { awaiting: t.awaiting, approved: t.approved, rejected: t.rejected },
          createdAt: iso(t.createdAt),
          updatedAt: iso(t.updatedAt),
        };
      }),
  }));

  // --- Trend: every IST day in the window, zero-filled ------------------------
  const allDays = [...enquiryDays.map((d) => d.day), ...tagDays.map((d) => d.day)].sort();
  const startDay = since ? istDay(since) : allDays[0];
  const endDay = istDay(until ?? new Date());
  const days: string[] = [];
  if (startDay) {
    for (let t = Date.parse(`${startDay}T00:00:00Z`); t <= Date.parse(`${endDay}T00:00:00Z`); t += 86400_000) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }
  }
  const enqByDay = new Map(enquiryDays.map((d) => [d.day, d.n]));
  const tagByDay = new Map(tagDays.map((d) => [d.day, d]));
  const trend = days.slice(-MAX_DAYS).map((day) => ({
    day,
    enquiries: enqByDay.get(day) ?? 0,
    tags: tagByDay.get(day)?.n ?? 0,
    completed: tagByDay.get(day)?.completed ?? 0,
  }));

  const order = ["Pending", "In Progress", "Completed", "Sent to client", "Not Quoted", "Regret"];
  const data: DashboardData = {
    kpis: {
      enquiries: projectCounts?.enquiries ?? 0,
      tags: tagCounts?.tags ?? 0,
      pending: tagCounts?.pending ?? 0,
      inProgress: tagCounts?.inProgress ?? 0,
      completed: tagCounts?.completed ?? 0,
      reports: tagCounts?.reports ?? 0,
      awaitingApproval: approvalCounts?.awaiting ?? 0,
      awaitingTags: approvalCounts?.awaitingTags ?? 0,
    },
    trend,
    enquiryStatus: order
      .map((label) => ({ label, count: statusRows.filter((r) => r.status === label).length }))
      .filter((s) => s.count > 0),
    industries: industryRows,
    mix: clientMix(mixRows),
    approvals: {
      awaiting: approvalCounts?.awaiting ?? 0,
      approved: approvalCounts?.approved ?? 0,
      rejected: approvalCounts?.rejected ?? 0,
    },
    recent,
  };
  return data;
}


// --- Client mix ---------------------------------------------------------------

type MixRow = { market: string | null; zone: string | null; rep: string | null; status: string | null };

const NOT_SET = "Not set";
const MAX_REPS = 10;

/** Groups values by filterKey, labelled with each group's most used spelling. */
function grouper() {
  const groups = new Map<string, { spellings: Map<string, number>; count: number }>();
  return {
    add(raw: string | null | undefined): string {
      const v = (raw ?? "").trim();
      const k = filterKey(v) || "\u0000";
      const g = groups.get(k) ?? { spellings: new Map(), count: 0 };
      g.count += 1;
      const label = v || NOT_SET;
      g.spellings.set(label, (g.spellings.get(label) ?? 0) + 1);
      groups.set(k, g);
      return k;
    },
    label(k: string): string {
      const g = groups.get(k);
      if (!g) return NOT_SET;
      return [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    },
    counts(): { key: string; label: string; count: number }[] {
      return [...groups.entries()]
        .map(([key, g]) => ({ key, label: this.label(key), count: g.count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    },
  };
}

function clientMix(rows: MixRow[]): DashboardData["mix"] {
  const market = grouper();
  const zone = grouper();
  const rep = grouper();
  const repStatus = new Map<string, { pending: number; inProgress: number; completed: number; notQuoted: number; regret: number; sentToClient: number }>();
  const cell = new Map<string, number>();
  for (const r of rows) {
    market.add(r.market);
    const z = zone.add(r.zone);
    const p = rep.add(r.rep);
    const st = repStatus.get(p) ?? { pending: 0, inProgress: 0, completed: 0, notQuoted: 0, regret: 0, sentToClient: 0 };
    if (r.status === "Completed") st.completed += 1;
    else if (r.status === "In Progress") st.inProgress += 1;
    else if (r.status === "Not Quoted") st.notQuoted += 1;
    else if (r.status === "Regret") st.regret += 1;
    else if (r.status === "Sent to client") st.sentToClient += 1;
    else st.pending += 1;
    repStatus.set(p, st);
    cell.set(`${p}|${z}`, (cell.get(`${p}|${z}`) ?? 0) + 1);
  }
  const plain = (g: ReturnType<typeof grouper>) => g.counts().map(({ label, count }) => ({ label, count }));
  const topReps = rep.counts().slice(0, MAX_REPS);
  const zones = zone.counts();
  return {
    markets: plain(market),
    zones: zones.map(({ label, count }) => ({ label, count })),
    reps: topReps.map((r) => ({ label: r.label, total: r.count, ...repStatus.get(r.key)! })),
    repZone: topReps.flatMap((r) =>
      zones.map((z) => ({ rep: r.label, zone: z.label, count: cell.get(`${r.key}|${z.key}`) ?? 0 })),
    ),
  };
}
