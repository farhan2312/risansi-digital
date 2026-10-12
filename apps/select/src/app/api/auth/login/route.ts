/**
 * Gone. Signing in happens at Risansi Digital.
 *
 * Phase 4b. This handler checked `users_pump.password_hash` and minted a
 * local `auth_token`. Both had to go: a second place to type a password is
 * what this migration exists to end, and a locally minted cookie is a way
 * into the portal that never consults the grant decided at the hub.
 *
 * Answered rather than deleted — an old bookmark, a stale tab or a cached
 * client bundle will hit it, and a 410 naming the new address is more use
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
