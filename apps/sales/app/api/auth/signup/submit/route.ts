/**
 * Gone. Signing up happens at Risansi Digital.
 *
 * Phase 4b. This inserted a `users` row with a local password hash and a
 * Pending status. The password would sign nobody in and the Pending status
 * is not what decides access any more — identity.app_grants is.
 *
 * Answered rather than deleted: a cached bundle or an open tab will still
 * post to it, and a 410 naming the new address is more use than a 404.
 */
import { NextResponse } from 'next/server';

const HUB = (process.env.HUB_URL || 'https://digital.risansi.com').replace(/\/+$/, '');

export async function POST() {
  return NextResponse.json(
    { error: 'Create your account at Risansi Digital.', signUpUrl: `${HUB}/sign-up` },
    { status: 410 },
  );
}
