/**
 * The front door (Phase 5, steps 6 and 7), and nothing else.
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
 * ── Step 7: nobody signed in goes to the hub ───────────────────
 *
 * This portal no longer has a sign-in form. On `/`, and on a page inside
 * the app opened with no session of either kind, they go to the hub's
 * sign-in carrying `next` — the page they asked for, so a link out of a
 * notification email lands there once they are in. The hub checks `next`
 * with safeReturnUrl(); this deliberately does not, so the two cannot drift.
 * A local cookie still counts as a session: they drain on their own.
 * GET only — a server action posted without a session is answered by the
 * action itself, and a redirect to another site is no answer to a POST.
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

const LOCAL_COOKIE = "session";
const HUB = (process.env.HUB_URL || "https://digital.risansi.com").replace(/\/+$/, "");

function toHub(next: string) {
  return NextResponse.redirect(`${HUB}/sign-in?next=${encodeURIComponent(next)}`);
}

export async function proxy(req: NextRequest) {
  const shared = await hasSharedSession(req);
  if (req.nextUrl.pathname === "/") {
    if (shared) return NextResponse.redirect(new URL("/risansi/dashboard", req.url));
    // Somebody still holding a local cookie goes in by the root page, as before.
    if (req.cookies.has(LOCAL_COOKIE)) return NextResponse.next();
    return toHub(new URL("/risansi/dashboard", req.url).href);
  }
  // Inside the app.
  if (!shared && !req.cookies.has(LOCAL_COOKIE) && req.method === "GET") return toHub(req.nextUrl.href);
  return NextResponse.next();
}

export const config = {
  // `/` and the app itself. Not /login, which reads the shared session and
  // says why somebody was refused — matching it would loop them.
  matcher: ["/", "/risansi/:path*"],
};
