'use server';

import { getServerSession } from 'next-auth/next';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import risansiPool from '@/lib/db-risansi';
import { recordAudit } from '@/lib/audit';
import { orphanSql } from '@/lib/risansi-auth';
import {
  freezeCreditForClient, freezeCreditForRepBook, thawOpenCredit,
} from '@/lib/risansi-attribution';

// Rep ownership: who owns a client, who covers it, and who manages whom.
//
// Every write in here is admin-gated and returns its failure rather than
// throwing it. Next.js redacts errors thrown out of a server action in
// production, so a thrown one reaches the browser as "an unexpected response"
// and the reason stays on the server — which is exactly how the outstanding
// upload failed silently for weeks.

export type Outcome = { ok: true; message?: string } | { ok: false; error: string };

const fail = (e: unknown): Outcome => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e) || 'Unknown error',
});

async function requireAdmin(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== 'admin' && role !== 'sysadmin') return null;
  return { email: session?.user?.email ?? '' };
}

const touch = () => {
  revalidatePath('/risansi/admin/reps');
  revalidatePath('/risansi/clients');
  revalidatePath('/risansi/pipeline');
};

// ── the owner ─────────────────────────────────────────────────────

/** Set (or clear, with null) the one rep who owns a client. */
export async function setPrimaryRep(clientId: number, repId: number | null): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can change client ownership.' };
  if (!Number.isInteger(clientId) || clientId <= 0) return { ok: false, error: 'Invalid client.' };
  try {
    if (repId != null) {
      // A person cannot own and cover the same client — covering is what the
      // others do. Promoting a secondary therefore removes the secondary row
      // rather than leaving the client listing them twice.
      await risansiPool.query(
        'DELETE FROM client_secondary_reps WHERE client_id = $1 AND rep_id = $2', [clientId, repId]);
    }
    // Before the owner changes, not after: the freeze needs the owner the
    // client is about to lose, and once the row is written there is nowhere
    // left to read it from.
    const frozen = await freezeCreditForClient(risansiPool, clientId, repId);

    const r = await risansiPool.query(
      'UPDATE clients SET primary_rep_id = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [clientId, repId]);
    if (!r.rowCount) return { ok: false, error: 'That client no longer exists, or has been archived.' };

    // Open items move to the new owner, closed ones stay with whoever held
    // them. That is the second half of the attribution rule of 1 Oct 2026, and
    // the two halves are deliberately not symmetric: the first half was a
    // one-time reset of ALL history, open and closed, to today's owner, and
    // from here on only open work follows a handover. A line under the past,
    // not an inconsistency.
    //
    // Open items need no UPDATE at all. Attribution is derived — every figure
    // reads COALESCE(o.credited_rep_id, c.primary_rep_id), and an open row's
    // credited_rep_id is NULL — so the line above has already moved them. The
    // only write is the freeze: closed opportunities are stamped with the
    // OUTGOING owner so their value does not walk across to the new one.
    // See lib/risansi-attribution.ts and migration 0102.
    if (frozen) {
      await recordAudit({
        action: 'reassign', entityType: 'client', entityId: clientId,
        entityLabel: `client #${clientId}`,
        summary: `Credit for ${frozen} closed opportunit${frozen === 1 ? 'y' : 'ies'} frozen on the outgoing owner`,
        metadata: { to_rep_id: repId, frozen },
        actorEmail: me.email,
      });
    }
    await thawOpenCredit(risansiPool, clientId);

    // The rep_id tidy-up below predates the attribution rule and no longer
    // moves any money: rep_id records who raised the enquiry or was assigned
    // the visit, and nothing reads it as an owner any more. It is kept because
    // leaving an open record pointed at somebody with no relation to the client
    // is still untidy, and because a visit's rep is the person expected to
    // travel. Closed work is history and is not touched.
    let opps = 0, visits = 0;
    if (repId != null) {
      const stray = (repCol: string) => `(${repCol} IS NULL OR ${orphanSql(repCol, 'c')})`;
      const movedOpps = await risansiPool.query<{ id: number; label: string; from_rep: number | null }>(
        `UPDATE opportunities o SET rep_id = $2, updated_at = NOW()
           FROM clients c
          WHERE c.id = $1 AND o.client_id = c.id
            AND o.stage IN ('Suspect', 'Prospect', 'Quoted', 'Negotiating', 'On Hold')
            AND ${stray('o.rep_id')}
          RETURNING o.id, COALESCE(o.quote_ref, o.product) AS label, o.rep_id AS from_rep`,
        [clientId, repId]);
      opps = movedOpps.rowCount ?? 0;
      for (const m of movedOpps.rows) {
        await recordAudit({
          action: 'reassign', entityType: 'opportunity', entityId: m.id, entityLabel: m.label,
          summary: "Open opportunity moved to the client's new owner",
          metadata: { to_rep_id: repId, client_id: clientId },
          actorEmail: me.email,
        });
      }
      const movedVisits = await risansiPool.query<{ id: number; visit_date: string }>(
        `UPDATE visits v SET rep_id = $2, updated_at = NOW()
           FROM clients c
          WHERE c.id = $1 AND v.client_id = c.id
            AND v.status <> 'completed' AND v.submitted_at IS NULL
            AND ${stray('v.rep_id')}
          RETURNING v.id, v.visit_date::text AS visit_date`,
        [clientId, repId]);
      visits = movedVisits.rowCount ?? 0;
      for (const m of movedVisits.rows) {
        await recordAudit({
          action: 'reassign', entityType: 'visit', entityId: m.id, entityLabel: m.visit_date,
          summary: "Open visit moved to the client's new owner",
          metadata: { to_rep_id: repId, client_id: clientId },
          actorEmail: me.email,
        });
      }
    }
    touch();
    // Said in two sentences because they are two different things. The first
    // is what the new owner now answers for, the second is what the old one
    // keeps — and an admin who is not told the second will assume the handover
    // took the whole account's history with it.
    const moved = [
      opps ? `${opps} open opportunit${opps === 1 ? 'y' : 'ies'}` : '',
      visits ? `${visits} open visit${visits === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ');
    const kept = frozen
      ? ` ${frozen} closed opportunit${frozen === 1 ? 'y stays' : 'ies stay'} credited to the previous owner.`
      : '';
    return {
      ok: true,
      message: repId == null
        ? 'Owner cleared.'
        : `Owner set. Open work follows them.${moved ? ` (${moved} reassigned.)` : ''}${kept}`,
    };
  } catch (e) { return fail(e); }
}

// ── the people covering it ────────────────────────────────────────

export async function addSecondaryRep(clientId: number, repId: number): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can change who covers a client.' };
  try {
    const { rows } = await risansiPool.query<{ primary_rep_id: number | null }>(
      'SELECT primary_rep_id FROM clients WHERE id = $1 AND deleted_at IS NULL', [clientId]);
    if (!rows.length) return { ok: false, error: 'That client no longer exists, or has been archived.' };
    if (rows[0].primary_rep_id === repId) {
      return { ok: false, error: 'They already own this client, so there is nothing to cover.' };
    }
    await risansiPool.query(
      `INSERT INTO client_secondary_reps (client_id, rep_id, added_by)
       VALUES ($1, $2, (SELECT id FROM users WHERE lower(email) = lower($3)))
       ON CONFLICT DO NOTHING`,
      [clientId, repId, me.email]);
    touch();
    return { ok: true, message: 'Added as covering rep.' };
  } catch (e) { return fail(e); }
}

export async function removeSecondaryRep(clientId: number, repId: number): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can change who covers a client.' };
  try {
    await risansiPool.query(
      'DELETE FROM client_secondary_reps WHERE client_id = $1 AND rep_id = $2', [clientId, repId]);
    touch();
    return { ok: true, message: 'Removed.' };
  } catch (e) { return fail(e); }
}

// ── the hierarchy ─────────────────────────────────────────────────

/** One cell of the Teams matrix. `on` ticks it, off unticks. */
export async function setManagerRep(managerId: number, repId: number, on: boolean): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can change teams.' };
  if (managerId === repId) {
    return { ok: false, error: 'Nobody manages themselves — they already see their own clients by owning them.' };
  }
  try {
    if (on) {
      await risansiPool.query(
        `INSERT INTO manager_reps (manager_id, rep_id, added_by)
         VALUES ($1, $2, (SELECT id FROM users WHERE lower(email) = lower($3)))
         ON CONFLICT DO NOTHING`,
        [managerId, repId, me.email]);
    } else {
      await risansiPool.query(
        'DELETE FROM manager_reps WHERE manager_id = $1 AND rep_id = $2', [managerId, repId]);
    }
    revalidatePath('/risansi/admin/reps');
    revalidatePath('/risansi/field');
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ── handing over a book ───────────────────────────────────────────

export interface MovePreview {
  owned: number;
  covered: number;
  alreadyTheirs: number;
}

/** What a move would do, without doing it. */
export async function previewMove(fromRepId: number, toRepId: number): Promise<MovePreview | null> {
  if (!(await requireAdmin())) return null;
  try {
    const { rows } = await risansiPool.query<{ owned: string; covered: string; already: string }>(
      `SELECT
         (SELECT count(*) FROM clients
           WHERE primary_rep_id = $1 AND deleted_at IS NULL)::text AS owned,
         (SELECT count(*) FROM client_secondary_reps s
            JOIN clients c ON c.id = s.client_id AND c.deleted_at IS NULL
           WHERE s.rep_id = $1)::text AS covered,
         (SELECT count(*) FROM clients
           WHERE primary_rep_id = $1 AND deleted_at IS NULL
             AND id IN (SELECT client_id FROM client_secondary_reps WHERE rep_id = $2))::text AS already`,
      [fromRepId, toRepId]);
    return {
      owned: Number(rows[0]?.owned ?? 0),
      covered: Number(rows[0]?.covered ?? 0),
      alreadyTheirs: Number(rows[0]?.already ?? 0),
    };
  } catch { return null; }
}

/**
 * Hand one person's book to another.
 *
 * Deliberately a deliberate act rather than something that happens when an
 * account is deactivated. Silent reassignment is how ownership drifted in the
 * first place, and a leaver's clients showing up in the Unassigned tab is a
 * better outcome than them quietly becoming somebody else's problem.
 */
export async function moveClients(
  fromRepId: number, toRepId: number, what: 'owned' | 'covered' | 'both',
): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can move clients.' };
  if (fromRepId === toRepId) return { ok: false, error: 'Those are the same person.' };

  const c = await risansiPool.connect();
  try {
    await c.query('BEGIN');
    let owned = 0, covered = 0;

    if (what === 'owned' || what === 'both') {
      // Closed work stays with the person handing the book over, and the only
      // moment to say so is before the owner column moves. Open work follows
      // the new owner by itself, because attribution is derived from it.
      await freezeCreditForRepBook(c, fromRepId);
      // The receiver may already cover some of what they are about to own.
      // Clear that first, or the client ends up listing them as both.
      await c.query(
        `DELETE FROM client_secondary_reps
          WHERE rep_id = $2
            AND client_id IN (SELECT id FROM clients WHERE primary_rep_id = $1 AND deleted_at IS NULL)`,
        [fromRepId, toRepId]);
      const r = await c.query(
        `UPDATE clients SET primary_rep_id = $2, updated_at = NOW()
          WHERE primary_rep_id = $1 AND deleted_at IS NULL`, [fromRepId, toRepId]);
      owned = r.rowCount ?? 0;
    }

    if (what === 'covered' || what === 'both') {
      // Move the covering rows, skipping any client the receiver now owns —
      // owning it already includes everything covering it would give them.
      const r = await c.query(
        `UPDATE client_secondary_reps s SET rep_id = $2
          WHERE s.rep_id = $1
            AND NOT EXISTS (SELECT 1 FROM client_secondary_reps k
                             WHERE k.client_id = s.client_id AND k.rep_id = $2)
            AND NOT EXISTS (SELECT 1 FROM clients c2
                             WHERE c2.id = s.client_id AND c2.primary_rep_id = $2)`,
        [fromRepId, toRepId]);
      covered = r.rowCount ?? 0;
      // Anything left is a duplicate of what the receiver already had.
      await c.query('DELETE FROM client_secondary_reps WHERE rep_id = $1', [fromRepId]);
    }

    // A reopened opportunity that an earlier handover had frozen is live work
    // again and belongs to whoever owns the account now. The bulk move does not
    // enumerate the accounts it touched, so this sweeps all of them.
    await thawOpenCredit(c, null);

    await c.query('COMMIT');
    touch();
    const bits = [owned ? `${owned} owned` : '', covered ? `${covered} covered` : ''].filter(Boolean);
    return { ok: true, message: bits.length ? `Moved ${bits.join(' and ')}.` : 'Nothing to move.' };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return fail(e);
  } finally { c.release(); }
}

// ── the recycle bin ───────────────────────────────────────────────

/**
 * What archiving this client would hide.
 *
 * Read before the confirmation is shown, so the dialog can name the open work
 * rather than ask "are you sure" about something the person cannot see. 527 of
 * 2,788 clients carry an open opportunity, so this is the common case rather
 * than the edge one.
 */
export interface ArchivePreview {
  name: string;
  code: string;
  openOpps: number;
  /** Rupees, across those open opportunities. */
  openValueInr: number;
  plannedVisits: number;
  openComplaints: number;
  visits: number;
  hasRevenue: boolean;
}

export async function clientArchivePreview(clientId: number): Promise<ArchivePreview | null> {
  const me = await requireAdmin();
  if (!me) return null;
  try {
    const { rows } = await risansiPool.query<Record<string, string>>(
      `SELECT c.legal_name AS name, c.code,
              (SELECT count(*) FROM opportunities o
                WHERE o.client_id = c.id AND o.stage NOT IN ('Won','Lost','Dropped'))::text AS open_opps,
              (SELECT COALESCE(round(sum(COALESCE(o.offer_value_inr, o.value_cr*10000000, 0))), 0)
                 FROM opportunities o
                WHERE o.client_id = c.id AND o.stage NOT IN ('Won','Lost','Dropped'))::text AS open_value_inr,
              (SELECT count(*) FROM visits v WHERE v.client_id = c.id AND v.status = 'planned')::text AS planned_visits,
              (SELECT count(*) FROM complaints cm
                WHERE cm.client_id = c.id AND cm.status NOT IN ('Resolved','Closed'))::text AS open_complaints,
              (SELECT count(*) FROM visits v WHERE v.client_id = c.id)::text AS visits,
              (EXISTS (SELECT 1 FROM client_revenue_monthly m WHERE m.client_id = c.id))::text AS has_revenue
         FROM clients c WHERE c.id = $1 AND c.deleted_at IS NULL`, [clientId]);
    const r = rows[0];
    if (!r) return null;
    return {
      name: r.name, code: r.code,
      openOpps: Number(r.open_opps), openValueInr: Number(r.open_value_inr),
      plannedVisits: Number(r.planned_visits), openComplaints: Number(r.open_complaints),
      visits: Number(r.visits), hasRevenue: r.has_revenue === 'true',
    };
  } catch { return null; }
}

/**
 * Archive a client. Reversible: nothing is deleted, `deleted_at` is set and
 * every query in the portal already reads `deleted_at IS NULL`, so the client
 * leaves Client 360, Opportunities, Field Activity and the Executive Review at
 * once. Its visits, opportunities and revenue stay attached and come back with
 * it.
 */
export async function archiveClient(clientId: number): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can archive a client.' };
  try {
    const { rows } = await risansiPool.query<{ legal_name: string }>(
      `UPDATE clients SET deleted_at = NOW(), updated_by = $2, updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING legal_name`, [clientId, me.email]);
    if (!rows[0]) return { ok: false, error: 'That client is already archived.' };
    revalidatePath('/risansi/admin/clients');
    revalidatePath('/risansi/clients');
    revalidatePath('/risansi/admin/recoverable');
    touch();
    return { ok: true, message: `${rows[0].legal_name} archived. Restore it from Recoverable, or tick Show archived here.` };
  } catch (e) { return fail(e); }
}

/** Bring an archived client back. */
export async function restoreClient(clientId: number): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can restore a client.' };
  try {
    const r = await risansiPool.query(
      'UPDATE clients SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 AND deleted_at IS NOT NULL',
      [clientId]);
    if (!r.rowCount) return { ok: false, error: 'That client is not archived.' };
    revalidatePath('/risansi/admin/recoverable');
    touch();
    return { ok: true, message: 'Restored. It has no owner until you set one.' };
  } catch (e) { return fail(e); }
}

// ── one client's people, read and written together ────────────────

export interface ClientOwnership {
  primaryRepId: number | null;
  primaryRepName: string | null;
  secondary: { id: number; name: string }[];
  managers: string[];
}

/** Who works this client. Admin-only, like everything else that can change it. */
export async function getClientOwnership(clientId: number): Promise<ClientOwnership | null> {
  if (!(await requireAdmin())) return null;
  if (!Number.isInteger(clientId) || clientId <= 0) return null;
  try {
    const { rows } = await risansiPool.query<{
      primary_rep_id: number | null; primary_rep_name: string | null;
      secondary: { id: number; name: string }[] | null; managers: string[] | null;
    }>(
      `SELECT c.primary_rep_id,
              (SELECT u.name FROM users u WHERE u.id = c.primary_rep_id) AS primary_rep_name,
              (SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
                 FROM client_secondary_reps s JOIN users u ON u.id = s.rep_id
                WHERE s.client_id = c.id) AS secondary,
              (SELECT array_agg(DISTINCT u.name)
                 FROM manager_reps mr JOIN users u ON u.id = mr.manager_id AND u.is_active
                WHERE mr.rep_id = c.primary_rep_id
                   OR mr.rep_id IN (SELECT rep_id FROM client_secondary_reps WHERE client_id = c.id)) AS managers
         FROM clients c WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [clientId]);
    const r = rows[0];
    if (!r) return null;
    return {
      primaryRepId: r.primary_rep_id,
      primaryRepName: r.primary_rep_name,
      secondary: r.secondary ?? [],
      managers: r.managers ?? [],
    };
  } catch { return null; }
}

/**
 * Set a client's owner and covering reps in one transaction.
 *
 * One call rather than a primary write plus N secondary writes, because the two
 * halves constrain each other: promoting a covering rep to owner has to drop
 * their covering row in the same breath, and a form that saved the pieces
 * separately could leave a client listing the same person twice if the second
 * request never arrived.
 */
export async function setClientOwnership(
  clientId: number, primaryRepId: number | null, secondaryRepIds: number[],
): Promise<Outcome> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: 'Only an admin can change who works a client.' };
  if (!Number.isInteger(clientId) || clientId <= 0) return { ok: false, error: 'Invalid client.' };

  // A person cannot both own and cover the same account.
  const secondary = [...new Set(secondaryRepIds.filter(n => Number.isInteger(n) && n > 0))]
    .filter(n => n !== primaryRepId);

  const c = await risansiPool.connect();
  try {
    await c.query('BEGIN');
    // Closed work stays with the owner this form is replacing. Before the
    // UPDATE, and a no-op when the owner is not actually changing — this form
    // posts the field on every save.
    await freezeCreditForClient(c, clientId, primaryRepId);
    const r = await c.query(
      'UPDATE clients SET primary_rep_id = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [clientId, primaryRepId]);
    if (!r.rowCount) {
      await c.query('ROLLBACK');
      return { ok: false, error: 'That client no longer exists, or has been archived.' };
    }
    // Replace the covering set wholesale: the form sends the list it wants, and
    // diffing it here would just be the same delete-then-insert with more ways
    // to disagree with what the user is looking at.
    await c.query('DELETE FROM client_secondary_reps WHERE client_id = $1', [clientId]);
    for (const repId of secondary) {
      await c.query(
        `INSERT INTO client_secondary_reps (client_id, rep_id, added_by)
         VALUES ($1, $2, (SELECT id FROM users WHERE lower(email) = lower($3)))
         ON CONFLICT DO NOTHING`,
        [clientId, repId, me.email]);
    }
    await thawOpenCredit(c, clientId);
    await c.query('COMMIT');
    touch();
    revalidatePath(`/risansi/clients/${clientId}`);
    return {
      ok: true,
      message: primaryRepId == null
        ? 'Owner cleared — this client is now unassigned.'
        : `Saved. ${secondary.length ? `${secondary.length} covering rep${secondary.length === 1 ? '' : 's'}.` : 'No covering reps.'}`,
    };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return fail(e);
  } finally { c.release(); }
}

/** Everyone who can own or cover a client, for the pickers. */
export async function listAssignableReps(): Promise<{ id: number; name: string; role: string }[]> {
  if (!(await requireAdmin())) return [];
  try {
    return (await risansiPool.query<{ id: number; name: string; role: string }>(
      `SELECT id::int AS id, name, role FROM users
        WHERE is_active = TRUE AND role IN ('rep','manager') ORDER BY role DESC, name`)).rows;
  } catch { return []; }
}
