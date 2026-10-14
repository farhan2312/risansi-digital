"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/session";
import { updatePassword, verifyPasswordById } from "@/lib/users";
import { logAudit } from "@/lib/audit";



export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; error: string };

export async function changePassword(
  input: ChangePasswordInput
): Promise<ChangePasswordResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };

  // if user is Platform admin, disable the change password features
  if (user.email === process.env.ADMIN_EMAIL) {
    return { ok: false, error: "Password changes are not allowed for Platform Admins." };
  }

  if (!input.currentPassword)
    return { ok: false, error: "Enter your current password." };
  if (!input.newPassword || input.newPassword.length < 6)
    return { ok: false, error: "New password must be at least 6 characters." };
  if (input.newPassword !== input.confirmPassword)
    return { ok: false, error: "New passwords do not match." };
  if (input.newPassword === input.currentPassword)
    return {
      ok: false,
      error: "New password must be different from the current one.",
    };

  const valid = await verifyPasswordById(user.id, input.currentPassword);
  if (!valid) return { ok: false, error: "Current password is incorrect." };

  await updatePassword(user.id, input.newPassword);
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "password.change",
    category: "auth",
    details: "Changed password",
  });
  return { ok: true };
}

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await logAudit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: "logout",
      category: "auth",
      details: "Signed out",
    });
  }
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
