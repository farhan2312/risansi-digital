/**
 * /sign-in
 *
 * Also the landing place for a portal bounce. A link to one complaint in an
 * old notification email, clicked while signed out, arrives here as
 * `/sign-in?next=https://sales.risansi.com/risansi/complaints/412` and should
 * end up back at that complaint rather than on the hub's front page.
 *
 * `next` is checked by `safeReturnUrl()` from the identity package and nothing
 * else. An unvalidated redirect parameter on a login page is a phishing hop:
 * the attacker sends `digital.risansi.com/sign-in?next=https://evil.example/`,
 * the victim reads the real domain, signs in and is handed to the attacker
 * still believing they are inside Risansi. The package's version is tested and
 * covers the shapes that are easy to miss — protocol-relative URLs,
 * backslashes, embedded credentials, internationalised lookalike hosts.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeReturnUrl } from '@risansi/identity';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { SignInForm } from '@/components/sign-in-form';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = {
  title: 'Sign in — Risansi Digital',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // A promise in Next 16: synchronous access to searchParams was removed.
  const params = await searchParams;
  const raw = params.next;
  const next = safeReturnUrl(typeof raw === 'string' ? raw : null, '/');

  const viewer = await getViewer();
  if (viewer) {
    // Already signed in. Someone holding an issued password still has to deal
    // with that first, so send them there rather than on to `next`.
    redirect(viewer.mustChangePassword ? '/change-password' : next);
  }

  return (
    <>
      <SiteHeader showSignIn={false} />
      <div className="auth-shell">
        <h1>Sign in</h1>
        <p>One account for every Risansi portal.</p>
        <SignInForm next={next} />
        <p className="auth-foot">
          No account yet? <a href="/sign-up">Create one</a> with your Risansi address.
        </p>
      </div>
      <SiteFooter />
    </>
  );
}
