/**
 * Gone. Passwords are changed at Risansi Digital.
 *
 * This handler used to hash into `users.password_hash`, which stopped being
 * the credential store at phase 3 step 4 — so every call since has written a
 * column nothing reads and answered `{ ok: true }`. Somebody could change
 * their password, be told it worked, and find the old one still signing them
 * in. A lie that looks like success is worse than an error, which is why this
 * answers an error.
 *
 * Kept rather than deleted for the same reason the sign-in page was: it is
 * the one thing an old bookmark or a stale tab will hit, and a 410 naming the
 * new address is more use than a 404. Step 5 removes it along with next-auth
 * and the credential columns.
 */

import { NextResponse } from 'next/server';

const HUB = (process.env.HUB_URL || 'https://digital.risansi.com').replace(/\/+$/, '');

export async function POST() {
  return NextResponse.json(
    {
      error: 'Passwords are changed at Risansi Digital.',
      changePasswordUrl: `${HUB}/change-password`,
    },
    { status: 410 },
  );
}
