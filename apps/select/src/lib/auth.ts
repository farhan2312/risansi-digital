/**
 * Who is asking - the Risansi Digital session, as this portal's claims.
 *
 * Since Phase 4b the hub's shared `risansi_session` cookie is the only
 * session this portal accepts: sign-in happens only at Risansi Digital. The
 * app's own `auth_token` JWT (and the Bearer header that could carry it) is
 * gone - nothing issued it any more since /api/auth/login answers 410, and
 * leaving it readable only kept a second way in, and made Sign out clear the
 * wrong cookie.
 */
import { SHARED_COOKIE, sharedSessionPayload } from "@/lib/effective-role";

/** How long the claims below say they are good for. The real lifetime is the
 *  shared session's own; this only fills iat/exp for code that reads them. */
const CLAIMS_LIFETIME_SECONDS = 60 * 60 * 12;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const match = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export interface TokenClaims {
  sub: string;
  name: string | null;
  email: string;
  role: string;
  /** True while the user still has an admin-issued password; the middleware
   * sends them to the hub's change-password page. */
  mustChangePassword?: boolean;
  iat: number;
  exp: number;
}

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 401) {
    super(message);
    this.statusCode = statusCode;
    this.name = "AuthError";
  }
}

/**
 * The shared session's claims. The resolving lives in `effective-role.ts`
 * and is shared with middleware, which gates pages on the role it returns -
 * two implementations would be a door that opens on one side and not the
 * other. The cookie's `sub` is an `identity.users.id`; everything
 * downstream expects this app's own `users_pump.id` (the foreign key on
 * projects, quotations and audit rows), so the translation happens there.
 */
export async function decodeToken(req: Request): Promise<TokenClaims> {
  const p = await sharedSessionPayload(readCookie(req, SHARED_COOKIE));
  if (!p) throw new AuthError("Missing or invalid session", 401);
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: p.sub,
    name: p.name,
    email: p.email,
    role: p.role ?? "user",
    mustChangePassword: p.mustChangePassword,
    iat: now,
    exp: now + CLAIMS_LIFETIME_SECONDS,
  };
}

/** Same as decodeToken, but returns null instead of throwing — for routes
 * where being logged in is optional (e.g. attributing "created by"). */
export async function tryDecodeToken(req: Request): Promise<TokenClaims | null> {
  try {
    return await decodeToken(req);
  } catch {
    return null;
  }
}

// Three roles: "user" (main app only), "admin" (also gets the admin master
// pages — Pump Model/Pulley/Gearbox — but NOT access requests), "system_admin"
// (full control, including approving/rejecting access requests). Role is
// assigned directly in the DB — there's no self-service promotion UI, same
// as how the original single "admin" role has always been granted.
export async function requireAdmin(req: Request): Promise<TokenClaims> {
  const claims = await decodeToken(req);
  if (claims.role !== "admin" && claims.role !== "system_admin") {
    throw new AuthError("Admin access required", 403);
  }
  return claims;
}

/** Roles that may view and edit the Pulley Master: the admin roles plus
 * pulley_owner, who otherwise has plain User access. */
export const PULLEY_MASTER_ROLES = ["pulley_owner", "admin", "system_admin"] as const;

export const canManagePulleyMaster = (role: string | null | undefined): boolean =>
  (PULLEY_MASTER_ROLES as readonly string[]).includes(role ?? "");

export async function requirePulleyMasterAccess(req: Request): Promise<TokenClaims> {
  const claims = await decodeToken(req);
  if (!canManagePulleyMaster(claims.role)) {
    throw new AuthError("Pulley Master access required", 403);
  }
  return claims;
}

/** Selection heads and system admins — the roles that decide approvals
 * (APPROVER_ROLES in lib/approval.ts). */
export async function requireApprover(req: Request): Promise<TokenClaims> {
  const claims = await decodeToken(req);
  if (claims.role !== "selection_head" && claims.role !== "system_admin") {
    throw new AuthError("Selection head access required", 403);
  }
  return claims;
}

/** Stricter than requireAdmin — for the handful of routes that "admin"
 * explicitly does NOT get (access-request review), per the 3-role spec. */
export async function requireSystemAdmin(req: Request): Promise<TokenClaims> {
  const claims = await decodeToken(req);
  if (claims.role !== "system_admin") {
    throw new AuthError("System admin access required", 403);
  }
  return claims;
}
