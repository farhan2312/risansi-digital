// Server-only reads of company-wide app_settings (key/value). Sysadmins edit
// these on /risansi/admin/settings; everything else just reads them here.

import { cache } from 'react';
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

// ── Complaint edit override ─────────────────────────────────────
//
// A switch, not a code change. The complaint pages are gated by department,
// per-complaint assignment and status, and on 28 Oct 2026 almost nobody could
// edit anything: the 2026 register had been imported with schema_version 1
// (which canEditPage reads as a legacy, read-only record), 336 of 395
// complaints were Closed, and 43 of 45 active users had no department at all.
// People could not attach the documents a complaint needs.
//
// Opening it by deleting the rules would mean another deploy to put them back,
// and by then nobody remembers what they were. This relaxes them from a
// setting instead, so the rules stay in the code, turning it off is one
// switch on /risansi/admin/settings, and the audit trail marks what was
// changed while it was open.
//
// It does NOT widen who can SEE a complaint: canAccessComplaint still decides
// that, and this is only consulted after it has passed. It does not grant
// status moves either — canMove is untouched, so a closed complaint can take
// a document without anybody being able to quietly reopen it.
export const COMPLAINT_EDIT_OVERRIDE_KEY = 'complaint_edit_override';

/**
 * Is the company-wide complaint edit override on? Off on any failure.
 *
 * cache() so the permission check can ask freely — a page that gates eight
 * complaint pages asks eight times and pays for one query.
 */
export const complaintEditOverride = cache(async (): Promise<boolean> => {
  try {
    const { rows } = await risansiPool.query<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`, [COMPLAINT_EDIT_OVERRIDE_KEY]);
    return (rows[0]?.value ?? '').trim().toLowerCase() === 'on';
  } catch {
    return false;
  }
});
