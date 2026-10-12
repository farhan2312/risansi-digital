/**
 * Server-side audit-log statistics shared by the Audit Log page
 * (/api/admin/audit) and its PDF report (/api/admin/audit/report), so both
 * compute "active time" the same way.
 *
 * ACTIVE TIME is estimated from activity, not from login/logout. Logout is
 * almost never recorded — people close the tab, and sessions outlive the
 * working day (47 logins vs 1 logout when this was built) — so login→logout
 * would be meaningless. Instead, each user's events are ordered in time and
 * the gap between consecutive events is summed, counting only gaps no longer
 * than IDLE_CUTOFF_SECONDS. A longer gap means they walked away, so it is
 * idle rather than active.
 *
 * The 15-minute cutoff comes from the data: gaps between one user's events
 * cluster heavily under a minute and fall away sharply past 15 minutes.
 *
 * It is a conservative estimate: time spent before the first event after a
 * break (reading, filling in a form before saving) is not visible to the
 * audit trail, and a lone event contributes nothing.
 */
import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { auditLog, enquiryTags, projects, stepApproval } from "@/lib/db/schema";
import { startOfIstDay, startOfIstMonth, startOfIstWeek } from "@/lib/ist";

export const IDLE_CUTOFF_SECONDS = 15 * 60;

export type AuditRange = "today" | "week" | "month" | "7d" | "30d" | "all";

export const AUDIT_RANGES: readonly AuditRange[] = ["today", "week", "month", "7d", "30d", "all"];

export const isAuditRange = (v: string): v is AuditRange =>
  (AUDIT_RANGES as readonly string[]).includes(v);

/** Start of the window for a range key, or null for "all". */
export function rangeStart(range: AuditRange): Date | null {
  const now = new Date();
  // "Today" is the IST day, not the server's: on a UTC host, local midnight
  // would be 05:30 IST and hide everything done overnight in India.
  if (range === "today") return startOfIstDay(now);
  // Calendar week (from Monday) and month, both in IST.
  if (range === "week") return startOfIstWeek(now);
  if (range === "month") return startOfIstMonth(now);
  if (range === "7d") return new Date(now.getTime() - 7 * 86400_000);
  if (range === "30d") return new Date(now.getTime() - 30 * 86400_000);
  return null;
}

/** The time window a request asks for. Either end may be open. */
export type AuditWindow = { since: Date | null; until: Date | null };

const parseInstant = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Resolve `from` / `to` (ISO instants) or else a quick `range` chip into a
 * window. Explicit dates win over the chip.
 *
 * The client sends instants, not bare dates: it converts the From/To dates
 * the user picked into the start of the From day and the END of the To day in
 * THEIR time zone. Doing that here would use the server's zone and shift the
 * window by hours for anyone not in it. A reversed pair is swapped rather than
 * rejected, since the intent is unambiguous.
 */
export function resolveWindow(params: URLSearchParams): AuditWindow {
  let since = parseInstant(params.get("from"));
  let until = parseInstant(params.get("to"));
  if (since || until) {
    if (since && until && since > until) [since, until] = [until, since];
    return { since, until };
  }
  const raw = params.get("range") ?? "7d";
  return { since: rangeStart(isAuditRange(raw) ? raw : "7d"), until: null };
}

/** SQL condition for a window, or undefined when it is open at both ends. */
export function windowCondition({ since, until }: AuditWindow): SQL | undefined {
  if (since && until) return sql`${auditLog.createdAt} >= ${since} and ${auditLog.createdAt} <= ${until}`;
  if (since) return sql`${auditLog.createdAt} >= ${since}`;
  if (until) return sql`${auditLog.createdAt} <= ${until}`;
  return undefined;
}

const windowClause = (w: AuditWindow): SQL => {
  const c = windowCondition(w);
  return c ? sql`and ${c}` : sql``;
};

/**
 * Aggregate: a user's MOST RECENT recorded role within the grouped rows.
 *
 * Replaces `max(user_role)`, which compares the strings alphabetically - so a
 * user promoted or demoted mid-range got whichever of "admin" / "user" /
 * "system_admin" sorts last, not the role they actually ended up with. Rows
 * with no role (failed sign-ins) are skipped rather than winning as "latest".
 */
export const latestRole = sql<string | null>`
  (array_agg(${auditLog.userRole} order by ${auditLog.createdAt} desc)
     filter (where ${auditLog.userRole} is not null))[1]`;

/** Per-user active seconds over the window.
 *
 *  Failed sign-ins are left out. They are not time spent in the app (a
 *  blocked account never gets in), and anyone can type someone else's email,
 *  so they are not even reliably that user. They still show on the Logins
 *  tab and in the Failed counters. */
export async function activityByUser(
  window: AuditWindow,
): Promise<Map<string, { activeSeconds: number }>> {
  const res = await db.execute<{ email: string; active: number }>(sql`
    with ev as (
      select ${auditLog.userEmail} as email,
             extract(epoch from ${auditLog.createdAt} - lag(${auditLog.createdAt})
               over (partition by ${auditLog.userEmail} order by ${auditLog.createdAt})) as gap
      from ${auditLog}
      where ${auditLog.userEmail} is not null
        and ${auditLog.eventType} <> 'login_failed' ${windowClause(window)}
    )
    select email,
           coalesce(sum(gap) filter (where gap <= ${IDLE_CUTOFF_SECONDS}), 0)::float8 as active
    from ev
    group by email
  `);
  const out = new Map<string, { activeSeconds: number }>();
  for (const r of res.rows) {
    out.set(r.email, { activeSeconds: Math.round(Number(r.active) || 0) });
  }
  return out;
}

/**
 * Columns for one audit event, plus the enquiry and tag it touched.
 *
 * Resolved at READ time from entity_id, so every historic row is covered -
 * the 1,300+ wizard saves recorded before details named their tag included.
 * The audit rows themselves are never rewritten; the trail stays immutable.
 *
 *   tag-scoped actions (wizard.save/clear, report.generate, tag.*,
 *     approval.send)       entity_id IS the tag id
 *   approval.select       entity_id is a step_approval row -> its tag
 *   enquiry.create        entity_id is the project itself
 *
 * Joined on text: entity_id is free text and also holds user ids etc., so a
 * uuid cast would throw on those rows. A tag deleted since leaves these null,
 * which is why new rows also snapshot the names into `detail`.
 */
export const eventSelection = {
  id: auditLog.id,
  email: auditLog.userEmail,
  role: auditLog.userRole,
  eventType: auditLog.eventType,
  action: auditLog.action,
  entity: auditLog.entity,
  entityId: auditLog.entityId,
  detail: auditLog.detail,
  ip: auditLog.ip,
  userAgent: auditLog.userAgent,
  createdAt: auditLog.createdAt,
  enquiryCode: projects.projectCode,
  clientName: projects.name,
  tagName: enquiryTags.name,
};

/** Adds the enquiry/tag joins to a query already selecting FROM audit_log. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withEnquiryJoins<T extends { leftJoin: any }>(q: T) {
  return q
    .leftJoin(stepApproval, sql`${stepApproval.id}::text = ${auditLog.entityId}`)
    .leftJoin(
      enquiryTags,
      sql`${enquiryTags.id}::text = coalesce(${stepApproval.tagId}::text, ${auditLog.entityId})`,
    )
    .leftJoin(
      projects,
      sql`${projects.id}::text = coalesce(${enquiryTags.projectId}::text,
        case when ${auditLog.entity} = 'projects' then ${auditLog.entityId} end)`,
    );
}

/** Free-text search across who, what, from which IP, and which enquiry/tag. Assumes the
 *  enquiry joins are present. */
export function searchCondition(q: string): SQL | undefined {
  const needle = q.trim().toLowerCase();
  if (!needle) return undefined;
  // Escape LIKE wildcards so a search for "50%" or "a_b" is taken literally.
  const like = `%${needle.replace(/([\\%_])/g, "\\$1")}%`;
  return sql`(lower(coalesce(${auditLog.userEmail}, '')) like ${like}
    or lower(coalesce(${auditLog.action}, '')) like ${like}
    or lower(coalesce(${auditLog.detail}, '')) like ${like}
    or lower(coalesce(${auditLog.ip}, '')) like ${like}
    or lower(coalesce(${projects.projectCode}, '')) like ${like}
    or lower(coalesce(${projects.name}, '')) like ${like}
    or lower(coalesce(${enquiryTags.name}, '')) like ${like})`;
}
