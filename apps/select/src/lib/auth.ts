/**
 * JWT auth, ported from azure-functions/shared/auth.py.
 * HS256 tokens with the same {sub, email, role, iat, exp} payload, so a
 * JWT_SECRET shared with the old deployment stays compatible.
 */
import jwt from "jsonwebtoken";

const JWT_ALGORITHM = "HS256" as const;
const JWT_EXPIRY_SECONDS = 60 * 60 * 12; // 12 hours

/** httpOnly cookie the session token lives in — not readable/settable from
 * client JS, so it can't be faked via localStorage the way the old
 * client-stored token could be. */
export const AUTH_COOKIE_NAME = "auth_token";
export const AUTH_COOKIE_MAX_AGE = JWT_EXPIRY_SECONDS;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const match = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing required environment variable: JWT_SECRET");
  }
  return secret;
}

export interface TokenClaims {
  sub: string;
  name: string | null;
  email: string;
  role: string;
  /** True while the user still has an admin-issued password. Carried in the
   * token so middleware can gate the whole app without a DB round-trip;
   * change-password re-issues the cookie with it cleared. */
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

export interface TokenUser {
  id: string;
  name: string | null;
  email: string;
  role: string | null;
  mustChangePassword?: boolean;
}

export function createToken(user: TokenUser): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(user.id),
    name: user.name ?? null,
    email: user.email,
    role: user.role ?? "user",
    mustChangePassword: user.mustChangePassword === true,
    iat: now,
    exp: now + JWT_EXPIRY_SECONDS,
  };
  return jwt.sign(payload, getSecret(), { algorithm: JWT_ALGORITHM });
}

/** Extract and verify the session token — from the httpOnly auth cookie
 * (the normal path for browser requests), falling back to a Bearer
 * Authorization header for any direct/non-browser API callers. */
export function decodeToken(req: Request): TokenClaims {
  const header = req.headers.get("authorization") ?? "";
  const bearerToken = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  const token = bearerToken ?? readCookie(req, AUTH_COOKIE_NAME);
  if (!token) {
    throw new AuthError("Missing or invalid session", 401);
  }
  try {
    return jwt.verify(token, getSecret(), {
      algorithms: [JWT_ALGORITHM],
    }) as TokenClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AuthError("Token expired", 401);
    }
    throw new AuthError("Invalid token", 401);
  }
}

/** Same as decodeToken, but returns null instead of throwing — for routes
 * where being logged in is optional (e.g. attributing "created by"). */
export function tryDecodeToken(req: Request): TokenClaims | null {
  try {
    return decodeToken(req);
  } catch {
    return null;
  }
}

// Three roles: "user" (main app only), "admin" (also gets the admin master
// pages — Pump Model/Pulley/Gearbox — but NOT access requests), "system_admin"
// (full control, including approving/rejecting access requests). Role is
// assigned directly in the DB — there's no self-service promotion UI, same
// as how the original single "admin" role has always been granted.
export function requireAdmin(req: Request): TokenClaims {
  const claims = decodeToken(req);
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

export function requirePulleyMasterAccess(req: Request): TokenClaims {
  const claims = decodeToken(req);
  if (!canManagePulleyMaster(claims.role)) {
    throw new AuthError("Pulley Master access required", 403);
  }
  return claims;
}

/** Selection heads and system admins — the roles that decide approvals
 * (APPROVER_ROLES in lib/approval.ts). */
export function requireApprover(req: Request): TokenClaims {
  const claims = decodeToken(req);
  if (claims.role !== "selection_head" && claims.role !== "system_admin") {
    throw new AuthError("Selection head access required", 403);
  }
  return claims;
}

/** Stricter than requireAdmin — for the handful of routes that "admin"
 * explicitly does NOT get (access-request review), per the 3-role spec. */
export function requireSystemAdmin(req: Request): TokenClaims {
  const claims = decodeToken(req);
  if (claims.role !== "system_admin") {
    throw new AuthError("System admin access required", 403);
  }
  return claims;
}
