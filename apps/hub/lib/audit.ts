/**
 * identity.auth_events — append only.
 *
 * Each portal keeps its own log of what happened inside it. This records only
 * what happened to identity: signing in, failing to, signing out, asking for
 * an application, and being granted or refused one.
 *
 * Email is written alongside user_id so a row still reads correctly after an
 * account is deleted, which is how the sales portal's auth_audit already
 * behaves — and it is the only way a failed sign-in for an address that does
 * not exist records anything useful at all.
 *
 * Logging never breaks the thing it is logging. A write that fails is reported
 * to the server console and swallowed: an audit table that is full or briefly
 * unreachable must not be the reason somebody cannot sign in.
 */

import { headers } from 'next/headers';
import db from '@/lib/db';

export type AuthEvent =
  | 'sign_in'
  | 'sign_in_failed'
  | 'sign_out'
  | 'sign_up'
  | 'password_changed'
  | 'access_requested'
  | 'grant_approved'
  | 'grant_rejected'
  | 'grant_revoked'
  | 'grant_role_changed'
  | 'approver_granted'
  | 'approver_revoked';

export interface AuthEventFields {
  event: AuthEvent;
  email?: string | null;
  userId?: string | null;
  appSlug?: string | null;
  /** Free text. Who decided, which role was set, why something was refused. */
  detail?: string | null;
}

/**
 * The caller's address as the platform reports it.
 *
 * `x-forwarded-for` is a list when there are proxies in front; the first entry
 * is the client and the rest are the hops. Vercel sets `x-real-ip` as well,
 * which is already resolved, so prefer it.
 */
async function callerIdentity(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip =
    h.get('x-real-ip')
    ?? (forwarded ? forwarded.split(',')[0]!.trim() : null)
    ?? null;
  return { ip: ip || null, userAgent: h.get('user-agent') };
}

export async function logAuthEvent(fields: AuthEventFields): Promise<void> {
  try {
    const { ip, userAgent } = await callerIdentity();
    await db.query(
      `INSERT INTO identity.auth_events
         (event, email, user_id, app_slug, ip, user_agent, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        fields.event,
        fields.email ?? null,
        fields.userId ?? null,
        fields.appSlug ?? null,
        ip,
        userAgent,
        fields.detail ?? null,
      ],
    );
  } catch (err) {
    console.error('identity.auth_events write failed', fields.event, err);
  }
}
