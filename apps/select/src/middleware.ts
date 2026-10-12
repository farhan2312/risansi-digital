import { NextResponse, type NextRequest } from "next/server";
import type { JWTPayload } from "jose";

import { SHARED_COOKIE, sharedSessionPayload } from "@/lib/effective-role";
import { sessionVerdict } from "@/lib/session-guard";

/** Server-side gate for pages AND the API. Runs before any protected page is
 * served, so direct URL entry, client-side navigation, and the back button are
 * all covered the same way (unlike the old client-only localStorage check,
 * which only ran after the page had already mounted), and before any /api
 * route handler, so a route that forgets to check the session is still
 * closed. Runs on the Node.js runtime because the account check reads the
 * database. */

/** Forced-password-change screen — reachable only by a flagged user, and the
 * only protected page they can reach. */
const HUB = (process.env.HUB_URL || "https://digital.risansi.com").replace(/\/+$/, "");
/**
 * Phase 4b: both of these are at Risansi Digital now. This portal has no
 * sign-in page and no change-password form — two places to type a password is
 * what the migration exists to end, and a local login would also be a way to
 * mint a cookie that bypasses every grant decision made at the hub.
 */
const HUB_SIGN_IN = `${HUB}/sign-in`;
const CHANGE_PASSWORD_PATH = `${HUB}/change-password`;
/** The path this app used to serve it on. Kept only to forward. */
const LOCAL_CHANGE_PASSWORD = "/change-password";

/** Where to send somebody who is not signed in, carrying where they meant to
 *  go. `next` is checked by safeReturnUrl() at the hub and deliberately not
 *  here: two checks in two codebases drift apart, and on a login page an
 *  unvalidated destination is a phishing hop. */
function toHub(req: NextRequest) {
  return NextResponse.redirect(`${HUB_SIGN_IN}?next=${encodeURIComponent(req.nextUrl.href)}`);
}

/** Where a session that has ended (deactivated, role changed, password reset)
 * lands; the login page explains why they are there. */
const SESSION_ENDED_PATH = "/?session=ended";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/projects",
  "/pump-selection",
  "/pump-details",
  "/selection-summary",
  "/head-calculator",
  "/commercial",
  "/client-prices",
  "/my-bug-reports",
  "/approvals",
  "/admin",
];

/** The only API routes callable without a session: signing in and out,
 * requesting access, and the health probe. Everything else under /api needs
 * one — deny by default, so a new route is protected without remembering to. */
const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/access-requests",
  "/api/health",
]);

/** All a user with an admin-issued password can call until they set their
 * own — the API side of the page redirect to /change-password below. */
const MUST_CHANGE_PASSWORD_API_PATHS = new Set(["/api/auth/me", "/api/auth/change-password"]);

/**
 * The session: Risansi Digital's shared cookie - the only one this portal
 * accepts (sign-in happens only at the hub; this app's own auth_token is no
 * longer issued or read).
 *
 * This gate runs before anything that understands the shared cookie, so
 * without this a person holding a perfectly good one is bounced to the login
 * page and never reaches the code that would have recognised it. That is
 * exactly what happened on the sales portal the first time its proxy was
 * tested, and it is the same shape of mistake here.
 *
 * The shared path returns a payload whose role came from the grant, so the
 * role gates further down read the same value the route handlers will.
 */
async function verifySession(req: NextRequest): Promise<JWTPayload | null> {
  return (await sharedSessionPayload(req.cookies.get(SHARED_COOKIE)?.value)) as JWTPayload | null;
}

/** Page requests: whether the account behind a valid token still allows it.
 * A database failure lets the page through: pages are client-rendered shells
 * whose data all comes from the API, which fails closed on its own. */
async function pageSessionEnded(payload: JWTPayload): Promise<boolean> {
  try {
    return (await sessionVerdict(payload)) === "ended";
  } catch {
    return false;
  }
}

/** Sends an ended session to the login page. */
function endPageSession(req: NextRequest) {
  return NextResponse.redirect(new URL(SESSION_ENDED_PATH, req.url));
}

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function guardApi(req: NextRequest, pathname: string) {
  if (PUBLIC_API_PATHS.has(pathname)) return NextResponse.next();

  // Same source as decodeToken in lib/auth: the Risansi Digital session.
  const payload = await verifySession(req);
  if (!payload) {
    return apiError("Please sign in to continue.", 401);
  }

  let verdict;
  try {
    verdict = await sessionVerdict(payload);
  } catch {
    return apiError("Could not verify your session. Please try again.", 503);
  }
  if (verdict === "ended") {
    return apiError("Your session has ended. Please sign in again.", 401);
  }

  if (payload.mustChangePassword === true && !MUST_CHANGE_PASSWORD_API_PATHS.has(pathname)) {
    return apiError("Change your password before continuing.", 403);
  }
  return NextResponse.next();
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return await guardApi(req, pathname);
  }

  // Login page ("/"): an already-signed-in user has no reason to see the
  // form again — send them straight to the dashboard. Done here rather than
  // in the page component so there's no flash of the login screen before a
  // client-side redirect kicks in. An expired/invalid cookie, or one whose
  // account has since been deactivated, falls through to the form (and gets
  // cleared) instead of bouncing.
  if (pathname === "/") {
    let session = await verifySession(req);
    if (session && (await pageSessionEnded(session))) session = null;
    if (session) {
      return NextResponse.redirect(
        session.mustChangePassword === true
          ? CHANGE_PASSWORD_PATH
          : new URL("/dashboard", req.url),
      );
    }
    return toHub(req);
  }

  // Forced password change: a user with an admin-issued password can't reach
  // any protected page until they've set their own.
  //
  // Phase 4b: that screen is at Risansi Digital now, so this path only
  // exists to forward the bookmarks and the stale tabs. No session check
  // first — there is nothing here to protect, and the hub will ask who they
  // are anyway.
  if (pathname === LOCAL_CHANGE_PASSWORD) {
    return NextResponse.redirect(CHANGE_PASSWORD_PATH);
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (!isProtected) return NextResponse.next();

  const payload = await verifySession(req);
  if (!payload) {
    // No session (or a stale one) - to the hub to sign in.
    return toHub(req);
  }
  // Deactivated, role changed or password reset since signing in. Checked
  // before the role gates below, which trust the token's role — safe only
  // once it is known to still match the account.
  if (await pageSessionEnded(payload)) return endPageSession(req);

  if (payload.mustChangePassword === true) {
    return NextResponse.redirect(CHANGE_PASSWORD_PATH);
  }

  // Users & Access (formerly "access requests") and Bug Tracker are
  // system_admin only; the other /admin/* pages (the master-data tables)
  // are open to admin and system_admin alike.
  const role = payload.role;
  const isAdminLevel = role === "admin" || role === "system_admin";
  // Approvals: selection heads and system admins (APPROVER_ROLES).
  if (pathname === "/approvals" || pathname.startsWith("/approvals/")) {
    if (role !== "selection_head" && role !== "system_admin") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }
  if (
    pathname.startsWith("/admin/users") ||
    pathname.startsWith("/admin/bug-tracker") ||
    pathname.startsWith("/admin/audit")
  ) {
    if (role !== "system_admin") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  } else if (pathname === "/admin/pulley-master" || pathname.startsWith("/admin/pulley-master/")) {
    // Pulley owners get this one master page on top of User access.
    if (!isAdminLevel && role !== "pulley_owner") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  } else if (pathname.startsWith("/admin") && !isAdminLevel) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: [
    "/api/:path*",
    "/",
    "/change-password",
    "/dashboard/:path*",
    "/projects/:path*",
    "/pump-selection/:path*",
    "/pump-details/:path*",
    "/selection-summary/:path*",
    "/head-calculator/:path*",
    "/commercial/:path*",
    "/client-prices/:path*",
    "/my-bug-reports/:path*",
    "/approvals/:path*",
    "/admin/:path*",
  ],
};
