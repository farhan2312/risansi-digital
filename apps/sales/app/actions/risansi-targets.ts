'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { getSession } from '@/lib/risansi-auth';
import { getCurrentFY } from '@/lib/risansi-utils';

export type SaveResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): SaveResult => ({ ok: false, error });

/** One row off the Settings list. The target arrives as the raw string the
 *  input held, blank included, so "cleared" and "zero" stay distinguishable. */
export type RepTargetInput = {
  id: number;
  /** Annual revenue, Crores. */
  targetCr: string;
  /** Accounts to add this year. Blank means no target. */
  newClients?: string;
  /** Visit reports to file this year. Blank means no target. */
  visits?: string;
};

// A count above this is a typo too. Nobody files 20,000 visit reports in a
// year, and the biggest book in the company added 336 accounts.
const MAX_TARGET_COUNT = 10_000;

// A target above this is a typo, not a quota — somebody typing rupees into a
// field labelled Crores lands here. The company year is tens of Crores.
const MAX_TARGET_CR = 10_000;

/** Save every rep's annual target in one go.
 *
 *  Sysadmin-only, matching setAnnualTarget on the same page: the company figure
 *  and the per-rep split are the same decision and should not have two
 *  different gates. Unlike setAnnualTarget this returns its refusal rather than
 *  throwing it, because a thrown error is redacted in production and the caller
 *  would show "an error occurred" for what is almost always a typo in one row.
 *
 *  All rows are written in one transaction. A partial save would leave the sum
 *  shown against the company target describing a state nobody chose. */
export async function setRepTargets(rows: RepTargetInput[]): Promise<SaveResult> {
  const session = await getSession();
  if (session?.user?.role !== 'sysadmin') return fail('Sysadmin access required.');
  const email = (session.user.email ?? 'system').toLowerCase();

  if (!Array.isArray(rows) || rows.length === 0) return fail('Nothing to save.');

  // Validate everything before writing anything, and name the offending rep:
  // "Enter a number" against a list of eighteen inputs is not a usable message.
  const { rows: known } = await risansiPool.query<{ id: number; name: string }>(
    `SELECT id, name FROM users WHERE is_active AND role IN ('rep','manager')`);
  const nameById = new Map(known.map(r => [r.id, r.name]));

  const clean: { id: number; value: string | null; newClients: string | null; visits: string | null }[] = [];
  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isInteger(id) || !nameById.has(id)) return fail('That rep is no longer on the list — reload the page.');
    const who = nameById.get(id)!;

    // A whole number of things, or blank. Shared by the two count metrics so
    // they refuse identically — and so the message names the rep AND the
    // column, which "Enter a number" against a grid of 48 inputs does not.
    const count = (raw: unknown, label: string): string | null | { err: string } => {
      const t = String(raw ?? '').trim();
      if (t === '') return null;
      const n = Number(t);
      if (!Number.isFinite(n)) return { err: `${who}: "${t}" is not a number for ${label}.` };
      if (n < 0) return { err: `${who}: ${label} cannot be negative.` };
      if (!Number.isInteger(n)) return { err: `${who}: ${label} is a count — ${t} is not a whole number.` };
      if (n > MAX_TARGET_COUNT) return { err: `${who}: ${n} ${label} in a year looks like a typo.` };
      return String(n);
    };

    const nc = count(row?.newClients, 'New Clients');
    if (nc && typeof nc === 'object') return fail(nc.err);
    const vi = count(row?.visits, 'Visits');
    if (vi && typeof vi === 'object') return fail(vi.err);

    const raw = String(row?.targetCr ?? '').trim();
    if (raw === '') { clean.push({ id, value: null, newClients: nc, visits: vi }); continue; }

    const n = Number(raw);
    if (!Number.isFinite(n)) return fail(`${who}: "${raw}" is not a number. Enter a target in Crores, or leave it blank.`);
    if (n < 0) return fail(`${who}: a target cannot be negative.`);
    if (n > MAX_TARGET_CR) return fail(`${who}: ${n} Cr looks like a typo — targets are in Crores, not rupees.`);

    // Rounded to paise-of-a-Crore and handed to pg as text, so the value that
    // reaches a numeric column is the one that was typed rather than whatever
    // a float round-trip makes of it.
    clean.push({ id, value: (Math.round(n * 100) / 100).toFixed(2), newClients: nc, visits: vi });
  }

  const client = await risansiPool.connect();
  try {
    // Does the table exist yet?
    //
    // Asked ONCE, before BEGIN, and not inside a try/catch around the write.
    // A failed statement aborts the whole transaction in Postgres, so an
    // INSERT into a missing rep_targets would roll back the users.target_cr
    // update alongside it — breaking the revenue target save that works today,
    // in the window between this deploying and migration 0122 being applied.
    const { rows: reg } = await client.query<{ present: string | null }>(
      `SELECT to_regclass('public.rep_targets')::text AS present`);
    const hasTable = reg[0]?.present != null;

    await client.query('BEGIN');
    const fy = getCurrentFY().code;
    for (const c of clean) {
      // users.target_cr is still written. The Executive Review reads it, and
      // changing that page in the same breath as introducing the table would
      // make one change impossible to tell from the other if revenue
      // attainment moved. Retiring the column belongs with the Phase 3 step 5
      // cleanup; until then the two are kept in step here.
      await client.query(
        `UPDATE users SET target_cr = $1::numeric, updated_at = NOW() WHERE id = $2`,
        [c.value, c.id],
      );

      // A blank clears the row rather than storing 0: 0 is a real target of
      // nothing, and "not set" has to stay tellable from it.
      if (!hasTable) continue;
      for (const [metric, v] of [
        ['revenue_cr', c.value], ['new_clients', c.newClients], ['visits', c.visits],
      ] as const) {
        if (v === null) {
          await client.query(
            `DELETE FROM rep_targets WHERE user_id = $1 AND fy = $2 AND metric = $3`,
            [c.id, fy, metric]);
        } else {
          await client.query(
            `INSERT INTO rep_targets (user_id, fy, metric, value, updated_by, updated_at)
             VALUES ($1, $2, $3, $4::numeric, $5, NOW())
             ON CONFLICT (user_id, fy, metric)
             DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
            [c.id, fy, metric, v, email]);
        }
      }
    }
    // Best-effort audit, same as the company target: a failed audit write must
    // not roll back a save the sysadmin watched succeed.
    try {
      await client.query(
        `INSERT INTO assignment_audit (entity_type, entity_id, action, old_value, new_value, changed_by)
         VALUES ('setting', 'rep_target_cr', 'update', NULL, $1::jsonb, $2)`,
        [JSON.stringify(clean), email],
      );
    } catch { /* audit is non-critical */ }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return fail(e instanceof Error ? e.message : 'Could not save the rep targets.');
  } finally {
    client.release();
  }

  revalidatePath('/risansi/admin/settings');
  revalidatePath('/risansi');
  revalidatePath('/risansi/pipeline');
  revalidatePath('/risansi/executive-review');
  return { ok: true };
}
