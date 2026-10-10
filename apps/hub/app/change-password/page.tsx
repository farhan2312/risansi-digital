/**
 * /change-password
 *
 * Reachable to anyone signed in, and the *only* thing reachable while
 * `must_change_password` is true — every other page calls `requireViewer()`,
 * which sends them here, and this one calls `requireViewerUnblocked()` so it
 * does not redirect to itself.
 *
 * That flag matters more than it looks. The password merge forces a reset for
 * all 91 people (MIGRATION_PLAN.md §2.4): nobody's portal password carries
 * over, so everybody arrives here once with an issued password, and the hub
 * becomes the only place a Risansi password is ever set.
 *
 * The header is deliberately still rendered, so somebody who landed here by
 * accident can sign out rather than being stuck.
 */

import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ChangePasswordForm } from '@/components/change-password-form';
import { requireViewerUnblocked } from '@/lib/viewer';

export const metadata: Metadata = {
  title: 'Set your password — Risansi Digital',
};

export default async function ChangePasswordPage() {
  const viewer = await requireViewerUnblocked();

  return (
    <>
      <SiteHeader />
      <div className="auth-shell">
        <h1>{viewer.mustChangePassword ? 'Choose your password' : 'Change your password'}</h1>
        <p>
          {viewer.mustChangePassword
            ? 'The password you were given gets you this far and no further. '
              + 'Pick one of your own and the portals open up.'
            : 'This is the password for every Risansi portal, so changing it here '
              + 'changes it everywhere.'}
        </p>
        <ChangePasswordForm />
      </div>
      <SiteFooter />
    </>
  );
}
