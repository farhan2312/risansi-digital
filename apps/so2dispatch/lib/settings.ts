// Values the business sets once and the app reads everywhere. Server only.

import { query } from "@/lib/db";

export const USD_INR_RATE = "usd_inr_rate";

export type SettingValue = {
  value: string | null;
  updated_at: string | null;
  updated_by_name: string | null;
};

export async function getSetting(key: string): Promise<SettingValue> {
  const r = await query<SettingValue>(
    `SELECT s.value,
            to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at,
            u.full_name AS updated_by_name
       FROM app_settings s LEFT JOIN users u ON u.id = s.updated_by
      WHERE s.key = $1`,
    [key]
  );
  return r.rows[0] ?? { value: null, updated_at: null, updated_by_name: null };
}

export async function setSetting(key: string, value: string, actorId: string): Promise<void> {
  await query(
    `INSERT INTO app_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, value, actorId]
  );
}

/** The USD → INR rate, or null while none has been set. */
export async function getUsdInrRate(): Promise<number | null> {
  const n = Number((await getSetting(USD_INR_RATE)).value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
