'use server';

/**
 * Signing out, for real.
 *
 * Phase 3 step 4 left two cookies in play and a Sign out button that cleared
 * only one of them:
 *
 *   risansi_session            set by the hub, scoped to .risansi.com
 *   next-auth.session-token    set by this app before step 4, host-only
 *
 * The button called next-auth's signOut(), which clears the second and knows
 * nothing about the first. So anybody who signed in through the hub — which
 * is now everybody — clicked Sign out, was sent to the sign-in page, and was
 * waved straight back in by the shared cookie they still held. On a shared
 * machine that hands the next person the previous one's portal.
 *
 * Both are cleared here, in one place, because "sign out" meaning "sign out
 * of some of it" is the kind of thing nobody discovers until it matters.
 *
 * The shared cookie belongs to .risansi.com and this app is a subdomain of
 * it, so it can be cleared from here directly — no cross-origin round trip.
 * Attributes have to match what the hub set, or the browser writes a second
 * cookie instead of replacing the first, which is why the options come from
 * the identity package rather than being spelled out again.
 *
 * The next-auth cookie is deleted by name rather than through signOut()
 * because step 5 removes next-auth and this should not have to change again.
 * Both names: next-auth picks the __Secure- prefix when NEXTAUTH_URL is https,
 * and deleting a cookie that is not there costs nothing.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_NAME, clearedCookieOptions } from '@risansi/identity';

const HUB = (process.env.HUB_URL || 'https://digital.risansi.com').replace(/\/+$/, '');

export async function signOutEverywhere(): Promise<void> {
  const jar = await cookies();

  jar.set(COOKIE_NAME, '', clearedCookieOptions());
  // A cookie is identified by name, domain and path — not by `secure` — so one
  // clear per name is enough. `secure` still has to be false on a plain-http
  // localhost, where the browser rejects a Secure Set-Cookie outright and the
  // cookie would survive the sign-out.
  const secure = process.env.NODE_ENV === 'production';
  for (const name of ['next-auth.session-token', '__Secure-next-auth.session-token']) {
    jar.set(name, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 });
  }

  // To the hub, which is where signing back in happens.
  redirect(`${HUB}/sign-in`);
}
