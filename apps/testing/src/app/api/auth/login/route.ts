/**
 * Gone. Signing in happens at Risansi Digital.
 *
 * Phase 4b. This handler checked `users.password_hash`, which stopped being
 * the credential store when the portal started accepting a shared session.
 * Leaving it would be a second place to type a password — the thing this
 * migration exists to end — and a way to mint a local cookie that bypasses
 * every grant decision made at the hub.
 *
 * Answered rather than deleted: it is what an old bookmark, a stale tab or a
 * cached client bundle will hit, and a 410 naming the new address is more use
 * than a 404. Step 5 removes it with the rest of the local credential path.
 */
import { NextResponse } from "next/server";

const HUB = (process.env.HUB_URL || "https://digital.risansi.com").replace(/\/+$/, "");

export async function POST() {
  return NextResponse.json(
    { error: "Sign in at Risansi Digital.", signInUrl: `${HUB}/sign-in` },
    { status: 410 },
  );
}
