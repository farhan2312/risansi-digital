import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { getClientIp, getUserAgent, logAudit } from "@/lib/audit";
import { authCookieOptions, AUTH_COOKIE_NAME, createToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSessions, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return error("Request body must be JSON", 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return error("'email' and 'password' are required", 400);
  }

  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    // No user_id on a failed attempt -- either the account doesn't exist or
    // the password was wrong, and we don't want to leak which via the log.
    await logAudit({ ipAddress: ip, userAgent, eventType: "login_failed", userEmail: email, details: "Invalid email or password" });
    return error("Invalid email or password.", 401);
  }

  if (user.status === "pending") {
    await logAudit({
      ipAddress: ip, userAgent,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      eventType: "login_failed",
      details: "Access request still pending",
    });
    return error("Your access request is still pending admin approval.", 403);
  }
  if (user.status === "rejected") {
    await logAudit({
      ipAddress: ip, userAgent,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      eventType: "login_failed",
      details: "Access request rejected",
    });
    return error("Your access request was rejected. Contact an administrator.", 403);
  }
  if (user.status === "inactive") {
    await logAudit({
      ipAddress: ip, userAgent,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      eventType: "login_failed",
      details: "Account deactivated",
    });
    return error("Your account has been deactivated. Contact an administrator.", 403);
  }

  const token = createToken({ id: user.id, email: user.email, role: user.role });

  await db.insert(userSessions).values({ userId: user.id, userName: user.name, userEmail: user.email });
  await logAudit({ ipAddress: ip, userAgent, userId: user.id, userName: user.name, userEmail: user.email, eventType: "login" });

  const response = json({
    user: {
      id: String(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      must_change_password: user.mustChangePassword,
    },
  });
  response.cookies.set(AUTH_COOKIE_NAME, token, authCookieOptions());
  return response;
}
