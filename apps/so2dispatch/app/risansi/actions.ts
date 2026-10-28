"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/session";
import { HUB_SIGN_OUT_URL, MOVED_TO_HUB } from "@/lib/hub";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { roleLabel, type Role } from "@/lib/roles";
import { ACTIVE_ROLE_COOKIE, EXTRA_ROLE_CHOICES, listUserRoles, setExtraRoles } from "@/lib/user-roles";



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

/**
 * Work as another of their departments: the role is kept in a cookie and
 * honoured only while it is still one of theirs (lib/session.ts). Lands them
 * on the dashboard, which sends a department to its own page.
 */
export async function switchRoleAction(role: string): Promise<{ ok: false; error: string } | void> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You are not signed in." };
  if (!(user.roles ?? [user.role]).includes(role as Role)) return { ok: false, error: "That is not one of your departments." };
  const store = await cookies();
  if (role === user.primary_role) store.delete(ACTIVE_ROLE_COOKIE);
  else store.set(ACTIVE_ROLE_COOKIE, role, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "role.switch",
    category: "auth",
    details: `Working as ${roleLabel(role)} (was ${roleLabel(user.role)})`,
  });
  redirect("/risansi/dashboard");
}

/** Admin: a person's extra departments, besides their main role. */
export async function saveExtraRolesAction(userId: string, roles: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || (user.primary_role ?? user.role) !== "admin") return { ok: false, error: "Only Admin can give extra departments." };
  const person = (await listUserRoles()).find((u) => u.id === userId);
  if (!person) return { ok: false, error: "Account not found." };
  const chosen = (Array.isArray(roles) ? roles : []).filter((r): r is Role => (EXTRA_ROLE_CHOICES as string[]).includes(r));
  try {
    await setExtraRoles(userId, chosen, person.role, user.id);
  } catch (error) {
    console.error("saveExtraRolesAction failed:", error);
    return { ok: false, error: "Could not save the departments." };
  }
  await logAudit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: "user.roles",
    category: "activity",
    target: person.email,
    details: `Extra departments: ${chosen.filter((r) => r !== person.role).map(roleLabel).join(", ") || "none"}`,
  });
  revalidatePath("/risansi/user-access-control");
  return { ok: true };
}
