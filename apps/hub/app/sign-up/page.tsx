/**
 * /sign-up
 *
 * Creates an `identity.users` row and nothing else. No grants: the new account
 * can sign in and see the grid, with Request access on every tile that needs
 * one. That is the whole of what signing up gets you, which is why it is safe
 * to let people do it themselves.
 *
 * Restricted to @risansi.com, matching what
 * apps/sales/app/api/auth/signup/submit/route.ts does today.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { SignUpForm } from '@/components/sign-up-form';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = {
  title: 'Create an account — Risansi Digital',
};

export default async function SignUpPage() {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.mustChangePassword ? '/change-password' : '/');

  return (
    <>
      <SiteHeader />
      <div className="auth-shell">
        <h1>Create an account</h1>
        <p>
          One account for every Risansi portal. Which portals you can open is
          decided after this, one request at a time.
        </p>
        <SignUpForm />
        <p className="auth-foot">
          Already have one? <a href="/sign-in">Sign in</a>.
        </p>
      </div>
      <SiteFooter />
    </>
  );
}
