import { query } from "@/lib/db";
import { assemblyDueSql, boiReceivedSql, orderOpenSql, orderStatusSql, onlyBillingSql, releasedSql, spareEcSql } from "@/lib/dept-view";
import { ecDrawingDoneSql } from "@/lib/drawing-filter";
import { isCentral, reminderDeptForRole, type ReminderDept } from "@/lib/roles";

// The DB session runs in UTC, but the business operates on IST days. Deadlines
// are calendar dates, so "today" must be the IST calendar date, not the UTC
// one — otherwise the day boundary is off by up to 5.5 hours.
const TODAY_IST = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

// Planning works to the EC's dispatch target — but once Central Visibility
// revises that date, the revised one is the deadline that counts.
const PLANNING_DUE =
  "COALESCE(o.dispatch_target_revised_date, o.dispatch_target_date)";

// A reminder fires while a department's target date is still ahead (not yet
// overdue — that's alerts.ts) but within a week, and the completing step hasn't
// happened. The three milestones the business wants — 7 days / 72h / 24h out —
// map to 7 / 3 / 1 days left, since the target columns are DATE-granular.
// Planning's reminders also carry the ones already past ("overdue").
export type ReminderTier = "overdue" | "24h" | "72h" | "7d";

/**
 * An EC Planning has made ready: a Spare Fully ready, a Pump Assembled or
 * Packed. Until then its readiness date is a promise still open.
 */
export const PLANNING_READY_SQL = (pl: string) => `lower(btrim(COALESCE(NULLIF(${pl}.actual_spare_status, ''),
      NULLIF(${pl}.actual_pump_status, ''), ''))) IN ('fully ready', 'assembled', 'packed')`;

export type ReminderRow = {
  id: string;
  sl_no: number;
  so_no: string | null;
  ec_no: string | null;
  client_name: string | null;
  dept: ReminderDept;
  department: string;
  due_date: string;
  days_left: number;
  tier: ReminderTier;
};

// Same four department deadlines as the overdue engine, shifted to the
// upcoming window. Each branch tags its dept key + label.
const REMINDERS_SQL = `
  -- Drawing due (its readiness date, else the SO's Drawing target): fires while any pump EC is not done
  -- (GAD issued to Planning, curve approved, parts drawn where asked) and the
  -- target is within a week — or already past, which is overdue.
  SELECT o.id, o.sl_no::int AS sl_no, o.so_no, NULL::text AS ec_no, o.client_name,
         'drawing'::text AS dept, 'Drawing'::text AS department,
         to_char(COALESCE(o.drg_readiness_date, o.drg_target_date), 'YYYY-MM-DD') AS due_date,
         (COALESCE(o.drg_readiness_date, o.drg_target_date) - ${TODAY_IST})::int AS days_left
    FROM orders o
   WHERE COALESCE(o.drg_readiness_date, o.drg_target_date) <= ${TODAY_IST} + 7
     AND EXISTS (
       SELECT 1 FROM order_items it
        WHERE it.order_id = o.id
          -- Spares need no drawing.
          AND NOT (${spareEcSql("it", "o")})
          -- Due until Drawing is done with the EC (lib/drawing-filter).
          AND NOT ${ecDrawingDoneSql("it", "o")}
     )

  UNION ALL
  -- Purchase (BOI items) due to be received (SO-level target). Only when the
  -- SO needs BOI and some EC still has pending items.
  SELECT o.id, o.sl_no::int, o.so_no, NULL::text AS ec_no, o.client_name,
         'purchase'::text, 'Purchase'::text,
         to_char(o.purchase_target_date, 'YYYY-MM-DD'),
         (o.purchase_target_date - ${TODAY_IST})::int
    FROM orders o
   WHERE o.boi = 'Yes'
     AND o.purchase_target_date >= ${TODAY_IST}
     AND o.purchase_target_date <= ${TODAY_IST} + 7
     AND EXISTS (
       SELECT 1 FROM order_items it
        WHERE it.order_id = o.id
          AND (
            NOT EXISTS (SELECT 1 FROM order_boi_items b WHERE b.item_id = it.id)
            OR EXISTS (SELECT 1 FROM order_boi_items b
                        WHERE b.item_id = it.id AND NOT ${boiReceivedSql("b")})
          )
     )

  UNION ALL
  -- QC docs due to be submitted (SO-level target).
  SELECT o.id, o.sl_no::int, o.so_no, NULL::text AS ec_no, o.client_name,
         'qc'::text, 'Quality'::text,
         to_char(o.qc_doc_target_date, 'YYYY-MM-DD'),
         (o.qc_doc_target_date - ${TODAY_IST})::int
    FROM orders o
   WHERE o.qc_doc_target_date >= ${TODAY_IST}
     AND o.qc_doc_target_date <= ${TODAY_IST} + 7
     AND (o.qc_required IS NULL OR o.qc_required <> 'No')
     AND EXISTS (
       SELECT 1 FROM order_items it
        LEFT JOIN order_qc qc ON qc.item_id = it.id
        WHERE it.order_id = o.id AND qc.qc_doc_actual_date IS NULL
     )

  UNION ALL
  -- Planning works to its own readiness date, one per SO (Planning edits an
  -- SO as one, so its ECs share it): the earliest date among the ECs not yet
  -- ready — due within the week, or already past.
  SELECT o.id, o.sl_no::int, o.so_no, NULL::text AS ec_no, o.client_name,
         'planning'::text, 'Planning'::text,
         to_char(r.due, 'YYYY-MM-DD'),
         (r.due - ${TODAY_IST})::int
    FROM orders o
    JOIN LATERAL (
      SELECT min(pl.planning_readiness_date) AS due
        FROM order_items it JOIN order_planning pl ON pl.item_id = it.id
       WHERE it.order_id = o.id AND pl.planning_readiness_date IS NOT NULL
         AND NOT (${PLANNING_READY_SQL("pl")})
    ) r ON r.due IS NOT NULL
   WHERE r.due <= ${TODAY_IST} + 7

  UNION ALL
  -- Assembly & Packing due to complete, against its own packing date (a
  -- Spare lot) or Planning's readiness date (an EC without lots):
  -- the earliest one among the SO's ECs not packed yet — past it, the SO is
  -- overdue, as Planning's is. Whether the order has since gone out is
  -- Dispatch's arm, below.
  SELECT o.id, o.sl_no::int, o.so_no, NULL::text AS ec_no, o.client_name,
         'assembly'::text, 'Assembly & Packing'::text,
         to_char(r.due, 'YYYY-MM-DD'),
         (r.due - ${TODAY_IST})::int
    FROM orders o
    JOIN LATERAL (
      SELECT min(${assemblyDueSql("it")}) AS due
        FROM order_items it
       WHERE it.order_id = o.id
    ) r ON r.due IS NOT NULL
   WHERE r.due <= ${TODAY_IST} + 7

  UNION ALL
  -- Dispatch due to go out, against the SO's dispatch date (revised if set)
  -- — the same date Planning schedules to.
  SELECT o.id, o.sl_no::int, o.so_no, NULL::text AS ec_no, o.client_name,
         'dispatch'::text, 'Dispatch'::text,
         to_char(${PLANNING_DUE}, 'YYYY-MM-DD'),
         (${PLANNING_DUE} - ${TODAY_IST})::int
    FROM orders o
   WHERE ${PLANNING_DUE} >= ${TODAY_IST}
     AND ${PLANNING_DUE} <= ${TODAY_IST} + 7
     AND lower(${orderStatusSql("o")}) <> 'fully dispatch'
`;

function tierOf(daysLeft: number): ReminderTier {
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 1) return "24h";
  if (daysLeft <= 3) return "72h";
  return "7d";
}

/** Upcoming deadlines, soonest first. Optionally limited to some departments. */
export async function listReminders(
  depts?: ReminderDept[]
): Promise<ReminderRow[]> {
  const filter = depts && depts.length > 0 ? depts : null;
  try {
    const result = await query<Omit<ReminderRow, "tier"> & { days_left: number }>(
      `SELECT * FROM (${REMINDERS_SQL}) r
        WHERE ($1::text[] IS NULL OR r.dept = ANY($1))
          -- A cancelled or diverted order has no deadlines left.
          -- Nor one Central Visibility has not yet cleared or held: no department sees it.
          AND EXISTS (SELECT 1 FROM orders oo WHERE oo.id = r.id AND ${orderOpenSql("oo")} AND ${releasedSql("oo")} AND NOT ${onlyBillingSql("oo")})
        ORDER BY r.days_left ASC, r.sl_no ASC`,
      [filter]
    );
    return result.rows.map((r) => ({
      ...r,
      sl_no: Number(r.sl_no),
      days_left: Number(r.days_left),
      tier: tierOf(Number(r.days_left)),
    }));
  } catch (error) {
    // The orders table is mid-restructure and some columns this query relies
    // on (target dates, QC Needed) are temporarily gone — degrade to "no
    // reminders" rather than taking down every page that calls this
    // (app/risansi/layout.tsx counts it on every request, for every role).
    // Remove this guard once those columns are back.
    console.error("listReminders failed (orders columns may be missing):", error);
    return [];
  }
}

/** Reminders for one department (used on that department's workspace page). */
export async function listRemindersForDepartment(
  dept: ReminderDept
): Promise<ReminderRow[]> {
  return listReminders([dept]);
}

/**
 * Reminders relevant to a role: their own department, or every department for
 * Central Visibility / Admin oversight.
 */
export async function listRemindersForRole(role: string): Promise<ReminderRow[]> {
  if (isCentral(role)) return listReminders();
  const dept = reminderDeptForRole(role);
  return dept ? listReminders([dept]) : [];
}

/** Reminder count for a department role (0 for roles without a deadline). */
export async function countRemindersForRole(role: string): Promise<number> {
  const dept = reminderDeptForRole(role);
  if (!dept) return 0;
  return (await listReminders([dept])).length;
}
