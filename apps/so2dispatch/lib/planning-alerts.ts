import "server-only";

import { query } from "@/lib/db";
import { listReminders } from "@/lib/reminders";
import { orderOpenSql, orderStatusSql, onlyBillingSql, releasedSql } from "@/lib/dept-view";
import { emitNotification } from "@/lib/notifications";

const TODAY_IST = "(now() AT TIME ZONE 'Asia/Kolkata')::date";
/** How many days ahead an LD date is told to Planning. */
export const LD_WARN_DAYS = 4;

const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * Planning's daily alerts, raised once a day (the first time anyone in
 * Planning opens the app that day): each SO whose readiness date has passed
 * with Planning not done, and each SO whose LD date is within the next
 * LD_WARN_DAYS days. A day already done is skipped at the cost of one write.
 * Never throws.
 */
export async function ensurePlanningAlerts(): Promise<void> {
  try {
    const today = (await query<{ d: string }>(`SELECT to_char(${TODAY_IST}, 'YYYY-MM-DD') AS d`)).rows[0].d;
    // Claim the day: only the first caller gets a row back.
    const claim = await query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('planning_alerts_day', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        WHERE app_settings.value IS DISTINCT FROM EXCLUDED.value
       RETURNING key`,
      [today]
    );
    if (!claim.rowCount) return;
    try {
      await raise();
    } catch (error) {
      // Let a later visit try the day again.
      await query(`UPDATE app_settings SET value = NULL WHERE key = 'planning_alerts_day' AND value = $1`, [today]);
      throw error;
    }
  } catch (error) {
    console.error("ensurePlanningAlerts failed:", error);
  }
}

async function raise(): Promise<void> {
  // Delays: Planning's readiness date passed and not met (as its reminders read it).
  const late = (await listReminders(["planning"])).filter((r) => r.days_left < 0);
  // LD dates coming up on SOs still to go out.
  const ld = await query<{ id: string; so_no: string | null; sl_no: number; ld_date: string; days_left: number }>(
    `SELECT o.id, o.so_no, o.sl_no::int AS sl_no, to_char(o.ld_date, 'YYYY-MM-DD') AS ld_date,
            (o.ld_date - ${TODAY_IST})::int AS days_left
       FROM orders o
      WHERE o.ld = 'Yes' AND o.ld_date BETWEEN ${TODAY_IST} AND ${TODAY_IST} + ${LD_WARN_DAYS}
        AND ${orderOpenSql("o")} AND ${releasedSql("o")} AND NOT ${onlyBillingSql("o")}
        AND lower(${orderStatusSql("o")}) <> 'fully dispatch'
        AND EXISTS (SELECT 1 FROM order_items it WHERE it.order_id = o.id)`
  );
  await Promise.all([
    ...late.map((r) =>
      emitNotification({
        roles: ["planning"],
        orderId: r.id,
        type: "delay",
        message: `Delay: ${r.so_no ?? `#${r.sl_no}`} — readiness date ${day(r.due_date)} passed, ${days(-r.days_left)} late`,
      })
    ),
    ...ld.rows.map((r) =>
      emitNotification({
        roles: ["planning"],
        orderId: r.id,
        type: "ld_due",
        message:
          Number(r.days_left) === 0
            ? `LD date today for ${r.so_no ?? `#${r.sl_no}`} (${day(r.ld_date)})`
            : `LD date in ${days(Number(r.days_left))} for ${r.so_no ?? `#${r.sl_no}`} (${day(r.ld_date)})`,
      })
    ),
  ]);
}
