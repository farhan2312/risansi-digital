/**
 * Portal-wide settings (app_settings key/value rows). Server-only.
 *
 * usd_inr_rate — 1 USD in INR, set by an admin on Admin > USD to INR. An
 * enquiry that switches on Quote in USD copies the rate at that moment into
 * projects.usd_inr_rate, so changing it here never re-prices a quote.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { appSettings, users } from "@/lib/db/schema";

export const USD_INR_RATE_KEY = "usd_inr_rate";

export type UsdInrSetting = {
  /** null until an admin sets it. */
  rate: number | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

export async function getUsdInrSetting(): Promise<UsdInrSetting> {
  const [row] = await db
    .select({ value: appSettings.value, updatedAt: appSettings.updatedAt, name: users.name, email: users.email })
    .from(appSettings)
    .leftJoin(users, eq(users.id, appSettings.updatedBy))
    .where(eq(appSettings.key, USD_INR_RATE_KEY))
    .limit(1);
  const rate = row?.value ? Number(row.value) : NaN;
  return {
    rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    updatedByName: row ? (row.name ?? row.email ?? null) : null,
  };
}

/** Saves the rate (already validated with parseUsdRate). */
export async function setUsdInrRate(rate: number, userId: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(appSettings)
    .values({ key: USD_INR_RATE_KEY, value: String(rate), updatedAt: now, updatedBy: userId })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: String(rate), updatedAt: now, updatedBy: userId },
    });
}
