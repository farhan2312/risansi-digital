"use server";

import { getCurrentUser } from "@/lib/session";
import { updatePassword, verifyPasswordById } from "@/lib/users";
import { logAudit } from "@/lib/audit";

export type SetPasswordResult = { ok: true } | { ok: false; error: string };

/**
 * First-login forced password change. Unlike the normal change flow this does
 * NOT ask for the current password (the user is on a temporary one), but it
 * only works while the account is actually flagged `must_change_password` —
 * so it can't be used to bypass the current-password check on a normal change.
 */
export async function forceSetPassword(input: {
  newPassword: string;
  confirmPassword: string;
}): Promise<SetPasswordResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!user.must_change_password) {
    // Nothing to do — the caller will send them on to the app.
    return { ok: true };
  }

  const next = input.newPassword ?? "";
  if (next.length < 6)
    return { ok: false, error: "New password must be at least 6 characters." };
  if (next !== input.confirmPassword)
    return { ok: false, error: "Passwords do not match." };
  // Reject reusing the password they're currently on. Compared against the
  // stored hash rather than a hardcoded literal, so no shared credential ever
  // lives in source — and this holds for any temporary password an admin issues.
  if (await verifyPasswordById(user.id, next))
    return {
      ok: false,
      error: "Choose a password different from your current one.",
    };

  await updatePassword(user.id, next); // also clears must_change_password
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "password.change",
    category: "auth",
    details: "Set password on first login (forced change)",
  });
  return { ok: true };
}
