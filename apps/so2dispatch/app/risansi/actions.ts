"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/session";
import { HUB_SIGN_OUT_URL, MOVED_TO_HUB } from "@/lib/hub";
import { logAudit } from "@/lib/audit";



export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Retired (Phase 5, step 7): passwords are changed at Risansi Digital — the
 * menu links there. Answers with the new address for any old bundle still
 * posting here.
 */
export async function changePassword(
  _input: ChangePasswordInput
): Promise<ChangePasswordResult> {
  return { ok: false, error: MOVED_TO_HUB };
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
  // The shared session is the hub's to clear, and clearing it signs them out
  // of every portal — its sign-out page asks first.
  redirect(HUB_SIGN_OUT_URL);
}
