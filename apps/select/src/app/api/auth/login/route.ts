import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { error, json } from "@/lib/api";
import { AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_NAME, createToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logAudit } from "@/lib/audit";

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

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    await logAudit(req, {
      eventType: "login_failed",
      action: "auth.login_failed",
      actor: { id: user?.id ?? null, email, role: user?.role ?? null },
      detail: user ? "Incorrect password" : "No account for this email",
    });
    return error("Invalid email or password.", 401);
  }

  if (user.status === "pending") {
    await logAudit(req, {
      eventType: "login_failed",
      action: "auth.login_blocked",
      actor: { id: user.id, email: user.email, role: user.role },
      detail: "Account status: pending",
    });
    return error("Your access request is still pending admin approval.", 403);
  }
  if (user.status === "rejected") {
    await logAudit(req, {
      eventType: "login_failed",
      action: "auth.login_blocked",
      actor: { id: user.id, email: user.email, role: user.role },
      detail: "Account status: rejected",
    });
    return error("Your access request was rejected. Contact an administrator.", 403);
  }
  if (user.status === "deactivated") {
    await logAudit(req, {
      eventType: "login_failed",
      action: "auth.login_blocked",
      actor: { id: user.id, email: user.email, role: user.role },
      detail: "Account status: deactivated",
    });
    return error("Your account has been deactivated. Contact an administrator.", 403);
  }

  const token = createToken({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
  await logAudit(req, {
    eventType: "login",
    action: "auth.login",
    actor: { id: user.id, email: user.email, role: user.role },
    detail: "Signed in",
  });

  const response = json({
    user: {
      id: String(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      // Lets the client route straight to the change-password screen; the
      // middleware enforces it regardless.
      mustChangePassword: user.mustChangePassword === true,
    },
  });
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  return response;
}
