'use server';

import { revalidatePath } from 'next/cache';
import risansiPool from '@/lib/db-risansi';
import { getCurrentUser, hasRole } from '@/lib/risansi-auth';
import { recordAudit } from '@/lib/audit';

// Refusals come back rather than being thrown: a thrown server-action message
// is redacted in production, so the person who needs to read it cannot.
export type ReassignResult =
  | { ok: true; movedOrders: number; clearedVisit: boolean; newClientName: string; newClientCode: string | null }
  | { ok: false; error: string };
const fail = (error: string): ReassignResult => ({ ok: false, error });

// Re-pointing an opportunity at the right client.
//
// The bulk quote and order-in-hand imports attached some opportunities to the
// wrong client — the code and name on the record agree with each other, they
// simply belong to somebody else. Nothing in the normal UI can fix that:
// client_id is set at creation and the edit form has no control for it, by
// design, because moving a deal between accounts changes who can see it.
//
// So this is sysadmin-only, and it is deliberately the whole job rather than a
// bare UPDATE: an order booked against the deal has to follow it, or revenue and
// pipeline start disagreeing for both accounts.

async function requireSysadmin() {
  const user = await getCurrentUser();
  if (!user.email || !hasRole(user.role, 'sysadmin')) {
    throw new Error('Only a sysadmin can change the client on an opportunity.');
  }
  return user;
}

export interface ReassignImpact {
  oppId: number;
  quoteRef: string | null;
  stage: string;
  currentClientId: number;
  currentClientCode: string | null;
  currentClientName: string;
  /** Order-in-hand rows booked against this opportunity; they move with it. */
  orders: number;
  ordersValueCr: number;
  /** Set when the opportunity was auto-created from a visit. */
  visitId: number | null;
  salesOrders: number;
}

/** What a reassignment would carry with it — shown before anything is changed. */
export async function getReassignImpact(oppId: number): Promise<ReassignImpact | null> {
  await requireSysadmin();
  const { rows } = await risansiPool.query<ReassignImpact>(
    `SELECT o.id AS "oppId", o.quote_ref AS "quoteRef", o.stage,
            o.client_id AS "currentClientId",
            c.code AS "currentClientCode", c.legal_name AS "currentClientName",
            o.visit_id AS "visitId",
            (SELECT count(*)::int FROM orders WHERE opportunity_id = o.id) AS orders,
            (SELECT COALESCE(sum(order_value_cr), 0)::float8 FROM orders WHERE opportunity_id = o.id) AS "ordersValueCr",
            (SELECT count(*)::int FROM opportunity_sales_orders WHERE opportunity_id = o.id) AS "salesOrders"
       FROM opportunities o JOIN clients c ON c.id = o.client_id
      WHERE o.id = $1`,
    [oppId],
  );
  return rows[0] ?? null;
}

export async function reassignOpportunityClient(oppId: number, newClientId: number): Promise<ReassignResult> {
  const user = await requireSysadmin();
  if (!Number.isInteger(oppId) || !Number.isInteger(newClientId)) throw new Error('Bad request.');

  const before = await getReassignImpact(oppId);
  if (!before) return fail('Opportunity not found.');
  if (before.currentClientId === newClientId) {
    return fail('That is already the client on this opportunity.');
  }

  const { rows: target } = await risansiPool.query<{ id: number; code: string | null; legal_name: string }>(
    'SELECT id, code, legal_name FROM clients WHERE id = $1 AND deleted_at IS NULL', [newClientId],
  );
  if (!target[0]) return fail('That client no longer exists.');

  const client = await risansiPool.connect();
  let movedOrders = 0;
  let clearedVisit = false;
  try {
    await client.query('BEGIN');

    await client.query(
      'UPDATE opportunities SET client_id = $2, updated_at = NOW() WHERE id = $1',
      [oppId, newClientId],
    );

    // Orders follow the deal. Every one of the 530 linked orders currently agrees
    // with its opportunity's client; leaving them behind would create the first
    // disagreements, with the order booked to one account and the deal to another.
    const ord = await client.query(
      'UPDATE orders SET client_id = $2 WHERE opportunity_id = $1 AND client_id <> $2',
      [oppId, newClientId],
    );
    movedOrders = ord.rowCount ?? 0;

    // A visit belongs to a client. If the deal has moved away from that client,
    // the link now points across accounts and is worse than no link at all.
    const vis = await client.query(
      `UPDATE opportunities SET visit_id = NULL
        WHERE id = $1 AND visit_id IS NOT NULL
          AND visit_id IN (SELECT id FROM visits WHERE client_id <> $2)`,
      [oppId, newClientId],
    );
    clearedVisit = (vis.rowCount ?? 0) > 0;

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await recordAudit({
    action: 'update', entityType: 'opportunity', entityId: String(oppId),
    summary: `Client changed from ${before.currentClientCode ?? '—'} ${before.currentClientName} `
      + `to ${target[0].code ?? '—'} ${target[0].legal_name}`
      + (movedOrders ? `; ${movedOrders} order(s) moved with it` : '')
      + (clearedVisit ? '; visit link cleared (belonged to the old client)' : ''),
    actorEmail: user.email, actorRole: user.role,
  }).catch(() => {});

  revalidatePath('/risansi/pipeline');
  revalidatePath(`/risansi/clients/${before.currentClientId}`);
  revalidatePath(`/risansi/clients/${newClientId}`);

  return {
    ok: true,
    movedOrders,
    clearedVisit,
    newClientName: target[0].legal_name,
    newClientCode: target[0].code,
  };
}

/**
 * Whether the signed-in user may re-point an opportunity at another client.
 *
 * Exists so the control can decide for itself whether to render, rather than
 * having isSysadmin threaded from a page through the board and the table into
 * the drawer — four components that would each have to keep it in step, when
 * only one of them cares.
 */
export async function canReassignClient(): Promise<boolean> {
  const user = await getCurrentUser();
  return !!user.email && hasRole(user.role, 'sysadmin');
}
