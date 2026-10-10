/**
 * Is the shared Risansi Digital session reaching this app, and does it agree
 * with NextAuth about who you are?
 *
 * Phase 3 step 1 of MIGRATION_PLAN.md. The point of step 1 is to find out
 * whether the shared cookie works here BEFORE step 3 relies on it, and
 * "probably" is not an answer you want to discover is wrong on the morning
 * everybody signs in. This is how that question gets a definite answer.
 *
 * Sysadmin only. It reports no secret and no token — booleans, an email and a
 * uuid — but it still describes the authentication arrangement, and that is
 * not something to hand to anyone who asks.
 *
 * Delete this once step 4 is done. It has no purpose afterwards, and a
 * diagnostic nobody needs is just more surface.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/risansi-auth';
import { hasRole } from '@/lib/risansi-auth';
import { diagnoseSharedSession } from '@/lib/risansi-shared-session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user.email || !hasRole(user.role, 'sysadmin')) {
    // Not found rather than forbidden: a 403 confirms the route exists.
    return new NextResponse('Not found', { status: 404 });
  }

  const diagnosis = await diagnoseSharedSession(user.email);

  return NextResponse.json({
    phase: 'Phase 3 step 1 — observation only. NextAuth is still what decides who is signed in.',
    ...diagnosis,
    readyForStep3: diagnosis.secretConfigured && diagnosis.verifies && diagnosis.agree !== false,
  });
}
