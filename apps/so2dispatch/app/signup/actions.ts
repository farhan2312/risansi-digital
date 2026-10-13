"use server";

import { createPendingUser, EmailInUseError } from "@/lib/users";
import { REQUESTABLE_ROLES, roleLabel, type Role } from "@/lib/roles";
import { logAudit } from "@/lib/audit";

export type RequestAccessInput = {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: string;
};

export type RequestAccessResult =
  | { ok: true }
  | { ok: false; error: string };

const VALID_ROLES: Role[] = REQUESTABLE_ROLES;

export async function requestAccess(
  input: RequestAccessInput
): Promise<RequestAccessResult> {
  const fullName = input.fullName?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  const { password, confirmPassword, role } = input;

  // Server-side validation (never trust the client).
  if (!fullName) return { ok: false, error: "Full name is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: "Enter a valid email address." };
  if (!password || password.length < 6)
    return { ok: false, error: "Password must be at least 6 characters." };
  if (password !== confirmPassword)
    return { ok: false, error: "Passwords do not match." };
  if (!VALID_ROLES.includes(role as Role))
    return { ok: false, error: "Please select a valid role." };

  try {
    await createPendingUser({
      fullName,
      email,
      password,
      role: role as Role,
    });
    await logAudit({
      actor: { email, role: role as Role },
      action: "access.request",
      category: "ownership",
      target: email,
      details: `Requested access as ${roleLabel(role)}`,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof EmailInUseError) {
      return { ok: false, error: error.message };
    }
    console.error("requestAccess failed:", error);
    return {
      ok: false,
      error: "Something went wrong. Please try again.",
    };
  }
}
