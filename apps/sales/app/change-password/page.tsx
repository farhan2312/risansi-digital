/**
 * Changing a password happens at Risansi Digital.
 *
 * Phase 3 step 4. The credential that signs anybody into this portal lives in
 * `identity.users` now. The form that used to be here wrote
 * `users.password_hash`, which nothing reads any more — so leaving it would
 * let somebody set a new password, be told it worked, and find on their next
 * sign-in that nothing had changed and they were still being prompted. That
 * is the worst of the three possible outcomes: worse than an error, because
 * it looks like success.
 *
 * Kept as a redirect rather than deleted. It is linked from old notification
 * emails and people have it bookmarked; deleting it makes those 404, keeping
 * it sends them somewhere that works.
 *
 * The form component and the API route behind it are left in place for now.
 * They are unreachable from here, and step 5 removes them along with NextAuth
 * and the credential columns — doing it in one go rather than leaving the
 * password machinery half-dismantled across two releases.
 */

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const HUB = (process.env.HUB_URL || 'https://digital.risansi.com').replace(/\/+$/, '');

export default async function ChangePasswordRedirect() {
  redirect(`${HUB}/change-password`);
}
