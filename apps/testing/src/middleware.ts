/**
 * The front door, and nothing else.
 *
 * This app had no middleware. Its root path *is* the login page, and
 * `AuthGuard` only wraps the dashboard group — so arriving at
 * rndtesting.risansi.com with a perfectly good Risansi Digital session
 * rendered the login form and never called `/api/auth/me`. The shared session
 * was never looked at, the account was never provisioned, and the only way in
 * was a page you could not reach without being in. Pump Selection does not
 * have this problem because its middleware notices the session before any
 * page renders.
 *
 * Deliberately narrow. It matches `/` and answers one question: is there a
 * credible Risansi Digital session? If so, send them inside, where AuthGuard
 * and `decodeToken` do the real work — reading the grant, resolving the role
 * and creating the account row if this is their first visit.
 *
 * ── Signature and issuer only, no database ──────────────────────
 *
 * This decides nothing about what anybody may do; it decides whether to show
 * a login form. Whether this person may actually open the portal is settled
 * by `sharedClaims` in lib/auth.ts, on a row re-read per request. Outer door
 * here, lock there — the same split the sales portal's proxy uses, and for
 * the same reason: a gate that re-reads the database on every page view costs
 * a round trip to answer a question the next request answers properly anyway.
 *
 * ── Why jose is inlined rather than imported ────────────────────
 *
 * `@risansi/identity`'s index pulls in bcryptjs through its password module,
 * which has no business in a middleware bundle. Same cookie name, same
 * secret, same issuer — kept in step by this comment and by the fact that a
 * mismatch fails closed, showing the login page rather than letting anybody
 * through.
 */

import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

const SHARED_COOKIE = "risansi_session";
const ISSUER = "risansi-digital";

async function hasSharedSession(req: NextRequest): Promise<boolean> {
  const raw = req.cookies.get(SHARED_COOKIE)?.value;
  const secret = process.env.RISANSI_SESSION_SECRET;
  // A missing secret means "no shared sessions here", not an error. The login
  // form still works, which is the whole point of keeping it for now.
  if (!raw || !secret) return false;
  try {
    await jwtVerify(raw, new TextEncoder().encode(secret), { issuer: ISSUER });
    return true;
  } catch {
    return false;
  }
}

const HUB = (process.env.HUB_URL || "https://digital.risansi.com").replace(/\/+$/, "");

export async function middleware(req: NextRequest) {
  if (await hasSharedSession(req)) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Phase 4b, the visible step: this portal no longer has a sign-in page.
  // Two places to type a password is the thing the whole migration exists to
  // end. The login screen's component is still in the tree and still
  // reachable by nothing — removing it is step 5, along with the local
  // cookie it used to mint.
  //
  // `next` carries where they were going, so a link out of a notification
  // email lands on that page rather than on the dashboard. It is checked by
  // safeReturnUrl() at the hub and deliberately not here: an unvalidated
  // destination on a login page is a phishing hop, and two checks in two
  // codebases drift apart.
  const next = encodeURIComponent(req.nextUrl.href);
  return NextResponse.redirect(`${HUB}/sign-in?next=${next}`);
}

export const config = {
  // Only the login page. Everything else is already guarded by AuthGuard and
  // by each route handler, and widening this would duplicate those checks in
  // a second place that can drift from them.
  matcher: ["/"],
};
