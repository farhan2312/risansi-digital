"use server";

import { cookies } from "next/headers";
import { verifyCredentials } from "@/lib/users";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export type LoginInput = { email: string; password: string };

export type LoginResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

const STATUS_MESSAGES: Record<string, string> = {
  pending: "Your access request is still pending admin approval.",
  rejected: "Your access request was not approved. Contact an administrator.",
  disabled: "This account has been disabled. Contact an administrator.",
};

export async function login(input: LoginInput): Promise<LoginResult> {
  const email = input.email?.trim() ?? "";
  const password = input.password ?? "";

  if (!email || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  const result = await verifyCredentials(email, password);

  if (!result.ok) {
    await logAudit({
      actor: { email },
      action: "login_failed",
      category: "auth",
      details:
        result.reason === "invalid"
          ? "Invalid email or password"
          : `Account ${result.reason}`,
    });
    if (result.reason === "invalid") {
      return { ok: false, error: "Invalid email or password." };
    }
    return { ok: false, error: STATUS_MESSAGES[result.reason] };
  }

  // Signed session: store a JWT (HS256) carrying the user id in an httpOnly
  // cookie. The signature prevents a forged/tampered cookie from being accepted.
  const token = await signSession(result.user.id);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  await logAudit({
    actor: {
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
    },
    action: "login",
    category: "auth",
    details: "Signed in",
  });

  return { ok: true, redirectTo: "/risansi" };
}
