import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify, type JWTPayload } from "jose";

import { sessionVerdict } from "@/lib/session-guard";

/** Server-side gate for pages AND the API. Runs before any protected page is
 * served, so direct URL entry, client-side navigation, and the back button are
 * all covered the same way (unlike the old client-only localStorage check,
 * which only ran after the page had already mounted), and before any /api
 * route handler, so a route that forgets to check the session is still
 * closed. Runs on the Node.js runtime because the account check reads the
 * database. */
const AUTH_COOKIE_NAME = "auth_token";

/** Forced-password-change screen — reachable only by a flagged user, and the
 * only protected page they can reach. */
const CHANGE_PASSWORD_PATH = "/change-password";

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
  "/api/auth/logout",
  "/api/access-requests",
  "/api/health",
]);

/** All a user with an admin-issued password can call until they set their
 * own — the API side of the page redirect to /change-password below. */
const MUST_CHANGE_PASSWORD_API_PATHS = new Set(["/api/auth/me", "/api/auth/change-password"]);

/** Verifies a session token, returning its payload or null when absent,
 * expired, or otherwise invalid. */
async function verifyToken(token: string | null | undefined): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return payload;
  } catch {
    return null;
  }
}

function verifySession(req: NextRequest) {
  return verifyToken(req.cookies.get(AUTH_COOKIE_NAME)?.value);
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

/** Sends an ended session to the login page and drops its cookie. */
function endPageSession(req: NextRequest) {
  const res = NextResponse.redirect(new URL(SESSION_ENDED_PATH, req.url));
  res.cookies.delete(AUTH_COOKIE_NAME);
  return res;
}

function apiError(message: string, status: number, clearCookie = false) {
  const res = NextResponse.json({ error: message }, { status });
  if (clearCookie) res.cookies.delete(AUTH_COOKIE_NAME);
  return res;
}

async function guardApi(req: NextRequest, pathname: string) {
  if (PUBLIC_API_PATHS.has(pathname)) return NextResponse.next();

  // Same sources as decodeToken in lib/auth: a Bearer header for direct API
  // callers, otherwise the browser's session cookie.
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyToken(bearer ?? cookie);
  if (!payload) {
    return apiError("Please sign in to continue.", 401, Boolean(cookie));
  }

  let verdict;
  try {
    verdict = await sessionVerdict(payload);
  } catch {
    return apiError("Could not verify your session. Please try again.", 503);
  }
  if (verdict === "ended") {
    return apiError("Your session has ended. Please sign in again.", 401, true);
  }

  if (payload.mustChangePassword === true && !MUST_CHANGE_PASSWORD_API_PATHS.has(pathname)) {
    return apiError("Change your password before continuing.", 403);
  }
  return NextResponse.next();
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return guardApi(req, pathname);
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
        new URL(
          session.mustChangePassword === true ? CHANGE_PASSWORD_PATH : "/dashboard",
          req.url,
        ),
      );
    }
    if (req.cookies.get(AUTH_COOKIE_NAME)) {
      const res = NextResponse.next();
      res.cookies.delete(AUTH_COOKIE_NAME);
      return res;
    }
    return NextResponse.next();
  }

  // Forced password change: a user with an admin-issued password can't reach
  // any protected page until they've set their own. Checked before the
  // role gates below so it can't be side-stepped by deep-linking.
  if (pathname === CHANGE_PASSWORD_PATH) {
    const session = await verifySession(req);
    if (!session) return NextResponse.redirect(new URL("/", req.url));
    if (await pageSessionEnded(session)) return endPageSession(req);
    // Already changed it — no reason to sit on this screen.
    if (session.mustChangePassword !== true) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (!isProtected) return NextResponse.next();

  const payload = await verifySession(req);
  if (!payload) {
    // No session (or a stale one) — back to the login page, dropping the dead
    // cookie so the next request doesn't re-run a doomed verify.
    const res = NextResponse.redirect(new URL("/", req.url));
    if (req.cookies.get(AUTH_COOKIE_NAME)) res.cookies.delete(AUTH_COOKIE_NAME);
    return res;
  }
  // Deactivated, role changed or password reset since signing in. Checked
  // before the role gates below, which trust the token's role — safe only
  // once it is known to still match the account.
  if (await pageSessionEnded(payload)) return endPageSession(req);

  if (payload.mustChangePassword === true) {
    return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, req.url));
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
