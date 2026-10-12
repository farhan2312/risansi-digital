/**
 * Signing up happens at Risansi Digital.
 *
 * Phase 4b. This form created a `users` row with a local password and a
 * Pending status for a sysadmin here to approve. Neither half works now: the
 * credential lives in identity, and whether somebody may open this portal is
 * a grant decided at the hub.
 *
 * Kept as a redirect — it is linked from older emails and people have it
 * bookmarked.
 */
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const HUB = (process.env.HUB_URL || 'https://digital.risansi.com').replace(/\/+$/, '');

export default async function SignUpRedirect() {
  redirect(`${HUB}/sign-up`);
}
