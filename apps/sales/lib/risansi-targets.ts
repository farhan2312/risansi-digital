// Annual revenue targets, company-wide and per rep. Server-only reads; the
// sysadmin edits both on /risansi/admin/settings.
//
// There are two numbers and they are deliberately independent:
//
//   • app_settings.annual_target_cr — the company figure. Still edited on its
//     own, still the number the Opportunities dashboard and the Executive
//     Review show. It is NOT derived from the sum of the rep targets.
//   • users.target_cr — one rep's share of the year, in Crores.
//
// Keeping them independent is the point. When management's real per-rep split
// arrives it will very likely not add up to the company figure, and a derived
// company total would quietly absorb that difference instead of showing it.
// The Settings page prints the sum against the company figure so the gap is
// something somebody has to look at.

import risansiPool from '@/lib/db-risansi';

// Used when app_settings has never been written, or the read fails. The same
// 32 the dashboard, the pipeline page and the Executive Review already fall
// back to — changing it in one place only would give the portal two answers.
export const DEFAULT_ANNUAL_TARGET_CR = 32;

/** One rep's row on the targets list. `targetCr` is null when none is set. */
export type RepTarget = {
  id: number;
  name: string;
  role: string;
  repCode: string | null;
  zone: string | null;
  targetCr: number | null;
};

/** Company-wide annual target in Crores. Falls back to DEFAULT_ANNUAL_TARGET_CR. */
export async function getCompanyAnnualTarget(): Promise<number> {
  try {
    const { rows } = await risansiPool.query<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'annual_target_cr' LIMIT 1`);
    const v = parseFloat(rows[0]?.value ?? '');
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_ANNUAL_TARGET_CR;
  } catch {
    return DEFAULT_ANNUAL_TARGET_CR;
  }
}

/** Who carries a quota: the same set the Executive Review's TSM roster and the
 *  Reps & Managers page already mean by "rep". admin / sysadmin / staff are
 *  back-office accounts and are not given a target. */
const ACTIVE_REPS_SQL = `u.is_active AND u.role IN ('rep','manager')`;

/** Every active rep with their target, ordered as the Settings list shows them.
 *  target_cr is numeric, so it is cast to text in SQL and parsed here rather
 *  than handed to a client component as pg's string. */
export async function getRepTargets(): Promise<RepTarget[]> {
  try {
    const { rows } = await risansiPool.query<{
      id: number; name: string; role: string;
      rep_code: string | null; zone: string | null; target_cr: string | null;
    }>(
      `SELECT u.id, u.name, u.role, u.rep_code, u.zone, u.target_cr::text AS target_cr
         FROM users u
        WHERE ${ACTIVE_REPS_SQL}
        ORDER BY u.name`);
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      role: r.role,
      repCode: r.rep_code,
      zone: r.zone,
      targetCr: r.target_cr === null ? null : Number(r.target_cr),
    }));
  } catch {
    return [];
  }
}

/** The provisional starting figure: the company target split evenly over the
 *  active reps, so the individual targets add up to the company one. Zero reps
 *  would divide by zero, which is how a target of Infinity reaches a page. */
export function equalShareCr(companyTargetCr: number, activeRepCount: number): number {
  if (activeRepCount <= 0) return 0;
  return Math.round((companyTargetCr / activeRepCount) * 100) / 100;
}

/** What a rep's target actually is for the purpose of a percentage.
 *
 *  A rep with no target falls back to the equal share rather than to nothing.
 *  Nothing means dividing by zero wherever attainment is computed, and a rep
 *  added after the seeding would otherwise read as 0% of ₹0 forever. The
 *  Settings page shows an unset rep's figure as implied rather than typed, so
 *  the fallback is visible instead of being mistaken for a decision. */
export function effectiveTargetCr(targetCr: number | null, equalShare: number): number {
  return targetCr === null ? equalShare : targetCr;
}

/** Target per rep id, with the equal-share fallback already applied. The shape
 *  anything computing attainment per rep should read. */
export async function getEffectiveRepTargetMap(): Promise<Map<number, number>> {
  const [company, reps] = await Promise.all([getCompanyAnnualTarget(), getRepTargets()]);
  const share = equalShareCr(company, reps.length);
  return new Map(reps.map(r => [r.id, effectiveTargetCr(r.targetCr, share)]));
}
