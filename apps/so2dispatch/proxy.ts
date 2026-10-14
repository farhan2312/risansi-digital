/**
 * The front door (Phase 5, step 6), and nothing else.
 *
 * Somebody arriving already signed in at Risansi Digital must not be met by a
 * login form: the shared session would never be examined, their account never
 * created, and the only way in would be a page they cannot reach without
 * being in. This matches `/` and answers one question — is there a credible
 * Risansi Digital session? — and if so sends them inside, where lib/session.ts
 * does the real work: reading the grant, resolving the role and creating the
 * account on a first visit (step 5).
 *
 * ── Signature and issuer only, no database ──────────────────────
 *
 * This decides whether to show a login form, nothing about what anybody may
 * do. Somebody with a credible session but no grant goes inside, is turned
 * back by the /risansi layout, and /login says why (getAccessRefusal).
 *
 * ── Only `/`, not /login ────────────────────────────────────────
 *
 * Matching /login too would loop that refused person — inside, back to
 * /login, inside again. /login already reads the shared session server-side
 * and sends anyone it admits inside, so it does not need this.
 *
 * ── Why jose is inlined rather than imported ────────────────────
 *
 * `@risansi/identity`'s index pulls in bcryptjs through its password module,
 * which has no business in a proxy bundle. Same cookie name, secret and
 * issuer as the package — a mismatch fails closed, showing the login page.
 * Same as apps/testing/src/middleware.ts.
 */

import { jwtVerify } from "jose";
import { NextResponse, type NextRequest } from "next/server";

const SHARED_COOKIE = "risansi_session";
const ISSUER = "risansi-digital";

async function hasSharedSession(req: NextRequest): Promise<boolean> {
  const raw = req.cookies.get(SHARED_COOKIE)?.value;
  const secret = process.env.RISANSI_SESSION_SECRET;
  // A missing secret means "no shared sessions here", not an error: the
  // local login still works, which is the point of keeping it for now.
  if (!raw || !secret) return false;
  try {
    await jwtVerify(raw, new TextEncoder().encode(secret), { issuer: ISSUER });
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  if (await hasSharedSession(req)) {
    return NextResponse.redirect(new URL("/risansi/dashboard", req.url));
  }
  // No shared session: the root page decides, as it always has.
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
