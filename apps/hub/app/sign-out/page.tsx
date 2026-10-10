/**
 * /sign-out
 *
 * A page with a button rather than a link that logs you out on sight.
 *
 * A GET that clears the session can be fired by anything that can make your
 * browser issue a request — an `<img src>` in an email is enough, and the
 * cookie is scoped to `.risansi.com`, so one of those would sign somebody out
 * of all four portals at once. Only an annoyance rather than a breach, but a
 * POST costs nothing and the header's Sign out button posts to the same action.
 *
 * Reachable while signed out too, where it says so and offers the way back in.
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { signOutAction } from '@/app/actions/auth';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = {
  title: 'Sign out — Risansi Digital',
};

export default async function SignOutPage() {
  const viewer = await getViewer();

  return (
    <>
      <SiteHeader />
      <div className="auth-shell">
        <h1>Sign out</h1>
        {viewer
          ? (
            <>
              <p>
                {`This signs ${viewer.email} out of Risansi Digital and every portal `
                  + 'behind it, on this browser.'}
              </p>
              <form action={signOutAction} className="panel stack">
                <button className="btn btn-wide" type="submit">Sign out</button>
              </form>
            </>
          )
          : (
            <>
              <p>You are not signed in.</p>
              <p className="auth-foot"><a href="/sign-in">Sign in</a></p>
            </>
          )}
      </div>
      <SiteFooter />
    </>
  );
}
