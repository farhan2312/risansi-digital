/**
 * Active time, worked out from what people actually did.
 *
 *  1. Every recorded action (a save, a report generated, a sign-in...) has a time. Failed sign-ins are
 *     not counted -- they are not someone using the portal.
 *  2. Each user's action times are put in order and the gap between each one and the one before it is measured.
 *  3. A gap of ACTIVE_GAP_MINUTES or less counts as active time. A longer gap means they stepped away, so
 *     it counts as idle and adds nothing.
 *
 * Example: saves at 10:00, 10:04, 10:09 and 11:30 -> the 4 and 5 minute gaps count (9 min), the 81 minute
 * gap is idle. Active time = 9m.
 *
 * A gap is credited to the day (and the range) its later action falls in. The first action in a range only
 * counts a gap to an earlier one if that earlier action was within ACTIVE_GAP_MINUTES before the range began.
 */
import { sql, type SQL } from "drizzle-orm";

import { windowCondition, type AuditWindow } from "@/lib/auditRange";

export const ACTIVE_GAP_MINUTES = 15;

/** A derived table aliased `g` with one row per recorded action: user_id, user_email, user_name, `at` (when it
 * happened) and `secs` (the active seconds that action adds -- its gap to the previous one, or 0 when that gap
 * is longer than the threshold or there is no previous action). Filter it with {@link gapsInWindow}. */
export const activeGapTable = (w: AuditWindow): SQL => sql`(
  select
    a.user_id,
    a.user_email,
    a.user_name,
    a.created_at as at,
    case
      when a.created_at - lag(a.created_at) over (partition by a.user_id order by a.created_at) <= make_interval(mins => ${ACTIVE_GAP_MINUTES})
        then extract(epoch from (a.created_at - lag(a.created_at) over (partition by a.user_id order by a.created_at)))
      else 0
    end::float as secs
  from audit_logs a
  where a.user_id is not null
    and a.event_type <> 'login_failed'
    ${w.start ? sql`and a.created_at >= ${new Date(w.start.getTime() - ACTIVE_GAP_MINUTES * 60_000)}` : sql``}
    ${w.end ? sql`and a.created_at < ${w.end}` : sql``}
) g`;

/** The `where` for the outer query: only the actions that fall inside the window itself. */
export const gapsInWindow = (w: AuditWindow): SQL => windowCondition(sql`g.at`, w);
