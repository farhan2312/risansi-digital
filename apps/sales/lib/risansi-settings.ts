// Server-only reads of company-wide app_settings (key/value). Sysadmins edit
// these on /risansi/admin/settings; everything else just reads them here.

import risansiPool from '@/lib/db-risansi';

// Fallback used when the setting has never been saved, or the table/read fails.
export const DEFAULT_USD_INR_RATE = 86;

/** Current USD→INR rate (₹ per $1). Falls back to DEFAULT_USD_INR_RATE. */
export async function getUsdRate(): Promise<number> {
  try {
    const { rows } = await risansiPool.query<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'usd_inr_rate' LIMIT 1`);
    const v = parseFloat(rows[0]?.value ?? '');
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_USD_INR_RATE;
  } catch {
    return DEFAULT_USD_INR_RATE;
  }
}
